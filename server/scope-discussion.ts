/** S05 discussion composition. Fixture-only enablement; no live adapter or coordinator is installed.
 * Reuses the existing thread transport and S04 reservations, verification, budget and dispatch.
 */
import type { z } from "zod";
import type { SupervisionActor } from "../shared/supervision";
import type { AgentProfile } from "../shared/supervision-effects";
import { discussScope, type ScopeSnapshot, type ScopeSummary, type DiscussionResult } from "../shared/supervision-rpc";
import { resolveDiscussion, scopeConversationKey } from "../shared/scope-discussion";
import type { ItemThread } from "../shared/item-threads";
import { readThread, sendRecordedDiscussion, threadReplyPath } from "./item-threads";
import type { SupervisionStore } from "./supervision-store";
import type { SupervisorSessions } from "./supervisor-sessions";
import { activationEffects } from "./supervisor-sessions";
import { refuse } from "./supervision-effects";
import { digest } from "./submissions";
import { scopeSnapshot } from "./scope-projection";
import { serialized } from "./serialize";
import { message, TEMPLATES } from "./templates";
import { SupervisionError } from "./supervision-store";

const ACTOR: SupervisionActor = { kind: "captain-ui", id: "scope-discussion", source: "firstmate.scope.discuss" };
export interface ScopeDiscussionOptions {
  enabled?: boolean; uiEnabled?: boolean;
  generalId(): Promise<string | null>;
  /** Server-owned profile/budget qualification; never accepted from a composer tag. */
  profile(scopeId: string): Promise<AgentProfile>;
  generalSend(text: string, messageId: string, beforeSend: (agentId: string) => Promise<void>): Promise<unknown>;
}
export class ScopeDiscussions {
  constructor(readonly home: string, readonly store: SupervisionStore, readonly sessions: SupervisorSessions, private readonly options: ScopeDiscussionOptions) {
    if (sessions.store !== store || sessions.gateway.store !== store || sessions.receiver !== sessions.gateway.receiver)
      refuse("CONFLICT", "Discussion, session and gateway authority stores/receivers must match.");
  }
  async read(): Promise<ScopeSnapshot> {
    return scopeSnapshot(await this.store.read(), await this.options.generalId(), { uiEnabled: this.options.uiEnabled ?? false, executionEnabled: this.options.enabled ?? false });
  }
  async conversation(homeId: string, scopeId: string, conversationId: string): Promise<ItemThread> {
    if (homeId !== this.store.homeId) refuse("STALE", "The configured home changed. Preserve this draft and refresh.");
    if (!(await this.read()).scopes.some(s => s.id === scopeId)) refuse("UNKNOWN_OWNER", "This scope is unavailable; no conversation substitution.");
    return readThread(this.home, scopeConversationKey(homeId, scopeId, conversationId));
  }
  async discuss(raw: z.infer<typeof discussScope.input>): Promise<ItemThread> {
    const input = structuredClone(discussScope.input.parse(raw)), { route } = input;
    if (!this.options.enabled) refuse("UNSUPPORTED", "Discussion execution is disabled. Reading does not activate a session.");
    if (route.target.homeId !== this.store.homeId) refuse("STALE", "The configured home changed. Preserve this draft and refresh.");
    const key = scopeConversationKey(this.store.homeId, route.target.scopeId, route.conversationId);
    return serialized(`${this.store.root}:discussion:${route.target.scopeId}`, async () => {
      // A lost response returns the original attributed record even after transfer. Nothing is sent.
      const old = await readThread(this.home, key), existing = old.messages.find(m => m.id === input.id);
      if (existing) {
        if (existing.requestHash !== digest(input)) refuse("CONFLICT", "Message id already belongs to another body or captured recipient.");
        return old;
      }
      const snapshot = await this.read();
      let resolved: ReturnType<typeof resolveDiscussion<ScopeSummary>>;
      try { resolved = resolveDiscussion(input.addressedText, snapshot.scopes, snapshot.projects, input.defaultScope); }
      catch (e) { refuse("UNKNOWN_OWNER", e instanceof Error ? e.message : String(e)); }
      if (resolved.scope.id !== route.target.scopeId || resolved.text !== input.text || digest(resolved.projectIds) !== digest(route.projectIds) || resolved.scope.title !== route.recipient)
        refuse("STALE", "The displayed recipient or project context changed. Preserve the draft and resolve it again.");
      if (digest(resolved.scope.target) !== digest(route.target)) refuse("STALE", "The captured binding changed. Preserve this draft and refresh; no fallback recipient.");
      if (route.target.scopeId !== "general" && snapshot.freshness !== "current") refuse("HELD", "Scoped authority is unavailable; no fallback to General.");
      if (resolved.scope.hostId !== null && resolved.scope.hostId.trim().toLowerCase() !== "local")
        refuse("UNSUPPORTED", "Remote scope discussion has no qualified receiver. Open its original host; no local or General substitution.");
      const reply = threadReplyPath(key, input.id);
      // Only this message and explicit project identifiers cross into this recipient's model history.
      // Neither other scopes' histories nor reply bodies are forwarded.
      const prompt = await message(TEMPLATES.scopeDiscuss, { home: this.home, reply, text: input.text,
        contextJson: JSON.stringify({ recipient: route.recipient, scopeId: route.target.scopeId, conversationId: route.conversationId,
          replyTo: route.replyTo, projectContext: snapshot.projects.filter(p => route.projectIds.includes(p.id)) }) });
      return sendRecordedDiscussion(this.home, key, route.recipient, { id: input.id, text: input.text, route, requestHash: digest(input) }, async beforeSend => {
        if (route.target.scopeId === "general") {
          if (!route.target.agentId) refuse("UNKNOWN_OWNER", "FirstMate has no current session. Open its launch controls.");
          await this.options.generalSend(prompt, `firstmate-scope-${input.id}`, async id => {
            if (id !== route.target.agentId) refuse("STALE", "FirstMate changed before delivery; no substitution.");
            await beforeSend(id);
          });
          return;
        }
        const { gateway } = this.sessions;
        if (route.target.epoch === 0) {
          await this.sessions.prepare({ requestId: input.id, scopeId: route.target.scopeId, scopeVersion: route.target.scopeVersion,
            profile: await this.options.profile(route.target.scopeId), opening: prompt, purpose: "discussion" }, ACTOR);
          const status = await this.store.read(), binding = status.bindings.find(b => b.scopeId === route.target.scopeId)!;
          await beforeSend(binding.agentId); // record before workspace/create/send
          const effects = activationEffects(status, binding.scopeId, binding.epoch);
          for (const effect of [effects.workspace!, effects.create!]) {
            const result = await gateway.dispatch(effect.id);
            if (result.state !== "succeeded") throw new Error("Activation result is uncertain or held; reconcile the original effects.");
          }
          await this.sessions.verify(binding.scopeId, binding.epoch);
          if ((await gateway.dispatch(effects.send!.id)).state !== "succeeded") throw new Error("Opening send is uncertain; never resend it automatically.");
        } else {
          const effectId = await this.sessions.reserveTurnWith({ requestId: input.id, scopeId: route.target.scopeId, epoch: route.target.epoch,
            causation: `discussion:${route.conversationId}:${input.id}`, text: prompt }, ACTOR, current => {
            const scope = current.scopes.find(s => s.id === route.target.scopeId), binding = current.bindings.find(b => b.scopeId === scope?.id);
            if (scope?.version !== route.target.scopeVersion || binding?.agentId !== route.target.agentId) refuse("STALE", "Binding changed at reservation; preserve the captured target.");
            return [];
          });
          await beforeSend(route.target.agentId!);
          if ((await gateway.dispatch(effectId)).state !== "succeeded") throw new Error("Send outcome is uncertain or held; reconcile this original message.");
        }
      });
    });
  }
  /** Only a proven pre-reservation refusal lets the composer edit/retry. Loss of a reply or of
   * the record read remains uncertain. This method never dispatches a second request. */
  async result(raw: z.infer<typeof discussScope.input>): Promise<DiscussionResult> {
    try { return { outcome: "recorded", thread: await this.discuss(raw) }; }
    catch (error) {
      const problem = error instanceof Error ? error.message : String(error);
      try {
        const status = await this.store.read(), thread = await readThread(this.home, scopeConversationKey(raw.route.target.homeId, raw.route.target.scopeId, raw.route.conversationId));
        if (status.freshness !== "held" && !status.commands.some(c => c.id === raw.id) && !thread.messages.some(m => m.id === raw.id) && error instanceof SupervisionError)
          return { outcome: "refused", code: error.code, message: problem };
      } catch { /* Unknown storage/delivery never proves absence. */ }
      return { outcome: "uncertain", message: problem };
    }
  }
}
