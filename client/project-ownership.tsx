import type { PluginTheme } from "@getpaseo/plugin";
import type { PluginScreenProps } from "@getpaseo/plugin/client";
import { useRpc } from "@getpaseo/plugin/client";
import { Modal } from "@getpaseo/plugin/client/react-native";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { ProjectRuntimeSnapshotSchema, provisionProjectFromUi, recoverProjectRuntimeFromUi, abortProjectProvisionFromUi, readProjectMemory, readProjectRuntime, type ProjectRuntimeSnapshot } from "../shared/project-runtime";
import { workflowRequestId, useWorkflowPlans } from "./workflow-plans";
import { errorText } from "./format";
import { projectHasHistory, projectHasProblem, projectSetupAvailable } from "./ownership-state";
type Project = ProjectRuntimeSnapshot["projects"][number];
function Action({ theme, label, onPress, disabled = false }: { theme: PluginTheme; label: string; onPress(): void; disabled?: boolean }) {
  return <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled }} disabled={disabled} onPress={onPress}
    style={{ minHeight: 44, maxWidth: "100%", minWidth: 0, flexShrink: 1, paddingHorizontal: 12, paddingVertical: 8, justifyContent: "center", borderWidth: 1, borderColor: theme.colors.border, borderRadius: 7, opacity: disabled ? 0.5 : 1 }}>
    <Text style={{ color: theme.colors.foreground, fontSize: 13, flexShrink: 1 }}>{label}</Text>
  </Pressable>;
}
export function ProjectOwnershipBoard({ theme, compact, navigation, hostId = "local", advanced = false, onNavigate }: {
  theme: PluginTheme; compact: boolean; navigation?: PluginScreenProps["navigation"]; hostId?: string; advanced?: boolean; onNavigate?(): void;
}) {
  const read = useRpc(readProjectRuntime), provision = useRpc(provisionProjectFromUi);
  const plans = useWorkflowPlans();
  const recover = useRpc(recoverProjectRuntimeFromUi), stop = useRpc(abortProjectProvisionFromUi);
  const query = useQuery({ queryKey: ["firstmate", "project-ownership", hostId], queryFn: async () => ProjectRuntimeSnapshotSchema.parse(await read({})), refetchInterval: 5000 });
  const [selected, select] = useState<Project | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null);
  const gate = useRef(false), pending = useRef<Parameters<typeof provision>[0] | null>(null), homeId = query.data?.homeId;
  useEffect(() => { select(null); pending.current = null; setError(null); }, [hostId, homeId]);
  const data = query.data;
  if (!data) return query.isError ? <Text accessibilityRole="alert" style={{ color: theme.colors.statusWarning }}>Project status could not be read. Close and reopen details to check again.</Text> : null;
  if (!advanced && !projectHasHistory(data) && !data.projects.some(projectSetupAvailable) && !data.problems.length && data.freshness !== "held" && !query.isError) return null;
  if (!data.enabled && !data.projects.length && !data.problems.length && data.freshness !== "held" && !query.isError) return null;
  const stale = query.isError || !data.enabled || data.freshness !== "current" || !!selected && !data.projects.some(p => p.projectId === selected.projectId && p.version === selected.version);
  async function confirm() {
    if (gate.current || stale || !selected?.projectId || !data) return;
    gate.current = true; setBusy(true); setError(null);
    pending.current ??= selected.provisionInput ?? { homeId: data.homeId, requestId: selected.provisionRequestId ?? workflowRequestId(), projectId: selected.projectId, projectVersion: selected.version };
    try {
      const next = ProjectRuntimeSnapshotSchema.parse(await provision(pending.current));
      // Reread after receipt; never reinterpret a lost reply as a fresh provisioning request.
      await query.refetch();
      const current = next.projects.find(p => p.projectId === selected.projectId);
      if (current?.agentId && !current.reason) { select(null); pending.current = null; }
      else setError(current?.reason ?? "Provisioning is recorded. Inspect the retained session and resume this request.");
    } catch (e) { setError(`${errorText(e)} The request may be recorded; retry retains its identity.`); }
    finally { gate.current = false; setBusy(false); }
  }
  async function repair() {
    if (gate.current || query.isError || !data?.enabled || !data.recovery) return;
    gate.current = true; setBusy(true); setError(null);
    try { await recover({ homeId: data.homeId, ...data.recovery }); await query.refetch(); }
    catch (e) { setError(errorText(e)); }
    finally { gate.current = false; setBusy(false); }
  }
  async function abort() {
    const requestId = selected?.provisionRequestId ?? pending.current?.requestId;
    if (gate.current || stale || !data || !selected?.projectId || !requestId) return;
    gate.current = true; setBusy(true); setError(null);
    try {
      await stop({ homeId: data.homeId, projectId: selected.projectId, projectVersion: selected.version, provisionRequestId: requestId });
      await query.refetch(); select(null); pending.current = null;
    } catch (e) { setError(errorText(e)); }
    finally { gate.current = false; setBusy(false); }
  }
  return <>
    <ProjectOwnershipView theme={theme} compact={compact} data={data} readError={query.isError} onRefresh={() => { void query.refetch(); }}
      {...(!selected ? { onRecover: () => { void repair(); }, recoveryBusy: busy } : {})}
      onProvision={p => { pending.current = null; setError(null); select(p); }}
      onDiscuss={p => { if (p.scopeId && plans.canDiscussScope?.(p.scopeId, data.homeId) && plans.discussScope) { plans.discussScope(p.scopeId, data.homeId); onNavigate?.(); } }} canDiscuss={p => !!p.scopeId && !!plans.canDiscussScope?.(p.scopeId, data.homeId)}
      onOpen={navigation ? p => { if (p.agentId) { navigation.openAgent({ agentId: p.agentId, ...(hostId === "local" ? {} : { serverId: hostId }) }); onNavigate?.(); } } : undefined} />
    {!selected && error ? <Text accessibilityRole="alert" style={{ color: theme.colors.statusDanger }}>{error}</Text> : null}
    {selected ? <Modal title={`${selected.provisionRequestId ? "Resume" : "Create"} project mate for ${selected.name}?`} open onOpenChange={open => { if (!open && !busy) select(null); }}>
      <Modal.Content><View style={{ gap: 12 }}>
        <Text style={{ color: theme.colors.foreground }}>Create one persistent conversation in its own workspace. This reserves a session and opening turn within the reviewed project limits.</Text>
        <Text selectable style={{ color: theme.colors.foreground }}>{selected.profile?.provider} · {selected.profile?.modeId} · {selected.profile?.thinkingOptionId || "default reasoning"}</Text>
        <Text style={{ color: theme.colors.foregroundMuted }}>Limits: {selected.limits?.supervisorSessions} sessions, {selected.limits?.supervisorTurns} turns. Spent: {selected.sessions} sessions, {selected.turns} turns.</Text>
        <Text style={{ color: theme.colors.foregroundMuted }}>Explicit app action by convention; caller identity is unverified. Project oversight grants no plan execution or release authority.</Text>
        {error ? <Text accessibilityRole="alert" style={{ color: theme.colors.statusDanger }}>{error}</Text> : null}
        {stale ? <Text accessibilityRole="alert" style={{ color: theme.colors.statusWarning }}>{data.recovery ? "Recover project records, then resume the recorded request. Recovery checks retained history and creates no session." : "Project status changed or could not be refreshed. Close and refresh before acting."}</Text> : null}
        {(pending.current || selected.provisionRequestId) && !stale ? <Text style={{ color: theme.colors.foregroundMuted }}>Stopping provisioning cancels only undispatched operations. Its identity, spent budget and uncertain operations remain recorded; no replacement mate is created.</Text> : null}
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
          <Action theme={theme} label="Cancel" disabled={busy} onPress={() => select(null)} />
          {data.recovery ? <Action theme={theme} label="Recover project records" disabled={busy || query.isError || !data.enabled} onPress={() => { void repair(); }} /> : null}
          <Action theme={theme} label={busy ? "Provisioning…" : pending.current ? "Resume recorded request" : selected.provisionRequestId ? "Resume project provisioning" : "Create project mate"} disabled={busy || stale} onPress={() => { void confirm(); }} />
          {pending.current || selected.provisionRequestId ? <Action theme={theme} label="Stop recorded provisioning" disabled={busy || stale} onPress={() => { void abort(); }} /> : null}
        </View>
      </View></Modal.Content>
    </Modal> : null}
  </>;
}
export function ProjectOwnershipView({ theme, compact, data, readError = false, onRefresh, onProvision, onOpen, onRecover, recoveryBusy = false, onDiscuss, canDiscuss }: {
  theme: PluginTheme; compact: boolean; data: ProjectRuntimeSnapshot; readError?: boolean; onRefresh(): void; onProvision(p: Project): void; onOpen?: ((p: Project) => void) | undefined;
  onRecover?: () => void; recoveryBusy?: boolean;
  onDiscuss?: (p: Project) => void; canDiscuss?: (p: Project) => boolean;
}) {
  const [expanded, expand] = useState(false), [memoryProject, setMemory] = useState<Project | null>(null), colors = theme.colors;
  const stale = readError || data.freshness !== "current";
  const available = data.projects.filter(projectSetupAvailable).length;
  const held = data.projects.filter(projectHasProblem).length;
  return <View testID="project-ownership" style={{ borderBottomWidth: 1, borderColor: colors.border, padding: compact ? 12 : 16, gap: 8 }}>
    <View style={{ flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
      <Pressable accessibilityRole="button" accessibilityLabel="Project mates and plans" accessibilityState={{ expanded }} onPress={() => expand(!expanded)} style={{ minHeight: 44, justifyContent: "center", flexGrow: 1, flexShrink: 1, minWidth: 0, flexBasis: "100%" }}>
        <Text style={{ color: colors.foreground, fontSize: 14, fontWeight: "600" }}>Project mates{available ? ` · ${available} available to set up` : ""}{held ? ` · ${held} need review` : ""}</Text>
      </Pressable>
      {expanded ? <Action theme={theme} label="Refresh projects" onPress={onRefresh} /> : null}
    </View>
    {data.pause ? <Text accessibilityLiveRegion="polite" style={{ color: colors.foregroundMuted }}>{data.pause}</Text> : null}
    {readError ? <Text accessibilityRole="alert" style={{ color: colors.statusDanger }}>Project status could not be refreshed. Showing the last received census; actions are unavailable.</Text> : null}
    {data.problems.length || data.freshness === "held" ? <Text accessibilityRole="alert" style={{ color: colors.statusWarning }}>Some projects couldn't be checked. Open project details and refresh before continuing.</Text> : null}
    {expanded ? <>
      {data.problems.map((p, i) => <Text key={i} accessibilityRole="alert" style={{ color: colors.statusWarning }}>{p}</Text>)}
      {data.recovery && onRecover ? <View style={{ gap: 8 }}><Text style={{ color: colors.foregroundMuted }}>Recover the inspected project records before resuming. Recovery validates history and creates no workspace, agent or turn.</Text>
        <Action theme={theme} label="Recover project records" disabled={!data.enabled || readError || recoveryBusy} onPress={onRecover} /></View> : null}
      <Text style={{ color: colors.foregroundMuted, fontSize: 12 }}>General retains {data.general.headroom} of {data.general.slots} plugin admission slots. Provider capacity is unknown.</Text>
      {!data.projects.length && !data.problems.length && !readError && (data.freshness === "current" || data.freshness === "uninitialized") ? <Text style={{ color: colors.foregroundMuted }}>No projects have been set up.</Text> : null}
      <View style={{ gap: 16 }}>
        {data.projects.map((p, i) => <View key={`${p.projectId ?? p.name}:${i}`} style={{ gap: 6 }}>
          <Text style={{ color: colors.foreground, fontSize: 14, fontWeight: "600" }}>{p.name} · {projectSetupAvailable(p) ? "Review this project's setup" : p.state}{p.agentId ? " · mate reserved" : ""}</Text>
          {p.reason && !projectSetupAvailable(p) ? <Text style={{ color: colors.foregroundMuted, fontSize: 13 }}>{p.reason} Review the saved details before resuming.</Text> : null}
          <Text selectable style={{ color: colors.foregroundMuted, fontSize: 12 }}>Stored state: {p.state} · version {p.version} · project {p.projectId ?? "not recorded"} · scope {p.scopeId ?? "not recorded"}{p.reason ? ` · ${p.reason}` : ""}</Text>
          <Text selectable style={{ color: colors.foregroundMuted, fontSize: 12 }}>{p.hostId ?? "Host not recorded"} · {p.directory ?? "Folder not recorded"}</Text>
          {p.agentId ? <Text style={{ color: colors.foregroundMuted, fontSize: 12 }}>{p.sessions} sessions · {p.turns} turns spent{p.uncertain ? ` · ${p.uncertain} uncertain` : ""}</Text> : null}
          {p.plans.map(plan => <View key={plan.id} style={{ gap: 2 }}>
            <Text style={{ color: colors.foreground, fontSize: 13 }}>{plan.title}</Text>
            <Text style={{ color: colors.foregroundMuted, fontSize: 12 }}>{plan.state}{plan.projectIds.length > 1 ? " · shared across projects" : ""}{plan.sponsorScopeId ? ` · sponsor ${plan.sponsorScopeId === data.general.scopeId ? "FirstMate" : data.projects.find(p => p.scopeId === plan.sponsorScopeId)?.name ?? plan.sponsorScopeId.slice(0, 8)}` : ""}{plan.ownerScopeId ? ` · execution scope ${plan.ownerScopeId.slice(0, 8)}` : ""}</Text>
          </View>)}
          {!p.plans.length ? <Text style={{ color: colors.foregroundMuted, fontSize: 12 }}>No associated plans in the stored inventory.</Text> : null}
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
            {p.agentId && p.workspaceId && onOpen ? <Action theme={theme} label={`Open ${p.name} conversation`} onPress={() => onOpen(p)} /> : null}
            {canDiscuss?.(p) && onDiscuss ? <Action theme={theme} label={`Discuss ${p.name} scope`} onPress={() => onDiscuss(p)} /> : null}
            {p.version > 0 ? <Action theme={theme} label={`Read ${p.name} memory${p.memoryPending ? ` (${p.memoryPending} proposals)` : ""}`} onPress={() => setMemory(p)} /> : null}
            {data.enabled && p.profile && p.state === "admitted" && (!p.provisionRequestId && !p.agentId || p.reason?.startsWith("Provisioning incomplete")) ?
              <Action theme={theme} label={`${p.provisionRequestId ? "Resume" : "Create"} ${p.name} mate`} disabled={stale || !!p.reason && !p.reason.startsWith("Provisioning incomplete")} onPress={() => onProvision(p)} /> : null}
          </View>
        </View>)}
      </View>
    </> : null}
    {memoryProject?.projectId ? <ProjectMemoryView theme={theme} homeId={data.homeId} project={memoryProject} onClose={() => setMemory(null)} /> : null}
  </View>;
}
function ProjectMemoryView({ theme, homeId, project, onClose }: { theme: PluginTheme; homeId: string; project: Project; onClose(): void }) {
  const read = useRpc(readProjectMemory);
  const query = useQuery({ queryKey: ["firstmate", "project-memory", homeId, project.projectId], queryFn: () => read({ homeId, projectId: project.projectId! }), retry: false });
  return <Modal title={`${project.name} memory`} open onOpenChange={open => { if (!open) onClose(); }}><Modal.Content>
    <ScrollView style={{ maxHeight: 420 }} contentContainerStyle={{ gap: 12 }}>
      <Text style={{ color: theme.colors.foregroundMuted }}>Project context only. Proposals await a versioned accept or reject recorded by the first mate.</Text>
      {query.isPending ? <Text style={{ color: theme.colors.foregroundMuted }}>Reading verified memory…</Text> : null}
      {query.error ? <Text accessibilityRole="alert" style={{ color: theme.colors.statusDanger }}>{errorText(query.error)}</Text> : null}
      {query.data?.memory.map(m => <View key={m.key} style={{ gap: 4 }}><Text style={{ color: theme.colors.foreground, fontWeight: "600" }}>{m.key} · accepted version {m.version}</Text><Text selectable style={{ color: theme.colors.foreground }}>{m.text}</Text></View>)}
      {query.data?.proposals.map(p => <View key={p.id} style={{ gap: 4 }}><Text style={{ color: theme.colors.foreground, fontWeight: "600" }}>{p.key} · proposed against version {p.expectedVersion}</Text><Text selectable style={{ color: theme.colors.foreground }}>{p.text}</Text><Text selectable style={{ color: theme.colors.foregroundMuted, fontSize: 12 }}>Proposal {p.id} · version {p.version}</Text></View>)}
      {query.data && !query.data.memory.length && !query.data.proposals.length ? <Text style={{ color: theme.colors.foregroundMuted }}>No accepted memory or pending proposals.</Text> : null}
    </ScrollView>
  </Modal.Content></Modal>;
}
