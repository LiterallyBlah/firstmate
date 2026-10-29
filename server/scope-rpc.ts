/** Read-only routes plus separately gated explicit execution through Build C's owned runtime.
 * Reading constructs no receiver, writable store, session, timer or coordinator. */
import type { PluginServerContext } from "@getpaseo/plugin/server";
import type { SupervisionStatus } from "../shared/supervision";
import type { NeedsYouSnapshot } from "../shared/needs-you";
import { readScopes, readScopeConversation, discussScope, activateScope, readScopeNeeds, answerScopeDecision } from "../shared/supervision-rpc";
import { scopeConversationKey } from "../shared/scope-discussion";
import { scopeSnapshot } from "./scope-projection";
import { readThread } from "./item-threads";
import { SupervisionError } from "./supervision-store";
import { withScopedNeedsYou } from "./needs-you-service";
import type { ScopeDiscussions } from "./scope-discussion";
import type { SupervisionCommands } from "./supervision-commands";
import { activationSnapshot } from "./supervision-activation";
import type { ScopeRuntime } from "./scope-runtime";
import { scopedBearings } from "./scope-bearings";
export interface ScopeRpcDependencies {
  read(): Promise<{ home: string; generalId: string | null; status: SupervisionStatus }>;
  readNeeds(): Promise<NeedsYouSnapshot>;
  uiEnabled?: boolean; executionEnabled?: boolean;
  activationEnabled?: boolean;
  admittedProjectsOnly?: boolean;
  execute?: ScopeRuntime["execute"];
  discussions?: ScopeDiscussions; commands?: SupervisionCommands;
}
export function registerScopeRpcs(server: Pick<PluginServerContext, "handle">, deps: ScopeRpcDependencies) {
  const combined = async () => {
    const [base, { status }] = await Promise.all([deps.readNeeds(), deps.read()]);
    return { ...withScopedNeedsYou(base, status), scopedAnswersEnabled: !!deps.executionEnabled && !!(deps.commands || deps.execute) };
  };
  server.handle(readScopes, async () => {
    const { status, generalId } = await deps.read();
    return { ...scopeSnapshot(status, generalId, { uiEnabled: deps.uiEnabled ?? false, executionEnabled: deps.executionEnabled ?? false, admittedProjectsOnly: deps.admittedProjectsOnly }),
      ...(deps.uiEnabled ? { bearings: scopedBearings(status) } : {}),
      activation: activationSnapshot(status, !!deps.activationEnabled) };
  });
  server.handle(readScopeConversation, async input => {
    const { home, status } = await deps.read();
    if (input.homeId !== status.homeId) throw new SupervisionError("STALE", "Home changed; preserve the draft and refresh.");
    if (input.scopeId !== "general" && !status.scopes.some(s => s.id === input.scopeId)) throw new SupervisionError("UNKNOWN_OWNER", "Scope unavailable; no conversation substitution.");
    return readThread(home, scopeConversationKey(input.homeId, input.scopeId, input.conversationId));
  });
  server.handle(activateScope, () => ({ state: "unsupported" as const, reason: "Use explicit Send to create a discussion session. Reading and standalone activation never create resources." }));
  server.handle(discussScope, async (input, context) => {
    if (!deps.executionEnabled) return { outcome: "refused" as const, code: "UNSUPPORTED", message: "Discussion execution is disabled. No fallback to General." };
    if (deps.execute) {
      try { return await deps.execute(input.route.target.homeId, input.route.target.scopeId, context.paseo, services => services.discussions.result(input)); }
      catch (error) { return { outcome: "uncertain" as const, message: error instanceof Error ? error.message : String(error) }; }
    }
    return deps.discussions?.result(input) ?? { outcome: "refused" as const, code: "UNSUPPORTED", message: "No discussion service is installed." };
  });
  server.handle(readScopeNeeds, combined);
  server.handle(answerScopeDecision, async (input, context) => {
    if (!deps.executionEnabled || !(deps.commands || deps.execute)) throw new SupervisionError("UNSUPPORTED", "Scoped answer execution is disabled; no legacy answer substitution.");
    const act = async (commands: SupervisionCommands, unverified: boolean) => {
    try {
      const { status } = await deps.read();
      if (status.homeId !== input.homeId || commands.store.homeId !== input.homeId) throw new SupervisionError("STALE", "Home changed. Preserve this decision draft and refresh.");
      if (unverified) await commands.answerFromUnverifiedUi(input);
      else await commands.answer(input, { kind: "captain-ui", id: "scope-decision", source: "firstmate.scope.answer" });
      return await combined();
    } catch (error) {
      // Reuse S03's accepted-command index. A publication hold, read failure or accepted
      // request cannot prove absence; in those cases the exact original submission stays held.
      try {
        const status = await commands.store.read();
        if (error instanceof SupervisionError && status.homeId === input.homeId && status.freshness === "current" &&
          !status.commands.some(c => c.id === input.submissionId))
          return { outcome: "refused" as const, code: error.code, message: error.message };
      } catch { /* Unknown storage cannot release a submission. */ }
      return { outcome: "uncertain" as const, message: error instanceof Error ? error.message : String(error) };
    }
    };
    if (deps.execute) {
      try { return await deps.execute(input.homeId, input.scopeId, context.paseo, services => act(services.commands, true)); }
      catch (error) { return { outcome: "uncertain" as const, message: error instanceof Error ? error.message : String(error) }; }
    }
    return act(deps.commands!, false);
  });
}
