import type { PluginTheme } from "@getpaseo/plugin";
import { useRpc } from "@getpaseo/plugin/client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, useSyncExternalStore } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { readChatQueue, submitChatMessage, changeChatQueue, type ChatQueuePreview, type ChatQueuePayload, type ChatQueueTarget } from "../shared/chat-queue";
import { workflowRequestId } from "./workflow-plans";
import { errorText } from "./format";
import { mateSendGate } from "./mate-send";

// Keep the original request ID after a lost RPC response. Checking it calls the
// same idempotent server admission; it can never claim that item a second time.
const SLOT = Symbol.for("firstmate.chat-queue.pending/1");
const pending: Map<string, { id: string; payload: ChatQueuePayload; now: boolean; replaces?: string; error?: string }> = Reflect.get(globalThis, SLOT) ?? new Map();
Reflect.set(globalThis, SLOT, pending);
const EVENTS = Symbol.for("firstmate.chat-queue.events/1");
const events: { version: number; listeners: Set<() => void> } = Reflect.get(globalThis, EVENTS) ?? { version: 0, listeners: new Set() };
Reflect.set(globalThis, EVENTS, events);
const notify = () => { events.version++; events.listeners.forEach(fn => fn()); };
export const chatQueueEvents = { version: () => events.version, subscribe: (fn: () => void) => { events.listeners.add(fn); return () => { events.listeners.delete(fn); }; } };
export function pendingChatDiscussions(hostId: string, homeId: string) {
  return [...pending].flatMap(([key, value]) => {
    if (value.payload.kind !== "scope" || value.payload.input.route.target.homeId !== homeId) return [];
    try { if (JSON.parse(JSON.parse(key)[0])[0] !== hostId) return []; } catch { return []; }
    return [{ pending: value.payload.input, running: mateSendGate(`queue:${key}`).busy(), error: value.error ?? null }];
  });
}
const edits = new Map<string, string>();
export function useChatQueue(target: ChatQueueTarget | null, context: string) {
  useSyncExternalStore(chatQueueEvents.subscribe, chatQueueEvents.version);
  const read = useRpc(readChatQueue), submit = useRpc(submitChatMessage), change = useRpc(changeChatQueue), cache = useQueryClient();
  const key = JSON.stringify([context, target]);
  const queryKey = ["firstmate", "chat-queue", key];
  const query = useQuery({ queryKey, queryFn: () => read({ target: target! }), enabled: !!target, refetchInterval: 1000 });
  const gate = mateSendGate(target?.kind === "mate" ? target.agentId : `queue:${key}`);
  const sending = useSyncExternalStore(gate.subscribe, gate.busy);
  const [problem, setProblem] = useState<string | null>(null);
  const refresh = () => cache.invalidateQueries({ queryKey });
  async function send(payload: ChatQueuePayload, now = false): Promise<boolean> {
    if (gate.busy() || !target) return false;
    const old = pending.get(key);
    if (old && JSON.stringify(old.payload) !== JSON.stringify(payload)) { setProblem("Check your earlier message before sending another."); return false; }
    const replacing = edits.get(key);
    const request: { id: string; payload: ChatQueuePayload; now: boolean; replaces?: string; error?: string } = old ?? { id: workflowRequestId(), payload, now, ...(replacing ? { replaces: replacing } : {}) };
    const started = gate.run(async () => { pending.set(key, request); setProblem(null); notify();
    try {
      const { error: _error, ...input } = request;
      const item = await submit(input);
      pending.delete(key);
      edits.delete(key);
      notify();
      if (item.state === "refused") { edits.set(key, item.id); setProblem("This message wasn't sent. You can edit it and try again."); await refresh(); return false; }
      if (item.state === "held") setProblem("This message is held. Check the conversation before sending it again.");
      await refresh(); return true;
    } catch (error) { request.error = errorText(error); setProblem(`Couldn't confirm this message. Check it before sending another. ${errorText(error)}`); notify(); return false; }
    });
    return started === null ? false : started.finally(notify);
  }
  async function act(item: ChatQueuePreview, action: "edit" | "remove" | "now") {
    if (gate.busy() || !target) return null;
    const started = gate.run(async () => { setProblem(null);
    try { const result = await change({ target: item.target, id: item.id, action }); if (action === "edit") edits.set(key, item.id); else if (edits.get(key) === item.id) edits.delete(key); await refresh(); return result.payload; }
    catch (error) { setProblem(errorText(error)); return null; }
    });
    return started === null ? null : started;
  }
  return { sending, send, act, items: query.data?.items.filter(i => !["sent", "removed"].includes(i.state)) ?? [],
    enabled: query.data?.enabled ?? true, problem: problem ?? (query.isError ? "The queue couldn't be checked. Your draft is kept." : null),
    checking: query.isPending, unconfirmed: pending.has(key), check: async () => { const request = pending.get(key); if (request && await send(request.payload, request.now)) return request.payload; return null; } };
}

