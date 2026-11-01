import type { PluginTheme } from "@getpaseo/plugin";
import { useRpc } from "@getpaseo/plugin/client";
import { Modal } from "@getpaseo/plugin/client/react-native";
import { useQuery } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { actWatchSupervisor, readWatchSupervisors, WatchSupervisorSnapshotSchema, type WatchAssignmentTarget, type WatchSupervisorSnapshot } from "../shared/watch-routing";
import { workflowRequestId } from "./workflow-plans";
import { errorText } from "./format";
import type { z } from "zod";
function Action({ theme, label, disabled = false, onPress }: { theme: PluginTheme; label: string; disabled?: boolean; onPress(): void }) {
  return <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled }} disabled={disabled} onPress={onPress}
    style={{ minHeight: 44, minWidth: 0, maxWidth: "100%", padding: 10, borderWidth: 1, borderColor: theme.colors.border, borderRadius: 8, opacity: disabled ? 0.5 : 1 }}>
    <Text style={{ color: theme.colors.foreground, flexShrink: 1 }}>{label}</Text></Pressable>;
}
/** Same captured-target review from Home, Plans and the exact watch. Opening is read-only. */
export function WatchSupervisorButton({ theme, name, planId }: { theme: PluginTheme; name?: string; planId?: string }) {
  const [open, show] = useState(false);
  return <><Action theme={theme} label={name ? `Supervisor for ${name}` : "Assign watch inputs"} onPress={() => show(true)} />
    {open ? <WatchSupervisorDialog key={`${name ?? "all"}:${planId ?? "all"}`} theme={theme} name={name} planId={planId} onClose={() => show(false)} /> : null}</>;
}
function WatchSupervisorDialog({ theme, name, planId, onClose }: { theme: PluginTheme; name: string | undefined; planId: string | undefined; onClose(): void }) {
  const read = useRpc(readWatchSupervisors), act = useRpc(actWatchSupervisor), gate = useRef(false), pending = useRef<Parameters<typeof act>[0] | null>(null);
  const [error, fail] = useState<string | null>(null), [busy, setBusy] = useState(false);
  const query = useQuery({ queryKey: ["firstmate", "watch-supervisors"], queryFn: async () => WatchSupervisorSnapshotSchema.parse(await read({})), retry: false });
  async function send(input: Parameters<typeof act>[0]) {
    if (gate.current) return; gate.current = true; setBusy(true); fail(null); pending.current ??= input;
    try { await act(pending.current); pending.current = null; await query.refetch(); }
    catch (e) { fail(`${errorText(e)} The exact request is retained. Check status before retrying.`); }
    finally { gate.current = false; setBusy(false); }
  }
  return <Modal title="Watch Supervisor assignment" open onOpenChange={open => { if (!open && !busy) onClose(); }}><Modal.Content>
    {query.data ? <WatchAssignmentReview key={query.data.homeId} theme={theme} data={query.data} name={name} planId={planId} disabled={busy || !!pending.current || query.isError} onAction={send} /> :
      <Text style={{ color: theme.colors.foreground }}>{query.isError ? "Assignments unavailable. Reconnect and check status." : "Reading saved watch assignments…"}</Text>}
    {error ? <Text accessibilityRole="alert" style={{ color: theme.colors.foreground }}>{error}</Text> : null}
    {pending.current ? <Action theme={theme} label="Retry exact assignment request" disabled={busy} onPress={() => { void send(pending.current!); }} /> : null}
    <Action theme={theme} label="Check assignment status" disabled={busy} onPress={() => { void query.refetch(); }} />
    <Action theme={theme} label="Close assignment" disabled={busy} onPress={onClose} />
  </Modal.Content></Modal>;
}
export function WatchAssignmentReview({ theme, data, name, planId, disabled = false, onAction }: { theme: PluginTheme; data: WatchSupervisorSnapshot;
  name?: string | undefined; planId?: string | undefined; disabled?: boolean; onAction(input: z.input<typeof actWatchSupervisor.input>): unknown }) {
  const [selected, select] = useState<WatchAssignmentTarget | null>(null);
  const text = { color: theme.colors.foreground, lineHeight: 21, fontSize: 14 }, note = { ...text, color: theme.colors.foregroundMuted };
  const blocked = disabled || !!data.problems.length;
  const selectedAssignment = data.watches.find(w => w.name === selected?.name)?.assignment;
  return <View testID="watch-assignment-review" style={{ gap: 14, minWidth: 0, maxWidth: "100%" }}>
    <Text style={{ ...text, fontWeight: "600", fontSize: 18 }}>Exact watch inputs</Text>
    <Text style={note}>A typed watch fact goes directly to one plan owner. This adds no session, grant or worker budget. Opaque prompts need an explicit attribution review.</Text>
    {data.problems.map(p => <Text key={p} accessibilityRole="alert" style={text}>{p}</Text>)}
    {data.watches.filter(w => (!name || w.name === name) && (!planId || !w.assignment || w.assignment.target.planId === planId)).map(w => {
      const row = w.assignment, owner = data.owners.find(o => o.scopeId === row?.target.scopeId);
      return <View key={w.name} style={{ gap: 8, minWidth: 0, paddingVertical: 8, borderBottomWidth: 1, borderColor: theme.colors.border }}>
        <Text style={{ ...text, fontWeight: "600" }}>{w.name} · {row?.stage ?? "Existing route"}</Text>
        <Text selectable style={note}>Definition: {w.definitionDigest}</Text>
        {w.problem ? <Text accessibilityRole="alert" style={text}>{w.problem}</Text> : null}
        {row ? <><Text selectable style={text}>Plan {row.target.planId} · local · attempt {row.target.attemptId}</Text>
          <Text selectable style={note}>Captured owner {row.target.owner.agentId} · epoch {row.target.owner.epoch} · plan revision {row.target.planRevision}</Text>
          <Text style={note}>{owner?.profile ?? "Retained owner profile unavailable"}. Remaining: {owner?.remainingSessions ?? "unknown"} sessions, {owner?.remainingTurns ?? "unknown"} turns.</Text>
          <Text style={note}>Original delivery inventory: {row.pending.length}. Pending and uncertain deliveries retain their original route and identity.</Text>
          {row.stage === "prepared" ? <>
            <Action theme={theme} label={`Commit exact route for ${w.name}`} disabled={blocked || !!w.problem || row.target.definitionDigest !== w.definitionDigest} onPress={() => { void onAction({ op: "commit", requestId: workflowRequestId(), homeId: data.homeId, name: w.name, assignmentRequestId: row.requestId, assignmentDigest: w.assignmentDigest! }); }} />
            <Action theme={theme} label={`Abort prepared route for ${w.name}`} disabled={blocked} onPress={() => { void onAction({ op: "abort", requestId: workflowRequestId(), homeId: data.homeId, name: w.name, assignmentRequestId: row.requestId, assignmentDigest: w.assignmentDigest! }); }} />
          </> : row.stage === "committed" ? <Action theme={theme} label={`Unassign future watch inputs for ${w.name}`} disabled={blocked} onPress={() => { void onAction({ op: "unassign", requestId: workflowRequestId(), homeId: data.homeId, name: w.name, assignmentRequestId: row.requestId, assignmentDigest: w.assignmentDigest! }); }} /> :
            row.stage === "paused" ? <><Text style={note}>Future inputs are unassigned and paused. Pending inputs, owner identity, history and spending remain retained. There is no fallback to General.</Text>
              <Action theme={theme} label={`Resume exact watch assignment for ${w.name}`} disabled={blocked || !!w.problem} onPress={() => { void onAction({ op: "resume", requestId: workflowRequestId(), homeId: data.homeId, name: w.name, assignmentRequestId: row.requestId, assignmentDigest: w.assignmentDigest! }); }} /></> : null}
        </> : null}
        {!row || row.stage === "aborted" ? data.targets.filter(t => t.name === w.name && (!planId || t.planId === planId)).map(t => <Action key={`${t.scopeId}:${t.taskId}`} theme={theme}
          label={`Review ${w.name} to ${t.planId} · ${t.taskId}`} disabled={blocked} onPress={() => select(t)} />) : null}
      </View>;
    })}
    {selected && (!selectedAssignment || selectedAssignment.stage === "aborted") ? <View style={{ gap: 8 }}><Text selectable style={text}>Review {selected.name} → {selected.planId}. Home {selected.homeId} · local · scope {selected.scopeId} · task {selected.taskId} · attempt {selected.attemptId}.</Text>
      <Text style={note}>{data.owners.find(o => o.scopeId === selected.scopeId)?.profile}. Remaining: {data.owners.find(o => o.scopeId === selected.scopeId)?.remainingSessions ?? "unknown"} sessions, {data.owners.find(o => o.scopeId === selected.scopeId)?.remainingTurns ?? "unknown"} turns. One executing scope per session. New assignment holds admission until old deliveries drain; it never attaches an owner.</Text>
      <Action theme={theme} label="Prepare reviewed watch assignment" disabled={blocked || !data.targets.some(t => JSON.stringify(t) === JSON.stringify(selected))}
        onPress={() => { void onAction({ op: "prepare", requestId: workflowRequestId(), expectedGeneration: data.watches.find(w => w.name === selected.name)?.assignment?.generation ?? 0, target: selected }); }} />
    </View> : null}
    <Text accessibilityRole="alert" style={note}>{data.observer.reason}</Text>
    <Action theme={theme} label="Enable independent read-only observer unavailable" disabled onPress={() => {}} />
  </View>;
}
