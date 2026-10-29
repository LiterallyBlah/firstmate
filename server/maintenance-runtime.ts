/** Default-off Build D. One owned workflow clock, S10 observe records and exception-only owner turns.
 * Only the captain-app admission creates an owner. No Attach, timer mutation, worker dispatch or deletion executor.
 */
import { readdir, readFile, stat } from "node:fs/promises";
import { z } from "zod";
import type { PluginServerContext } from "@getpaseo/plugin/server";
import type { GatewayReceiver } from "../shared/supervision-effects";
import type { SupervisionActor, SupervisionStatus } from "../shared/supervision";
import type { MaintenanceIncident, MaintenanceJob } from "../shared/supervision-maintenance";
import { maintenanceSummary } from "../shared/supervision-maintenance";
import { MaintenanceCommandSchema, MaintenanceCensusSchema, MaintenanceRuntimeSnapshotSchema, readMaintenance, readMaintenanceTimers, readMaintenanceSummary,
  administerMaintenance, admitMaintenanceFromUi, answerMaintenanceFromUi, type MaintenanceAnswer, type AdmitMaintenance, type MaintenanceCensus, type MaintenanceCommand } from "../shared/maintenance-runtime";
import { readFirstmateConfig, resolveHome } from "./config";
import { requireNoMigration } from "./mate";
import { workflowHomeIdentity } from "./workflow-ownership";
import { SupervisionRuntime } from "./supervision-runtime";
import { SupervisionJobs, maintenanceIncidentNote, JobInputSchema, type TimerInventory } from "./supervision-jobs";
import { SupervisionResources, maintenanceRows, refuse } from "./supervision-resources";
import { SupervisionCommands } from "./supervision-commands";
import { SupervisionGateway, stableId, expectedFor } from "./supervision-effects";
import { SupervisorSessions, activationEffects, supervisorSpend } from "./supervisor-sessions";
import { SupervisionUiReceiver } from "./supervision-ui-receiver";
import { executorApproval } from "./supervision-capabilities";
import { serialized } from "./serialize";
import { digest, publish } from "./submissions";
import { resolveInHome } from "./files";
import { observeWithin } from "./supervision-observation";
import type { SupervisionStore } from "./supervision-store";
import type { PaseoApi } from "./host-types";
import { admitMaintenanceOwner, maintenanceAdmission } from "./maintenance-admission";
import { MaintenanceDecisions, maintenanceCaptainDecisions, maintenanceAnswerDelivery, maintenanceAnswerRequest, maintenanceAnswerOwner } from "./maintenance-decisions";

const SYSTEM: SupervisionActor = { kind: "system", id: "maintenance-runtime", source: "plugin/maintenance-incident" };
const requestFor = (incident: MaintenanceIncident) => stableId("maintenance-incident-turn", incident.id, String(incident.generation));
const delivery = (s: SupervisionStatus, i: MaintenanceIncident) => s.effects.find(e => e.requestId === requestFor(i) && e.attemptId === null && e.operation === "agent.send");
const inputFor = (j: MaintenanceJob) => JobInputSchema.parse({ jobId: j.id, expectedVersion: j.version, scopeId: j.scopeId, name: j.name,
  domain: j.domain, schedule: j.schedule, hosts: j.hosts, resource: j.resource, selectors: j.selectors, retained: j.retained, mode: j.mode,
  legacyTimer: j.legacyTimer, budget: j.budget, maxPasses: j.maxPasses });

