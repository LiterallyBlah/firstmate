/** Home's Supervisors: every plan, project and routine-check Supervisor from stored truth, with projects as context. Opening this starts no work. */
import type { PluginTheme } from "@getpaseo/plugin";
import { useRpc, type PluginScreenProps } from "@getpaseo/plugin/client";
import { Icon, Modal } from "@getpaseo/plugin/client/react-native";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { readSupervisorList, SupervisorListSchema, type SupervisorListRow } from "../shared/supervisor-controls";
import { ProjectRuntimeSnapshotSchema, readProjectRuntime } from "../shared/project-runtime";
import { MaintenanceRuntimeSnapshotSchema, readMaintenance } from "../shared/maintenance-runtime";
import { readWatchSupervisors, WatchSupervisorSnapshotSchema } from "../shared/watch-routing";
import { activationHasHistory, maintenanceHasHistory } from "./ownership-state";
import { projectReadProblems, ProjectContextBoard } from "./project-context";
import { MaintenanceOwnershipBoard } from "./maintenance-ownership";
import { SupervisionActivationBoard } from "./supervision-activation";
import { useWorkflowPlans } from "./workflow-plans";
import { SupervisorControlsButton } from "./supervisor-controls";
import { WatchSupervisorButton } from "./watch-supervisors";
import { ProjectSupervisorAdd } from "./project-supervisor";
import { CONTROL_HEIGHT } from "./control-size";
import { remoteWorkerHostLine } from "./remote-host-line";
import { useRemotes } from "./remotes";

const KIND: Record<SupervisorListRow["kind"], string> = { plan: "Plan", project: "Project", maintenance: "Routine checks" };
const STATE: Record<string, string> = { active: "Active", paused: "Paused", "change-pending": "Change pending after current work", uncertain: "Needs checking",
  waiting: "Opening", unavailable: "Unavailable", prepared: "Being set up", suspect: "Needs checking", retired: "Retired" };
function usage(row: SupervisorListRow) {
  const count = (used: number, cap: number | undefined, noun: string) => `${used}${cap === undefined ? "" : ` of ${cap}`} ${noun}${(cap ?? used) === 1 ? "" : "s"}`;
  return `Used ${count(row.sessions, row.limits?.supervisorSessions, "session")} · ${count(row.turns, row.limits?.supervisorTurns, "turn")}`;
}
function profileText(row: SupervisorListRow) {
  return row.profile ? `${row.profile.provider} · ${row.profile.modeId ?? "default mode"} · reasoning ${row.profile.thinkingOptionId ?? "not offered"}` : "Profile not recorded";
}

