/** S04 composition of the existing S02 mailbox and S03/S04 gateway. Explicit attachment only;
 * Build B registers this once over the owned runtime using the existing workflow clock.
 * General and project conversations are never consulted or sent a routine result.
 */
import type { PluginLifecycleRegistration } from "@getpaseo/plugin/server";
import { randomUUID } from "node:crypto";
import type { SupervisionActor, SupervisionEffect, SupervisionStatus } from "../shared/supervision";
import type { InboxOffer } from "../shared/supervision-inbox";
import { continuationAgenda, continuationInputVersion, deriveContinuation, livenessScan } from "./supervision-continuation";
import { effectLogicalKey, expectedFor, refuse, stableId, type SupervisionGateway } from "./supervision-effects";
import type { SupervisionEvents } from "./supervision-events";
import type { SupervisionInbox } from "./supervision-inbox";
import { pendingPriorOffers } from "./supervision-inbox";
import { terminal } from "./supervision-inbox-state";
import type { SupervisorSessions } from "./supervisor-sessions";
import type { SupervisionStore } from "./supervision-store";
import { serialized } from "./serialize";
import { digest } from "./submissions";
import type { PaseoApi } from "./host-types";
import { message, TEMPLATES } from "./templates";
import { INBOX_LIMITS } from "../shared/supervision-inbox";
import { observeWithin, RECOVERY_OBSERVATION_TIMEOUT_MS } from "./supervision-observation";

const ACTOR: SupervisionActor = { kind: "system", id: "supervision-lifecycle", source: "plugin/checked-owner-turn" };
const PENDING = ["reserved", "dispatching", "uncertain", "accepted"];
export type ReconcileTrigger = "event" | "turn-end" | "restart" | "heartbeat";
export interface ScopeWake {
  scopeId: string; state: "idle" | "held" | "accepted" | "uncertain" | "awaiting-owner";
  reason: string; effectId: string | null; offerId: string | null;
}
export class SupervisionLifecycle {
  constructor(readonly store: SupervisionStore, readonly ingress: SupervisionEvents, readonly inbox: SupervisionInbox,
    readonly sessions: SupervisorSessions, readonly gateway: SupervisionGateway, private readonly options: { enabled?: boolean; observationTimeoutMs?: number;
      context?: (status: SupervisionStatus, scopeId: string) => unknown } = {}) {
    if ([ingress.store, inbox.store, sessions.store, gateway.store].some(s => s !== store))
      refuse("CONFLICT", "Lifecycle components must share one authority store.");
  }
  private enabled() { if (!this.options.enabled) refuse("UNSUPPORTED", "Scoped lifecycle attachment is disabled; activation is separate."); }
  assertAttachmentEnabled() { this.enabled(); }

