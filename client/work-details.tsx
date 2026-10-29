/** Read-only entry to the existing captain-app controls. Opening this starts no work. */
import type { PluginTheme } from "@getpaseo/plugin";
import { useRpc, type PluginScreenProps } from "@getpaseo/plugin/client";
import { Modal } from "@getpaseo/plugin/client/react-native";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { ProjectRuntimeSnapshotSchema, readProjectRuntime } from "../shared/project-runtime";
import { MaintenanceRuntimeSnapshotSchema, readMaintenance } from "../shared/maintenance-runtime";
import { activationHasHistory, maintenanceHasHistory, projectHasHistory, projectHasProblem, projectSetupAvailable } from "./ownership-state";
import { ProjectOwnershipBoard } from "./project-ownership";
import { MaintenanceOwnershipBoard } from "./maintenance-ownership";
import { SupervisionActivationBoard } from "./supervision-activation";
import { useWorkflowPlans } from "./workflow-plans";

export function WorkDetails({ theme, compact, hostId = "local", navigation, always = false }: {
  theme: PluginTheme; compact: boolean; hostId?: string;
  navigation?: PluginScreenProps["navigation"]; always?: boolean;
}) {
  const { activation, activationError } = useWorkflowPlans();
  const readProjects = useRpc(readProjectRuntime), readChecks = useRpc(readMaintenance);
  const projects = useQuery({ queryKey: ["firstmate", "project-ownership", hostId],
    queryFn: async () => ProjectRuntimeSnapshotSchema.parse(await readProjects({})), refetchInterval: 5000 });
  const checks = useQuery({ queryKey: ["firstmate", "maintenance-ownership", hostId],
    queryFn: async () => MaintenanceRuntimeSnapshotSchema.parse(await readChecks({})), refetchInterval: 5000 });
  const [open, setOpen] = useState(false);
  useEffect(() => { setOpen(false); }, [hostId, projects.data?.homeId, checks.data?.homeId, activation?.homeId]);
  const available = projects.data?.projects.filter(projectSetupAvailable).length ?? 0;
  const problem = activationError || projects.isError || checks.isError || !!activation?.problems.length ||
    !!projects.data?.problems.length || projects.data?.freshness === "held" || projects.data?.projects.some(projectHasProblem) ||
    !!checks.data?.problems.length || checks.data?.freshness === "held" ||
    !!checks.data?.incidents.length || checks.data?.owners.some(o => !!o.uncertain || o.state !== "active" || o.opening !== "succeeded") ||
    activation?.plans.some(p => !!p.resumeRequestId || !!p.opening && p.opening !== "succeeded" || !!p.binding && p.binding !== "active");
  const retained = activation && activationHasHistory(activation) || projects.data && projectHasHistory(projects.data) || checks.data && maintenanceHasHistory(checks.data);
  if (!always && !available && !retained && !problem) return null;
  return <View testID="work-details-entry" style={{ paddingHorizontal: compact ? 12 : 16, borderTopWidth: always ? 0 : 1, borderColor: theme.colors.border }}>
    <Pressable accessibilityRole="button" accessibilityLabel={always ? "Advanced work details" : "Work details"} accessibilityState={{ expanded: open }}
      onPress={() => setOpen(true)} style={{ minHeight: 44, paddingVertical: 10, gap: 4, justifyContent: "center" }}>
      <Text style={{ color: theme.colors.foreground, fontSize: 13 }}>{always ? "Advanced work details" : "Work details"}</Text>
      {problem ? <Text accessibilityRole="alert" style={{ color: theme.colors.statusWarning, fontSize: 13 }}>Some work couldn't be checked. Review details before continuing.</Text> : null}
      {available ? <Text style={{ color: theme.colors.foregroundMuted, fontSize: 13 }}>{available} {available === 1 ? "project available" : "projects available"} to set up</Text> : null}
    </Pressable>
    <Modal title="Work details" open={open} onOpenChange={setOpen}><Modal.Content>
      <View style={{ gap: 16 }}>
        <Text style={{ color: theme.colors.foregroundMuted }}>Saved project mates, plan help and routine checks. Advanced controls keep their existing reviews and limits.</Text>
        {projects.isPending || checks.isPending || !activation && !activationError ? <Text style={{ color: theme.colors.foregroundMuted }}>Loading saved work…</Text> : null}
        {activationError ? <Text accessibilityRole="alert" style={{ color: theme.colors.statusWarning }}>Plan help could not be refreshed. Close and reopen details to check again; actions remain unavailable.</Text> : null}
        <SupervisionActivationBoard theme={theme} compact={compact} advanced />
        <ProjectOwnershipBoard theme={theme} compact={compact} hostId={hostId} {...(navigation ? { navigation } : {})} advanced />
        <MaintenanceOwnershipBoard theme={theme} compact={compact} hostId={hostId} {...(navigation ? { navigation } : {})} advanced />
        {!projects.isPending && !checks.isPending && activation && !problem && !available && !retained && !activation.enabled && !projects.data?.enabled && !checks.data?.enabled ?
          <Text style={{ color: theme.colors.foregroundMuted }}>No saved project mates, plan help or routine checks.</Text> : null}
      </View>
    </Modal.Content></Modal>
  </View>;
}
