/** Survives remount and bundle reload. Unknown delivery keeps the original request for a read,
 * never a fresh request ID or automatic retry. No model call is made by reconciliation. */
import type { z } from "zod";
import type { discussScope } from "../shared/supervision-rpc";
import type { DiscussionResult } from "../shared/supervision-rpc";
import { scopeConversationKey } from "../shared/scope-discussion";
import type { ItemThread } from "../shared/item-threads";
export type DiscussionInput = z.infer<typeof discussScope.input>;
export interface DiscussionSendState { running: boolean; pending: DiscussionInput | null; error: string | null }
const SLOT = Symbol.for("paseo.firstmate.scope-sends/1");
interface Registry { gates: Map<string, ReturnType<typeof createDiscussionSender>>; listeners: Set<() => void>; version: number }
function registry(root: object): Registry {
  let value = Reflect.get(root, SLOT) as Registry | Map<string, ReturnType<typeof createDiscussionSender>> | undefined;
  if (!value || value instanceof Map) {
    value = { gates: value ?? new Map(), listeners: new Set(), version: 0 };
    Reflect.set(root, SLOT, value);
    for (const gate of value.gates.values()) attach(value, gate);
  }
  return value;
}
function attach(all: Registry, gate: ReturnType<typeof createDiscussionSender>) {
  gate.subscribe(() => { all.version++; all.listeners.forEach(fn => fn()); });
}
export const discussionSendKey = (hostId: string, homeId: string, scopeId: string) => JSON.stringify([hostId, homeId, scopeId]);
/** Shared stream notices follow captured sends even after clearing @text or switching scopes. */
export function discussionSendRegistry(root: object) {
  const all = registry(root);
  return { version: () => all.version, subscribe(fn: () => void) { all.listeners.add(fn); return () => all.listeners.delete(fn); },
    pending(hostId: string, homeId: string) {
      return [...all.gates].filter(([key]) => { try { const parts = JSON.parse(key); return parts[0] === hostId && parts[1] === homeId; } catch { return false; } })
        .map(([, gate]) => gate.snapshot()).filter(s => s.pending !== null);
    } };
}
export function discussionSender(root: object, key: string) {
  const all = registry(root);
  let gate = all.gates.get(key);
  if (!gate) { gate = createDiscussionSender(); all.gates.set(key, gate); attach(all, gate); }
  return gate;
}
export function createDiscussionSender() {
  let state: DiscussionSendState = { running: false, pending: null, error: null };
  const listeners = new Set<() => void>();
  const update = (next: DiscussionSendState) => { state = next; listeners.forEach(fn => fn()); };
  return {
    snapshot: () => state,
    subscribe(fn: () => void) { listeners.add(fn); return () => listeners.delete(fn); },
    send(input: DiscussionInput, deliver: (captured: DiscussionInput) => Promise<DiscussionResult>, done: (thread: ItemThread) => void,
      refused?: (captured: DiscussionInput) => void): boolean {
      if (state.running || state.pending) return false;
      // Wire data only; JSON copying is available on the supported Hermes floor.
      const captured: DiscussionInput = JSON.parse(JSON.stringify(input));
      update({ running: true, pending: captured, error: null });
      void Promise.resolve().then(() => deliver(captured)).then(result => {
        if (result.outcome === "refused") {
          update({ running: false, pending: null, error: result.message }); refused?.(captured); return;
        }
        if (result.outcome === "uncertain") throw new Error(result.message);
        const thread = result.thread;
        if (thread.key !== scopeConversationKey(captured.route.target.homeId, captured.route.target.scopeId, captured.route.conversationId))
          throw new Error("The reply belongs to a different conversation. The captured message remains unconfirmed.");
        const row = thread.messages.find(m => m.id === captured.id);
        if (!row) throw new Error("The send response has no matching message. Read its original conversation before continuing.");
        update({ running: false, pending: row.delivery === "uncertain" && row.reply === null ? captured : null,
          error: row.delivery === "uncertain" && row.reply === null ? "Send outcome unknown. Reconcile the original message; it will not be resent." : null });
        done(thread);
      }).catch(error => update({ running: false, pending: captured, error: error instanceof Error ? error.message : String(error) }));
      return true;
    },
    reconcile(thread: ItemThread) {
      if (state.running || !state.pending) return;
      const pending = state.pending;
      if (thread.key !== scopeConversationKey(pending.route.target.homeId, pending.route.target.scopeId, pending.route.conversationId)) return;
      const row = thread.messages.find(m => m.id === pending.id);
      if (row && (row.delivery === "sent" || row.reply !== null)) update({ running: false, pending: null, error: null });
    },
  };
}