  /** Every trigger rereads durable state. Trigger names/timestamps are not semantic generations. */
  async wake(scopeId: string, _trigger: ReconcileTrigger): Promise<ScopeWake> {
    this.enabled();
    return serialized(`${this.store.root}:lifecycle:${scopeId}`, async () => {
      let s = _trigger === "restart" ? await this.store.audit() : await this.store.read();
      const result = (state: ScopeWake["state"], reason: string, effectId: string | null = null, offerId: string | null = null): ScopeWake =>
        ({ scopeId, state, reason, effectId, offerId });
      const scope = s.scopes.find(v => v.id === scopeId), binding = s.bindings.find(v => v.scopeId === scopeId);
      const backend = s.backends.find(b => b.ownerScopeId === scopeId && b.backend === "scoped");
      if (s.freshness !== "current" || !scope || !["plan", "project"].includes(scope.kind) ||
        (scope.kind === "plan" && (!backend || backend.state !== "active")) || scope.state !== "active" || binding?.state !== "active")
        return result("held", "Owner/backend is unavailable or paused; obligations and reservations remain.");
      // Project conversations consume only their own relevant mailbox/outbox. No portfolio scan,
      // implicit plan, or model summary of routine plan outcomes is introduced here.
      const planGoal = scope.kind === "plan" ? deriveContinuation(s, scopeId, backend!.planId) : null;
      const goal = planGoal ? { ...planGoal, due: planGoal.due && binding.purpose !== "discussion" } :
        { disposition: "waiting", due: false, reason: "No changed project mailbox input.", planId: "", inputVersion: "", nextNodes: [], wakeKey: "" };
      const outboxes = s.outbox.filter(o => o.ownerScopeId === scopeId && o.state === "pending" &&
        s.commands.some(c => c.id === o.causationId && c.actor.kind !== "agent"));
      // Wakes carry bounded identity hints. All pending outboxes remain pageable through scope read;
      // a truncated prompt is never a disposition or an implicit acknowledgement.
      const outboxContext = { outboxIds: outboxes.slice(0, 4).map(o => o.id), pendingOutboxes: outboxes.length,
        ...(this.options.context ? { ownerContext: this.options.context(s, scopeId) } : {}) };
      if (goal.disposition === "paused" || s.operationHolds.some(h => h.scopeId === scopeId && h.state === "held" && h.operations.some(o => o === "model.use" || o === "plan.start")))
        return result("held", "Admissions are paused or held; no owner turn is started.");
      const sends = s.effects.filter(e => e.scopeId === scopeId && e.attemptId === null && e.operation === "agent.send");
      const pending = sends.find(e => PENDING.includes(e.state));
      if (pending) {
        if (pending.epoch !== binding.epoch || pending.state !== "reserved")
          return result("uncertain", "Reconcile the original supervisor turn; no resend or takeover.", pending.id);
        return this.deliver(pending.id, offerForEffect(s, pending)?.id ?? null);
      }
      // Verification/opening and old-actor quiescence are the existing manual replacement gates.
      // Carry its remaining informational facts through S02, never replay the old send effect.
      const oldPages = pendingPriorOffers(s, scopeId, binding.epoch).slice(0, 7);
      if (oldPages.length) {
        await this.inbox.reoffer(scopeId, binding.epoch, stableId("mailbox-reoffer", scopeId, String(binding.epoch), digest(oldPages.map(o => o.id))));
        s = await this.store.read();
        if (pendingPriorOffers(s, scopeId, binding.epoch).length) return result("held", "Retained prior pages need another bounded reconciliation pass.");
      }
      // A delivered page is not handled. No second offer or planning turn may pass its missing result.
      let offer = s.inbox.offers.find(o => o.scopeId === scopeId && o.epoch === binding.epoch && o.state !== "retired" &&
        (o.state !== "acknowledged" || s.inbox.assignments.some(a => a.offerId === o.id && !terminal(a))));
      if (offer && offer.state !== "prepared") {
        const effect = sends.find(e => offerForEffect(s, e)?.id === offer!.id);
        if (offer.state === "uncertain" && effect?.state === "succeeded") {
          await this.settleOffer(effect, offer.id);
          return result("accepted", "Recovered the committed send result; owner acknowledgement is still required.", effect.id, offer.id);
        }
        return result(offer.state === "uncertain" ? "uncertain" : "awaiting-owner",
          "The current page needs its owner's explicit acknowledgement and per-event results.", effect?.id ?? null, offer.id);
      }
      let observed;
      try { observed = await observeWithin(this.gateway.receiver, `agent:${binding.agentId}`, () => this.gateway.receiver.findAgent(binding.agentId), this.options.observationTimeoutMs); }
      catch { return result("held", "This owner's observation is unavailable; identity and obligations remain unknown, not absent."); }
      // Optional projection metadata, excluded from the continuation's semantic inputs. A status
      // read never performs this lookup and this bookkeeping cannot wake itself.
      if (observed?.id === binding.agentId) {
        const observedState = observed.archivedAt ? "unknown" as const : observed.status === "idle" ? "dormant" as const : observed.status === "running" || observed.status === "initializing" ? "awake" as const : "unknown" as const;
        const projectionState = await this.store.read(), current = projectionState.bindings.find(b => b.scopeId === scopeId);
        if (current?.epoch === binding.epoch && current.state === binding.state &&
          (!current.observation || Date.now() - Date.parse(current.observation.at) >= 60000 ||
            current.observation.state !== observedState)) {
          const mutations = [{ kind: "binding" as const, value: { ...current, observation: {
            state: observedState,
            at: new Date().toISOString() } } }];
          await this.store.transact(expectedFor(projectionState, mutations), randomUUID(), mutations);
        }
      }
      if (observed?.id !== binding.agentId || observed.archivedAt || observed.status !== "idle" || observed.pendingPermissions)
        return result("held", "Wait for this exact owner to be idle; General's turn is irrelevant.");
      if (!offer && s.inbox.assignments.some(a => a.scopeId === scopeId && a.state === "assigned")) {
        const prepared = await this.inbox.prepare(scopeId, binding.epoch, true);
        s = await this.store.read(); offer = s.inbox.offers.find(o => o.id === prepared.resultIds[0]);
      }
      if (offer) {
        const page = offer, text = await message(TEMPLATES.scopeFacts, { contextJson: JSON.stringify({ kind: "scoped-facts", scopeId, epoch: binding.epoch,
          offerId: page.id, events: page.eventIds.map(id => s.inbox.events.find(e => e.id === id)), ...outboxContext }).replace(/</g, "\\u003c") });
        if (Buffer.byteLength(text) > INBOX_LIMITS.pageBytes) refuse("HELD", "Owner context exceeds its bounded page; all facts remain retained.");
        const cause = offerCause(page);
        const effectId = await this.sessions.reserveTurnWith({ requestId: stableId("mailbox-turn", cause), scopeId, epoch: binding.epoch, causation: cause, text }, ACTOR, current => {
          const row = current.inbox.offers.find(o => o.id === page.id);
          if (!row || row.version !== page.version || row.state !== "prepared" || row.sends >= 3 || (row.nextAttemptAt && Date.parse(row.nextAttemptAt) > Date.now()))
            refuse("STALE", "Offer changed before its counted send reservation.");
          return [{ kind: "inbox-offer", value: { ...row, state: "uncertain", sends: row.sends + 1,
            lastAttemptAt: new Date().toISOString(), nextAttemptAt: null, version: row.version + 1 } }];
        });
        return this.deliver(effectId, page.id);
      }
      if (!goal.due && !outboxes.length) return result("idle", goal.reason);
      if (!planGoal && !this.options.context) return result("held", "Project plan-command outboxes have no qualified handler yet; retain the input without a model summary or General fallback.");
      const cause = planGoal ? `continuation:${goal.wakeKey}` : `project-judgment:${digest(outboxes.map(o => [o.id, o.subjectHash]))}`,
        prior = sends.find(e => e.logicalKey === turnKey(scopeId, binding.epoch, cause));
      if (prior) return result("awaiting-owner", "This semantic generation was already offered; an unchanged retry is not progress. The unfinished obligation remains due.", prior.id);
      const text = await message(binding.purpose === "discussion" ? TEMPLATES.scopeFacts : TEMPLATES.scopeContinuation, { contextJson: JSON.stringify({ kind: binding.purpose === "discussion" ? "discussion-outbox" : "unfinished-goal", scopeId, epoch: binding.epoch,
        planId: goal.planId, inputVersion: goal.inputVersion, nextNodes: goal.nextNodes, disposition: goal.disposition, reason: goal.reason, ...outboxContext }).replace(/</g, "\\u003c") });
      if (Buffer.byteLength(text) > INBOX_LIMITS.pageBytes) refuse("HELD", "Owner context exceeds its bounded page; the obligation remains due.");
      const effectId = await this.sessions.reserveTurnWith({ requestId: stableId("continuation-turn", cause), scopeId, epoch: binding.epoch, causation: cause, text }, ACTOR, current => {
        if (planGoal ? continuationInputVersion(current, scopeId, goal.planId) !== goal.inputVersion : digest(current.outbox.filter(o => o.ownerScopeId === scopeId && o.state === "pending" &&
          current.commands.some(c => c.id === o.causationId && c.actor.kind !== "agent")).map(o => [o.id, o.subjectHash])) !== digest(outboxes.map(o => [o.id, o.subjectHash]))) refuse("STALE", "Relevant facts changed before this owner pass was reserved.");
        return [];
      });
      return this.deliver(effectId, null);
    });
  }
  private async deliver(effectId: string, offerId: string | null): Promise<ScopeWake> {
    const effect = await this.gateway.dispatch(effectId);
    if (offerId && effect.state === "succeeded")
      await this.settleOffer(effect, offerId);
    return { scopeId: effect.scopeId, state: effect.state === "succeeded" ? "accepted" : effect.state === "failed" ? "held" : "uncertain",
      reason: effect.state === "failed" ? effect.receiptRef ?? "Definite receiver refusal; spend retained, no automatic retry." : "Send result retained; transport acceptance handles no event or goal.", effectId, offerId };
  }
  private async settleOffer(effect: SupervisionEffect, offerId: string) {
    try { await this.inbox.accepted(effect.scopeId, effect.epoch, offerId, stableId("offer-accepted", effect.id)); }
    catch (error) {
      // A fast owner's explicit ack or a held transfer may precede this late send result.
      // Preserve it in the effect; never regress the page or apply it to the replacement epoch.
      const s = await this.store.read(), offer = s.inbox.offers.find(o => o.id === offerId);
      if (s.freshness !== "current" || !offer || !["acknowledged", "retired"].includes(offer.state)) throw error;
    }
  }

