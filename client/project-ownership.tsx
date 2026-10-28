import type { PluginTheme } from "@getpaseo/plugin";
import type { PluginScreenProps } from "@getpaseo/plugin/client";
import { useRpc } from "@getpaseo/plugin/client";
import { Modal } from "@getpaseo/plugin/client/react-native";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { ProjectRuntimeSnapshotSchema, provisionProjectFromUi, readProjectMemory, readProjectRuntime, type ProjectRuntimeSnapshot } from "../shared/project-runtime";
import { workflowRequestId } from "./workflow-plans";
import { errorText } from "./format";
type Project = ProjectRuntimeSnapshot["projects"][number];
function Action({ theme, label, onPress, disabled = false }: { theme: PluginTheme; label: string; onPress(): void; disabled?: boolean }) {
  return <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled }} disabled={disabled} onPress={onPress}
    style={{ minHeight: 44, paddingHorizontal: 12, paddingVertical: 8, justifyContent: "center", borderWidth: 1, borderColor: theme.colors.border, borderRadius: 7, opacity: disabled ? 0.5 : 1 }}>
    <Text style={{ color: theme.colors.foreground, fontSize: 13 }}>{label}</Text>
  </Pressable>;
}
export function ProjectOwnershipBoard({ theme, compact, navigation, hostId = "local" }: {
  theme: PluginTheme; compact: boolean; navigation?: PluginScreenProps["navigation"]; hostId?: string;
}) {
  const read = useRpc(readProjectRuntime), provision = useRpc(provisionProjectFromUi);
  const query = useQuery({ queryKey: ["firstmate", "project-ownership", hostId], queryFn: async () => ProjectRuntimeSnapshotSchema.parse(await read({})), refetchInterval: 5000 });
  const [selected, select] = useState<Project | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null);
  const gate = useRef(false), pending = useRef<Parameters<typeof provision>[0] | null>(null), homeId = query.data?.homeId;
  useEffect(() => { select(null); pending.current = null; setError(null); }, [hostId, homeId]);
  const data = query.data;
  if (!data || !data.enabled && !data.projects.some(p => p.agentId)) return null;
  const stale = query.isError || !data.enabled || data.freshness !== "current" || !!selected && !data.projects.some(p => p.projectId === selected.projectId && p.version === selected.version);
  async function confirm() {
    if (gate.current || stale || !selected?.projectId || !data) return;
    gate.current = true; setBusy(true); setError(null);
    pending.current ??= { homeId: data.homeId, requestId: selected.provisionRequestId ?? workflowRequestId(), projectId: selected.projectId, projectVersion: selected.version };
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
  return <>
    <ProjectOwnershipView theme={theme} compact={compact} data={data} readError={query.isError} onRefresh={() => { void query.refetch(); }}
      onProvision={p => { pending.current = null; setError(null); select(p); }}
      onOpen={navigation ? p => { if (p.agentId) navigation.openAgent({ agentId: p.agentId, ...(hostId === "local" ? {} : { serverId: hostId }) }); } : undefined} />
    {selected ? <Modal title={`${selected.agentId ? "Resume" : "Create"} project mate for ${selected.name}?`} open onOpenChange={open => { if (!open && !busy) select(null); }}>
      <Modal.Content><View style={{ gap: 12 }}>
        <Text style={{ color: theme.colors.foreground }}>Create one persistent conversation in its own workspace. This reserves a session and opening turn within the reviewed project limits.</Text>
        <Text selectable style={{ color: theme.colors.foreground }}>{selected.profile?.provider} · {selected.profile?.modeId} · {selected.profile?.thinkingOptionId || "default reasoning"}</Text>
        <Text style={{ color: theme.colors.foregroundMuted }}>Limits: {selected.limits?.supervisorSessions} sessions, {selected.limits?.supervisorTurns} turns. Spent: {selected.sessions} sessions, {selected.turns} turns.</Text>
        <Text style={{ color: theme.colors.foregroundMuted }}>Explicit app action by convention; caller identity is unverified. Project oversight grants no plan execution or release authority.</Text>
        {error ? <Text accessibilityRole="alert" style={{ color: theme.colors.statusDanger }}>{error}</Text> : null}
        {stale ? <Text accessibilityRole="alert" style={{ color: theme.colors.statusWarning }}>Project status changed or could not be refreshed. Close and refresh before acting.</Text> : null}
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
          <Action theme={theme} label="Cancel" disabled={busy} onPress={() => select(null)} />
          <Action theme={theme} label={busy ? "Provisioning…" : pending.current ? "Resume recorded request" : selected.agentId ? "Resume project provisioning" : "Create project mate"} disabled={busy || stale} onPress={() => { void confirm(); }} />
        </View>
      </View></Modal.Content>
    </Modal> : null}
  </>;
}
export function ProjectOwnershipView({ theme, compact, data, readError = false, onRefresh, onProvision, onOpen }: {
  theme: PluginTheme; compact: boolean; data: ProjectRuntimeSnapshot; readError?: boolean; onRefresh(): void; onProvision(p: Project): void; onOpen?: ((p: Project) => void) | undefined;
}) {
  const [expanded, expand] = useState(false), [memoryProject, setMemory] = useState<Project | null>(null), colors = theme.colors;
  const stale = readError || data.freshness !== "current";
  const held = data.projects.filter(p => p.reason).length;
  return <View testID="project-ownership" style={{ borderBottomWidth: 1, borderColor: colors.border, padding: compact ? 12 : 16, gap: 8 }}>
    <View style={{ flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
      <Pressable accessibilityRole="button" accessibilityLabel="Project mates and plans" accessibilityState={{ expanded }} onPress={() => expand(!expanded)} style={{ minHeight: 44, justifyContent: "center", flexGrow: 1 }}>
        <Text style={{ color: colors.foreground, fontSize: 14, fontWeight: "600" }}>Project mates · {data.projects.length}{held ? ` · ${held} awaiting attention` : ""}{data.freshness === "held" ? " · status held" : ""}</Text>
      </Pressable>
      {expanded ? <Action theme={theme} label="Refresh projects" onPress={onRefresh} /> : null}
    </View>
    {readError ? <Text accessibilityRole="alert" style={{ color: colors.statusDanger }}>Project status could not be refreshed. Showing the last received census; actions are unavailable.</Text> : null}
    {expanded ? <>
      {data.problems.map((p, i) => <Text key={i} accessibilityRole="alert" style={{ color: colors.statusWarning }}>{p}</Text>)}
      <Text style={{ color: colors.foregroundMuted, fontSize: 12 }}>General retains {data.general.headroom} of {data.general.slots} plugin admission slots. Provider capacity is unknown.</Text>
      {!data.projects.length ? <Text style={{ color: colors.foregroundMuted }}>Register active projects in Home files, then record reviewed admission and allocation.</Text> : null}
      <ScrollView style={{ maxHeight: compact ? 300 : 380 }} contentContainerStyle={{ gap: 16 }}>
        {data.projects.map((p, i) => <View key={`${p.projectId ?? p.name}:${i}`} style={{ gap: 6 }}>
          <Text style={{ color: colors.foreground, fontSize: 14, fontWeight: "600" }}>{p.name} · {p.state}{p.agentId ? " · mate reserved" : ""}</Text>
          {p.reason ? <Text style={{ color: colors.foregroundMuted, fontSize: 13 }}>{p.reason}</Text> : null}
          {p.agentId ? <Text style={{ color: colors.foregroundMuted, fontSize: 12 }}>{p.sessions} sessions · {p.turns} turns spent{p.uncertain ? ` · ${p.uncertain} uncertain` : ""}</Text> : null}
          {p.plans.map(plan => <View key={plan.id} style={{ gap: 2 }}>
            <Text style={{ color: colors.foreground, fontSize: 13 }}>{plan.title}</Text>
            <Text style={{ color: colors.foregroundMuted, fontSize: 12 }}>{plan.state}{plan.projectIds.length > 1 ? " · shared across projects" : ""}{plan.sponsorScopeId ? ` · sponsor ${plan.sponsorScopeId === data.general.scopeId ? "FirstMate" : data.projects.find(p => p.scopeId === plan.sponsorScopeId)?.name ?? plan.sponsorScopeId.slice(0, 8)}` : ""}{plan.ownerScopeId ? ` · execution scope ${plan.ownerScopeId.slice(0, 8)}` : ""}</Text>
          </View>)}
          {!p.plans.length ? <Text style={{ color: colors.foregroundMuted, fontSize: 12 }}>No associated plans in the stored inventory.</Text> : null}
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
            {p.agentId && p.workspaceId && onOpen ? <Action theme={theme} label={`Open ${p.name} conversation`} onPress={() => onOpen(p)} /> : null}
            {p.version > 0 ? <Action theme={theme} label={`Read ${p.name} memory${p.memoryPending ? ` (${p.memoryPending} proposals)` : ""}`} onPress={() => setMemory(p)} /> : null}
            {data.enabled && p.profile && p.state === "admitted" && (!p.agentId || p.reason?.startsWith("Provisioning incomplete")) ?
              <Action theme={theme} label={`${p.agentId ? "Resume" : "Create"} ${p.name} mate`} disabled={stale || !!p.reason && !p.reason.startsWith("Provisioning incomplete")} onPress={() => onProvision(p)} /> : null}
          </View>
        </View>)}
      </ScrollView>
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
