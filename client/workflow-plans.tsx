import type { PluginTheme } from "@getpaseo/plugin";
import { useRpc } from "@getpaseo/plugin/client";
import { Modal, TextInput } from "@getpaseo/plugin/client/react-native";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createContext, useContext, useRef, useState, type ReactNode } from "react";
import { Pressable, Text, View } from "react-native";
import { actOnWorkflowPlan, readWorkflowPlans, WorkflowSnapshotSchema, type WorkflowSnapshot, type PlanNeed } from "../shared/workflow-rpc";
import { planFinished, planWorstCase, type PlanCaptainCommand, type WorkflowPlan } from "../shared/workflow-plans";
import { migrationTargets, type FleetCard } from "../shared/fleet";
import { readRemotes } from "../shared/remotes";
import { OptionPicker } from "./option-picker";
import type { NeedsYouSnapshot } from "../shared/needs-you";
import { FLEET_QUERY_KEY } from "./fleet-query";
import { NEEDS_YOU_QUERY_KEY } from "./needs-you-query";
import { errorText } from "./format";
import { workflowOwnsCard } from "../shared/workflow-identity";

export const WORKFLOW_QUERY_KEY = ["firstmate", "workflow-plans"] as const;
const Plans = createContext<{ snapshot?: WorkflowSnapshot; loading: boolean; error: string | null; refresh(): void; open(id: string): void }>({ loading: true, error: null, refresh() {}, open() {} });
export function useWorkflowPlans() { return useContext(Plans); }
function Button({ theme, label, onPress, disabled = false, quiet = false }: { theme: PluginTheme; label: string; onPress(): void; disabled?: boolean; quiet?: boolean }) {
  return <Pressable accessibilityRole="button" accessibilityLabel={label} disabled={disabled} accessibilityState={{ disabled }} onPress={onPress}
    style={{ minHeight: 44, justifyContent: "center", padding: 10, borderRadius: 7, borderWidth: 1, borderColor: quiet ? "transparent" : theme.colors.border, backgroundColor: quiet ? theme.colors.surface0 : theme.colors.surface1, opacity: disabled ? 0.5 : 1 }}>
    <Text style={{ color: quiet ? theme.colors.foregroundMuted : theme.colors.foreground, fontSize: 13 }}>{label}</Text>
  </Pressable>;
}
export function WorkflowSurface({ theme, children }: { theme: PluginTheme; children: ReactNode }) {
  const read = useRpc(readWorkflowPlans), act = useRpc(actOnWorkflowPlan), cache = useQueryClient();
  const catalog = useRpc(migrationTargets), readHosts = useRpc(readRemotes);
  const query = useQuery({ queryKey: WORKFLOW_QUERY_KEY, queryFn: async () => WorkflowSnapshotSchema.parse(await read({})), refetchInterval: 5000 });
  const [selected, setSelected] = useState<{ id: string; hash: string } | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null);
  const gate = useRef(false), pending = useRef<{ id: string; serialized: string } | null>(null);
  const snapshot = query.data, plan = snapshot?.plans.find(p => p.definition.id === selected?.id);
  const models = useQuery({ queryKey: ["firstmate", "plan-models"], queryFn: () => catalog({}), enabled: selected !== null });
  const hosts = useQuery({ queryKey: ["firstmate", "plan-hosts"], queryFn: () => readHosts({}), enabled: selected !== null });
  const open = (id: string) => { if (!snapshot?.subjects[id]) return; pending.current = null; setError(null); setSelected({ id, hash: snapshot.subjects[id]! }); };
  async function submit(command: PlanCaptainCommand) {
    if (!snapshot || gate.current) return; gate.current = true; setBusy(true); setError(null);
    const serialized = JSON.stringify(command);
    // An uncertain request keeps its id and exact body until its result can be reconciled.
    if (!pending.current || pending.current.serialized !== serialized) pending.current = { id: globalThis.crypto?.randomUUID?.() ?? "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, c => { const n = Math.floor(Math.random() * 16); return (c === "x" ? n : (n & 3) | 8).toString(16); }), serialized };
    try {
      const next = await act({ homeId: snapshot.homeId, requestId: pending.current.id, command });
      cache.setQueryData(WORKFLOW_QUERY_KEY, next); pending.current = null; setSelected(null);
      void cache.invalidateQueries({ queryKey: FLEET_QUERY_KEY }); void cache.invalidateQueries({ queryKey: NEEDS_YOU_QUERY_KEY });
    } catch (e) { setError(errorText(e)); void query.refetch(); }
    finally { gate.current = false; setBusy(false); }
  }
  return <Plans.Provider value={{ ...(snapshot ? { snapshot } : {}), loading: query.isPending, error: query.error ? errorText(query.error) : null, refresh: () => { void query.refetch(); }, open }}>
    {children}
    <Modal title={plan?.definition.title ?? "Plan"} open={selected !== null} onOpenChange={value => { if (!value && !busy) setSelected(null); }}>
      <Modal.Content>
        {snapshot && plan && selected ? <PlanDialog key={selected.hash} theme={theme} plan={plan} subjectHash={selected.hash} homeId={snapshot.homeId}
          stale={!!query.error || snapshot.subjects[selected.id] !== selected.hash} onRefresh={() => open(selected.id)} busy={busy} error={error} onAct={submit}
          models={models.data?.targets ?? []} hosts={hosts.data?.hosts ?? []} /> :
          <Text style={{ color: theme.colors.foregroundMuted }}>This plan could not be refreshed. No action has been recorded.</Text>}
      </Modal.Content>
    </Modal>
  </Plans.Provider>;
}

