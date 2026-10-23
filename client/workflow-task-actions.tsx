import type { PluginTheme } from "@getpaseo/plugin";
import { Text, View } from "react-native";
import type { PlanNode, WorkflowPlan } from "../shared/workflow-plans";
import { IconButton } from "./ui";
import { useWorkflowPlans } from "./workflow-plans";
import { workflowTaskTarget } from "./workflow-task-navigation";

/** Read-only links shared by graph details, List steps and the plan dialog. */
export function WorkflowTaskActions({ plan, node, theme, onNavigate, disabled = false }: {
  plan: WorkflowPlan; node: PlanNode; theme: PluginTheme; onNavigate?(): void; disabled?: boolean;
}) {
  const context = useWorkflowPlans();
  if (node.kind !== "run") return null;
  const target = workflowTaskTarget(plan, node, context.fleet?.cards ?? []);
  // Unstarted/unavailable steps do not need repetitive worker absence prose.
  if (!target.card && plan.nodes[node.id]?.state !== "running" && !plan.nodes[node.id]?.agentId) return null;
  const unavailable = context.fleetOffline || context.error ? "The fleet or plan could not be refreshed. Refresh before following this step." :
    !context.canNavigate ? "Task navigation is unavailable until this home and its first mate are connected." : null;
  const explanation = unavailable ?? (plan.nodes[node.id]?.state === "running" || plan.nodes[node.id]?.agentId ? target.explanation : null);
  function follow(converse: boolean) {
    if (!target.card || !context.scope || unavailable || disabled || (converse && !target.worker)) return;
    onNavigate?.();
    context.navigate?.({ scope: context.scope, plan: plan.definition.id, node: node.id, card: target.card.key, ...(converse && target.worker ? { worker: target.worker } : {}) });
  }
  return <View style={{ gap: 5 }}>
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
      {target.card ? <IconButton theme={theme} icon="ListTodo" label="Show task" showLabel disabled={disabled || !!unavailable} onPress={() => follow(false)} /> : null}
      {target.worker ? <IconButton theme={theme} icon="MessagesSquare" label="Converse" showLabel disabled={disabled || !!unavailable} onPress={() => follow(true)} /> : null}
    </View>
    {explanation ? <Text style={{ color: theme.colors.foregroundMuted, fontSize: 12 }}>{explanation}</Text> : null}
  </View>;
}
