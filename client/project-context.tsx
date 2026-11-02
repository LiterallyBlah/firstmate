/** Projects as context only: name, folder, memory and associated plans. A project's Supervisor is listed with the others. */
import type { PluginTheme } from "@getpaseo/plugin";
import { useRpc } from "@getpaseo/plugin/client";
import { Icon, Modal } from "@getpaseo/plugin/client/react-native";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { ProjectRuntimeSnapshotSchema, recoverProjectRuntimeFromUi, readProjectMemory, readProjectRuntime, type ProjectRuntimeSnapshot } from "../shared/project-runtime";
import { errorText } from "./format";
type Project = ProjectRuntimeSnapshot["projects"][number];

/** Expected legacy handoff context stays in the snapshot; it is not a failed project read. */
export function projectReadProblems(data: ProjectRuntimeSnapshot): string[] {
  const warnings = new Set(projectAssociationWarnings(data));
  return data.problems.filter(problem => !warnings.has(problem));
}
export function projectAssociationWarnings(data: ProjectRuntimeSnapshot): string[] {
  return data.associationWarnings ?? (data.freshness === "uninitialized" && data.sequence === 0 && data.hash === null ? data.problems.filter(p => /^Plan .+ has unresolved project or host membership; no ownership was guessed\.$/.test(p)) : []);
}
/** What the stored record says about a project, without offering to create anything for it. */
export function projectStatus(project: Project): string {
  const location = project.registryLocation ?? project.directory;
  const remote = location && !/^[A-Za-z]:[\\/]/.test(location) && (/^([^:/\\]+):[\\/](?![\\/])/.exec(location)?.[1] ?? /^ssh:\/\/(?:[^@/]+@)?([^/:]+)/.exec(location)?.[1]);
  if (remote) return `On another computer (${remote})`;
  if (location && /^[a-z][\w+.-]*:\/\//i.test(location)) return "Repository URL; no local folder recorded";
  if (/Project (directory is unavailable|location is not a directory)/.test(project.reason ?? "")) return project.reason?.includes("not a directory") ? "Not a folder" : "Folder not found";
  if (project.reason?.includes("ambiguous")) return "Duplicate project entry";
  if (project.state === "admitted") return "Admitted";
  if (project.state === "unadmitted") return "In the project list";
  return project.reason ? `${project.state[0]!.toUpperCase()}${project.state.slice(1)}: ${project.reason}` : `${project.state[0]!.toUpperCase()}${project.state.slice(1)}`;
}
function Action({ theme, label, onPress, disabled = false }: { theme: PluginTheme; label: string; onPress(): void; disabled?: boolean }) {
  return <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled }} disabled={disabled} onPress={onPress}
    style={{ minHeight: 44, maxWidth: "100%", minWidth: 0, flexShrink: 1, paddingHorizontal: 12, paddingVertical: 8, justifyContent: "center", borderWidth: 1, borderColor: theme.colors.border, borderRadius: 7, opacity: disabled ? 0.5 : 1 }}>
    <Text style={{ color: theme.colors.foreground, fontSize: 13, flexShrink: 1 }}>{label}</Text>
  </Pressable>;
}
export function ProjectContextBoard({ theme, compact, hostId = "local" }: { theme: PluginTheme; compact: boolean; hostId?: string }) {
  const read = useRpc(readProjectRuntime), recover = useRpc(recoverProjectRuntimeFromUi);
  const query = useQuery({ queryKey: ["firstmate", "project-ownership", hostId], queryFn: async () => ProjectRuntimeSnapshotSchema.parse(await read({})), refetchInterval: 5000 });
  const [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null), gate = useRef(false);
  const data = query.data;
  useEffect(() => { setError(null); }, [hostId, data?.homeId]);
  if (!data) return query.isError ? <Text accessibilityRole="alert" style={{ color: theme.colors.statusWarning }}>Project status could not be read. Use Refresh Supervisors to check again.</Text> : null;
  if (!data.projects.length && !data.problems.length && data.freshness !== "held" && !query.isError) return null;
  async function repair() {
    if (gate.current || query.isError || !data?.enabled || !data.recovery) return;
    gate.current = true; setBusy(true); setError(null);
    try { await recover({ homeId: data.homeId, ...data.recovery }); await query.refetch(); }
    catch (e) { setError(errorText(e)); }
    finally { gate.current = false; setBusy(false); }
  }
  return <>
    <ProjectContextView theme={theme} compact={compact} data={data} readError={query.isError} onRefresh={() => { void query.refetch(); }} onRecover={() => { void repair(); }} recoveryBusy={busy} />
    {error ? <Text accessibilityRole="alert" style={{ color: theme.colors.statusDanger }}>{error}</Text> : null}
  </>;
}
export function ProjectContextView({ theme, compact, data, readError = false, onRefresh, onRecover, recoveryBusy = false, initiallyExpanded = false }: {
  theme: PluginTheme; compact: boolean; data: ProjectRuntimeSnapshot; readError?: boolean; onRefresh(): void;
  onRecover?: () => void; recoveryBusy?: boolean; initiallyExpanded?: boolean;
}) {
  const [expanded, expand] = useState(initiallyExpanded), [memoryProject, setMemory] = useState<Project | null>(null), [technical, showTechnical] = useState<string | null>(null), colors = theme.colors;
  const [globalDetails, showGlobalDetails] = useState(false), [planList, showPlanList] = useState<string | null>(null);
  const problems = projectReadProblems(data), warnings = projectAssociationWarnings(data);
  const summary = `${data.projects.length} ${data.projects.length === 1 ? "project" : "projects"}`;
  return <View testID="project-context" style={{ borderTopWidth: 1, borderColor: colors.border, paddingVertical: compact ? 12 : 16, gap: 8 }}>
    <Pressable accessibilityRole="button" accessibilityLabel="Projects" accessibilityState={{ expanded }} aria-expanded={expanded} onPress={() => expand(!expanded)} style={{ minHeight: 44, flexDirection: "row", alignItems: "center", gap: 8, minWidth: 0 }}>
      <Icon name={expanded ? "ChevronDown" : "ChevronRight"} size={18} color={colors.foregroundMuted} />
      <View style={{ flex: 1, gap: 3 }}><Text style={{ color: colors.foreground, fontSize: 14, fontWeight: "600" }}>Projects</Text>
        <Text style={{ color: colors.foregroundMuted, fontSize: 12 }}>{summary} · context for plans and Supervisors</Text></View>
    </Pressable>
    {data.pause ? <Text accessibilityLiveRegion="polite" style={{ color: colors.foregroundMuted }}>{data.pause}</Text> : null}
    {readError ? <Text accessibilityRole="alert" style={{ color: colors.statusDanger }}>Project status could not be refreshed. Showing the last received records.</Text> : null}
    {expanded ? <>
      {problems.map((p, i) => <Text key={i} accessibilityRole="alert" style={{ color: colors.statusWarning }}>{p}</Text>)}
      {data.recovery && onRecover ? <View style={{ gap: 8 }}><Text style={{ color: colors.foregroundMuted }}>Recover the inspected project records. Recovery validates history and creates no workspace, agent or turn.</Text>
        <Action theme={theme} label="Recover project records" disabled={!data.enabled || readError || recoveryBusy} onPress={onRecover} /></View> : null}
      {warnings.length ? <Text style={{ color: colors.foregroundMuted, fontSize: 12 }}>Some older plans aren't linked to a project. No action needed.</Text> : null}
      <Pressable accessibilityRole="button" accessibilityLabel="Project technical details" accessibilityState={{ expanded: globalDetails }} aria-expanded={globalDetails} onPress={() => showGlobalDetails(!globalDetails)} style={{ minHeight: 44, flexDirection: "row", gap: 6, alignItems: "center" }}>
        <Icon name={globalDetails ? "ChevronDown" : "ChevronRight"} size={14} color={colors.foregroundMuted} /><Text style={{ color: colors.foregroundMuted, fontSize: 12 }}>Technical details</Text>
      </Pressable>
      {globalDetails ? <View style={{ gap: 6 }}><Text style={{ color: colors.foregroundMuted, fontSize: 12 }}>General retains {data.general.headroom} of {data.general.slots} plugin admission slots. Provider capacity is unknown.</Text>
        {warnings.map((warning, i) => <Text key={i} style={{ color: colors.foregroundMuted, fontSize: 12 }}>{warning}</Text>)}
        <Action theme={theme} label="Refresh projects" onPress={onRefresh} /></View> : null}
      <View style={{ gap: 16 }}>
        {data.projects.map((p, i) => { const key = `${p.projectId ?? p.name}:${i}`; return <View key={key} style={{ gap: 6 }}>
          <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 8 }}>
            <View style={{ flex: 1, minWidth: 100, gap: 3 }}><Text style={{ color: colors.foreground, fontSize: 14, fontWeight: "600" }}>{p.name}</Text>
              <Text style={{ color: colors.foregroundMuted, fontSize: 12 }}>{projectStatus(p)}</Text>
              <Text selectable style={{ color: colors.foregroundMuted, fontSize: 12 }}>{p.directory ?? p.registryLocation ?? "Folder not recorded"}</Text></View>
            <Pressable accessibilityRole="button" accessibilityLabel={`${technical === key ? "Hide" : "Show"} ${p.name} details`} accessibilityState={{ expanded: technical === key }} aria-expanded={technical === key} onPress={() => showTechnical(technical === key ? null : key)} style={{ minHeight: 44, minWidth: 44, paddingHorizontal: 6, flexDirection: "row", alignItems: "center", gap: 4 }}>
              <Text style={{ color: colors.foregroundMuted, fontSize: 12 }}>Details</Text><Icon name={technical === key ? "ChevronDown" : "ChevronRight"} size={14} color={colors.foregroundMuted} /></Pressable>
          </View>
          {technical === key ? <View style={{ gap: 6 }}>
          <Text selectable style={{ color: colors.foregroundMuted, fontSize: 12 }}>Stored state: {p.state} · version {p.version} · project {p.projectId ?? "not recorded"} · scope {p.scopeId ?? "not recorded"}{p.reason ? ` · ${p.reason}` : ""}</Text>
          <Text selectable style={{ color: colors.foregroundMuted, fontSize: 12 }}>{p.hostId ?? "Host not recorded"} · {p.directory ?? p.registryLocation ?? "Folder not recorded"}</Text>
          {p.plans.length ? <Pressable accessibilityRole="button" accessibilityLabel={`${p.name} plans: ${p.plans.length}`} accessibilityState={{ expanded: planList === key }} aria-expanded={planList === key} onPress={() => showPlanList(planList === key ? null : key)} style={{ minHeight: 44, flexDirection: "row", alignItems: "center", gap: 6 }}><Icon name={planList === key ? "ChevronDown" : "ChevronRight"} size={14} color={colors.foregroundMuted} /><Text style={{ color: colors.foregroundMuted, fontSize: 12 }}>{p.plans.length} {p.plans.length === 1 ? "plan" : "plans"}</Text></Pressable> : null}
          {planList === key ? p.plans.map(plan => <View key={plan.id} style={{ gap: 2 }}>
            <Text style={{ color: colors.foreground, fontSize: 13 }}>{plan.title}</Text>
            <Text style={{ color: colors.foregroundMuted, fontSize: 12 }}>{plan.state}{plan.projectIds.length > 1 ? " · shared across projects" : ""}{plan.sponsorScopeId ? ` · sponsor ${plan.sponsorScopeId === data.general.scopeId ? "FirstMate" : data.projects.find(p => p.scopeId === plan.sponsorScopeId)?.name ?? plan.sponsorScopeId.slice(0, 8)}` : ""}{plan.ownerScopeId ? ` · execution scope ${plan.ownerScopeId.slice(0, 8)}` : ""}</Text>
          </View>) : null}
          {!p.plans.length ? <Text style={{ color: colors.foregroundMuted, fontSize: 12 }}>No associated plans in the stored inventory.</Text> : null}
          {p.version > 0 ? <Action theme={theme} label={`Read ${p.name} memory${p.memoryPending ? ` (${p.memoryPending} proposals)` : ""}`} onPress={() => setMemory(p)} /> : null}
          </View> : null}
        </View>; })}
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