export interface MaintenanceRuntimeOptions {
  enabled?: boolean; config?: typeof readFirstmateConfig; now?: () => string;
  inventory: (home: string, config: Awaited<ReturnType<typeof readFirstmateConfig>>, jobs: readonly MaintenanceJob[]) => Promise<TimerInventory>;
  receiver?: (paseo: PaseoApi) => GatewayReceiver; observationTimeoutMs?: number;
  headroom?: { slots: number; reserved: number };
}
export class MaintenanceRuntime {
  private paseo: PaseoApi | null = null;
  private minute: string | null = null;
  private closed = false;
  private readonly receivers = new WeakMap<PaseoApi, GatewayReceiver>();
  private readonly headroom: { slots: number; reserved: number };
  constructor(readonly runtime: SupervisionRuntime, private readonly options: MaintenanceRuntimeOptions) {
    const { slots, reserved } = options.headroom ?? { slots: 4, reserved: 1 };
    if (!Number.isSafeInteger(slots) || !Number.isSafeInteger(reserved) || reserved < 1 || slots <= reserved)
      throw new Error("Maintenance capacity must retain the configured General headroom.");
    this.headroom = { slots, reserved };
  }
  private config() { return (this.options.config ?? readFirstmateConfig)(); }
  private now() { return this.options.now?.() ?? new Date().toISOString().replace(/\.\d{3}Z$/, "Z"); }
  private receiver(paseo: PaseoApi) {
    let receiver = this.receivers.get(paseo);
    if (!receiver) { receiver = this.options.receiver?.(paseo) ?? new SupervisionUiReceiver(paseo, this.runtime.root, { maintenanceMates: true }); this.receivers.set(paseo, receiver); }
    return receiver;
  }
  remember(paseo: PaseoApi) { if (!this.closed) this.paseo = paseo; }
  stop() { this.closed = true; this.paseo = null; }
  private async checked(homeId: string) {
    if (!this.options.enabled || this.closed) refuse("UNSUPPORTED", "Maintenance is disabled; no writer or model was created.");
    const config = await this.config(); requireNoMigration(config);
    const home = resolveHome(config);
    if (workflowHomeIdentity(home) !== homeId) refuse("STALE", "Maintenance home changed; refresh before acting.");
    return { config, home };
  }
  async read() {
    const config = await this.config(), s = await this.runtime.read(resolveHome(config)), rows = maintenanceRows(s), summary = maintenanceSummary(s);
    const approval = executorApproval({ installedVersion: null }); // No executor or live qualification ships here.
    return MaintenanceRuntimeSnapshotSchema.parse({ enabled: !!this.options.enabled && !this.closed, homeId: s.homeId, sequence: s.sequence,
      freshness: s.freshness, lowerBound: summary.lowerBound, problems: summary.problems,
      cleanup: { state: "held", reason: "G8: automatic cleanup is held; no qualified no-follow executor or reviewed installed-version reader evidence.",
        conditions: approval.conditions.map(c => ({ id: c.id, satisfied: c.satisfied, reasons: c.reasons })) }, ...rows,
      owners: s.scopes.filter(scope => scope.kind === "maintenance").map(scope => {
        const b = s.bindings.find(b => b.scopeId === scope.id);
        return { scopeId: scope.id, state: scope.state, agentId: b?.agentId ?? null, epoch: b?.epoch ?? 0, ...supervisorSpend(s, scope.id),
          admission: maintenanceAdmission(s, scope.id), opening: b ? activationEffects(s, scope.id, b.epoch).send?.state ?? null : null };
      }),
      deliveries: rows.incidents.map(i => { const e = delivery(s, i); return { incidentId: i.id, generation: i.generation, effectId: e?.id ?? null,
        state: i.notify.state === "handled" ? "handled" : e?.state ?? (i.notify.state === "held-budget" || i.kind === "budget" ? "held-budget" : "awaiting-owner") }; }),
      captainDecisions: maintenanceCaptainDecisions(s), decisions: s.decisions.filter(d => d.maintenance), outbox: s.outbox.filter(o => o.maintenance),
    });
  }
  async summary() { return maintenanceSummary(await this.runtime.read(resolveHome(await this.config()))); }
  async admit(input: AdmitMaintenance, paseo: PaseoApi) {
    await this.checked(input.homeId); this.remember(paseo);
    await admitMaintenanceOwner(this.runtime, input, this.receiver(paseo), id => this.checked(id), this.headroom);
    return this.read();
  }
  async answer(input: MaintenanceAnswer, paseo: PaseoApi) {
    const { home } = await this.checked(input.homeId); this.remember(paseo);
    await this.runtime.mutate(home, store => new MaintenanceDecisions(store, id => this.checked(id), () => this.now()).answer(input));
    return this.read();
  }
  /** Fresh actual script/managed/native census, with no store acquisition, timer write or model wake. */
  async census(): Promise<MaintenanceCensus> {
    const config = await this.config(), home = resolveHome(config), status = await this.runtime.read(home);
    const inventory = await this.options.inventory(home, config, maintenanceRows(status).jobs);
    const managed = inventory.rows.filter(r => r.kind === "managed-watch" && /take[\s_-]*the[\s_-]*initiative/i.test(r.name));
    const reminders = inventory.rows.filter(r => r.kind === "native-heartbeat" && /fleet|initiative/i.test(r.name));
    const problems = [...inventory.problems, ...status.problems];
    if (managed.length !== 1) problems.push("Take-the-Initiative needs exact managed-owner reconciliation; do not create a native fleet reminder.");
    if (reminders.some(r => r.enabled)) problems.push("An overlapping native fleet/initiative reminder is still enabled; retirement needs its known owner's evidence.");
    const body = { homeId: status.homeId, complete: inventory.complete && status.freshness === "current", problems,
      rows: inventory.rows, hashes: inventory.hashes, initiative: { managed: managed.map(r => r.id), nativeReminders: reminders.map(r => r.id),
        disposition: managed.length === 1 && !reminders.some(r => r.enabled) ? "managed-owner-retained" : "held-reconciliation" } };
    return MaintenanceCensusSchema.parse({ ...body, capturedAt: this.now(), fingerprint: digest(body) });
  }
  async admin(raw: { homeId: string; requestId: string; actorId: string; command: MaintenanceCommand }) {
    const command = MaintenanceCommandSchema.parse(raw.command), { config, home } = await this.checked(raw.homeId);
    return serialized(`${this.runtime.root}:maintenance-admin:${raw.homeId}`, async () => {
      await this.runtime.mutate(home, async store => {
        await this.checked(raw.homeId);
        const s = await store.read(), requestHash = digest({ ...raw, command });
        const accepted = s.commands.find(c => c.id === raw.requestId);
        if (accepted) {
          if (accepted.result.maintenanceRequest?.inputHash !== requestHash) refuse("CONFLICT", "Maintenance request ID has different content or belongs to another command.");
          return; // Exact accepted replay: no current-version, owner, timer or retirement preflight can re-execute it.
        }
        // Same-user role convention only. General records administration; actual bound owners may observe/ack.
        const general = raw.actorId === config.mateAgentId && !!config.mateAgentId;
        const actor: SupervisionActor = { kind: general ? "mate-chat" : "agent", id: raw.actorId, source: "maintenance request (unverified same-user role)" };
        if (!["observe", "ack", "escalate", "answer-handled"].includes(command.op) && !general) refuse("UNKNOWN_OWNER", "Only the current first mate records maintenance administration.");
        const commandCheck = async (current: SupervisionStatus) => {
          const fresh = await this.checked(raw.homeId);
          if (general && fresh.config.mateAgentId !== raw.actorId) refuse("STALE", "General changed before maintenance commit.");
          if (command.op === "state" && command.state === "active" && maintenanceRows(current).jobs.find(j => j.id === command.jobId)?.mode !== "observe")
            refuse("HELD", "G8 holds automatic cleanup; only observe jobs can activate.");
          if (command.op === "job") {
            const prior = maintenanceRows(current).jobs.find(j => j.id === command.input.jobId);
            if ((prior?.legacyTimer.disposition === "retired" || command.input.legacyTimer.disposition === "retired") && digest(prior?.legacyTimer ?? null) !== digest(command.input.legacyTimer))
              refuse("HELD", "Record retirement through fresh evidence; retained retirement evidence cannot be overwritten by job editing.");
          }
          if (command.op === "job" && maintenanceRows(current).jobs.find(j => j.id === command.input.jobId)?.hosts.some(h => !command.input.hosts.includes(h)))
            refuse("HELD", "Keep every approved host in coverage, including offline or held hosts; reducing coverage needs separate reconciliation.");
          if (command.op === "retired") {
            const census = await this.census();
            if (!census.complete || census.fingerprint !== command.inventoryHash) refuse("STALE", "Timer census changed before retirement commit.");
          }
          if (command.op === "ack") {
            const i = maintenanceRows(current).incidents.find(i => i.id === command.incidentId), j = maintenanceRows(current).jobs.find(j => j.id === i?.jobId);
            const b = current.bindings.find(b => b.scopeId === j?.scopeId), effect = i && delivery(current, i);
            if (!b || b.agentId !== raw.actorId || b.state !== "active" || b.epoch !== command.epoch || effect?.epoch !== b.epoch || effect.state !== "succeeded")
              refuse("HELD", "Only the exact delivered maintenance owner/epoch acknowledges this incident; uncertain sends stay held.");
          }
        };
        const options = { enabled: true, now: () => this.now(), requestHash, commandCheck }, jobs = new SupervisionJobs(store, options);
        if (command.op === "job") {
          await jobs.defineJob(raw.requestId, actor, command.input);
        } else if (command.op === "state") {
          await jobs.setState(raw.requestId, actor, command);
        } else if (command.op === "observe") await jobs.observe(raw.requestId, actor, command.input);
        else if (command.op === "escalate") await new MaintenanceDecisions(store, id => this.checked(id), () => this.now()).escalate(raw.requestId, actor, command.input, requestHash);
        else if (command.op === "answer-handled") await new MaintenanceDecisions(store, id => this.checked(id), () => this.now()).handled(raw.requestId, actor, command, requestHash, config.mateAgentId);
        else if (command.op === "ack") {
          await jobs.acknowledge(raw.requestId, { kind: "agent", id: raw.actorId, source: actor.source }, command);
        } else if (command.op === "retired") {
          const census = await this.census(), job = maintenanceRows(s).jobs.find(j => j.id === command.jobId);
          const row = census.rows.find(r => r.id === command.timerId);
          if (!census.complete || census.fingerprint !== command.inventoryHash) refuse("STALE", "Timer census changed or is incomplete; reread before recording retirement.");
          if (!job || job.version !== command.expectedVersion) refuse("STALE", "Maintenance job changed.");
          const key = job.legacyTimer.kind === "script-watch" ? "script:" : job.legacyTimer.kind === "managed-watch" ? "managed:" : "native:";
          if (!row || row.id !== `${key}${job.legacyTimer.id}` || row.owner === "unknown" || row.enabled || row.kind === "plugin-interval")
            refuse("HELD", "Retirement needs the exact known-owner timer freshly observed disabled; unknown/missing timers stay held.");
          if (row.kind === "managed-watch" && census.initiative.managed.includes(row.id)) refuse("HELD", "Retain managed Take-the-Initiative; maintenance does not replace the initiative owner.");
          const input = inputFor(job);
          input.legacyTimer = { ...job.legacyTimer, disposition: "retired", evidence: [...command.evidence,
            { ref: `timer-census:${row.id}`, digest: census.fingerprint }].slice(-32) };
          await jobs.defineJob(raw.requestId, actor, input);
        } else if (command.op === "reconcile-items") await jobs.reconcileItems(raw.requestId, actor, command);
        else {
          const resources = new SupervisionResources(store, options);
          if (command.op === "resource-release") {
            const { op: _op, ...release } = command; await resources.release(raw.requestId, actor, release);
          }
          else if (command.op === "resource-reserve") {
            const { op: _op, ...reservation } = command; await resources.reserveForEffect(raw.requestId, actor, reservation);
          } else if (command.op === "resource-promote") {
            const { op: _op, ...promotion } = command; await resources.promote(raw.requestId, actor, promotion);
          } else if (command.op === "resource-renew") {
            const { op: _op, ...renewal } = command; await resources.renew(raw.requestId, actor, renewal);
          }
          else if (command.op === "resource-expire") await resources.expire(raw.requestId, actor);
        }
      });
      return this.read();
    });
  }
  /** Existing clock only. It never borrows General's conversation lock. No jobs means no writer. */
  async tick() {
    if (!this.options.enabled || this.closed) return;
    const config = await this.config(), home = resolveHome(config);
    if (config.migration || config.mateLaunch) return;
    await this.processRequests(home);
    const minute = this.now().slice(0, 16);
    if (this.minute === minute) return;
    this.minute = minute;
    const before = await this.runtime.read(home);
    if (before.freshness !== "current" || !maintenanceRows(before).jobs.some(j => j.state === "active" && j.mode === "observe") && !before.outbox.some(o => o.maintenance && o.state === "pending")) return;
    await this.runtime.mutate(home, async store => {
      await this.checked(before.homeId);
      const jobs = new SupervisionJobs(store, { enabled: true, now: () => this.now(), observeOnly: true });
      await jobs.tick();
      await new MaintenanceDecisions(store, id => this.checked(id), () => this.now()).budgets();
      if (this.paseo) await this.deliver(store, home, this.paseo);
    });
  }
  private incidentGuard(s: SupervisionStatus, i: MaintenanceIncident, generalId: string) {
    const row = maintenanceRows(s).incidents.find(r => r.id === i.id), job = maintenanceRows(s).jobs.find(j => j.id === row?.jobId);
    const scope = s.scopes.find(scope => scope.id === job?.scopeId), binding = s.bindings.find(b => b.scopeId === scope?.id);
    if (!row || row.version !== i.version || row.generation !== i.generation || row.state !== "open" || row.notify.state !== "pending" || row.kind === "budget" ||
      !job || job.state !== "active" || job.mode !== "observe" || job.budget === null || job.spentTurns > job.budget.turns ||
      scope?.kind !== "maintenance" || scope.state !== "active" || !binding || binding.state !== "active" || binding.purpose === "discussion" ||
      binding.hostId !== "local" || binding.agentId === generalId || activationEffects(s, scope.id, binding.epoch).send?.state !== "succeeded")
      refuse("HELD", "Incident/owner/budget changed or maintenance opening is unconfirmed; no exception turn is admitted.");
    return { job, binding, row };
  }
  private async deliver(store: SupervisionStore, home: string, paseo: PaseoApi) {
    const initial = await store.read();
    const scopes = [...new Set([...maintenanceRows(initial).jobs.filter(j => j.state === "active" && j.mode === "observe").map(j => j.scopeId),
      ...initial.outbox.filter(o => o.maintenance && o.state === "pending").map(o => o.ownerScopeId)])];
    // Per-scope queues/timeout: a stuck native lookup cannot serialize unrelated maintenance owners.
    await Promise.allSettled(scopes.map(scopeId => serialized(`${store.root}:maintenance-owner:${scopeId}`, async () => {
      await this.withdrawObsoleteUnsent(store, scopeId);
      const receiver = this.receiver(paseo);
      await this.deliverAnswer(store, home, receiver, scopeId);
      const current = await store.read();
      const incidents = maintenanceRows(current).incidents.filter(i => i.state === "open" && i.notify.state === "pending" && i.kind !== "budget" && delivery(current, i)?.state !== "succeeded" &&
        maintenanceRows(initial).jobs.some(j => j.id === i.jobId && j.scopeId === scopeId)).slice(0, 1);
      for (const incident of incidents) {
        const s = await store.read(), { config } = await this.checked(s.homeId), { job, binding } = this.incidentGuard(s, incident, config.mateAgentId);
        const admission = maintenanceAdmission(s, scopeId);
        if (!admission) refuse("HELD", "Maintenance owner limits are unknown; record explicit app admission rather than infer a turn cap.");
        let effect = delivery(s, incident);
        if (effect && (effect.epoch !== binding.epoch || effect.state !== "reserved")) return;
        const commands = new SupervisionCommands(store, home, { enabled: true });
        const gateway = new SupervisionGateway(store, commands, home, receiver, { enabled: true, admissionCheck: async (current, effect) => {
          const { config } = await this.checked(current.homeId);
          this.incidentGuard(current, incident, config.mateAgentId);
          if (effect.requestId !== requestFor(incident) || effect.scopeId !== scopeId || effect.operation !== "agent.send" || effect.attemptId !== null)
            refuse("HELD", "Maintenance only admits its reserved incident notification; corrective plans use the checked plan runtime/rules.");
        } });
        const sessions = new SupervisorSessions(store, gateway, receiver, { enabled: true, globalMateId: async () => (await this.config()).mateAgentId || null,
          limits: { supervisorSessions: 1, supervisorTurns: Math.min(admission.limits.supervisorTurns,
            1 + maintenanceRows(s).jobs.filter(j => j.scopeId === scopeId).reduce((sum, j) => sum + (j.budget?.turns ?? 0), 0)) } });
        if (!effect) {
          const note = await maintenanceIncidentNote(job, incident);
          if (!note || Buffer.byteLength(note) > 16 * 1024) refuse("HELD", "Incident context exceeds its bounded page.");
          const effectId = await sessions.reserveTurnWith({ requestId: requestFor(incident), scopeId, epoch: binding.epoch,
            causation: `maintenance:${incident.id}:${incident.generation}`, text: note,
            maintenanceIncident: { incidentId: incident.id, generation: incident.generation, jobId: job.id } }, SYSTEM, current => {
            this.incidentGuard(current, incident, config.mateAgentId); return [];
          });
          effect = (await store.read()).effects.find(e => e.id === effectId)!;
        }
        await observeWithin(receiver, `maintenance-send:${effect.id}`, () => gateway.dispatch(effect!.id), this.options.observationTimeoutMs);
      }
    })));
  }
  private async deliverAnswer(store: SupervisionStore, home: string, receiver: GatewayReceiver, scopeId: string) {
    const s = await store.read(), outbox = s.outbox.find(o => o.maintenance && o.state === "pending" && o.ownerScopeId === scopeId && maintenanceAnswerDelivery(s, o)?.state !== "succeeded");
    if (!outbox) return;
    const { config } = await this.checked(s.homeId), { decision, binding } = maintenanceAnswerOwner(s, outbox, config.mateAgentId);
    const admission = maintenanceAdmission(s, scopeId);
    if (!admission) refuse("HELD", "Maintenance answer delivery requires the original captain-app session/turn limits.");
    let effect = maintenanceAnswerDelivery(s, outbox);
    if (effect && (effect.epoch !== binding.epoch || effect.state !== "reserved")) return;
    const gateway = new SupervisionGateway(store, new SupervisionCommands(store, home, { enabled: true }), home, receiver, { enabled: true,
      admissionCheck: async (current, candidate) => {
        const { config } = await this.checked(current.homeId), actual = current.outbox.find(o => o.id === outbox.id);
        if (!actual || digest(actual) !== digest(outbox)) refuse("STALE", "Maintenance answer outbox changed before its send.");
        maintenanceAnswerOwner(current, actual, config.mateAgentId);
        if (candidate.requestId !== maintenanceAnswerRequest(actual) || candidate.scopeId !== scopeId || candidate.attemptId !== null || candidate.operation !== "agent.send")
          refuse("HELD", "Only the exact checked maintenance answer notification is admitted.");
      } });
    const sessions = new SupervisorSessions(store, gateway, receiver, { enabled: true, limits: admission.limits,
      globalMateId: async () => (await this.config()).mateAgentId || null });
    if (!effect) {
      const text = `Captain maintenance choice (client UI, unverified): ${JSON.stringify({ decision, outbox })}\nThis answer is an instruction to the logical maintenance owner, never a budget grant or work authority. Record handling with maintenance answer-handled, outboxId ${outbox.id}, epoch ${binding.epoch}, and checked result evidence. Budget edits and corrective work retain their existing reviewed guards.`;
      if (Buffer.byteLength(text) > 32 * 1024) refuse("HELD", "Maintenance answer exceeds its bounded context page.");
      const effectId = await sessions.reserveTurnWith({ requestId: maintenanceAnswerRequest(outbox), scopeId, epoch: binding.epoch,
        causation: `maintenance-answer:${outbox.id}`, text }, SYSTEM, current => {
        const actual = current.outbox.find(o => o.id === outbox.id);
        if (!actual || digest(actual) !== digest(outbox)) refuse("STALE", "Maintenance answer changed before reservation.");
        maintenanceAnswerOwner(current, actual, config.mateAgentId); return [];
      });
      effect = (await store.read()).effects.find(e => e.id === effectId)!;
    }
    await observeWithin(receiver, `maintenance-answer-send:${effect.id}`, () => gateway.dispatch(effect!.id), this.options.observationTimeoutMs);
  }
  /** A new generation can supersede only its never-claimed notification. No inferred native absence or refund. */
  private async withdrawObsoleteUnsent(store: SupervisionStore, scopeId: string) {
    const before = await store.read();
    for (const effect of before.effects.filter(e => e.scopeId === scopeId && e.attemptId === null && e.operation === "agent.send" &&
      e.state === "reserved" && e.maintenanceIncident)) {
      const identity = effect.maintenanceIncident!;
      const incident = maintenanceRows(before).incidents.find(i => i.id === identity.incidentId && i.jobId === identity.jobId);
      if (!incident || incident.state === "open" && incident.generation === identity.generation ||
        effect.requestId !== stableId("maintenance-incident-turn", identity.incidentId, String(identity.generation))) continue;
      await store.transactCommand(stableId("maintenance-withdraw-unsent", effect.id), digest({ effect: effect.id, version: effect.version }), SYSTEM, async current => {
        await this.checked(current.homeId);
        const row = current.effects.find(e => e.id === effect.id), actual = maintenanceRows(current).incidents.find(i => i.id === identity.incidentId && i.jobId === identity.jobId);
        if (!row || row.version !== effect.version || row.state !== "reserved" || !actual || actual.state === "open" && actual.generation === identity.generation ||
          maintenanceRows(current).jobs.find(j => j.id === actual.jobId)?.scopeId !== scopeId)
          refuse("STALE", "The obsolete notification changed or may have crossed admission; retain its original reservation.");
        const mutations = [{ kind: "effect" as const, value: { ...row, state: "cancelled" as const, version: row.version + 1,
          receiptRef: `maintenance:obsolete-never-sent:${identity.incidentId}:${identity.generation}` } }];
        return { expectedVersions: expectedFor(current, mutations), mutations,
          result: { planId: null, planHash: null, decisionId: null, outboxId: null } };
      });
    }
  }
  private async processRequests(home: string) {
    const directory = (await resolveInHome(home, "data/maintenance-requests")).absolute;
    await serialized(directory, async () => {
      let names: string[];
      try { names = await readdir(directory); } catch (e) { if ((e as NodeJS.ErrnoException).code === "ENOENT") return; throw e; }
      const Request = z.object({ id: z.uuid(), actor: z.string().min(1).max(256), command: z.union([MaintenanceCommandSchema,
        z.object({ op: z.literal("read") }).strict(), z.object({ op: z.literal("summary") }).strict(), z.object({ op: z.literal("timers") }).strict()]) }).strict();
      let processed = 0;
      for (const name of names.filter(n => /^[0-9a-f-]{36}\.json$/.test(n)).sort()) {
        const relative = `data/maintenance-requests/${name}`, reply = (await resolveInHome(home, relative.replace(/\.json$/, ".reply.json"))).absolute;
        try { await stat(reply); continue; } catch (e) { if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e; }
        if (processed++ >= 20) break;
        let response;
        try {
          const path = (await resolveInHome(home, relative)).absolute;
          if ((await stat(path)).size > 128 * 1024) refuse("HELD", "Maintenance request exceeds 128 KiB.");
          const input = Request.parse(JSON.parse(await readFile(path, "utf8")));
          if (`${input.id}.json` !== name) refuse("STALE", "Maintenance request filename differs from its identity.");
          response = { ok: true, result: input.command.op === "read" ? await this.read() : input.command.op === "summary" ? await this.summary() : input.command.op === "timers" ? await this.census() :
            await this.admin({ homeId: workflowHomeIdentity(home), requestId: input.id, actorId: input.actor, command: input.command }) };
        } catch (e) { response = { ok: false, error: e instanceof Error ? e.message : String(e) }; }
        await publish(reply, response);
      }
    });
  }
}

export function registerMaintenanceRuntime(server: PluginServerContext, maintenance: MaintenanceRuntime) {
  server.handle(readMaintenance, () => maintenance.read());
  server.handle(readMaintenanceTimers, () => maintenance.census());
  server.handle(readMaintenanceSummary, () => maintenance.summary());
  server.handle(administerMaintenance, (input, context) => { maintenance.remember(context.paseo); return maintenance.admin(input); });
  server.handle(admitMaintenanceFromUi, (input, context) => maintenance.admit(input, context.paseo));
  server.handle(answerMaintenanceFromUi, (input, context) => maintenance.answer(input, context.paseo));
  const started = server.on("agent.turn_started", (_event, context) => maintenance.remember(context.paseo));
  const ended = server.on("agent.turn_ended", (_event, context) => maintenance.remember(context.paseo));
  return () => { started(); ended(); maintenance.stop(); };
}
