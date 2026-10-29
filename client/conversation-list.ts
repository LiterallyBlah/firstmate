import type { ScopeSnapshot, ScopeSummary } from "../shared/supervision-rpc";
import type { DiscussionTarget } from "../shared/scope-discussion";

export interface MateConversation { scope: ScopeSummary; name: string; context: string }

/** Only an existing owner is a conversation. Empty scopes are not mates. */
export function mateConversations(snapshot: ScopeSnapshot | undefined): MateConversation[] {
  return (snapshot?.scopes ?? []).flatMap(scope => {
    if ((scope.kind !== "project" && scope.kind !== "plan") || !scope.target.agentId) return [];
    const suffix = scope.kind === "project" ? "mate" : "helper";
    return [{ scope, name: new RegExp(`\\b${suffix}$`, "i").test(scope.title) ? scope.title : `${scope.title} ${suffix}`,
      context: `${scope.kind === "project" ? "Project" : "Plan"}: ${scope.title}` }];
  }).sort((a, b) => a.name.localeCompare(b.name) || a.scope.id.localeCompare(b.scope.id));
}

export function sameConversationTarget(a: DiscussionTarget, b: DiscussionTarget): boolean {
  // Routine journal updates may advance scopeVersion. The existing sender still
  // captures/checks that fresh version; navigation pins the logical recipient.
  return a.homeId === b.homeId && a.scopeId === b.scopeId && a.epoch === b.epoch && a.agentId === b.agentId;
}

/** Suggest at the caret, retaining a leading mention while its message is typed. */
export function mentionAt(text: string, caret = text.length): { start: number; end: number; query: string } | null {
  const prefix = text.slice(0, caret);
  const match = /(?:^|\s)@([^\s@`]{0,80})$/.exec(prefix);
  if (match && !((prefix.match(/```/g)?.length ?? 0) % 2) && !((prefix.match(/`/g)?.length ?? 0) % 2)) return { start: caret - match[1]!.length - 1, end: caret, query: match[1]! };
  const leading = /^\s*@([^\s@`]{0,80})(?=\s|$)/.exec(text);
  return leading ? { start: leading[0].length - leading[1]!.length - 1, end: leading[0].length, query: leading[1]! } : null;
}

export function conversationReadKey(host: string, home: string, target: Pick<DiscussionTarget, "scopeId" | "epoch" | "agentId">): string {
  return JSON.stringify(["firstmate.conversation-read/1", host, home, target.scopeId, target.epoch, target.agentId]);
}

interface ReadRegistry { seen: Map<string, Set<string>>; listeners: Set<() => void>; version: number }
const SLOT = Symbol.for("paseo.firstmate.conversation-read/1");
/** Local reading state survives plugin evaluation/reconnect, like the existing drafts. */
export function conversationReads(root: object = globalThis) {
  let registry = Reflect.get(root, SLOT) as ReadRegistry | undefined;
  if (!registry) { registry = { seen: new Map(), listeners: new Set(), version: 0 }; Reflect.set(root, SLOT, registry); }
  const state = registry;
  return {
    subscribe(listener: () => void) { state.listeners.add(listener); return () => { state.listeners.delete(listener); }; },
    version: () => state.version,
    unread(key: string, replies: readonly string[]) { const seen = state.seen.get(key); return seen ? replies.filter(id => !seen.has(id)).length : 0; },
    // A cold app starts from the first complete observation, so old replies do
    // not reappear as new. An empty baseline still records an observation.
    observe(key: string, replies: readonly string[]) {
      if (state.seen.has(key)) return;
      state.seen.set(key, new Set(replies)); state.version++;
      state.listeners.forEach(listener => listener());
    },
    mark(key: string, replies: readonly string[]) {
      const seen = state.seen.get(key) ?? new Set<string>();
      const fresh = replies.filter(id => !seen.has(id));
      if (!fresh.length && state.seen.has(key)) return;
      for (const id of fresh) seen.add(id);
      state.seen.set(key, seen); state.version++;
      state.listeners.forEach(listener => listener());
    },
  };
}
