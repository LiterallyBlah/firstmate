import type { PluginTheme } from "@getpaseo/plugin";
import { useRpc } from "@getpaseo/plugin/client";
import { Modal, TextInput } from "@getpaseo/plugin/client/react-native";
import { useRef, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { ActivationSnapshotSchema, MigrationCommandSchema, migrateSupervisionPlan, type ActivationSnapshot, type MigrationCommand } from "../shared/supervision-activation";
import { errorText } from "./format";

function Control({ theme, label, disabled = false, onPress }: { theme: PluginTheme; label: string; disabled?: boolean; onPress(): void }) {
  return <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled }} disabled={disabled} onPress={onPress}
    style={{ minHeight: 44, maxWidth: "100%", minWidth: 0, flexShrink: 1, paddingVertical: 10, paddingHorizontal: 12, borderWidth: 1, borderColor: theme.colors.border, borderRadius: 7, opacity: disabled ? 0.5 : 1 }}>
    <Text style={{ color: theme.colors.foreground, flexShrink: 1 }}>{label}</Text>
  </Pressable>;
}
/** Extends the existing migration RPC. Viewing, inspecting and reviewing send nothing. */
export function MigrationOperations({ theme, data, unavailable = false, onRead }: { theme: PluginTheme; data: ActivationSnapshot; unavailable?: boolean;
  onRead(snapshot: ActivationSnapshot): void }) {
  const migrate = useRpc(migrateSupervisionPlan), [expanded, expand] = useState(false), [selected, select] = useState<string | null>(null);
  const [original, setOriginal] = useState(""), [pending, setPending] = useState<MigrationCommand | null>(null), [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false), [uncertain, setUncertain] = useState(false), [error, setError] = useState<string | null>(null), gate = useRef(false);
  const current = data.migrations.find(m => m.id === selected);
  function review(command: MigrationCommand) { setError(null); setUncertain(false); setReason(""); setPending(command); }
  function reviewOriginal() {
    try {
      const raw = JSON.parse(original);
      if (raw.homeId !== undefined && raw.homeId !== data.homeId) throw new Error("The preparation names another home. Refresh its original input.");
      const command = MigrationCommandSchema.parse({ ...raw, homeId: data.homeId });
      if (command.op !== "prepare" && command.op !== "resume") throw new Error("Use the original prepare or resume command here.");
      review(command);
    } catch (e) { setError(errorText(e)); }
  }
  async function run() {
    if (!pending || gate.current || unavailable || pending.homeId !== data.homeId || pending.op === "abort" && !uncertain && !reason.trim()) return;
    gate.current = true; setBusy(true); setError(null);
    const command = pending.op === "abort" && !uncertain ? { ...pending, reason: reason.trim() } : pending;
    setPending(command);
    try { onRead(ActivationSnapshotSchema.parse(await migrate(command))); setPending(null); setUncertain(false); }
    catch (e) { setUncertain(true); setError(`${errorText(e)} Inspect the refreshed migration audit. Retry retains this exact command; unknown effects are never repeated.`); }
    finally { gate.current = false; setBusy(false); }
  }
  return <View testID="migration-operations" style={{ gap: 12 }}>
    <Control theme={theme} label={expanded ? "Hide migration controls" : "Migration controls"} onPress={() => expand(!expanded)} />
    {expanded ? <View style={{ gap: 12 }}>
      <Text style={{ color: theme.colors.foregroundMuted }}>Inspect retained deliveries, resume the original migration, or release a prepared cutover back to its legacy owner. Each change is reviewed before it runs.</Text>
      {!data.migrations.length ? <Text style={{ color: theme.colors.foregroundMuted }}>No migrations are recorded for this home.</Text> : null}
      {data.migrations.map(m => <View key={m.id} style={{ gap: 8 }}>
        <Control theme={theme} label={`Inspect ${m.planId} migration · ${m.state}`} onPress={() => select(selected === m.id ? null : m.id)} />
        {selected === m.id ? <View style={{ gap: 8 }}>
          <Text selectable style={{ color: theme.colors.foregroundMuted }}>Migration {m.id}</Text>
          <Text style={{ color: theme.colors.foreground }}>Original attempts: {m.imported.attempts.length} · retained budget: {m.imported.budget.agents} sessions / {m.imported.budget.turns} turns</Text>
          <Text selectable style={{ color: theme.colors.foregroundMuted }}>{m.prerequisites.snapshot ? `Verified independent snapshot: ${m.prerequisites.snapshot.path}\nRetention: ${m.prerequisites.snapshot.retention}` : "Independent snapshot evidence is absent. Continuation may be held."}</Text>
          {data.dispositions.filter(d => d.migrationId === m.id).map(d => <View key={d.id} style={{ gap: 4 }}>
            <Text style={{ color: theme.colors.foreground }}>{d.source} · {d.route} · {d.removal.state}</Text>
            <Text selectable style={{ color: theme.colors.foregroundMuted }}>{d.reason}</Text>
          </View>)}
          {m.state === "prepared" || m.state === "barrier" ? <>
            {data.resumeMigrations?.find(r => r.migrationId === m.id) ? <Control theme={theme} label={`Resume ${m.planId} migration`} disabled={unavailable} onPress={() => review({ ...data.resumeMigrations!.find(r => r.migrationId === m.id)!, homeId: data.homeId, op: "resume" })} /> : null}
            <Control theme={theme} label={`Reconcile ${m.planId} deliveries`} disabled={unavailable} onPress={() => review({ homeId: data.homeId, migrationId: m.id, op: "reconcile" })} />
            <Control theme={theme} label={m.state === "prepared" ? `Check ${m.planId} migration barrier` : `Commit ${m.planId} scoped ownership`} disabled={unavailable} onPress={() => review({ homeId: data.homeId, migrationId: m.id, op: m.state === "prepared" ? "barrier" : "commit" })} />
            <Control theme={theme} label={`Abort ${m.planId} migration`} disabled={unavailable} onPress={() => review({ homeId: data.homeId, migrationId: m.id, op: "abort", reason: "" })} />
          </> : null}
        </View> : null}
      </View>)}
      <Text style={{ color: theme.colors.foreground }}>Start or recover from an original preparation</Text>
      <Text style={{ color: theme.colors.foregroundMuted }}>Paste the reviewed prepare or resume command with its plan, scope, project and named inventory, rollback build and policy evidence. This also recovers a freeze whose receipt was interrupted.</Text>
      <TextInput accessibilityLabel="Original migration preparation" value={original} onChangeText={setOriginal} multiline editable={!busy && !uncertain}
        style={{ minHeight: 120, color: theme.colors.foreground, backgroundColor: theme.colors.surface1, borderWidth: 1, borderColor: theme.colors.border, borderRadius: 7, padding: 12 }} />
      <Control theme={theme} label="Review migration command" disabled={unavailable || !original.trim() || busy || uncertain} onPress={reviewOriginal} />
      {error && !pending ? <Text accessibilityRole="alert" style={{ color: theme.colors.foreground }}>{error}</Text> : null}
    </View> : null}
    {pending ? <Modal title={`Review migration ${pending.op}`} open onOpenChange={open => { if (!open && !busy && !uncertain) setPending(null); }}>
      <Modal.Content><ScrollView contentContainerStyle={{ gap: 16 }}>
        <Text selectable style={{ color: theme.colors.foreground }}>Operation: {pending.op}{"plan" in pending ? `\nPlan: ${pending.plan}` : current ? `\nPlan: ${current.planId}` : ""}{"\n"}Migration: {pending.migrationId}</Text>
        <Text style={{ color: theme.colors.foregroundMuted }}>This app request is unverified. An independent snapshot cannot restore external effects or reset spend. Decision-answer holds stay held without a valid authorized resolution.</Text>
        {pending.op === "abort" ? <TextInput accessibilityLabel="Reason for aborting migration" value={uncertain ? pending.reason : reason} onChangeText={setReason} editable={!busy && !uncertain} multiline
          style={{ minHeight: 80, color: theme.colors.foreground, backgroundColor: theme.colors.surface1, borderWidth: 1, borderColor: theme.colors.border, borderRadius: 7, padding: 12 }} /> : null}
        {error ? <Text accessibilityRole="alert" style={{ color: theme.colors.foreground }}>{error}</Text> : null}
        <Control theme={theme} label={busy ? "Recording migration change…" : uncertain ? "Retry this migration command" : `Run migration ${pending.op}`}
          disabled={busy || unavailable || pending.homeId !== data.homeId || pending.op === "abort" && !uncertain && !reason.trim()} onPress={() => { void run(); }} />
        <Control theme={theme} label={uncertain ? "Close and inspect retained audit" : "Cancel migration change"} disabled={busy} onPress={() => { setPending(null); setUncertain(false); }} />
      </ScrollView></Modal.Content>
    </Modal> : null}
  </View>;
}
