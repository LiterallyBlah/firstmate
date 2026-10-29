/** Optional plan review. This component never calls Attach; the existing dedicated board owns it. */
import type { PluginTheme } from "@getpaseo/plugin";
import { useRpc } from "@getpaseo/plugin/client";
import { Modal, TextInput } from "@getpaseo/plugin/client/react-native";
import { useQuery } from "@tanstack/react-query";
import { createContext, useContext, useRef, useState, type ReactNode } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { readPlanHelp } from "../shared/plan-help";
import { readMigrationSettings, setMigrationSettings, type MigrationSettingsInput } from "../shared/migration-settings";
import { migrateSupervisionPlan, ActivationSnapshotSchema, type MigrationCommand } from "../shared/supervision-activation";
import { planFinished, type WorkflowPlan } from "../shared/workflow-plans";
import { workflowRequestId, useWorkflowPlans } from "./workflow-plans";
import { SupervisionActivationBoard } from "./supervision-activation";
import { errorText } from "./format";
const OpenHelp = createContext<((plan: string, title: string) => void) | null>(null);
/** Lives above plan rows: a freeze can remove a row without losing its open review. */
export function PlanHelpSurface({ theme, children }: { theme: PluginTheme; children: ReactNode }) {
  const { snapshot, activation } = useWorkflowPlans(), [selected, setSelected] = useState<{ homeId: string; plan: string; title: string } | null>(null);
  const open = (plan: string, title: string) => { if (snapshot) setSelected({ homeId: snapshot.homeId, plan, title }); };
  const homeId = snapshot?.homeId;
  const retained = activation && activation.homeId === homeId ? activation.migrations.filter(m => ["prepared", "barrier"].includes(m.state) && !snapshot?.plans.some(p => p.definition.id === m.planId)) : [];
  const handovers = [...new Map([...(snapshot?.planHelpPending ?? []), ...retained.map(m => ({ plan: m.planId, title: activation?.plans.find(p => p.plan === m.planId)?.title ?? m.planId }))].map(p => [p.plan, p])).values()];
  return <OpenHelp.Provider value={open}>
    {handovers.length ? <View style={{ gap: 8, padding: 12 }}>{handovers.map(p => <HelpButton key={p.plan} theme={theme} label={`Continue handover: ${p.title}`} onPress={() => open(p.plan, p.title)} />)}</View> : null}
    {children}
    {selected && selected.homeId === homeId ? <Modal title={`Help with ${selected.title}`} open onOpenChange={value => { if (!value) setSelected(null); }}><Modal.Content>
      <PlanHelpReview key={`${homeId}:${selected.plan}`} theme={theme} homeId={selected.homeId} planId={selected.plan} onClose={() => setSelected(null)} />
    </Modal.Content></Modal> : null}
  </OpenHelp.Provider>;
}
export function PlanHelpAction({ theme, plan }: { theme: PluginTheme; plan: WorkflowPlan }) {
  const { snapshot, activation, activationError } = useWorkflowPlans(), open = useContext(OpenHelp);
  if (!open || !snapshot || plan.definition.implicit || planFinished(plan) || plan.status === "abandoned") return null;
  const helper = activation?.plans.find(p => p.plan === plan.definition.id);
  const ready = !activationError && helper?.binding === "active" && helper.opening === "succeeded";
  return <View style={{ gap: 6 }}>
    {ready ? <Text style={{ color: theme.colors.foregroundMuted }}>Plan helper is ready.</Text> : null}
    <HelpButton theme={theme} label="Review plan help" onPress={() => open(plan.definition.id, plan.definition.title)} />
  </View>;
}
export function HelpButton({ theme, label, onPress, disabled = false }: { theme: PluginTheme; label: string; onPress(): void; disabled?: boolean }) {
  return <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled }} disabled={disabled} onPress={onPress}
    style={{ minHeight: 44, minWidth: 44, maxWidth: "100%", paddingHorizontal: 12, paddingVertical: 10, borderWidth: 1, borderColor: theme.colors.border, borderRadius: 7, justifyContent: "center", opacity: disabled ? 0.5 : 1 }}>
    <Text style={{ color: theme.colors.foreground, flexShrink: 1 }}>{label}</Text>
  </Pressable>;
}
export function PlanHelpReview({ theme, homeId, planId, onClose }: { theme: PluginTheme; homeId: string; planId: string; onClose(): void }) {
  const read = useRpc(readPlanHelp), readBackup = useRpc(readMigrationSettings), saveBackup = useRpc(setMigrationSettings), migrate = useRpc(migrateSupervisionPlan);
  const { activation, activationError, updateActivation, refreshActivation, scope } = useWorkflowPlans();
  const query = useQuery({ queryKey: ["firstmate", "plan-help", scope, homeId, planId], queryFn: () => read({ homeId, plan: planId }), retry: false });
  const backup = useQuery({ queryKey: ["firstmate", "plan-backup", scope, homeId], queryFn: () => readBackup({ homeId }), retry: false });
  const data = query.data, migration = activation?.homeId === homeId ? activation.migrations.find(m => m.planId === planId) : undefined;
  const [destination, setDestination] = useState<string | null>(null), [retention, setRetention] = useState<string | null>(null);
  const [inventory, setInventory] = useState(""), [rollbackBuild, setRollback] = useState(""), [policy, setPolicy] = useState("");
  const [reason, setReason] = useState(""), [details, setDetails] = useState(false), [review, setReview] = useState<MigrationCommand | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null), [uncertain, setUncertain] = useState(false);
  const saved = useRef<MigrationSettingsInput | null>(null), pending = useRef<MigrationCommand | null>(null), gate = useRef(false);
  const foreground = { color: theme.colors.foreground }, muted = { color: theme.colors.foregroundMuted };
  const fieldStyle = { ...foreground, minHeight: 44, padding: 10, borderWidth: 1, borderColor: theme.colors.border, borderRadius: 7, backgroundColor: theme.colors.surface1 };
  const held = !data || !!query.error || query.isFetching || !!activationError || !activation?.enabled || data.problems.length > 0;
  const holds = activation?.dispositions.filter(d => d.planId === planId && d.route === "hold") ?? [];
  async function refresh() { refreshActivation?.(); await Promise.all([query.refetch(), backup.refetch()]); }
  async function save() {
    if (gate.current || !backup.data || backup.error || migration) return;
    gate.current = true; setBusy(true); setError(null);
    saved.current ??= { homeId, expectedRevision: backup.data.revision, requestId: workflowRequestId(), backup: {
      destination: (destination ?? backup.data.backup?.destination ?? "").trim(), retention: (retention ?? backup.data.backup?.retention ?? "").trim() } };
    try { await saveBackup(saved.current); saved.current = null; await refresh(); }
    catch (e) { setError(`${errorText(e)} Your review is kept. Check saved backup settings before trying the same save again.`); }
    finally { gate.current = false; setBusy(false); }
  }
  async function run() {
    if (!review || gate.current || activationError || activation?.homeId !== homeId) return;
    gate.current = true; setBusy(true); setError(null); pending.current ??= review;
    try {
      const next = ActivationSnapshotSchema.parse(await migrate(pending.current)); updateActivation?.(next);
      pending.current = null; setReview(null); setUncertain(false); await query.refetch();
    } catch (e) { setUncertain(true); setError(`${errorText(e)} Check the saved handover. This review keeps the exact request; no unknown send is repeated.`); }
    finally { gate.current = false; setBusy(false); }
  }
  function choose(command: MigrationCommand) { if (pending.current) return; setReview(command); setError(null); }
  return <ScrollView contentContainerStyle={{ gap: 16, padding: 4 }} testID="plan-help-review">
    <Text style={foreground}>Plan help is optional. FirstMate keeps its existing conversation. Nothing changes until you review and confirm a handover.</Text>
    {query.isPending ? <Text accessibilityLiveRegion="polite" style={muted}>Checking this plan…</Text> : null}
    {query.error || backup.error ? <Text accessibilityRole="alert" style={foreground}>This review couldn't be checked. Your saved work is kept. Refresh to try again.</Text> : null}
    {data ? <>
      <Text style={foreground}>Current owner: {data.currentOwner}</Text>
      <Text style={foreground}>Proposed help: a separate conversation dedicated to {data.title}. Only the captain's Attach button can create its helper, after the handover is complete.</Text>
      <Text style={muted}>Choose the actual model, permissions and opening in that separate Attach review. Attaching reserves one helper session and one opening turn. Continuing work still needs checked permission sources and its recorded cumulative limit.</Text>
      <Text style={foreground}>Worker budget stays at {data.budget.agents} sessions / {data.budget.turns} turns. Already spent: {data.spent.agents} sessions / {data.spent.turns} turns. Handover never resets spending or grants merge, deploy or cleanup permission.</Text>
      <Text style={muted}>Handover saves and verifies an independent backup, preserves the exact history, checks pending deliveries, then changes who looks after this plan. Uncertain work stays held.</Text>
      {data.problems.map(problem => <Text key={problem} style={foreground}>{problem}</Text>)}
    </> : null}
    {!migration ? <View style={{ gap: 8 }}>
      <Text accessibilityRole="header" style={foreground}>Keep a backup before handover</Text>
      <Text style={muted}>Choose an existing folder outside FirstMate's home and saved work. Say how long you will keep its files. FirstMate verifies these backups; it does not delete them or restore work automatically.</Text>
      <TextInput accessibilityLabel="Backup folder" placeholder="Full path to an existing backup folder" value={destination ?? backup.data?.backup?.destination ?? ""} onChangeText={setDestination} editable={!busy && !saved.current} style={fieldStyle} />
      <TextInput accessibilityLabel="Backup retention" placeholder="How long will you keep these backups?" value={retention ?? backup.data?.backup?.retention ?? ""} onChangeText={setRetention} editable={!busy && !saved.current} multiline style={fieldStyle} />
      {backup.data?.problems.map(p => <Text key={p} style={foreground}>{p}</Text>)}
      {saved.current ? <HelpButton theme={theme} label="Check saved backup settings" disabled={busy} onPress={() => { void backup.refetch().then(result => { if (result.data?.requestId === saved.current?.requestId) { saved.current = null; setError(null); void refresh(); } }); }} /> : null}
      {saved.current ? <HelpButton theme={theme} label="Review corrected backup settings" disabled={busy} onPress={() => { void backup.refetch().then(result => { if (result.data && !result.error) { saved.current = null; setError(null); setDestination(result.data.backup?.destination ?? destination); setRetention(result.data.backup?.retention ?? retention); } }); }} /> : null}
      <HelpButton theme={theme} label={saved.current ? "Retry this backup save" : "Save backup settings"} disabled={busy || !backup.data || !!backup.error || !(destination ?? backup.data.backup?.destination)?.trim() || !(retention ?? backup.data.backup?.retention)?.trim()} onPress={() => { void save(); }} />
      <HelpButton theme={theme} label={details ? "Hide handover evidence" : "Handover evidence"} onPress={() => setDetails(!details)} />
      {details ? <View style={{ gap: 8 }}>
        <Text style={muted}>Keep the references from the reviewed delivery inventory, compatible rollback build and accepted permission import. These references grant no new permission. Missing or changed sources must be reviewed first.</Text>
        <TextInput accessibilityLabel="Reviewed delivery inventory" value={inventory} onChangeText={setInventory} placeholder="Reviewed delivery inventory reference" editable={!busy && !pending.current} style={fieldStyle} />
        <TextInput accessibilityLabel="Compatible rollback build" value={rollbackBuild} onChangeText={setRollback} placeholder="Compatible rollback build" editable={!busy && !pending.current} style={fieldStyle} />
        <TextInput accessibilityLabel="Accepted permission import" value={policy} onChangeText={setPolicy} placeholder="Accepted permission import reference" editable={!busy && !pending.current} style={fieldStyle} />
        <Text selectable style={muted}>{data?.sourcePaths.join("\n")}</Text>
      </View> : null}
      <HelpButton theme={theme} label="Review handover" disabled={busy || held || !inventory.trim() || !rollbackBuild.trim() || !policy.trim()} onPress={() => { if (data?.projectId) choose({ op: "prepare", homeId, plan: planId, migrationId: data.migrationId, scopeId: data.scopeId, projectId: data.projectId, reviewHash: data.reviewHash,
        prerequisites: { inventory: inventory.trim(), rollbackBuild: rollbackBuild.trim(), policy: policy.trim() } }); }} />
      {data?.preparation ? <HelpButton theme={theme} label="Review saved handover" disabled={busy || held} onPress={() => choose({ ...data.preparation!, op: "resume" } as MigrationCommand)} /> : null}
    </View> : <View style={{ gap: 8 }}>
      <Text style={foreground}>{migration.state === "committed" ? "Handover is complete. The captain can now review Attach below." : migration.state === "aborted" ? "Handover was canceled. Its history and spending are retained." : "Handover is saved. Check pending deliveries before changing ownership."}</Text>
      {holds.map(h => <Text key={h.id} style={foreground}>Held for review: {h.reason} {h.source === "decision-submission" ? "This answer requires the original captain-authorized resolution; this app cannot clear it." : "Inspect the evidence in Advanced work details before continuing."}</Text>)}
      {migration.state === "prepared" || migration.state === "barrier" ? <>
        {activation?.resumeMigrations?.find(m => m.migrationId === migration.id) ? <HelpButton theme={theme} label="Review resuming saved handover" disabled={busy || !!activationError} onPress={() => choose({ ...activation.resumeMigrations!.find(m => m.migrationId === migration.id)!, homeId, op: "resume" })} /> : null}
        <HelpButton theme={theme} label="Check handover deliveries" disabled={busy || !!activationError} onPress={() => choose({ op: "reconcile", homeId, migrationId: migration.id })} />
        <HelpButton theme={theme} label={migration.state === "prepared" ? "Review handover checks" : "Review ownership change"} disabled={busy || !!activationError || holds.length > 0} onPress={() => choose({ op: migration.state === "prepared" ? "barrier" : "commit", homeId, migrationId: migration.id })} />
        <TextInput accessibilityLabel="Reason to cancel handover" value={reason} onChangeText={setReason} placeholder="Reason to cancel handover" editable={!busy && !pending.current} style={fieldStyle} />
        <HelpButton theme={theme} label="Review canceling handover" disabled={busy || !reason.trim()} onPress={() => choose({ op: "abort", homeId, migrationId: migration.id, reason: reason.trim() })} />
      </> : null}
      {migration.state === "committed" ? <SupervisionActivationBoard theme={theme} compact planId={planId} /> : null}
    </View>}
    {review ? <View style={{ gap: 8 }}>
      <Text accessibilityRole="header" style={foreground}>{review.op === "prepare" ? "Confirm handover preparation" : review.op === "commit" ? "Confirm ownership change" : review.op === "abort" ? "Confirm canceling handover" : "Confirm handover check"}</Text>
      <Text style={foreground}>{review.op === "prepare" ? "This pauses changes from this plan's previous owner and preserves its exact history for handover. It creates no helper and sends no opening. Attach is a separate captain action after all checks pass." : review.op === "commit" ? "Confirm who looks after this plan using the checked handover. This does not attach a helper or grant additional permission." : review.op === "abort" ? "Return this plan to its previous owner. Saved history and spending remain. No message is resent." : "Run the existing checked handover step. Unknown effects remain held."}</Text>
      <Text style={muted}>Paseo cannot verify who pressed this button. The action is recorded for review.</Text>
      <HelpButton theme={theme} label={uncertain ? "Retry this handover request" : "Confirm this handover step"} disabled={busy || !!activationError} onPress={() => { void run(); }} />
      {!pending.current ? <HelpButton theme={theme} label="Keep current owner" disabled={busy} onPress={() => setReview(null)} /> : null}
    </View> : null}
    {error ? <Text accessibilityRole="alert" style={foreground}>{error}</Text> : null}
    <HelpButton theme={theme} label="Refresh plan help" disabled={busy} onPress={() => { void refresh(); }} />
    <Text style={muted}>Advanced work details in FirstMate settings retains original preparation JSON, saved identities, audits and specialist recovery controls.</Text>
    <HelpButton theme={theme} label="Back to plan" disabled={busy} onPress={onClose} />
  </ScrollView>;
}
