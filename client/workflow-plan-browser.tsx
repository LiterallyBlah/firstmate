import type { PluginTheme } from "@getpaseo/plugin";
import { TextInput } from "@getpaseo/plugin/client/react-native";
import { useEffect, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import type { WorkflowPlan } from "../shared/workflow-plans";
import type { WorkflowSnapshot } from "../shared/workflow-rpc";
import { IconButton } from "./ui";
import { useWorkflowPlans } from "./workflow-plans";
import { dependencyText, PLAN_PAGE_SIZE, planBudgetUsed, planGroups, planStatus, runState } from "./workflow-plan-list";

export function WorkflowPlansView({ theme }: { theme: PluginTheme }) {
  const { snapshot, loading, error, refresh, open } = useWorkflowPlans();
  return <WorkflowPlanBrowser theme={theme} snapshot={snapshot} loading={loading} error={error} onRefresh={refresh} onOpen={open} />;
}

/** One shared RPC snapshot; browsing, folding and searching never record a captain action. */
export function WorkflowPlanBrowser({ theme, snapshot, loading, error, onRefresh, onOpen }: {
  theme: PluginTheme; snapshot: WorkflowSnapshot | undefined; loading: boolean; error: string | null;
  onRefresh(): void; onOpen(id: string): void;
}) {
  const [search, setSearch] = useState("");
  const groups = planGroups(snapshot?.plans ?? [], search), colors = theme.colors;
  const meta = { color: colors.foregroundMuted, fontSize: 12 };
  return <View testID="workflow-plans-view" style={{ flex: 1, minHeight: 0 }}>
    <View style={{ padding: 12, gap: 8, borderBottomWidth: 1, borderColor: colors.border }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        <Text accessibilityRole="header" style={{ color: colors.foreground, fontSize: 14, fontWeight: "600", flex: 1 }}>Plans</Text>
        <IconButton theme={theme} icon="RefreshCw" label="Refresh plans" onPress={onRefresh} />
      </View>
      <Text style={meta}>Open plans first. Automatic one-run plans are grouped separately; each group shows ten at a time.</Text>
      <TextInput accessibilityLabel="Search plans" placeholder="Search title, worker or host" value={search} onChangeText={setSearch}
        style={{ color: colors.foreground, fontSize: 13, padding: 8, minHeight: 36, borderWidth: 1, borderColor: colors.border, borderRadius: 7, backgroundColor: colors.surface1 }} />
    </View>
    <ScrollView contentContainerStyle={{ padding: 12, gap: 12 }}>
      {error ? <View style={{ gap: 6 }}><Text accessibilityRole="alert" style={{ color: colors.statusDanger, fontSize: 13 }}>Plans could not be refreshed. {error}</Text>
        {snapshot ? <Text style={meta}>Showing the last received plans. Open a plan to review freshness before acting.</Text> : null}</View> : null}
      {snapshot?.problems?.length ? <Text accessibilityRole="alert" style={{ color: colors.statusWarning, fontSize: 13 }}>Some plans are unavailable. This list is incomplete. {snapshot.problems.join(" ")}</Text> : null}
      {snapshot?.warnings?.map(warning => <Text key={warning} style={meta}>{warning}</Text>)}
      {!snapshot ? <Text style={meta}>{loading ? "Loading plans…" : error ? "Use Refresh plans to try again." : "Plans are unavailable."}</Text> :
        !snapshot.plans.length && !snapshot.problems?.length ? <Text style={meta}>No plans yet. Work started by the first mate will appear here.</Text> :
        !groups.open.length && !groups.finished.length && search.trim() ? <Text style={meta}>No plans match this search.</Text> : <>
          <PlanSection key={`open:${search}`} title="Open plans" plans={groups.open} allPlans={snapshot.plans} theme={theme} onOpen={onOpen} searching={!!search.trim()} />
          <PlanSection key={`finished:${search}`} title="Recently finished" plans={groups.finished} allPlans={snapshot.plans} theme={theme} onOpen={onOpen} searching={!!search.trim()} />
        </>}
    </ScrollView>
  </View>;
}

function PlanSection({ title, plans, ...props }: { title: string; plans: WorkflowPlan[]; allPlans: readonly WorkflowPlan[]; theme: PluginTheme; onOpen(id: string): void; searching: boolean }) {
  if (!plans.length) return null;
  return <View style={{ gap: 8 }}>
    <Text accessibilityRole="header" style={{ color: props.theme.colors.foreground, fontSize: 13, fontWeight: "600" }}>{title} · {plans.length}</Text>
    <PlanGroup {...props} plans={plans.filter(p => !p.definition.implicit)} automatic={false} />
    <PlanGroup {...props} plans={plans.filter(p => p.definition.implicit)} automatic />
  </View>;
}

function PlanGroup({ plans, allPlans, theme, onOpen, automatic, searching }: {
  plans: WorkflowPlan[]; allPlans: readonly WorkflowPlan[]; theme: PluginTheme; onOpen(id: string): void; automatic: boolean; searching: boolean;
}) {
  const awaitingReview = plans.some(p => p.status === "review");
  const [expanded, setExpanded] = useState(!automatic || searching || awaitingReview);
  useEffect(() => { if (awaitingReview) setExpanded(true); }, [awaitingReview]);
  const [limit, setLimit] = useState(PLAN_PAGE_SIZE);
  if (!plans.length) return null;
  return <View style={{ gap: 6 }}>
    {automatic ? <Pressable accessibilityRole="button" accessibilityLabel={`Automatic one-run plans (${plans.length})`} accessibilityState={{ expanded }} onPress={() => setExpanded(v => !v)}
      style={{ padding: 10, borderRadius: 7, borderWidth: 1, borderColor: theme.colors.border, backgroundColor: theme.colors.surface1 }}>
      <Text style={{ color: theme.colors.foregroundMuted, fontSize: 12 }}>{expanded ? "▾" : "▸"} Automatic one-run plans · {plans.length}</Text>
    </Pressable> : null}
    {expanded ? <>
      {plans.slice(0, limit).map(plan => <PlanRow key={plan.definition.id} plan={plan} plans={allPlans} theme={theme} onOpen={onOpen} />)}
      {limit < plans.length ? <IconButton theme={theme} icon="ChevronDown" label={`Show ${Math.min(PLAN_PAGE_SIZE, plans.length - limit)} more plans (${plans.length - limit} remaining)`} showLabel onPress={() => setLimit(n => n + PLAN_PAGE_SIZE)} /> : null}
    </> : null}
  </View>;
}

function PlanRow({ plan, plans, theme, onOpen }: { plan: WorkflowPlan; plans: readonly WorkflowPlan[]; theme: PluginTheme; onOpen(id: string): void }) {
  const colors = theme.colors, used = planBudgetUsed(plan);
  const meta = { color: colors.foregroundMuted, fontSize: 12 };
  return <View testID={`workflow-plan-${plan.definition.id}`} style={{ gap: 6, padding: 10, borderWidth: 1, borderColor: colors.border, borderRadius: 8, backgroundColor: colors.surface1 }}>
    <Pressable accessibilityRole="button" accessibilityLabel={`Open plan: ${plan.definition.title}`} onPress={() => onOpen(plan.definition.id)} style={{ gap: 3, paddingVertical: 3 }}>
      <Text style={{ color: colors.foreground, fontSize: 13, fontWeight: "600" }}>{plan.definition.title} ›</Text>
      <Text style={meta}>{planStatus(plan)} · Posture: {plan.posture === "review" ? "Review before starting" : "Sail within approved work"}</Text>
    </Pressable>
    <Text style={meta}>Budget used / approved: {used.agents} / {plan.approvedBudget.agents} workers · {used.turns} / {plan.approvedBudget.turns} turns</Text>
    {plan.definition.nodes.map(node => {
      const state = plan.nodes[node.id], launch = state?.launch ?? (node.kind === "run" ? node.launch : null);
      return <View key={node.id} style={{ gap: 3, paddingTop: 5, borderTopWidth: 1, borderColor: colors.border }}>
        <Text style={{ color: colors.foreground, fontSize: 12 }}>
          {node.title} · {node.kind === "run" ? runState(state) : state?.answer ? "answered" : "decision"}{state?.held ? " · held" : ""}
        </Text>
        {launch ? <Text selectable style={meta}>Worker: {launch.agentTitle}{state?.agentId ? ` (${state.agentId})` : " · unassigned"} · Host: {launch.host === "local" ? "This machine" : launch.host}</Text> : null}
        {node.after.map(edge => <Text key={edge.node} style={meta}>After {dependencyText(edge, plans)}</Text>)}
        {node.kind === "decision" ? <>
          {node.options.map(option => <Text key={option.id} style={meta}>{option.id === state?.answer ? "Chosen: " : option.id === node.recommendation ? "Recommended: " : "Option: "}{option.label} — {option.consequence}</Text>)}
          <Text style={meta}>Recommendation: {node.options.find(o => o.id === node.recommendation)?.label ?? "None yet"} · {node.rationale}</Text>
        </> : null}
      </View>;
    })}
  </View>;
}