/** `iconOnly`: the narrow desktop header keeps one row by showing only the icon; the name stays its accessible label. */
export function SupervisorsEntry({ theme, compact, hostId = "local", navigation, always = false, iconOnly = false }: {
  theme: PluginTheme; compact: boolean; hostId?: string; navigation?: PluginScreenProps["navigation"]; always?: boolean; iconOnly?: boolean;
}) {
  // Plan handovers keep their inspection and original-command recovery here at every stage, not only once committed in Plans.
  const { activation, activationError, refreshActivation } = useWorkflowPlans();
  const readList = useRpc(readSupervisorList), readProjects = useRpc(readProjectRuntime), readChecks = useRpc(readMaintenance), readWatches = useRpc(readWatchSupervisors);
  const list = useQuery({ queryKey: ["firstmate", "supervisors", hostId], queryFn: async () => SupervisorListSchema.parse(await readList({})), refetchInterval: 5000 });
  const projects = useQuery({ queryKey: ["firstmate", "project-ownership", hostId],
    queryFn: async () => ProjectRuntimeSnapshotSchema.parse(await readProjects({})), refetchInterval: 5000 });
  const checks = useQuery({ queryKey: ["firstmate", "maintenance-ownership", hostId],
    queryFn: async () => MaintenanceRuntimeSnapshotSchema.parse(await readChecks({})), refetchInterval: 5000 });
  const remotes = useRemotes((list.data?.rows ?? []).some(r => r.workerHosts.length > 0));
  const hostLabel = (serverId: string) => remotes.data?.hosts.find(h => h.serverId === serverId)?.label ?? serverId;
  const [open, setOpen] = useState(false);
  // Which watches feed each plan Supervisor; read only while the list is open.
  const watches = useQuery({ queryKey: ["firstmate", "watch-supervisors"], queryFn: async () => WatchSupervisorSnapshotSchema.parse(await readWatches({})), enabled: open, retry: false });
  const identity = useRef({ hostId, list: list.data?.homeId, project: projects.data?.homeId, checks: checks.data?.homeId, activation: activation?.homeId });
  useEffect(() => {
    const next = { hostId, list: list.data?.homeId, project: projects.data?.homeId, checks: checks.data?.homeId, activation: activation?.homeId };
    // First successful metadata after a cold read error is recovery, not a home switch.
    const keys = ["list", "project", "checks", "activation"] as const;
    const knownHomes = keys.map(key => identity.current[key]).filter(Boolean);
    if (identity.current.hostId !== hostId || keys.some(key => next[key] && knownHomes.some(home => home !== next[key]))) setOpen(false);
    identity.current = next;
  }, [hostId, list.data?.homeId, projects.data?.homeId, checks.data?.homeId, activation?.homeId]);
  function refresh() {
    refreshActivation?.();
    void list.refetch({ cancelRefetch: false });
    void projects.refetch({ cancelRefetch: false });
    void checks.refetch({ cancelRefetch: false });
  }
  const rows = list.data?.rows ?? [];
  const problem = list.isError || projects.isError || checks.isError || !!list.data?.problems.length ||
    !!projects.data && !!projectReadProblems(projects.data).length || projects.data?.freshness === "held" ||
    !!checks.data?.problems.length || checks.data?.freshness === "held" || !!checks.data?.incidents.length ||
    rows.some(r => !["active", "retired"].includes(r.state) || !!r.lastFailure) || !!activationError || !!activation?.problems.length ||
    !!activation?.plans.some(p => !!p.resumeRequestId || !!p.opening && p.opening !== "succeeded" || !!p.binding && p.binding !== "active");
  // Project records stay reachable as context, even before any is admitted or supervised.
  const retained = !!rows.length || !!projects.data?.projects.length || checks.data && maintenanceHasHistory(checks.data) || activation && activationHasHistory(activation);
  if (!always && !retained && !problem) return null;
  const colors = theme.colors, note = { color: colors.foregroundMuted, fontSize: 13 };
  // Drawn like the header's other buttons (`IconButton`): its height, padding, corners and label, with the
  // 44-point target only in a compact (phone) layout. The narrow desktop header passes `compact` with
  // `iconOnly`, and keeps the desktop size.
  return <View testID="supervisors-entry" style={{ alignSelf: "flex-start", flexShrink: 0 }}>
    <Pressable accessibilityRole="button" accessibilityLabel="Supervisors" accessibilityState={{ expanded: open }}
      accessibilityHint="Supervisors for plans, watches, routine checks and projects" onPress={() => { setOpen(true); refresh(); }}
      style={{ minHeight: compact && !iconOnly ? 44 : CONTROL_HEIGHT, minWidth: compact && !iconOnly ? 44 : CONTROL_HEIGHT, paddingHorizontal: iconOnly ? 7 : 10,
        paddingVertical: 6, flexDirection: "row", alignItems: "center", gap: 6, justifyContent: "center", borderWidth: 1, borderRadius: 8,
        borderColor: colors.border, backgroundColor: colors.surface1 }}>
      {!compact || always || iconOnly ? <Icon name="SlidersHorizontal" size={14} color={colors.foreground} /> : null}
      {iconOnly ? null : <Text style={{ color: colors.foreground, fontSize: 12, fontWeight: "500" }}>Supervisors</Text>}
    </Pressable>
    <Modal title="Supervisors" open={open} onOpenChange={setOpen}><Modal.Content>
      <View testID="supervisor-list" style={{ gap: 16 }}>
        <Text style={{ color: colors.foregroundMuted }}>Each Supervisor looks after one plan and the watches that feed it, routine checks, or a project, with its own model, permissions and limits. Projects stay as context.</Text>
        {list.isPending || projects.isPending || checks.isPending ? <Text style={{ color: colors.foregroundMuted }}>Loading Supervisors…</Text> : null}
        {list.isError ? <Text accessibilityRole="alert" style={{ color: colors.statusWarning }}>Supervisors couldn't be loaded. Check this computer's connection, then use Refresh to try again.</Text> : null}
        {list.data?.problems.map(p => <Text key={p} accessibilityRole="alert" style={{ color: colors.statusWarning }}>{p}</Text>)}
        <Pressable accessibilityRole="button" accessibilityLabel="Refresh Supervisors"
          onPress={refresh} style={{ minHeight: 44, maxWidth: "100%", minWidth: 0, justifyContent: "center", padding: 10, borderWidth: 1, borderRadius: 7, borderColor: colors.border }}>
          <Text style={{ color: colors.foreground, flexShrink: 1 }}>Refresh Supervisors</Text>
        </Pressable>
        {list.data && !rows.length ? <Text style={note}>No Supervisors yet.</Text> : null}
        {rows.map(row => {
          const fed = row.kind === "plan" ? (watches.data?.watches ?? []).filter(w => w.assignment && w.assignment.stage !== "aborted" && w.assignment.target.scopeId === row.scopeId).map(w => w.name) : [];
          const openNative = row.agentId && navigation ? () => { navigation.openAgent({ agentId: row.agentId!, ...(hostId === "local" ? {} : { serverId: hostId }) }); setOpen(false); } : undefined;
          const hostLine = remoteWorkerHostLine(row.workerHosts, hostLabel);
          return <View key={row.scopeId} testID="supervisor-row" style={{ gap: 4, paddingVertical: 8, borderTopWidth: 1, borderColor: colors.border }}>
            <Text style={{ color: colors.foreground, fontSize: 14, fontWeight: "600" }}>{row.title}</Text>
            <Text style={note}>{KIND[row.kind]}{fed.length ? ` · fed by ${fed.join(", ")}` : ""} · {STATE[row.state] ?? row.state}</Text>
            <Text selectable style={note}>{profileText(row)}</Text>
            <Text style={note}>{usage(row)}</Text>
            {hostLine ? <Text style={note}>{hostLine}</Text> : null}
            {row.modeLabel ? <Text style={note}>Decisions: {row.modeLabel}</Text> : null}
            {row.lastFailure ? <Text accessibilityRole="alert" style={{ color: colors.statusWarning, fontSize: 13 }}>Last failure: {row.lastFailure}</Text> : null}
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
              {row.agentId && list.data ? <SupervisorControlsButton theme={theme} compact={compact} homeId={list.data.homeId} scopeId={row.scopeId} onOpenNative={openNative} /> : null}
              {openNative ? <Pressable accessibilityRole="button" accessibilityLabel={`Open ${row.title} native session`} onPress={openNative}
                style={{ minHeight: 44, maxWidth: "100%", minWidth: 0, justifyContent: "center", padding: 10, borderWidth: 1, borderRadius: 7, borderColor: colors.border }}>
                <Text style={{ color: colors.foreground, flexShrink: 1 }}>Open native session</Text></Pressable> : null}
            </View>
          </View>;
        })}
        <View style={{ gap: 8, paddingTop: 8, borderTopWidth: 1, borderColor: colors.border }}>
          <Text style={{ color: colors.foreground, fontSize: 14, fontWeight: "600" }}>Add</Text>
          <Text style={note}>Assign plan help from the plan in Plans. Watch inputs go to the Supervisor of the plan they feed.</Text>
          <WatchSupervisorButton theme={theme} />
          {projects.data ? <ProjectSupervisorAdd theme={theme} compact={compact} data={projects.data} stale={projects.isError || projects.data.freshness === "held" || !!projectReadProblems(projects.data).length}
            onRead={() => { void projects.refetch(); void list.refetch(); }} /> : null}
        </View>
        <SupervisionActivationBoard theme={theme} compact={compact} advanced navigation={navigation} assignWatches={false} />
        <MaintenanceOwnershipBoard theme={theme} compact={compact} hostId={hostId} {...(navigation ? { navigation } : {})} onNavigate={() => setOpen(false)} advanced listed />
        <ProjectContextBoard theme={theme} compact={compact} hostId={hostId} {...(navigation ? { onOpenAgent: (agentId: string) => {
          navigation.openAgent({ agentId, ...(hostId === "local" ? {} : { serverId: hostId }) }); setOpen(false); } } : {})} />
      </View>
    </Modal.Content></Modal>
  </View>;
}