export function PlanDialog({ theme, plan, subjectHash, stale, busy, error, onAct, onRefresh, models = [], hosts = [] }: {
  theme: PluginTheme; plan: WorkflowPlan; subjectHash: string; homeId: string; stale: boolean; busy: boolean; error: string | null;
  onAct(command: PlanCaptainCommand): Promise<void>; onRefresh(): void;
  models?: readonly { provider: string; label: string; modes: readonly { id: string; label: string }[]; thinking: readonly { id: string; label: string }[] }[];
  hosts?: readonly { serverId: string; label: string }[];
}) {
  const [mode, setMode] = useState<"changes" | "edit" | null>(null), [text, setText] = useState("");
  const [edits, setEdits] = useState<NonNullable<PlanCaptainCommand["edits"]>>([]);
  const colors = theme.colors, worst = planWorstCase(plan.definition, plan.nodes), disabled = busy || stale;
  const missingMode = edits.some(e => e.kind === "model" && !models.find(m => m.provider === e.agent.provider)?.modes.some(m => m.id === e.agent.modeId));
  const send = (action: PlanCaptainCommand["action"], extra: Partial<PlanCaptainCommand> = {}) => onAct({ op: "captain", plan: plan.definition.id, revision: plan.revision, subjectHash, action, text, ...extra });
  return <View testID="workflow-plan-dialog" style={{ gap: 16 }}>
    <Text style={{ color: colors.foregroundMuted }}>Revision {plan.revision} · {planFinished(plan) ? "Completed" : plan.status === "review" ? "Awaiting approval" : plan.status === "active" ? (plan.posture === "sail" ? "Sailing" : "Approved") : plan.status === "held" ? "On hold" : "Declined"}</Text>
    <Text selectable style={{ color: colors.foreground }}>{plan.definition.request.text}</Text>
    <Text style={{ color: colors.foregroundMuted }}>{new Date(plan.definition.request.at).toLocaleString()} · Worst case: {worst.agents} workers, {worst.turns} worker turns</Text>
    <Text style={{ color: colors.foregroundMuted }}>Approval permits this work. Merge and deployment still need their own approval.</Text>
    {plan.postureSource ? <Text style={{ color: colors.foregroundMuted }}>Posture from {plan.postureSource.source}: {plan.postureSource.detail}{plan.postureSource.warning ? ` ${plan.postureSource.warning}` : ""}</Text> : null}
    {stale ? <View style={{ gap: 6 }}><Text accessibilityRole="alert" style={{ color: colors.statusWarning }}>This plan changed or could not be refreshed. Review the latest version before acting.</Text><Button theme={theme} label="Review latest plan" disabled={busy} onPress={onRefresh} /></View> : null}
    {plan.definition.nodes.map(node => <View key={node.id} style={{ gap: 6, padding: 12, borderWidth: 1, borderColor: colors.border, borderRadius: 8 }}>
      <Text accessibilityRole="header" style={{ color: colors.foreground, fontWeight: "600" }}>{node.title} · {plan.nodes[node.id]?.answer ? "Answered" : plan.nodes[node.id]?.held ? "Held" : plan.nodes[node.id]?.state === "planned" ? "Queued" : plan.nodes[node.id]?.state}</Text>
      <Text style={{ color: colors.foreground }}>{node.summary}</Text>
      {node.after.length ? <Text style={{ color: colors.foregroundMuted }}>After {node.after.map(d => `${plan.definition.nodes.find(n => n.id === d.node)?.title ?? d.node} (${d.reason === "needs-evidence" ? "needs its evidence" : d.reason === "decision" ? "needs your answer" : d.reason === "shared-state" ? "shares mutable state" : "needs its code"}${d.on === "landed" ? ", after landing" : ""})`).join(", ")}</Text> : null}
      {node.kind === "run" ? <Text style={{ color: colors.foregroundMuted }}>{node.workflow === "scout@1" ? "Investigation" : "Task"} · {node.launch.agent.provider} · {node.launch.agent.thinkingOptionId ?? "default thinking"} · {node.launch.host === "local" ? "This machine" : node.launch.host} · one worker turn</Text> : <>
        <Text style={{ color: colors.foregroundMuted }}>Recommended: {node.options.find(o => o.id === node.recommendation)?.label ?? "none yet"}. {node.rationale}</Text>
        {node.options.map(option => <View key={option.id} style={{ gap: 3 }}><Text style={{ color: colors.foregroundMuted }}>{option.consequence}</Text>
          <Button theme={theme} label={plan.nodes[node.id]?.answer === option.id ? `Chosen: ${option.label}` : option.label} disabled={disabled || !!plan.nodes[node.id]?.answer || !!plan.nodes[node.id]?.held || plan.status === "abandoned"} onPress={() => void send("answer", { node: node.id, option: option.id })} />
        </View>)}
      </>}
      {plan.nodes[node.id]?.evidence ? <Text selectable style={{ color: colors.foregroundMuted }}>{plan.nodes[node.id]!.evidence}</Text> : null}
    </View>)}
    <Text accessibilityRole="header" style={{ color: colors.foreground, fontWeight: "600" }}>Revision history</Text>
    {plan.history.map((h, i) => <Text key={`${h.revision}:${i}`} style={{ color: colors.foregroundMuted }}>{h.revision} · {h.by === "board:captain" ? "You" : "First mate"} · {h.reason}</Text>)}
    {plan.captainEvents?.length ? <>
      <Text accessibilityRole="header" style={{ color: colors.foreground, fontWeight: "600" }}>Plan actions</Text>
      {plan.captainEvents.map(a => <Text key={a.id} selectable style={{ color: colors.foregroundMuted }}>{new Date(a.at).toLocaleString()} · {a.by === "board:captain" ? "Captain pressed" : "Recorded by the first mate from chat"}: {({ approve: "Approved", edit: "Approved with edits", changes: "Changes requested", hold: "Held", decline: "Declined", answer: "Decision answered" } as Record<string, string>)[a.action] ?? "Updated"}{a.text ? ` · ${a.text}` : ""}</Text>)}
    </> : null}
    {plan.status !== "abandoned" && !planFinished(plan) ? <>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
        <Button theme={theme} label="Approve" disabled={disabled} onPress={() => void send("approve")} />
        <Button theme={theme} label="Approve with edits" disabled={disabled} onPress={() => setMode("edit")} />
        <Button theme={theme} label="Ask for changes" disabled={disabled} onPress={() => setMode("changes")} />
        <Button theme={theme} label="Hold" disabled={disabled} onPress={() => void send("hold")} />
        <Button theme={theme} label="Decline" disabled={disabled || plan.definition.nodes.some(n => n.kind === "run" && plan.nodes[n.id]?.state !== "planned")} onPress={() => void send("decline")} />
      </View>
      {mode ? <View style={{ gap: 8 }}>
        <TextInput accessibilityLabel="Requested plan changes" placeholder="Describe the changes" value={text} onChangeText={setText} multiline style={{ minHeight: 80 }} />
        {mode === "edit" ? <>
          <Text style={{ color: colors.foregroundMuted }}>Edits apply to unstarted work. Scope or acceptance changes go to the first mate.</Text>
          <OptionPicker theme={theme} compact label="Plan posture" title="Plan posture" value={edits.find(e => e.kind === "posture")?.kind === "posture" ? (edits.find(e => e.kind === "posture") as { posture: string }).posture : plan.posture} disabled={disabled}
            options={[{ value: "sail", label: "Sail within approved work" }, { value: "review", label: "Review before starting" }]} onSelect={posture => setEdits(old => [...old.filter(e => e.kind !== "posture"), { kind: "posture", posture: posture as "review" | "sail" }])} />
          {plan.definition.nodes.filter(n => plan.nodes[n.id]?.state === "planned").map(node => {
            const currentModel = edits.find(e => e.kind === "model" && e.node === node.id), agent = currentModel?.kind === "model" ? currentModel.agent : node.kind === "run" ? node.launch.agent : null;
            const target = models.find(m => m.provider === agent?.provider);
            const replace = (edit: NonNullable<PlanCaptainCommand["edits"]>[number]) => setEdits(old => [...old.filter(e => !(e.kind === edit.kind && "node" in e && e.node === node.id)), edit]);
            const depEdit = edits.find(e => e.kind === "dependencies" && e.node === node.id), after = depEdit?.kind === "dependencies" ? depEdit.after : node.after;
            return <View key={node.id} style={{ gap: 8, padding: 8, borderWidth: 1, borderColor: colors.border }}>
              <Text style={{ color: colors.foreground }}>{node.title}</Text>
              {agent ? <>
                <OptionPicker theme={theme} compact label="Model" title={`Model for ${node.title}`} value={agent.provider} disabled={disabled || !models.length}
                  options={models.map(m => ({ value: m.provider, label: m.label }))} onSelect={value => { const m = models.find(m => m.provider === value)!; replace({ kind: "model", node: node.id, agent: { provider: value, modeId: m.modes.some(mode => mode.id === agent.modeId) ? agent.modeId : "" } }); }} />
                <OptionPicker theme={theme} compact label="Access mode" title={`Access mode for ${node.title}`} value={agent.modeId} disabled={disabled || !target}
                  options={target?.modes.map(m => ({ value: m.id, label: m.label })) ?? []} onSelect={value => replace({ kind: "model", node: node.id, agent: { ...agent, modeId: value } })} />
                <OptionPicker theme={theme} compact label="Thinking" title={`Thinking for ${node.title}`} value={agent.thinkingOptionId ?? ""} disabled={disabled || !target}
                  options={[{ value: "", label: "Default" }, ...(target?.thinking.map(m => ({ value: m.id, label: m.label })) ?? [])]} onSelect={value => { const { thinkingOptionId: _old, ...base } = agent; replace({ kind: "model", node: node.id, agent: { ...base, ...(value ? { thinkingOptionId: value } : {}) } }); }} />
                <OptionPicker theme={theme} compact label="Machine" title={`Machine for ${node.title}`} value={node.kind === "run" ? node.launch.host : "local"} disabled={disabled}
                  options={[{ value: "local", label: "This machine" }, ...hosts.map(h => ({ value: h.serverId, label: h.label }))]} onSelect={host => replace({ kind: "host", node: node.id, host })} />
              </> : null}
              <Text style={{ color: colors.foregroundMuted }}>Wait for</Text>
              {plan.definition.nodes.filter(n => n.id !== node.id).map(other => <Button key={other.id} theme={theme} label={`${after.some(d => d.node === other.id) ? "Remove dependency on" : "Wait for"} ${other.title}`} disabled={disabled} onPress={() => replace({ kind: "dependencies", node: node.id,
                after: after.some(d => d.node === other.id) ? after.filter(d => d.node !== other.id) : [...after, { node: other.id, reason: other.kind === "decision" ? "decision" : "builds-on", on: other.kind === "decision" ? "answered" : "done" }] })} />)}
              {after.filter(d => plan.definition.nodes.find(n => n.id === d.node)?.kind !== "decision").map(edge => <OptionPicker key={edge.node} theme={theme} compact label={`Why wait for ${plan.definition.nodes.find(n => n.id === edge.node)?.title ?? edge.node}?`} title="Dependency reason" value={edge.reason} disabled={disabled}
                options={[{ value: "builds-on", label: "Needs its code" }, { value: "needs-evidence", label: "Needs its evidence" }, { value: "shared-state", label: "Shares mutable state" }]} onSelect={reason => replace({ kind: "dependencies", node: node.id, after: after.map(d => d.node === edge.node ? { ...d, reason: reason as typeof d.reason } : d) })} />)}
              <Button theme={theme} label={`Remove ${node.title}`} disabled={disabled} onPress={() => replace({ kind: "remove", node: node.id })} />
              {plan.definition.nodes.some(n => n.after.some(d => d.node === node.id)) ? <Text style={{ color: colors.foregroundMuted }}>Removing this run holds its dependents until their dependencies are reviewed.</Text> : null}
              {plan.nodes[node.id]?.held ? <Button theme={theme} label={`Approve dependencies and release ${node.title}`} disabled={disabled} onPress={() => replace({ kind: "dependencies", node: node.id, after })} /> : null}
            </View>;
          })}
          <Text style={{ color: colors.foregroundMuted }}>{edits.length} edits selected. Required dependencies and started work are checked again before approval.</Text>
          {missingMode ? <Text accessibilityRole="alert" style={{ color: colors.statusWarning }}>Choose an access mode for the selected model before approving.</Text> : null}
        </> : null}
        <Button theme={theme} label={mode === "edit" ? "Apply edits and approve" : "Send changes to first mate"} disabled={disabled || (mode === "changes" ? !text.trim() : !edits.length || missingMode)}
          onPress={() => { if (mode === "edit") void send("edit", { edits }); else void send("changes"); }} />
      </View> : null}
    </> : null}
    {error ? <Text accessibilityRole="alert" style={{ color: colors.statusDanger }}>{error}</Text> : null}
  </View>;
}

