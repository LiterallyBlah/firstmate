import type { PluginTheme } from "@getpaseo/plugin";
import type { PluginScreenProps } from "@getpaseo/plugin/client";
import { useRpc } from "@getpaseo/plugin/client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { readScopeConversation, discussScope, type ScopeSnapshot, type ScopeSummary } from "../shared/supervision-rpc";
import { resolveDiscussion, scopeDraftKey } from "../shared/scope-discussion";
import type { ItemThread } from "../shared/item-threads";
import { drafts } from "./draft";
import { discussionSender, discussionSendKey, discussionSendRegistry } from "./scope-send";
import { workflowRequestId } from "./workflow-plans";
import { GrowingChatInput } from "./growing-chat-input";
import { errorText } from "./format";
import { OptionPicker } from "./option-picker";

function Button({ label, onPress, disabled = false, theme, selected = false, expanded }: { label: string; onPress(): void; disabled?: boolean; theme: PluginTheme; selected?: boolean; expanded?: boolean }) {
  return <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled, selected, ...(expanded === undefined ? {} : { expanded }) }} disabled={disabled} onPress={onPress}
    style={{ minHeight: 44, padding: 10, justifyContent: "center", borderWidth: 1, borderColor: selected ? theme.colors.accent : theme.colors.border,
      borderRadius: 7, backgroundColor: theme.colors.surface1, opacity: disabled ? 0.5 : 1 }}><Text style={{ color: theme.colors.foreground, fontSize: 13 }}>{label}</Text></Pressable>;
}
export function ScopeDiscussion({ snapshot, offline = false, hostId, theme, compact, navigation, refresh, initialScope, onSelectScope, generalControls }: {
  snapshot: ScopeSnapshot; offline?: boolean; hostId: string; theme: PluginTheme; compact: boolean;
  navigation?: PluginScreenProps["navigation"]; refresh(): void;
  initialScope?: string | undefined;
  onSelectScope?: ((id: string) => void) | undefined;
  generalControls?: ReactNode;
}) {
  const read = useRpc(readScopeConversation), send = useRpc(discussScope), cache = useQueryClient();
  const selectionKey = JSON.stringify(["firstmate.scope-selection/1", hostId, snapshot.homeId]);
  const savedSelection = useSyncExternalStore(drafts.subscribe, () => drafts.get(selectionKey));
  // The explicit route wins over an old preference, but deliberate recovery/reply
  // navigation must still be able to change the recipient within this discussion.
  const route = JSON.stringify([selectionKey, initialScope]);
  const [selection, setSelection] = useState({ route, id: initialScope });
  const selected = initialScope ? (selection.route === route ? selection.id! : initialScope) : savedSelection || "shared";
  const [showStatus, setShowStatus] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);
  const select = (id: string) => { setSelection({ route, id }); drafts.set(selectionKey, id); onSelectScope?.(id); };
  useEffect(() => { if (initialScope) drafts.set(selectionKey, initialScope); }, [initialScope, selectionKey]);
  const defaultScope = selected === "shared" ? "general" : selected;
  const draftKey = scopeDraftKey(hostId, snapshot.homeId, selected);
  const replyKey = JSON.stringify(["firstmate.scope-reply/1", draftKey]);
  const replyTo = useSyncExternalStore(drafts.subscribe, () => drafts.get(replyKey) || null);
  const setReplyTo = (id: string | null) => drafts.set(replyKey, id ?? "");
  const draft = useSyncExternalStore(drafts.subscribe, () => drafts.get(draftKey));
  useEffect(() => { setValidationError(null); }, [draftKey, draft]);
  const refusedDraft = useSyncExternalStore(drafts.subscribe, () => drafts.get(`${draftKey}:refused`));
  let resolved: ReturnType<typeof resolveDiscussion<ScopeSummary>> | null = null, routeError: string | null = null;
  try { resolved = resolveDiscussion(draft, snapshot.scopes, snapshot.projects, defaultScope); } catch (e) { if (draft.trim()) routeError = errorText(e); }
  if (replyTo && resolved && resolved.scope.id !== selected) routeError = "This reply belongs to another recipient. Cancel the reply or use its original recipient.";
  const recipient = resolved?.scope ?? snapshot.scopes.find(s => s.id === defaultScope);
  const gate = discussionSender(globalThis, discussionSendKey(hostId, snapshot.homeId, recipient?.id ?? defaultScope));
  const sending = useSyncExternalStore(gate.subscribe, gate.snapshot);
  const sendRegistry = discussionSendRegistry(globalThis);
  useSyncExternalStore(sendRegistry.subscribe, sendRegistry.version);
  const unconfirmed = sendRegistry.pending(hostId, snapshot.homeId);
  const conversations = useQuery({ queryKey: ["firstmate", "scope-conversations", hostId, snapshot.homeId, selected],
    queryFn: async () => {
      const scopes = snapshot.scopes.filter(s => selected === "shared" || s.id === selected);
      const results = await Promise.allSettled(scopes.map(s => read({ homeId: snapshot.homeId, scopeId: s.id, conversationId: "main" })));
      return { threads: results.flatMap(r => r.status === "fulfilled" ? [r.value] : []), problems: results.flatMap((r, i) => r.status === "rejected" ? [`${scopes[i]!.title}: ${errorText(r.reason)}`] : []) };
    }, refetchInterval: offline ? false : 5000 });
  useEffect(() => {
    for (const thread of conversations.data?.threads ?? []) gate.reconcile(thread);
  }, [conversations.data, gate]);
  const rows = (conversations.data?.threads ?? []).flatMap(t => t.messages.map(m => ({ thread: t, message: m }))).sort((a, b) => a.message.createdAt.localeCompare(b.message.createdAt) || a.message.id.localeCompare(b.message.id));
  const colors = theme.colors;
  const unavailableGeneral = recipient?.kind === "general" && recipient.target.agentId === null;
  const remote = recipient?.hostId != null && recipient.hostId.trim().toLowerCase() !== "local";
  const unsupported = recipient?.kind === "maintenance" || remote;
  const scopeUnavailable = recipient?.id !== "general" && recipient && (!['active', 'dormant'].includes(recipient.state) || recipient.session === "held");
  const blocked = offline || !snapshot.executionEnabled || (recipient?.id !== "general" && snapshot.freshness !== "current") || scopeUnavailable || unavailableGeneral || unsupported || sending.running || !!sending.pending || !!routeError || !resolved || !recipient;
  function sendDraft() {
    if (blocked || !resolved || !recipient) return;
    const captured = { id: workflowRequestId(), text: resolved.text, addressedText: draft, defaultScope,
      route: { target: { ...recipient.target }, recipient: recipient.title, projectIds: [...resolved.projectIds], conversationId: "main", replyTo } };
    const checked = discussScope.input.safeParse(captured);
    if (!checked.success) { setValidationError("The message or its address is outside the supported limits. Shorten it or refresh its scope."); return; }
    if (gate.send(checked.data, send, (_thread: ItemThread) => {
      void cache.invalidateQueries({ queryKey: ["firstmate", "scope-conversations", hostId, snapshot.homeId] }); refresh();
    }, refused => {
      if (!drafts.get(draftKey)) drafts.set(draftKey, refused.addressedText);
      else drafts.set(`${draftKey}:refused`, refused.addressedText);
      if (refused.route.replyTo) drafts.set(replyKey, refused.route.replyTo);
      refresh();
    })) { drafts.set(draftKey, ""); setReplyTo(null); }
  }
  // A fresh home has one setup task; no unavailable General recipient/composer alongside it.
  if (unavailableGeneral && generalControls) return <ScrollView automaticallyAdjustKeyboardInsets>{generalControls}</ScrollView>;
  return <View testID="scope-discussion" style={{ flex: 1, minHeight: 0, backgroundColor: colors.surface0 }}>
    <ScrollView contentContainerStyle={{ padding: compact ? 12 : 16, gap: 12 }}>
      <Text accessibilityRole="header" style={{ color: colors.foreground, fontSize: 17, fontWeight: "600" }}>Discussion</Text>
      <Text style={{ color: colors.foregroundMuted, fontSize: 13 }}>@mate selects one recipient. #project adds context. Shared messages without @ go to FirstMate.</Text>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
        {!initialScope ? <OptionPicker inline label="Discussion scope" title="Choose a discussion" value={selected} options={[
          { value: "shared", label: "Shared stream", detail: "Untagged messages go to FirstMate" },
          ...snapshot.scopes.map(s => ({ value: s.id, label: s.title, detail: `${s.kind} · ${s.id} · ${s.session}` }))
        ]} onSelect={select} theme={theme} compact={compact} /> : null}
        <Button label="Refresh" theme={theme} onPress={() => { refresh(); void conversations.refetch(); }} />
        <Button label={showStatus ? "Hide details" : "Details"} expanded={showStatus} theme={theme} onPress={() => setShowStatus(v => !v)} />
      </View>
      {offline ? <Text style={{ color: colors.statusWarning, fontSize: 12 }}>Offline · last updated {snapshot.asOf}. Refresh to check again.</Text> : snapshot.freshness !== "current" && snapshot.freshness !== "uninitialized" ?
        <Text accessibilityRole="alert" style={{ color: colors.statusWarning, fontSize: 12 }}>Some work couldn't be checked. Review Details before continuing.</Text> : null}
      {showStatus ? <Text selectable style={{ color: colors.foregroundMuted, fontSize: 12 }}>
        {offline ? "Offline · retained status" : `${snapshot.freshness} · sequence ${snapshot.sequence}`} · as of {snapshot.asOf} · Reading starts no model turn
      </Text> : null}
      {snapshot.problems.map((p, i) => <Text key={i} style={{ color: colors.statusDanger }}>{p}</Text>)}
      {showStatus && snapshot.bearings ? <Text selectable style={{ color: colors.foregroundMuted, fontSize: 13 }}>{snapshot.bearings}</Text> : null}
      {unconfirmed.map(state => <View key={state.pending!.id} style={{ gap: 4 }}>
        <Text numberOfLines={3} style={{ color: state.error ? colors.statusWarning : colors.foregroundMuted, fontSize: 12 }}>{state.running ? "Sending" : "Unconfirmed message"} to {state.pending!.route.recipient}: {state.pending!.addressedText}</Text>
        {state.error ? <Text style={{ color: colors.statusDanger, fontSize: 12 }}>{state.error}</Text> : null}
        <Button label={`Open original message to ${state.pending!.route.recipient}`} theme={theme} onPress={() => select(state.pending!.route.target.scopeId)} />
      </View>)}
      {showStatus ? snapshot.scopes.filter(s => selected === "shared" || s.id === selected).map(s => <View key={s.id} style={{ gap: 4, paddingVertical: 8, borderBottomWidth: 1, borderColor: colors.border }}>
        <Text style={{ color: colors.foreground, fontSize: 13, fontWeight: "600" }}>{s.title} · {s.session === "not-created" ? "Not yet created" : s.session === "unknown" ? "Activity unknown" : s.session}</Text>
        {s.discussionOnly ? <Text style={{ color: colors.foregroundMuted, fontSize: 12 }}>Discussion only · work activation requires separate authority</Text> : null}
        <Text style={{ color: colors.foregroundMuted, fontSize: 12 }}>{s.activeWorkers} tracked workers · {s.activeEffects} pending effects · {s.uncertainEffects} uncertain · source coverage {s.coverage} · Owner {s.target.agentId ?? "not created"}</Text>
        {s.lastEffectFailure ? <Text style={{ color: colors.statusWarning, fontSize: 12 }}>Last failure: {s.lastEffectFailure.operation} · {s.lastEffectFailure.reason ?? s.lastEffectFailure.id}</Text> : null}
        {(s.kind === "general" ? [] : s.goals).map(g => <Text key={`${s.id}:${g.planId}`} style={{ color: colors.foregroundMuted, fontSize: 12 }}>{g.title}: {g.state} · {g.next} · evidence {g.evidenceAgeMs === null ? "unavailable" : `${Math.floor(g.evidenceAgeMs / 60000)}m old at this read`}</Text>)}
        {s.target.agentId && navigation && s.hostId?.trim().toLowerCase() === "local" ? <Button label={`Open ${s.title} conversation`} theme={theme} onPress={() => navigation.openAgent({ agentId: s.target.agentId!, ...(hostId === "local" ? {} : { serverId: hostId }) })} /> : null}
      </View>) : null}
      {conversations.isPending ? <Text style={{ color: colors.foregroundMuted }}>Loading discussion records…</Text> : null}
      {[...(conversations.data?.problems ?? []), ...(conversations.error ? [errorText(conversations.error)] : [])].map((p, i) => <Text key={i} style={{ color: colors.statusDanger }}>{p}</Text>)}
      {!conversations.isPending && !conversations.isError && !conversations.data?.problems.length && !rows.length ? <Text style={{ color: colors.foregroundMuted }}>Start a conversation.</Text> : null}
      {rows.map(({ message: m }) => <View key={`${m.route?.target.scopeId}:${m.id}`} style={{ gap: 6, paddingVertical: 8 }}>
        <Text style={{ color: colors.foregroundMuted, fontSize: 12 }}>You → {m.route?.recipient ?? "Unknown recipient"}{m.route?.projectIds.length ? ` · context ${m.route.projectIds.map(id => snapshot.projects.find(p => p.id === id)?.name ?? id).join(", ")}` : ""}{m.route?.replyTo ? ` · reply to ${m.route.replyTo}` : ""}</Text>
        <Text style={{ color: colors.foreground, fontSize: 14 }}>{m.text}</Text>
        <Text style={{ color: m.delivery === "uncertain" ? colors.statusWarning : colors.foregroundMuted, fontSize: 12 }}>{m.delivery === "uncertain" ? "Send outcome unknown · no automatic retry" : m.reply === null ? "Sent · awaiting reply" : "Reply received"}</Text>
        {m.reply !== null ? <><Text style={{ color: colors.foregroundMuted, fontSize: 12 }}>{m.route?.recipient} · {m.agentId} · reply to {m.id}</Text><Text style={{ color: colors.foreground, fontSize: 14 }}>{m.reply}</Text></> : null}
        <Button label={`Reply to ${m.route?.recipient ?? m.agentId}`} theme={theme} onPress={() => {
          const id = m.route?.target.scopeId ?? "unavailable"; select(id);
          drafts.set(JSON.stringify(["firstmate.scope-reply/1", scopeDraftKey(hostId, snapshot.homeId, id)]), m.id);
        }} />
      </View>)}
    </ScrollView>
    <View style={{ gap: 8, padding: compact ? 12 : 16, borderTopWidth: 1, borderColor: colors.border }}>
      <Text style={{ color: colors.foreground, fontSize: 13 }}>To {recipient?.title ?? "Unavailable recipient"}{resolved?.projectIds.length ? ` · project context: ${resolved.projectIds.map(id => snapshot.projects.find(p => p.id === id)?.name ?? id).join(", ")}` : ""}{replyTo ? " · replying" : ""}</Text>
      {recipient ? <Text style={{ color: colors.foregroundMuted, fontSize: 12 }}>{recipient.session === "not-created" ? "Not yet created" : recipient.session === "unknown" ? "Status unavailable. Refresh to check again." : recipient.session}{recipient.discussionOnly ? " · discussion only" : ""}</Text> : null}
      {!snapshot.executionEnabled ? <Text style={{ color: colors.foregroundMuted, fontSize: 12 }}>Discussion execution is disabled pending activation.</Text> : unavailableGeneral ? <Text style={{ color: colors.foregroundMuted, fontSize: 12 }}>FirstMate has no session. Use the existing launch controls.</Text> : recipient?.session === "not-created" ? <Text style={{ color: colors.foregroundMuted, fontSize: 12 }}>First Send creates a persistent discussion session. Reading does not.</Text> : null}
      {routeError || validationError || sending.error ? <Text accessibilityRole="alert" style={{ color: colors.statusDanger }}>{routeError ?? validationError ?? sending.error}</Text> : null}
      {unsupported ? <Text style={{ color: colors.foregroundMuted }}>{remote ? "This remote scope is read-only here. Open its original host; no discussion receiver is qualified." : "This maintenance scope is read-only; no discussion adapter is qualified."}</Text> : null}
      {scopeUnavailable ? <Text style={{ color: colors.statusWarning }}>This scope is held, transferring or retired. Refresh its ownership before sending.</Text> : null}
      {refusedDraft ? <Button label="Add refused message to draft" theme={theme} onPress={() => { drafts.set(draftKey, `${refusedDraft}${draft ? `\n\n${draft}` : ""}`); drafts.set(`${draftKey}:refused`, ""); }} /> : null}
      {replyTo ? <Button label="Cancel reply" theme={theme} onPress={() => setReplyTo(null)} /> : null}
      {unavailableGeneral ? generalControls : null}
      {sending.pending && !sending.running ? <Button label="Reconcile original message" theme={theme} onPress={() => { void conversations.refetch(); refresh(); }} /> : null}
      <View style={{ flexDirection: "row", borderWidth: 1, borderColor: colors.border, borderRadius: 8, backgroundColor: colors.surface1 }}>
        <GrowingChatInput theme={theme} compact={compact} accessibilityLabel="Message recipient" multiline value={draft} onChangeText={text => drafts.set(draftKey, text)} placeholder="Message, @mate, or #project context…" />
      </View>
      <Button label={sending.running ? "Activating or sending…" : recipient?.session === "not-created" ? "Send · create discussion session" : "Send"} theme={theme} disabled={blocked} onPress={sendDraft} />
    </View>
  </View>;
}
