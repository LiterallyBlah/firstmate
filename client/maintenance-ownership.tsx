/** Captain-app maintenance admission/answers. Viewing never provisions, answers or attaches. */
import type { PluginTheme } from "@getpaseo/plugin";
import { useRpc } from "@getpaseo/plugin/client";
import type { PluginScreenProps } from "@getpaseo/plugin/client";
import { Modal, TextInput } from "@getpaseo/plugin/client/react-native";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { readMaintenance, admitMaintenanceFromUi, answerMaintenanceFromUi, MaintenanceRuntimeSnapshotSchema,
  type MaintenanceRuntimeSnapshot, type AdmitMaintenance, type MaintenanceAnswer } from "../shared/maintenance-runtime";
import { migrationTargets } from "../shared/fleet";
import { OptionPicker } from "./option-picker";
import { workflowRequestId } from "./workflow-plans";
import { errorText } from "./format";

type Owner = MaintenanceRuntimeSnapshot["owners"][number];
type Choice = MaintenanceRuntimeSnapshot["captainDecisions"][number];
function Action({ theme, label, disabled = false, onPress }: { theme: PluginTheme; label: string; disabled?: boolean; onPress(): void }) {
  return <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled }} disabled={disabled} onPress={onPress}
    style={{ minHeight: 44, paddingHorizontal: 12, paddingVertical: 10, justifyContent: "center", borderWidth: 1, borderColor: theme.colors.border, borderRadius: 7, opacity: disabled ? 0.5 : 1 }}>
    <Text style={{ color: theme.colors.foreground }}>{label}</Text>
  </Pressable>;
}
export function MaintenanceOwnershipBoard({ theme, compact, hostId = "local", navigation }: { theme: PluginTheme; compact: boolean; hostId?: string; navigation?: PluginScreenProps["navigation"] }) {
  const read = useRpc(readMaintenance);
  const query = useQuery({ queryKey: ["firstmate", "maintenance-ownership", hostId], queryFn: async () => MaintenanceRuntimeSnapshotSchema.parse(await read({})), refetchInterval: 5000 });
  const [admission, selectAdmission] = useState<Owner | "new" | null>(null), [choice, selectChoice] = useState<Choice | null>(null);
  const data = query.data;
  useEffect(() => { selectAdmission(null); selectChoice(null); }, [hostId, data?.homeId]);
  if (!data || !data.enabled && !data.owners.length && !data.captainDecisions.length) return null;
  const stale = query.isError || !data.enabled, colors = theme.colors;
  return <View testID="maintenance-ownership" style={{ gap: 8, padding: compact ? 12 : 16, borderBottomWidth: 1, borderColor: colors.border }}>
    <Text style={{ color: colors.foreground, fontSize: 14, fontWeight: "600" }}>Maintenance owners</Text>
    <Text style={{ color: colors.foregroundMuted }}>Observe mode. Automatic cleanup is held.</Text>
    {query.isError ? <Text accessibilityRole="alert" style={{ color: colors.statusWarning }}>Maintenance could not be refreshed. Actions are unavailable; refresh before continuing.</Text> : null}
    {data.problems.map(p => <Text key={p} accessibilityRole="alert" style={{ color: colors.statusWarning }}>{p}</Text>)}
    <ScrollView style={{ maxHeight: 240 }} contentContainerStyle={{ gap: 8 }}>
      {data.owners.map(owner => <View key={owner.scopeId} style={{ gap: 4 }}>
        <Text style={{ color: colors.foreground }}>{owner.admission?.name ?? "Maintenance owner"} · {owner.state}{owner.opening ? ` · opening ${owner.opening}` : ""}</Text>
        <Text style={{ color: colors.foregroundMuted }}>{owner.sessions} session reserved · {owner.turns} turns reserved{owner.uncertain ? ` · ${owner.uncertain} uncertain` : ""}</Text>
        {owner.agentId && navigation ? <Action theme={theme} label={`Open ${owner.admission?.name ?? "maintenance owner"}`} onPress={() => navigation.openAgent({ agentId: owner.agentId!, ...(hostId === "local" ? {} : { serverId: hostId }) })} /> : null}
        {owner.admission && owner.opening !== "succeeded" ? <Action theme={theme} label={`Resume ${owner.admission.name}`} disabled={stale} onPress={() => selectAdmission(owner)} /> : null}
      </View>)}
      <Text style={{ color: colors.foreground, fontWeight: "600" }}>Captain decisions · {data.captainDecisions.length}</Text>
      {data.captainDecisions.map(d => <Action key={d.decisionId} theme={theme} label={`Review: ${d.title}`} disabled={stale || !d.permittedActions.includes("answer")} onPress={() => selectChoice(d)} />)}
      {data.outbox.some(o => o.state === "pending") ? <Text style={{ color: colors.foregroundMuted }}>Answers awaiting owner handling: {data.outbox.filter(o => o.state === "pending").length}. Delivery and handling retain their original receipts.</Text> : null}
    </ScrollView>
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
      <Action theme={theme} label="Create maintenance owner" disabled={stale || data.freshness === "held"} onPress={() => selectAdmission("new")} />
      <Action theme={theme} label="Refresh maintenance" onPress={() => { void query.refetch(); }} />
    </View>
    {admission ? <MaintenanceAdmissionConfirmation key={`${data.homeId}:${admission === "new" ? "new" : admission.scopeId}`} theme={theme} compact={compact} homeId={data.homeId}
      owner={admission === "new" ? null : admission} stale={stale} onClose={() => selectAdmission(null)} onRead={() => { void query.refetch(); }} /> : null}
    {choice ? <MaintenanceAnswerConfirmation key={`${data.homeId}:${choice.decisionId}`} theme={theme} choice={choice} stale={stale || !data.captainDecisions.some(d => d.decisionId === choice.decisionId && d.subjectHash === choice.subjectHash && d.revision === choice.revision && d.permittedActions.includes("answer"))}
      onClose={() => selectChoice(null)} onRead={() => { void query.refetch(); }} /> : null}
  </View>;
}
export function MaintenanceAdmissionConfirmation({ theme, compact, homeId, owner, stale, onClose, onRead }: {
  theme: PluginTheme; compact: boolean; homeId: string; owner: Owner | null; stale: boolean; onClose(): void; onRead(): void;
}) {
  const admit = useRpc(admitMaintenanceFromUi), catalog = useRpc(migrationTargets), resume = owner?.admission;
  const models = useQuery({ queryKey: ["firstmate", "maintenance-models", homeId], queryFn: () => catalog({}), enabled: !resume });
  const [name, setName] = useState(""), [provider, setProvider] = useState(""), [mode, setMode] = useState(""), [turns, setTurns] = useState("20");
  const [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null);
  const pending = useRef<AdmitMaintenance | null>(null), gate = useRef(false), locked = busy || !!pending.current;
  const target = models.data?.targets.find(t => t.provider === provider);
  const valid = !!resume || !!name.trim() && !!target?.modes.some(m => m.id === mode) && /^\d+$/.test(turns) && Number(turns) >= 1 && Number(turns) <= 100000;
  async function confirm() {
    if (gate.current || stale || !valid && !pending.current) return;
    gate.current = true; setBusy(true); setError(null);
    pending.current ??= resume ? { homeId, requestId: resume.requestId, resume: true } : { homeId, requestId: workflowRequestId(), scopeId: workflowRequestId(), name: name.trim(),
      profile: { provider, modeId: mode }, limits: { supervisorSessions: 1, supervisorTurns: Number(turns) } };
    try {
      const next = MaintenanceRuntimeSnapshotSchema.parse(await admit(pending.current)); onRead();
      const current = next.owners.find(o => o.admission?.requestId === pending.current!.requestId);
      if (current?.state === "active" && current.opening === "succeeded") onClose();
      else setError("Admission is recorded. Inspect the reserved owner, then resume this request. Uncertain opening sends stay held.");
    } catch (e) { setError(`${errorText(e)} The request may be recorded. Retry preserves its exact identity and spend.`); }
    finally { gate.current = false; setBusy(false); }
  }
  const field = { color: theme.colors.foreground, backgroundColor: theme.colors.surface1, borderWidth: 1, borderColor: theme.colors.border, borderRadius: 7, padding: 12, fontSize: 16 };
  return <Modal title={resume ? `Resume ${resume.name}?` : "Create maintenance owner?"} open onOpenChange={open => { if (!open && !busy) onClose(); }}><Modal.Content>
    <View style={{ gap: 16 }}>
      <Text style={{ color: theme.colors.foreground }}>Create one persistent maintenance conversation in its own workspace. The opening limits it to observation and checked decisions. No cleanup or corrective work is authorized.</Text>
      <Text style={{ color: theme.colors.foregroundMuted }}>Captain app action by convention, not verified. Paseo supplies no caller identity. Session and turn reservations are never refunded after failure or uncertainty.</Text>
      {resume ? <Text selectable style={{ color: theme.colors.foreground }}>{resume.profile.provider} · {resume.profile.modeId} · one session · {resume.limits.supervisorTurns} total turns. Resume uses the saved profile and request.</Text> : <>
        <Text style={{ color: theme.colors.foreground }}>Owner name</Text>
        <TextInput accessibilityLabel="Maintenance owner name" value={name} onChangeText={setName} maxLength={120} editable={!locked} style={field} />
        <OptionPicker theme={theme} compact={compact} label="Maintenance model" title="Maintenance model" value={provider} options={models.data?.targets.map(t => ({ value: t.provider, label: t.label })) ?? []}
          disabled={locked} onSelect={v => { setProvider(v); setMode(""); }} />
        <OptionPicker theme={theme} compact={compact} label="Maintenance permission mode" title="Maintenance permission mode" value={mode} options={target?.modes.map(m => ({ value: m.id, label: m.label })) ?? []}
          disabled={locked || !target} onSelect={setMode} />
        <Text style={{ color: theme.colors.foreground }}>Total owner turns, including the opening, incidents and captain answer notifications (1–100,000)</Text>
        <TextInput accessibilityLabel="Maintenance owner turn limit" value={turns} onChangeText={setTurns} maxLength={6} editable={!locked} keyboardType="number-pad" style={field} />
      </>}
      {models.isError ? <Text accessibilityRole="alert" style={{ color: theme.colors.statusWarning }}>Models could not be loaded. Close and reopen to retry.</Text> : null}
      {error ? <Text accessibilityRole="alert" style={{ color: theme.colors.statusWarning }}>{error}</Text> : null}
      <Action theme={theme} label={busy ? "Recording admission…" : pending.current ? "Retry recorded maintenance admission" : resume ? "Resume maintenance admission" : "Confirm maintenance owner"}
        disabled={busy || stale || !valid && !pending.current} onPress={() => { void confirm(); }} />
      <Action theme={theme} label="Cancel" disabled={busy} onPress={onClose} />
    </View>
  </Modal.Content></Modal>;
}
export function MaintenanceAnswerConfirmation({ theme, choice, stale, onClose, onRead }: { theme: PluginTheme; choice: Choice; stale: boolean; onClose(): void; onRead(): void }) {
  const answer = useRpc(answerMaintenanceFromUi), [option, setOption] = useState(""), [text, setText] = useState(""), [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null);
  const pending = useRef<MaintenanceAnswer | null>(null), gate = useRef(false);
  async function confirm() {
    if (gate.current || stale || !option) return;
    gate.current = true; setBusy(true); setError(null);
    pending.current ??= { homeId: choice.homeId, submissionId: workflowRequestId(), decisionId: choice.decisionId, revision: choice.revision,
      subjectHash: choice.subjectHash, evidence: choice.evidence.map(e => ({ ref: e.ref, digest: e.digest! })), option, text };
    try {
      const next = MaintenanceRuntimeSnapshotSchema.parse(await answer(pending.current)); onRead();
      if (next.decisions.some(d => d.id === choice.decisionId && d.answer?.submissionId === pending.current!.submissionId)) onClose();
      else setError("No matching answer receipt returned. Inspect the decision, then retry this exact submission.");
    } catch (e) { setError(`${errorText(e)} Your choice and notes are retained; retry keeps the same submission.`); }
    finally { gate.current = false; setBusy(false); }
  }
  return <Modal title={choice.title} open onOpenChange={open => { if (!open && !busy) onClose(); }}><Modal.Content><View style={{ gap: 16 }}>
    <Text style={{ color: theme.colors.foreground }}>{choice.question}</Text>
    <Text style={{ color: theme.colors.foregroundMuted }}>This records a captain choice by app convention, not verified identity. It changes no budget and grants no work authority.</Text>
    {choice.options.map(o => <Action key={o.id} theme={theme} label={`${option === o.id ? "Selected: " : ""}${o.number}. ${o.label}${choice.recommendation === o.id ? " (recommended)" : ""}`} disabled={busy || !!pending.current || stale} onPress={() => setOption(o.id)} />)}
    <ScrollView style={{ maxHeight: 100 }}>{choice.evidence.map((e, i) => <Text selectable key={`${e.ref}:${i}`} style={{ color: theme.colors.foregroundMuted }}>{e.ref}{e.digest ? ` · ${e.digest}` : ""}</Text>)}</ScrollView>
    <TextInput accessibilityLabel="Maintenance answer notes" value={text} onChangeText={setText} editable={!busy && !pending.current} multiline maxLength={10000}
      style={{ minHeight: 80, fontSize: 16, color: theme.colors.foreground, backgroundColor: theme.colors.surface1, padding: 12, borderWidth: 1, borderColor: theme.colors.border, borderRadius: 7 }} />
    {stale ? <Text accessibilityRole="alert" style={{ color: theme.colors.statusWarning }}>This decision changed or could not be refreshed. Close and refresh before answering.</Text> : null}
    {error ? <Text accessibilityRole="alert" style={{ color: theme.colors.statusWarning }}>{error}</Text> : null}
    <Action theme={theme} label={busy ? "Recording answer…" : pending.current ? "Retry maintenance answer" : "Submit maintenance answer"} disabled={busy || stale || !option} onPress={() => { void confirm(); }} />
    <Action theme={theme} label="Cancel" disabled={busy} onPress={onClose} />
  </View></Modal.Content></Modal>;
}
