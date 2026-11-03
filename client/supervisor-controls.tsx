import type { PluginTheme } from "@getpaseo/plugin";
import type { PluginSurfaceProps } from "@getpaseo/plugin/client";
import { useRpc } from "@getpaseo/plugin/client";
import { Modal, TextInput } from "@getpaseo/plugin/client/react-native";
import { useQuery } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { readSupervisorControls, actSupervisorControls, SupervisorControlsSnapshotSchema, type SupervisorControlsSnapshot, type SupervisorControlInput } from "../shared/supervisor-controls";
import { profileProblem, type SupervisorProfile } from "../shared/supervisor-profile";
import { SupervisorProfileFields } from "./supervisor-profile";
import { workflowRequestId } from "./workflow-plans";
import { errorText } from "./format";
function Action({ theme, label, disabled, onPress }: { theme: PluginTheme; label: string; disabled?: boolean; onPress(): void }) {
  const [focused, focus] = useState(false);
  return <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled: !!disabled }} disabled={disabled} onPress={onPress}
    onFocus={() => focus(true)} onBlur={() => focus(false)} style={{ minHeight: 44, minWidth: 0, maxWidth: "100%", padding: 10, borderWidth: 2, borderRadius: 8,
      borderColor: focused ? theme.colors.accent : theme.colors.border, opacity: disabled ? 0.5 : 1 }}><Text style={{ color: theme.colors.foreground, flexShrink: 1 }}>{label}</Text></Pressable>;
}
export function SupervisorControlsButton({ theme, compact, homeId, scopeId, navigation, onOpenNative }: { theme: PluginTheme; compact: boolean; homeId: string; scopeId: string; navigation?: PluginSurfaceProps["navigation"] | undefined; onOpenNative?: (() => void) | undefined }) {
  const [open, show] = useState(false);
  return <><Action theme={theme} label="Supervisor settings" onPress={() => show(true)} />
    {open ? <SupervisorControlsDialog key={`${homeId}:${scopeId}`} theme={theme} compact={compact} homeId={homeId} scopeId={scopeId} navigation={navigation} onOpenNative={onOpenNative} onClose={() => show(false)} /> : null}</>;
}
function SupervisorControlsDialog({ theme, compact, homeId, scopeId, navigation, onOpenNative, onClose }: { theme: PluginTheme; compact: boolean; homeId: string; scopeId: string; navigation?: PluginSurfaceProps["navigation"] | undefined; onOpenNative?: (() => void) | undefined; onClose(): void }) {
  const read = useRpc(readSupervisorControls), act = useRpc(actSupervisorControls), gate = useRef(false), pending = useRef<SupervisorControlInput | null>(null);
  const [busy, setBusy] = useState(false), [error, fail] = useState<string | null>(null);
  const query = useQuery({ queryKey: ["firstmate", "supervisor-controls", homeId, scopeId], queryFn: async () => SupervisorControlsSnapshotSchema.parse(await read({ homeId, scopeId })), retry: false });
  async function send(input: SupervisorControlInput) {
    if (gate.current) return; gate.current = true; setBusy(true); fail(null); pending.current ??= input;
    try { const next = SupervisorControlsSnapshotSchema.parse(await act(pending.current));
      if (next.homeId !== homeId || next.scopeId !== scopeId) throw Error("The reviewed target changed. Reopen Supervisor settings.");
      pending.current = null; await query.refetch();
    } catch (e) { fail(`${errorText(e)} The request is retained. Check status before retrying; uncertain sends are never repeated.`); }
    finally { gate.current = false; setBusy(false); }
  }
  return <Modal title="Supervisor settings" open onOpenChange={open => { if (!open && !busy) onClose(); }}><Modal.Content>
    {query.data ? <SupervisorDetailView key={query.data.view.controlId ?? "current"} theme={theme} compact={compact} data={query.data} disabled={busy || query.isError || !!pending.current}
      onAction={input => { void send(input); }} onOpen={onOpenNative ?? (navigation ? () => { const id = query.data?.view.binding?.agentId; if (id) navigation.openAgent({ agentId: id }); } : undefined)} /> :
      <Text style={{ color: theme.colors.foreground }}>{query.isError ? "Supervisor status is unavailable. Reconnect and check again." : "Reading saved Supervisor status…"}</Text>}
    {error ? <Text accessibilityRole="alert" style={{ color: theme.colors.foreground }}>{error}</Text> : null}
    {pending.current ? <Action theme={theme} label="Retry exact saved request" disabled={busy} onPress={() => { void send(pending.current!); }} /> : null}
    <Action theme={theme} label="Check Supervisor status" disabled={busy} onPress={() => { void query.refetch(); }} />
    <Action theme={theme} label="Close Supervisor settings" disabled={busy} onPress={onClose} />
  </Modal.Content></Modal>;
}
/** Pure stored-state review also used by the native fixture. Rendering calls no action. */
export function SupervisorDetailView({ theme, compact, data, disabled = false, onAction, onOpen }: { theme: PluginTheme; compact: boolean; data: SupervisorControlsSnapshot; disabled?: boolean; onAction(input: SupervisorControlInput): void; onOpen?: (() => void) | undefined }) {
  const v = data.view, current = v.configurations.find(c => c.id === v.binding?.configurationId), [profile, choose] = useState<SupervisorProfile | null>(v.pending?.resolved ?? current?.resolved ?? null);
  const [reviewInput, setReviewInput] = useState<Extract<SupervisorControlInput, { op: "stage" }> | null>(null), [review, showReview] = useState(false), [opening, setOpening] = useState(""), [replacement, showReplacement] = useState(false);
  const [retiring, showRetire] = useState(false);
  const [sessions, setSessions] = useState(String(data.limits?.supervisorSessions ?? "")), [turns, setTurns] = useState(String(data.limits?.supervisorTurns ?? ""));
  const text = { color: theme.colors.foreground, fontSize: 14, lineHeight: 21 }, note = { ...text, color: theme.colors.foregroundMuted };
  const base = { requestId: workflowRequestId(), homeId: data.homeId, scopeId: data.scopeId, expectedEpoch: v.binding?.epoch ?? 1, bindingDigest: v.bindingDigest, planHash: data.planHash };
  const unavailable = disabled || !!data.problems.length || !v.binding;
  const limits = { supervisorSessions: Number(sessions), supervisorTurns: Number(turns) };
  const valid = !!profile && !profileProblem(profile, data.catalog) && Number.isSafeInteger(limits.supervisorSessions) && Number.isSafeInteger(limits.supervisorTurns) && limits.supervisorSessions >= v.sessions && limits.supervisorTurns >= v.turns &&
    !!data.limits && limits.supervisorSessions <= data.limits.supervisorSessions && limits.supervisorTurns <= data.limits.supervisorTurns;
  return <View testID="supervisor-detail" style={{ gap: 14, minWidth: 0, maxWidth: "100%" }}>
    <Text style={{ ...text, fontSize: 18, fontWeight: "600" }}>{data.title}</Text>
    <Text selectable style={note}>Exact scope: {data.scopeId} · local · epoch {v.binding?.epoch ?? "unavailable"}</Text>
    <Text style={text}>{v.state === "change-pending" ? "Change pending after current work." : `Supervisor ${v.state}`}</Text>
    <Text style={text}>Reserved: {v.sessions} sessions, {v.turns} turns. Uncertain effects: {v.obligations.uncertain.length}. Failed and uncertain work keeps its spending.</Text>
    {data.problems.map((p, i) => <Text accessibilityRole="alert" key={i} style={text}>{p}</Text>)}
    {v.replacementResume ? <><Text style={note}>A replacement review is saved. Resume only its original request; this reconciles the exact reserved identity and never repeats an uncertain opening.</Text>
      <Action theme={theme} label="Resume saved replacement" disabled={disabled} onPress={() => onAction(v.replacementResume!)} /></> : null}
    {current ? <Text style={text}>Current generation {current.generation}: {current.resolved.provider} · {current.resolved.modeId} · reasoning {current.resolved.thinkingOptionId ?? "not offered"}</Text> : <Text style={note}>Historical profile stays attributed to its original reservation. A new review captures a separate generation.</Text>}
    {v.pending ? <><Text style={text}>Proposed generation {v.pending.generation}: {v.pending.resolved.provider} · {v.pending.resolved.modeId} · reasoning {v.pending.resolved.thinkingOptionId ?? "not offered"}</Text>
      <Text style={note}>Current work keeps its original profile. Stop the exact native session, then review one additional counted session and opening. Idle, offline and timeouts are insufficient.</Text>
      <Text style={note}>Withdraw this exact proposal to review it again after work, catalog or policy changes. Its saved generation and other holds remain in history.</Text>
      <Action theme={theme} label="Withdraw pending proposal" disabled={disabled || !v.pendingDigest || !(["active", "suspect"].includes(v.binding?.state ?? "")) || !!v.replacementResume && v.binding?.state !== "suspect"}
        onPress={() => onAction({ ...base, op: "withdraw-proposal", expectedControlId: v.controlId!, configurationDigest: v.pendingDigest! })} />
      {v.reservedOwnerInputs.map(input => <View key={input.id} style={{ gap: 6 }}>
        <Text selectable style={note}>Undelivered owner input {input.id}. Saved payload {input.payloadDigest}. Withdrawal records non-delivery and keeps its original input and spent turn; it does not send it to the replacement.</Text>
        <Text selectable style={text}>{input.preview ?? "Input preview unavailable; its exact saved payload remains retained."}{input.truncated ? " (Preview shortened; full payload retained.)" : ""}</Text>
        <Action theme={theme} label={`Withdraw undelivered input ${input.id}`} disabled={disabled || v.binding?.state !== "active"}
          onPress={() => onAction({ ...base, op: "withdraw-input", expectedControlId: v.controlId!, effectId: input.id, effectVersion: input.version })} />
      </View>)}
      <Action theme={theme} label="Review replacement" disabled={unavailable || !!v.obligations.uncertain.length || !!v.obligations.reserved.length || !!v.replacementResume} onPress={() => showReplacement(true)} />
      {replacement ? <><TextInput accessibilityLabel="Replacement checkpoint and opening" multiline value={opening} onChangeText={setOpening} editable={!disabled}
        style={{ ...text, minHeight: 100, padding: 10, borderWidth: 1, borderColor: theme.colors.border, borderRadius: 8 }} />
        <Text style={text}>Only the captain should confirm. App provenance is unverified. History, workspace, transcript, task identities and all cumulative spending stay retained.</Text>
        <Action theme={theme} label="Replace stopped Supervisor" disabled={unavailable || !opening.trim() || !data.limits || v.sessions + 1 > data.limits.supervisorSessions || v.turns + 1 > data.limits.supervisorTurns}
          onPress={() => onAction({ ...base, op: "replace", expectedControlId: v.controlId!, opening: opening.trim() })} /></> : null}</> : v.state === "active" ? <>
      <SupervisorProfileFields theme={theme} compact={compact} catalog={data.catalog} profile={profile} onChange={p => { choose(p); showReview(false); }} disabled={unavailable || review} />
      {[["Cumulative session limit", sessions, setSessions], ["Cumulative turn limit", turns, setTurns]].map(([label, value, set]) => <View key={String(label)} style={{ gap: 5 }}><Text style={text}>{String(label)}</Text><TextInput accessibilityLabel={String(label)} value={String(value)} keyboardType="number-pad" editable={!unavailable && !review}
        onChangeText={set as (text: string) => void} style={{ ...text, minHeight: 44, padding: 10, borderWidth: 1, borderRadius: 8, borderColor: theme.colors.border }} /></View>)}
      {review ? <><Text style={text}>Review: {profile?.provider} · {profile?.modeId} · reasoning {profile?.thinkingOptionId ?? "not offered"}. Caps: {sessions} sessions/{turns} turns, including previous spending. Saving holds new work; it changes no running session.</Text>
        <Action theme={theme} label="Save pending profile change" disabled={unavailable || !valid || !reviewInput || reviewInput.bindingDigest !== v.bindingDigest || reviewInput.planHash !== data.planHash || reviewInput.policyDigest !== data.policyDigest} onPress={() => { if (reviewInput) onAction(reviewInput); }} />
        <Action theme={theme} label="Edit profile review" disabled={disabled} onPress={() => showReview(false)} /></> : <Action theme={theme} label="Review profile change" disabled={unavailable || !valid} onPress={() => { setReviewInput({ ...base, op: "stage", profile: profile!, limits, policyDigest: data.policyDigest }); showReview(true); }} />}
      <Action theme={theme} label="Pause new admissions" disabled={unavailable} onPress={() => onAction({ ...base, op: "pause" })} />
    </> : v.state === "paused" ? <Action theme={theme} label="Resume this pause" disabled={unavailable} onPress={() => onAction({ ...base, op: "resume", expectedControlId: v.controlId! })} /> : null}
    {v.binding && onOpen ? <Action theme={theme} label="Open exact native Supervisor" onPress={onOpen} /> : v.binding ? <Text selectable style={note}>Native session: {v.binding.agentId}. Open this exact session in Paseo before stopping it.</Text> : null}
    {data.kind === "project" && v.binding?.state === "retired" ? <Text style={text}>This project's Supervisor is retired. Its conversation stays readable in Paseo, and its identity, spending and history are kept. The project stays as context.</Text> : null}
    {data.kind === "project" && v.binding && v.binding.state !== "retired" && !v.pending && !v.replacementResume ? retiring ? <>
      <Text style={text}>Retire this project's Supervisor for good? It gets no more turns or messages, and the project stays as context for plans. Its conversation stays readable in Paseo; its identity, spending and history are kept. Only the captain should confirm. App provenance is unverified.</Text>
      <Action theme={theme} label="Retire project Supervisor" disabled={disabled || !!data.problems.length || !!v.obligations.uncertain.length || !!v.obligations.reserved.length ||
        !!v.obligations.workers.length || !!v.obligations.decisions.length || !!v.obligations.sources.length} onPress={() => onAction({ ...base, op: "retire" })} />
      <Action theme={theme} label="Keep this Supervisor" disabled={disabled} onPress={() => showRetire(false)} />
    </> : <Action theme={theme} label="Review retiring this Supervisor" disabled={disabled} onPress={() => showRetire(true)} /> : null}
    <Text style={note}>Retained obligations: {v.obligations.reserved.length} reserved effects, {v.obligations.workers.length} workers, {v.obligations.decisions.length} decisions, {v.obligations.sources.length} sources, {v.obligations.unlanded.length} unlanded steps.</Text>
    <Text style={note}>{v.retirement}</Text>
  </View>;
}
