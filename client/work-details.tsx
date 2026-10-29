/** Read-only entry to the existing captain-app controls. Opening this starts no work. */
import type { PluginTheme } from "@getpaseo/plugin";
import { useRpc, type PluginScreenProps } from "@getpaseo/plugin/client";
import { Icon, Modal } from "@getpaseo/plugin/client/react-native";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { ProjectRuntimeSnapshotSchema, readProjectRuntime } from "../shared/project-runtime";
import { MaintenanceRuntimeSnapshotSchema, readMaintenance } from "../shared/maintenance-runtime";
import { activationHasHistory, maintenanceHasHistory, projectHasHistory, projectSetupAvailable } from "./ownership-state";
import { projectReadProblems, projectSetupReadable, projectReadyToCreate } from "./project-readiness";
import { ProjectSetup } from "./project-setup";
import { ProjectOwnershipBoard } from "./project-ownership";
import { MaintenanceOwnershipBoard } from "./maintenance-ownership";
import { SupervisionActivationBoard } from "./supervision-activation";
import { useWorkflowPlans } from "./workflow-plans";

export function WorkDetails({ theme, compact, hostId = "local", navigation, always = false, showCount = true }: {
  theme: PluginTheme; compact: boolean; hostId?: string;
  navigation?: PluginScreenProps["navigation"]; always?: boolean; showCount?: boolean;
}) {
  const { activation, activationError, refreshActivation } = useWorkflowPlans();
  const readProjects = useRpc(readProjectRuntime), readChecks = useRpc(readMaintenance);
  const projects = useQuery({ queryKey: ["firstmate", "project-ownership", hostId],
    queryFn: async () => ProjectRuntimeSnapshotSchema.parse(await readProjects({})), refetchInterval: 5000 });
  const checks = useQuery({ queryKey: ["firstmate", "maintenance-ownership", hostId],
    queryFn: async () => MaintenanceRuntimeSnapshotSchema.parse(await readChecks({})), refetchInterval: 5000 });
  const [open, setOpen] = useState(false);
  const [setup, setSetup] = useState<string | null>(null);
  const identity = useRef({ hostId, project: projects.data?.homeId, checks: checks.data?.homeId, activation: activation?.homeId });
  useEffect(() => {
    const next = { hostId, project: projects.data?.homeId, checks: checks.data?.homeId, activation: activation?.homeId };
    // First successful metadata after a cold read error is recovery, not a home switch.
    const keys = ["project", "checks", "activation"] as const;
    const knownHomes = keys.map(key => identity.current[key]).filter(Boolean);
    if (identity.current.hostId !== hostId || keys.some(key =>
      next[key] && knownHomes.some(home => home !== next[key]))) { setOpen(false); setSetup(null); }
    identity.current = next;
  }, [hostId, projects.data?.homeId, checks.data?.homeId, activation?.homeId]);
  function refresh() {
    refreshActivation?.();
    void projects.refetch({ cancelRefetch: false });
    void checks.refetch({ cancelRefetch: false });
  }
  const available = projects.data && projectSetupReadable(projects.data, projects.isError) ? projects.data.projects.filter(p => projectSetupAvailable(p) || projectReadyToCreate(p)).length : 0;
  const problem = activationError || projects.isError || checks.isError || !!activation?.problems.length ||
    !!projects.data && !!projectReadProblems(projects.data).length || projects.data?.freshness === "held" ||
    !!checks.data?.problems.length || checks.data?.freshness === "held" ||
    !!checks.data?.incidents.length || checks.data?.owners.some(o => !!o.uncertain || o.state !== "active" || o.opening !== "succeeded") ||
    activation?.plans.some(p => !!p.resumeRequestId || !!p.opening && p.opening !== "succeeded" || !!p.binding && p.binding !== "active");
  const retained = activation && activationHasHistory(activation) || projects.data && projectHasHistory(projects.data) || checks.data && maintenanceHasHistory(checks.data);
  if (!always && !available && !retained && !problem) return null;
  return <View testID="work-details-entry" style={{ alignSelf: "flex-start", flexShrink: 0 }}>
    <Pressable accessibilityRole="button" accessibilityLabel={always ? "Advanced work details" : "Work details"} accessibilityState={{ expanded: open }}
      accessibilityHint={available ? `${available} ${available === 1 ? "project has" : "projects have"} a setup action` : "Saved project, plan and routine-check details"}
      onPress={() => { setOpen(true); refresh(); }} style={{ minHeight: 44, minWidth: 44, paddingHorizontal: 8, flexDirection: "row", alignItems: "center", gap: 6, justifyContent: "center", borderWidth: 1, borderRadius: 7, borderColor: theme.colors.border }}>
      {!compact || always ? <Icon name="SlidersHorizontal" size={15} color={theme.colors.foregroundMuted} /> : null}
      <Text style={{ color: theme.colors.foreground, fontSize: 13 }}>{always ? "Advanced work details" : compact ? "Details" : "Work details"}</Text>
      {available && showCount ? <View style={{ minWidth: 18, paddingHorizontal: 4, borderRadius: 9, backgroundColor: theme.colors.surface2, alignItems: "center" }}><Text style={{ color: theme.colors.foregroundMuted, fontSize: 11 }}>{available}</Text></View> : null}
    </Pressable>
    <Modal title="Work details" open={open} onOpenChange={setOpen}><Modal.Content>
      <View style={{ gap: 16 }}>
        <Text style={{ color: theme.colors.foregroundMuted }}>Saved project mates, plan help and routine checks. Advanced controls keep their existing reviews and limits.</Text>
        {projects.isPending || checks.isPending || !activation && !activationError ? <Text style={{ color: theme.colors.foregroundMuted }}>Loading saved work…</Text> : null}
        {activationError ? <Text accessibilityRole="alert" style={{ color: theme.colors.statusWarning }}>Plan help could not be refreshed. Refresh details to check again; actions remain unavailable.</Text> : null}
        {projects.isError ? <Text accessibilityRole="alert" style={{ color: theme.colors.statusWarning }}>Project details couldn't be loaded. Check this computer's connection, then use Refresh details to try again.</Text> : null}
        {checks.isError ? <Text accessibilityRole="alert" style={{ color: theme.colors.statusWarning }}>Routine-check details couldn't be loaded. Check this computer's connection, then use Refresh details to try again.</Text> : null}
        <Pressable accessibilityRole="button" accessibilityLabel="Refresh details"
          onPress={refresh} style={{ minHeight: 44, maxWidth: "100%", minWidth: 0, justifyContent: "center", padding: 10, borderWidth: 1, borderRadius: 7, borderColor: theme.colors.border }}>
          <Text style={{ color: theme.colors.foreground, flexShrink: 1 }}>Refresh details</Text>
        </Pressable>
        <SupervisionActivationBoard theme={theme} compact={compact} advanced />
        <ProjectOwnershipBoard theme={theme} compact={compact} hostId={hostId} {...(navigation ? { navigation } : {})} onNavigate={() => setOpen(false)}
          onSetup={project => { setOpen(false); setSetup(project.name); }} advanced />
        <MaintenanceOwnershipBoard theme={theme} compact={compact} hostId={hostId} {...(navigation ? { navigation } : {})} onNavigate={() => setOpen(false)} advanced />
        {!projects.isPending && !checks.isPending && activation && !problem && !available && !retained && !activation.enabled && !projects.data?.enabled && !checks.data?.enabled ?
          <Text style={{ color: theme.colors.foregroundMuted }}>No saved project mates, plan help or routine checks.</Text> : null}
      </View>
    </Modal.Content></Modal>
    {projects.data ? <ProjectSetup theme={theme} compact={compact} home={projects.data.homeId} hostId={hostId} open={setup !== null}
      {...(setup ? { initialProjectName: setup } : {})} {...(navigation ? { navigation } : {})} onClose={() => { setSetup(null); setOpen(true); refresh(); }} /> : null}
  </View>;
}