  /** The existing restart/heartbeat path may call this explicitly; no new timer. Reconcile intents
   * before wake, retain unknown effects, and persist exact worker observations through S02 ingress.
   * A read/transport failure affects its own subject, never serializes unrelated scope admissions. */
  async recover(trigger: "restart" | "heartbeat", paseo?: PaseoApi) {
    this.enabled();
    const before = await this.store.audit();
    if (before.freshness !== "current") refuse("HELD", "Recovery audit failed; retain authority and reconcile the journal/index before any receiver call.");
    const selected = before.effects.filter(e => ["dispatching", "uncertain"].includes(e.state)).slice(0, 32);
    const projects = before.scopes.filter(s => s.kind === "project" && s.state === "active" &&
      (before.inbox.assignments.some(a => a.scopeId === s.id && !terminal(a)) || before.outbox.some(o => o.ownerScopeId === s.id && o.state === "pending"))).map(s => s.id);
    const scopeIds = [...new Set([...continuationAgenda(before).map(c => c.scopeId), ...selected.map(e => e.scopeId), ...projects])];
    const scopes = await Promise.all(scopeIds.map(async scopeId => {
      let effects: PromiseSettledResult<SupervisionEffect>[] = [], observations: Awaited<ReturnType<typeof livenessScan>> = [];
      let wake: PromiseSettledResult<ScopeWake>;
      try {
        // No all-scope barrier: each owner wakes as soon as its own bounded observations finish.
        if (paseo) {
          try { await observeWithin(this.ingress, `${this.store.root}:catalog:${scopeId}`, () => this.ingress.reconcile(paseo, scopeId), this.options.observationTimeoutMs); }
          catch {
            const tasks = before.tasks.filter(t => t.ownerScopeId === scopeId);
            for (const a of before.attempts.filter(a => a.worker?.hostId === "local" && tasks.some(t => t.id === a.taskId)))
              await this.ingress.recordGap("catalog", a.worker!.agentId, null, ["fetch-failed"]);
          }
        }
        effects = await Promise.allSettled(selected.filter(e => e.scopeId === scopeId).map(e =>
          observeWithin(this.gateway, `${this.store.root}:effect:${e.id}`, () => this.gateway.reconcile(e.id), this.options.observationTimeoutMs)));
        observations = await livenessScan(await this.store.read(), this.gateway.receiver, { scopeId, timeoutMs: this.options.observationTimeoutMs ?? RECOVERY_OBSERVATION_TIMEOUT_MS });
        for (const row of observations) await this.ingress.admit({ agentId: row.agentId, kind: "catalog", turnId: null, outcome: null,
          permissionId: null, sourceKind: "catalog", sourceKey: digest([row.attemptId, row.observed]), epoch: null, cursor: null, maxSeq: null,
          gaps: row.observed.startsWith("not visible") ? ["fetch-failed"] : [], coverage: "unknown",
          payload: { status: row.observed, requiresAttention: row.ownerReview, attemptId: row.attemptId } });
        wake = { status: "fulfilled", value: await this.wake(scopeId, trigger) };
      } catch (reason) { wake = { status: "rejected", reason }; }
      return { effects, observations, wake };
    }));
    return { effects: scopes.flatMap(s => s.effects), observations: scopes.flatMap(s => s.observations), wakes: scopes.map(s => s.wake) };
  }
  /** Explicit local operator step after a held checkpoint-only recovery audit. The live
   * attachment must qualify who can invoke it; there is no public request-file/RPC route.
   * It restores derived index metadata only and never performs receiver effects.
   */
  async recoverIndex(observed: { homeId: string; sequence: number; hash: string | null }) {
    this.enabled();
    const before = await this.store.audit();
    if (before.homeId !== observed.homeId || before.sequence !== observed.sequence || before.hash !== observed.hash)
      refuse("STALE", "Recovery observation changed; inspect the held journal again.");
    if (before.freshness !== "held" || !before.problems.some(p => p.startsWith("Checkpoint validation failed;")))
      refuse("HELD", "Only a fully validated journal with a stale/missing checkpoint can rebuild its index.");
    await this.store.recoverIndex(observed);
    const after = await this.store.audit();
    if (after.freshness !== "current") refuse("HELD", "Index recovery did not yield a current audited journal.");
    return { homeId: after.homeId, sequence: after.sequence, hash: after.hash };
  }
}
const offerCause = (o: InboxOffer) => `mailbox:${o.id}:${o.sends}`;
const turnKey = (scopeId: string, epoch: number, causation: string) => effectLogicalKey({ scopeId, subject: `epoch:${epoch}`, operation: "agent.send", causation, objectiveRevision: 0 });
function offerForEffect(s: SupervisionStatus, e: SupervisionEffect) {
  // The offer claim increments sends atomically with reservation; the key contains the prior count.
  return s.inbox.offers.find(o => o.scopeId === e.scopeId && o.epoch === e.epoch && o.sends > 0 &&
    turnKey(e.scopeId, e.epoch, `mailbox:${o.id}:${o.sends - 1}`) === e.logicalKey);
}