export function PlanChip({ card, theme }: { card: FleetCard; theme: PluginTheme }) {
  const { snapshot, open } = useWorkflowPlans(), plan = snapshot?.plans.find(p => (!p.definition.implicit || p.status === "review") && workflowOwnsCard(p, card));
  if (!plan) return null;
  const done = Object.values(plan.nodes).filter(n => n.state === "done" || n.state === "landed").length;
  return <Button theme={theme} label={`${plan.definition.title} · ${done} of ${plan.definition.nodes.length}${plan.status === "review" && !planFinished(plan) ? " · awaiting approval" : ""}`} onPress={() => open(plan.definition.id)} />;
}
export function PlansControl({ theme, selected, onSelect }: { theme: PluginTheme; selected: string | null; onSelect(id: string | null): void }) {
  const { snapshot, open } = useWorkflowPlans(), [shown, setShown] = useState(false);
  const plans = snapshot?.plans.filter(p => !p.definition.implicit || p.status === "review") ?? [];
  if (!plans.length) return null;
  return <><Button theme={theme} label={selected ? `Plans: ${plans.find(p => p.definition.id === selected)?.definition.title ?? "selected"}` : "Plans"} onPress={() => setShown(true)} />
    <Modal title="Plans" open={shown} onOpenChange={setShown}><Modal.Content>
      <Button theme={theme} label="All plans and tasks" onPress={() => { onSelect(null); setShown(false); }} />
      {plans.map(p => <View key={p.definition.id} style={{ gap: 6 }}><Button theme={theme} label={`Filter: ${p.definition.title}`} onPress={() => { onSelect(p.definition.id); setShown(false); }} />
        <Button theme={theme} label={`Open plan: ${p.definition.title}`} onPress={() => { setShown(false); open(p.definition.id); }} /></View>)}
    </Modal.Content></Modal></>;
}
export function PlanNeeds({ theme, snapshot }: { theme: PluginTheme; snapshot?: Pick<NeedsYouSnapshot, "planNow" | "comingUp" | "planProblems"> | undefined }) {
  const { open } = useWorkflowPlans();
  const group = (label: string, needs: readonly PlanNeed[], muted: boolean) => needs.length ? <View testID={muted ? "workflow-coming-up" : "workflow-now"} style={{ gap: 8, paddingVertical: 10 }}>
    <Text accessibilityRole="header" style={{ color: muted ? theme.colors.foregroundMuted : theme.colors.foreground, fontSize: 13, fontWeight: "600" }}>{label}</Text>
    {needs.map(n => <View key={`${n.plan}:${n.node ?? "approval"}`} style={{ gap: 4 }}>
      <Button theme={theme} quiet={muted} label={`${n.title}: ${n.question}`} onPress={() => open(n.plan)} />
      <Text style={{ color: theme.colors.foregroundMuted, fontSize: 12 }}>{n.waits.length ? `After ${n.waits.join(", ")}. ` : ""}{n.neededBy.length ? `Needed before ${n.neededBy.join(", ")}. ` : ""}Recommended: {n.recommendation}</Text>
    </View>)}
  </View> : null;
  return <>{snapshot?.planProblems?.length ? <Text accessibilityRole="alert" style={{ color: theme.colors.statusWarning }}>Some plans are unavailable. The decision count is incomplete. {snapshot.planProblems.join(" ")}</Text> : null}{group("Now · plans", snapshot?.planNow ?? [], false)}{group("Coming up", snapshot?.comingUp ?? [], true)}</>;
}