export function ChatQueueRows({ queue, theme, onEdit, onConfirmed }: { queue: ReturnType<typeof useChatQueue>; theme: PluginTheme; onEdit(payload: ChatQueuePayload): void; onConfirmed(payload: ChatQueuePayload): void }) {
  const colors = theme.colors;
  const button = (label: string, onPress: () => void, disabled = false) => <Pressable accessibilityRole="button" accessibilityLabel={label} disabled={disabled || queue.sending}
    accessibilityState={{ disabled: disabled || queue.sending }} onPress={onPress} style={{ minHeight: 44, justifyContent: "center", paddingHorizontal: 8, opacity: disabled || queue.sending ? 0.5 : 1 }}>
    <Text style={{ color: colors.foreground, fontSize: 13, textDecorationLine: "underline" }}>{label}</Text>
  </Pressable>;
  return <View testID="chat-queue" style={{ gap: 4 }}>
    {queue.problem ? <Text accessibilityRole="alert" style={{ color: colors.statusWarning, fontSize: 13 }}>{queue.problem}</Text> : null}
    {queue.unconfirmed ? button("Check message", () => { void queue.check().then(payload => { if (payload) onConfirmed(payload); }); }) : null}
    {queue.items.length ? <>
      <Text accessibilityLiveRegion="polite" style={{ color: colors.foregroundMuted, fontSize: 12 }}>{queue.items.filter(i => i.state === "queued").length} queued · Sent one at a time</Text>
      <ScrollView style={{ maxHeight: 224 }} keyboardShouldPersistTaps="handled">
        {queue.items.map((item, index) => <View key={item.id} style={{ borderTopWidth: 1, borderColor: colors.border, paddingVertical: 4, gap: 2 }}>
          <Text numberOfLines={2} style={{ color: colors.foreground, fontSize: 13 }}>{index + 1}. {item.text || "Attachments"}</Text>
          {item.attachmentCount > 0 ? <Text style={{ color: colors.foregroundMuted, fontSize: 12 }}>{item.attachmentCount} attachments</Text> : null}
          {item.state === "editing" ? <Text style={{ color: colors.foregroundMuted, fontSize: 12 }}>Editing · Send it from the message box</Text> : null}
          {item.state === "refused" ? <Text style={{ color: colors.statusWarning, fontSize: 12 }}>{item.problem ?? "Not sent · Edit to try again"}</Text> : null}
          {item.state === "held" || item.state === "claimed" ? <Text style={{ color: colors.statusWarning, fontSize: 12 }}>{item.problem ?? "Checking delivery. This message will not be sent again."}</Text> : null}
          <View style={{ flexDirection: "row", flexWrap: "wrap" }}>
            {item.state === "queued" || item.state === "editing" || item.state === "refused" ? <>
              {button("Edit", () => { void queue.act(item, "edit").then(payload => { if (payload) onEdit(payload); }); })}
              {item.state === "queued" ? button("Send now", () => { void queue.act(item, "now"); }) : null}
            </> : null}
            {item.state !== "claimed" ? button("Remove", () => { void queue.act(item, "remove"); }) : null}
          </View>
        </View>)}
      </ScrollView>
    </> : null}
  </View>;
}