/** Concrete hook attachment for a separately qualified, default-off operating runtime.
 * Supervisor turn ends assess the same durable generation. Worker hooks persist facts before wake. */
export function registerSupervisionLifecycle(server: PluginLifecycleRegistration, lifecycle: SupervisionLifecycle) {
  lifecycle.assertAttachmentEnabled();
  const wakeAgent = async (agentId: string) => {
    const s = await lifecycle.store.read();
    const ids = new Set([...s.bindings.filter(b => b.agentId === agentId).map(b => b.scopeId),
      ...s.attempts.filter(a => a.worker?.agentId === agentId).flatMap(a => s.tasks.filter(t => t.id === a.taskId).map(t => t.ownerScopeId))]);
    await Promise.all([...ids].map(id => lifecycle.wake(id, "event")));
  };
  const registered = async (agentId: string) => (await lifecycle.store.read()).attempts.some(a => a.worker?.hostId === "local" && a.worker.agentId === agentId);
  const disposers = [server.on("agent.turn_ended", async (e, { paseo }) => {
    const owner = (await lifecycle.store.read()).bindings.find(b => b.agentId === e.agent.id);
    if (owner) await lifecycle.wake(owner.scopeId, "turn-end");
    else if (await registered(e.agent.id)) { await lifecycle.ingress.ended(e, paseo); await wakeAgent(e.agent.id); }
  }), server.on("agent.permission_requested", async e => {
    if (await registered(e.agent.id)) { await lifecycle.ingress.permission(e.agent.id, e.request.id); await wakeAgent(e.agent.id); }
  }), server.on("agent.permission_resolved", async e => {
    if (await registered(e.agent.id)) { await lifecycle.ingress.permission(e.agent.id, e.requestId, true); await wakeAgent(e.agent.id); }
  })];
  return () => disposers.forEach(dispose => dispose());
}
