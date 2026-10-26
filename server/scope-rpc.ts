/** Read-only production wiring; the execution seam requires explicit fixture/qualified injection.
 * No live receiver, writable store, session, timer or coordinator is constructed here. */
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
export interface ScopeRpcDependencies {
  read(): Promise<{ home: string; generalId: string | null; status: SupervisionStatus }>;
  readNeeds(): Promise<NeedsYouSnapshot>;
  uiEnabled?: boolean; executionEnabled?: boolean;
  discussions?: ScopeDiscussions; commands?: SupervisionCommands;
}
export function registerScopeRpcs(server: Pick<PluginServerContext, "handle">, deps: ScopeRpcDependencies) {
  const combined = async () => {
    const [base, { status }] = await Promise.all([deps.readNeeds(), deps.read()]);
    return { ...withScopedNeedsYou(base, status), scopedAnswersEnabled: !!deps.executionEnabled && !!deps.commands };
  };
  server.handle(readScopes, async () => {
    const { status, generalId } = await deps.read();
    return scopeSnapshot(status, generalId, { uiEnabled: deps.uiEnabled ?? false, executionEnabled: deps.executionEnabled ?? false });
  });
  server.handle(readScopeConversation, async input => {
    const { home, status } = await deps.read();
    if (input.homeId !== status.homeId) throw new SupervisionError("STALE", "Home changed; preserve the draft and refresh.");
    if (input.scopeId !== "general" && !status.scopes.some(s => s.id === input.scopeId)) throw new SupervisionError("UNKNOWN_OWNER", "Scope unavailable; no conversation substitution.");
    return readThread(home, scopeConversationKey(input.homeId, input.scopeId, input.conversationId));
  });
  server.handle(activateScope, () => ({ state: "unsupported" as const, reason: "Use explicit Send to create a discussion session. Reading and standalone activation never create resources." }));
  server.handle(discussScope, input => deps.executionEnabled && deps.discussions ? deps.discussions.result(input) :
    { outcome: "refused" as const, code: "UNSUPPORTED", message: "Discussion execution is disabled pending receiver and policy qualification. No fallback to General." });
  server.handle(readScopeNeeds, combined);
  server.handle(answerScopeDecision, async input => {
    if (!deps.executionEnabled || !deps.commands) throw new SupervisionError("UNSUPPORTED", "Scoped answer execution is disabled; no legacy answer substitution.");
    const { status } = await deps.read();
    if (status.homeId !== input.homeId || deps.commands.store.homeId !== input.homeId) throw new SupervisionError("STALE", "Home changed. Preserve this decision draft and refresh.");
    await deps.commands.answer(input, { kind: "captain-ui", id: "scope-decision", source: "firstmate.scope.answer" });
    return combined();
  });
}
