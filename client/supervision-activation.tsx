/** The only shipped attach caller. This app button is a convention: RPC origin is not authenticated. */
import type { PluginTheme } from "@getpaseo/plugin";
import { useRpc } from "@getpaseo/plugin/client";
import { Modal, TextInput } from "@getpaseo/plugin/client/react-native";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { ActivationSnapshotSchema, attachSupervisorFromUi,
  type ActivationSnapshot, type AttachSupervisorInput, type ResumeSupervisorInput } from "../shared/supervision-activation";
import { migrationTargets } from "../shared/fleet";
import { OptionPicker } from "./option-picker";
import { workflowRequestId, useWorkflowPlans } from "./workflow-plans";
import { errorText } from "./format";
import { MigrationOperations } from "./migration-operations";
import { activationHasHistory } from "./ownership-state";
type Plan = ActivationSnapshot["plans"][number];
function Action({ theme, label, onPress, disabled = false }: { theme: PluginTheme; label: string; onPress(): void; disabled?: boolean }) {
  return <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled }} disabled={disabled} onPress={onPress}
    style={{ minHeight: 44, maxWidth: "100%", minWidth: 0, flexShrink: 1, paddingHorizontal: 12, paddingVertical: 10, justifyContent: "center", borderWidth: 1, borderColor: theme.colors.border, borderRadius: 7, opacity: disabled ? 0.5 : 1 }}>
    <Text style={{ color: theme.colors.foreground, flexShrink: 1 }}>{label}</Text>
  </Pressable>;
}
export function SupervisionActivationBoard({ theme, compact, advanced = false, planId }: { theme: PluginTheme; compact: boolean; advanced?: boolean; planId?: string }) {
  const { activation, activationError: readError, updateActivation } = useWorkflowPlans();
  const data = activation && planId ? { ...activation, plans: activation.plans.filter(p => p.plan === planId),
    migrations: activation.migrations.filter(m => m.planId === planId), dispositions: activation.dispositions.filter(d => d.planId === planId),
    audits: activation.audits.filter(a => a.plan === planId), resumeMigrations: activation.resumeMigrations?.filter(m => m.plan === planId) } : activation;
  const [selected, select] = useState<Plan | null>(null);
  const [details, setDetails] = useState(false), showDetails = !planId || details;
  useEffect(() => { select(null); }, [data?.homeId]);
  if (!data || !activationHasHistory(data) && !data.problems.length && !data.pause && !readError && !(advanced && data.enabled)) return null;
  return <View testID="supervision-activation-board" style={{ gap: 8, padding: compact ? 12 : 16 }}>
    <Text style={{ color: theme.colors.foreground, fontWeight: "600" }}>Plan help</Text>
    {data.pause ? <Text accessibilityLiveRegion="polite" style={{ color: theme.colors.foregroundMuted }}>{data.pause}</Text> : null}
    {data.problems.map(p => <Text key={p} accessibilityRole="alert" style={{ color: theme.colors.foreground }}>{p}</Text>)}
    {readError ? <Text accessibilityRole="alert" style={{ color: theme.colors.foreground }}>Supervisor status could not be refreshed. Attach is unavailable.</Text> : null}
    {data.plans.map(plan => <View key={plan.scopeId} style={{ gap: 4 }}>
      <Text style={{ color: theme.colors.foreground }}>{planId ? plan.binding === "active" && plan.opening === "succeeded" ? "Plan helper is ready." : !plan.binding ? "Ready for the captain's Attach review." : "Saved helper setup needs checking. Inspect its attachment before continuing." : `${plan.title} · ${plan.binding ?? "No supervisor"}${plan.opening ? ` · opening ${plan.opening}` : ""}`}</Text>
      {showDetails ? <Text selectable style={{ color: theme.colors.foregroundMuted, fontSize: 12 }}>Plan {plan.plan} · scope {plan.scopeId} · version {plan.scopeVersion} · supervisor {plan.supervisorId}</Text> : null}
      {showDetails && plan.readiness ? <Text style={{ color: theme.colors.foregroundMuted }}>{plan.readiness.ready ? "Stored readiness checks met; live qualification still required." : `Readiness held: ${plan.readiness.reasons.join(" ")}`}</Text> : null}
      {plan.canAttach ? <Action theme={theme} label={planId ? "Attach plan helper" : `Attach supervisor to ${plan.title}`} disabled={!!readError || !data.enabled} onPress={() => select(plan)} /> : null}
      {plan.resumeRequestId ? <Action theme={theme} label={`Resume attachment to ${plan.title}`} disabled={!!readError || !data.enabled} onPress={() => select(plan)} /> : null}
    </View>)}
    {planId ? <Action theme={theme} label={details ? "Hide attachment details" : "Attachment details"} onPress={() => setDetails(!details)} /> : null}
    {showDetails && data.audits.length ? <Text style={{ color: theme.colors.foregroundMuted }}>Attachment history · by convention, not verified</Text> : null}
    {showDetails ? data.audits.map(a => <Text selectable key={`${a.at}:${a.supervisor}`} style={{ color: theme.colors.foregroundMuted }}>
      {a.at} · {a.plan} · supervisor {a.supervisor} · {a.source}
    </Text>) : null}
    {showDetails ? data.dispositions.filter(d => !data.migrations.some(m => m.id === d.migrationId)).map(d =>
      <Text selectable key={d.id} style={{ color: theme.colors.foregroundMuted }}>{d.source} · {d.route} · {d.removal.state} · {d.reason}</Text>) : null}
    {showDetails && (data.operatorEnabled || data.migrations.length || data.dispositions.length || data.resumeMigrations?.length) ?
      <MigrationOperations theme={theme} data={data} unavailable={!!readError || !data.enabled || !data.operatorEnabled} onRead={next => updateActivation?.(next)} /> : null}
    {selected ? <AttachConfirmation key={`${data.homeId}:${selected.scopeId}`} theme={theme} compact={compact} homeId={data.homeId} plan={selected} plain={!!planId}
      stale={!!readError || !data.enabled || !data.plans.some(p => p.scopeId === selected.scopeId && p.supervisorId === selected.supervisorId &&
        (selected.resumeRequestId ? p.resumeRequestId === selected.resumeRequestId : p.canAttach && p.hash === selected.hash && p.scopeVersion === selected.scopeVersion))}
      onClose={() => select(null)} onRead={next => updateActivation?.(next)} /> : null}
  </View>;
}
export function AttachConfirmation({ theme, compact, homeId, plan, stale, onClose, onRead, plain = false }: {
  theme: PluginTheme; compact: boolean; homeId: string; plan: Plan; stale: boolean; onClose(): void; onRead(snapshot: ActivationSnapshot): void; plain?: boolean;
}) {
  const attach = useRpc(attachSupervisorFromUi), catalog = useRpc(migrationTargets);
  const resuming = !!plan.resumeRequestId;
  const models = useQuery({ queryKey: ["firstmate", "attach-models", homeId], queryFn: () => catalog({}), enabled: !resuming });
  const [provider, setProvider] = useState(""), [mode, setMode] = useState(""), [opening, setOpening] = useState("");
  const [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null), [uncertain, setUncertain] = useState(false);
  const [details, setDetails] = useState(false);
  const pending = useRef<AttachSupervisorInput | ResumeSupervisorInput | null>(null), gate = useRef(false);
  const targets = models.data?.targets ?? [], target = targets.find(t => t.provider === provider);
  const valid = !stale && (resuming || !!target && target.modes.some(m => m.id === mode) && !!opening.trim());
  async function confirm() {
    if (gate.current || !valid && !pending.current) return;
    gate.current = true; setBusy(true); setError(null);
    // On a lost reply keep the exact request, including profile, opening and reserved supervisor.
    pending.current ??= plan.resumeRequestId ? { homeId, requestId: plan.resumeRequestId, resume: true } : { requestId: workflowRequestId(), homeId, plan: plan.plan, planHash: plan.hash,
      scopeId: plan.scopeId, scopeVersion: plan.scopeVersion, supervisorId: plan.supervisorId, profile: { provider, modeId: mode }, opening: opening.trim() };
    try {
      const next = ActivationSnapshotSchema.parse(await attach(pending.current)); onRead(next);
      const audit = next.audits.find(a => a.supervisor === plan.supervisorId && a.plan === plan.plan);
      const current = next.plans.find(p => p.scopeId === plan.scopeId && p.supervisorId === plan.supervisorId);
      if (!audit) { setUncertain(true); setError("No attachment receipt was returned. Keep this request and inspect the board before retrying."); }
      else if (current?.binding === "active" && current.opening === "succeeded") onClose();
      else { setUncertain(true); setError(plain ? "The attachment is saved, but its opening isn't confirmed. Inspect attachment details and resume this saved request. Recovery never repeats an uncertain send." : `Attachment recorded; ${current?.binding ?? "binding unknown"}, opening ${current?.opening ?? "unknown"}. Inspect the reserved supervisor, then retry this request. Recovery never repeats an uncertain send.`); }
    } catch (e) { setUncertain(true); setError(`${errorText(e)} The result may be recorded. Retry keeps this exact request; inspect the supervisor before taking any other action.`); }
    finally { gate.current = false; setBusy(false); }
  }
  return <Modal title={resuming ? `Resume attachment to ${plan.title}?` : plain ? `Attach plan help to ${plan.title}?` : `Attach supervisor to ${plan.title}?`} open onOpenChange={open => { if (!open && !busy) onClose(); }}>
    <Modal.Content>
      <View testID="supervision-attach-confirmation" style={{ gap: 16 }}>
        <Text selectable style={{ color: theme.colors.foreground }}>Plan: {plan.title}{plain ? "" : ` (${plan.plan})`}</Text>
        {!plain || details ? <Text selectable style={{ color: theme.colors.foreground }}>Supervisor: {plan.supervisorId}{provider ? ` · ${provider}` : ""}</Text> : null}
        <Text style={{ color: theme.colors.foregroundMuted }}>{resuming ? "Resume the recorded attachment after inspecting this reserved supervisor. Recovery looks up its exact identity and sends the saved opening only if it has not been dispatched." : plain ? "This creates one separate plan helper and sends the opening below. One session and one opening turn count against the recorded budget, including uncertain outcomes." : "This creates one independent supervisor and sends the opening below."} {plain ? "Only the captain should press Attach. Paseo cannot verify who pressed this button; the action is recorded for review." : "This is a captain action by convention, not verified. Paseo supplies no caller identity. The board records “client UI (unverified)”."}</Text>
        {resuming ? !plain || details ? <Text selectable style={{ color: theme.colors.foregroundMuted }}>Saved attachment request: {plan.resumeRequestId}</Text> : null : <>
        <OptionPicker theme={theme} compact={compact} roomy={plain} label={plain ? "Plan helper model" : "Supervisor model"} title={plain ? "Plan helper model" : "Supervisor model"} value={provider}
          options={targets.map(t => ({ value: t.provider, label: t.label }))} disabled={busy || uncertain} onSelect={v => { setProvider(v); setMode(""); }} />
        <OptionPicker theme={theme} compact={compact} roomy={plain} label="Permission mode" title={plain ? "Plan helper permissions" : "Supervisor permission mode"} value={mode}
          options={target?.modes.map(m => ({ value: m.id, label: m.label })) ?? []} disabled={!target || busy || uncertain} onSelect={setMode} />
        <Text style={{ color: theme.colors.foreground }}>{plain ? "Opening for this plan helper" : "Opening for this supervisor"}</Text>
        <TextInput accessibilityLabel={plain ? "Opening for this plan helper" : "Opening for this supervisor"} value={opening} onChangeText={setOpening} editable={!busy && !uncertain} multiline maxLength={16000}
          style={{ minHeight: 100, color: theme.colors.foreground, backgroundColor: theme.colors.surface1, borderColor: theme.colors.border, borderWidth: 1, borderRadius: 7, padding: 12 }} />
        </>}
        {models.error ? <Text accessibilityRole="alert" style={{ color: theme.colors.foreground }}>Models could not be loaded. Close and reopen to retry.</Text> : null}
        {stale && !pending.current ? <Text accessibilityRole="alert" style={{ color: theme.colors.foreground }}>The plan changed. Close and refresh before attaching.</Text> : null}
        {error ? <Text accessibilityRole="alert" style={{ color: theme.colors.foreground }}>{error}</Text> : null}
        {plain ? <Action theme={theme} label={details ? "Hide attachment identity" : "Attachment identity"} onPress={() => setDetails(!details)} /> : null}
        <Action theme={theme} label={busy ? resuming ? "Resuming…" : "Attaching…" : uncertain ? "Retry this attachment request" : plain ? resuming ? "Resume saved attachment" : "Attach this plan helper" : resuming ? `Resume ${plan.supervisorId} for ${plan.title}` : `Attach ${plan.supervisorId} to ${plan.title}`} disabled={busy || !valid && !pending.current} onPress={() => { void confirm(); }} />
        <Action theme={theme} label="Cancel" disabled={busy} onPress={onClose} />
      </View>
    </Modal.Content>
  </Modal>;
}
