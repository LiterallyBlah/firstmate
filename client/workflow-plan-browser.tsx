import type { PluginTheme } from "@getpaseo/plugin";
import { TextInput } from "@getpaseo/plugin/client/react-native";
import { useEffect, useId, useRef, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import type { PlanNode, WorkflowPlan } from "../shared/workflow-plans";
import type { WorkflowSnapshot } from "../shared/workflow-rpc";
import { IconButton, Segmented } from "./ui";
import { WorkflowPlanGraph } from "./workflow-plan-graph-view";
import { webAttributes } from "./web";
import { useWorkflowPlans } from "./workflow-plans";
import { PLAN_PAGE_SIZE, planBudgetUsed, planGroups, planStatus, planSteps, planSummary, reviewLabel, reviewStatus, stepState } from "./workflow-plan-list";
import { updatePlanBrowse, usePlanBrowse, type PlanBrowseState } from "./workflow-plan-state";
import { WorkflowTaskActions } from "./workflow-task-actions";
import { planOwner } from "../shared/workflow-plans";

export function WorkflowPlansView({ theme, showHeading = true, compact = false }: { theme: PluginTheme; showHeading?: boolean; compact?: boolean }) {
  const { snapshot, loading, error, refresh, open, scope } = useWorkflowPlans();
  return <WorkflowPlanBrowser key={scope} theme={theme} sessionKey={scope} snapshot={snapshot} loading={loading} error={error} onRefresh={refresh} onOpen={open} showHeading={showHeading} compact={compact} />;
}

/** One shared RPC snapshot; browsing, folding and searching never record a captain action. */
export function WorkflowPlanBrowser({ theme, snapshot, loading, error, onRefresh, onOpen, sessionKey, showHeading = true, compact = false }: {
  theme: PluginTheme; snapshot: WorkflowSnapshot | undefined; loading: boolean; error: string | null;
  onRefresh(): void; onOpen(id: string): void; showHeading?: boolean; compact?: boolean;
  sessionKey?: string | null | undefined;
}) {
  const localKey = useId(), key = sessionKey ?? localKey;
  const browse = usePlanBrowse(key, value => value), { search, view } = browse;
  const setSearch = (search: string) => updatePlanBrowse(key, { search, scrollY: 0 });
  const setView = (view: "graph" | "list") => updatePlanBrowse(key, { view });
  const [showHelp] = useState(!browse.helpSeen);
  useEffect(() => { if (snapshot?.plans.length) updatePlanBrowse(key, { helpSeen: true }); }, [key, !!snapshot?.plans.length]);
  const scroller = useRef<ScrollView>(null), restored = useRef(false);
  const state = { sessionKey: key, browse };
  const groups = planGroups(snapshot?.plans ?? [], search), colors = theme.colors;
  const meta = { color: colors.foregroundMuted, fontSize: 12 };
  return <View testID="workflow-plans-view" style={{ flex: 1, minHeight: 0 }}>
    <View style={{ padding: 12, gap: 8, borderBottomWidth: 1, borderColor: colors.border }}>
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "flex-end", gap: 8 }}>
        {showHeading ? <Text accessibilityRole="header" {...webAttributes({ "aria-level": "2" })} style={{ color: colors.foreground, fontSize: 14, fontWeight: "600", flex: 1 }}>Plans</Text> : null}
        <Segmented theme={theme} compact={compact} value={view} options={[{ value: "graph", label: "Graph" }, { value: "list", label: "List" }]} onChange={setView} />
        {showHeading ? <IconButton theme={theme} compact={compact} icon="RefreshCw" label="Refresh plans" onPress={onRefresh} /> : null}
      </View>
      {showHelp && snapshot?.plans.length ? <Text style={meta}>Expand a plan for its steps, or open it to make a decision.</Text> : null}
      <TextInput accessibilityLabel="Search plans" placeholder="Search title, worker or host" value={search} onChangeText={setSearch}
        style={{ color: colors.foreground, fontSize: 13, padding: 8, minHeight: 36, borderWidth: 1, borderColor: colors.border, borderRadius: 7, backgroundColor: colors.surface1 }} />
    </View>
    <ScrollView ref={scroller} contentOffset={{ x: 0, y: browse.scrollY }} scrollEventThrottle={100}
      onContentSizeChange={() => { if (!restored.current) { scroller.current?.scrollTo({ y: browse.scrollY, animated: false }); restored.current = true; } }}
      onScroll={event => { if (restored.current) updatePlanBrowse(key, { scrollY: event.nativeEvent.contentOffset.y }); }}
      contentContainerStyle={{ padding: 12, gap: 12 }}>
      {error ? <View style={{ gap: 6 }}><Text accessibilityRole="alert" style={{ color: colors.statusDanger, fontSize: 13 }}>Plans could not be refreshed. {error}</Text>
        {snapshot ? <Text style={meta}>Showing the last received plans. Open a plan to review freshness before acting.</Text> : null}</View> : null}
      {snapshot?.problems?.length ? <Text accessibilityRole="alert" style={{ color: colors.statusWarning, fontSize: 13 }}>Some plans are unavailable. This list is incomplete. {snapshot.problems.join(" ")}</Text> : null}
      {snapshot?.warnings?.map(warning => <Text key={warning} style={meta}>{warning}</Text>)}
      {!snapshot ? <Text style={meta}>{loading ? "Loading plans…" : error ? `Use ${showHeading ? "Refresh plans" : "Refresh"} to try again.` : "Plans are unavailable."}</Text> :
        !snapshot.plans.length && !snapshot.problems?.length ? <Text style={meta}>No plans yet. Work started by the first mate will appear here.</Text> :
        !groups.open.length && !groups.finished.length && search.trim() ? <Text style={meta}>No plans match this search.</Text> : <>
          <PlanSection {...state} level={showHeading ? "3" : "2"} section="open" title="Open plans" plans={groups.open} allPlans={snapshot.plans} theme={theme} onOpen={onOpen} searching={!!search.trim()} view={view} onList={() => setView("list")} />
          <PlanSection {...state} level={showHeading ? "3" : "2"} section="finished" title="Recently finished" plans={groups.finished} allPlans={snapshot.plans} theme={theme} onOpen={onOpen} searching={!!search.trim()} view={view} onList={() => setView("list")} />
        </>}
    </ScrollView>
  </View>;
}

type StepView = { view: "graph" | "list"; onList(): void; sessionKey: string; browse: PlanBrowseState };
function PlanSection({ title, level, plans, section, ...props }: { title: string; level: string; section: string; plans: WorkflowPlan[]; allPlans: readonly WorkflowPlan[]; theme: PluginTheme; onOpen(id: string): void; searching: boolean } & StepView) {
  if (!plans.length) return null;
  return <View style={{ gap: 8 }}>
    <Text accessibilityRole="header" {...webAttributes({ "aria-level": level })} style={{ color: props.theme.colors.foreground, fontSize: 13, fontWeight: "600" }}>{title} · {plans.length}</Text>
    <PlanGroup {...props} group={`${section}:explicit`} plans={plans.filter(p => !p.definition.implicit)} automatic={false} />
    <PlanGroup {...props} group={`${section}:automatic`} plans={plans.filter(p => p.definition.implicit)} automatic />
  </View>;
}

function PlanGroup({ plans, allPlans, theme, onOpen, automatic, searching, view, onList, sessionKey, browse, group }: {
  plans: WorkflowPlan[]; allPlans: readonly WorkflowPlan[]; theme: PluginTheme; onOpen(id: string): void; automatic: boolean; searching: boolean; group: string;
} & StepView) {
  const awaitingReview = plans.some(p => p.status === "review");
  const groupKey = `${group}:${browse.search}`;
  const expanded = !automatic || (browse.groups[groupKey] ?? (searching || awaitingReview));
  useEffect(() => { if (automatic && awaitingReview) updatePlanBrowse(sessionKey, state => ({ groups: { ...state.groups, [groupKey]: true } })); }, [automatic, awaitingReview, groupKey, sessionKey]);
  const limit = browse.limits[groupKey] ?? PLAN_PAGE_SIZE;
  if (!plans.length) return null;
  return <View style={{ gap: 6 }}>
    {automatic ? <Pressable accessibilityRole="button" accessibilityLabel={`Automatic one-run plans (${plans.length})`} accessibilityState={{ expanded }} onPress={() => updatePlanBrowse(sessionKey, state => ({ groups: { ...state.groups, [groupKey]: !expanded } }))}
      style={{ padding: 10, borderRadius: 7, borderWidth: 1, borderColor: theme.colors.border, backgroundColor: theme.colors.surface1 }}>
      <Text style={{ color: theme.colors.foregroundMuted, fontSize: 12 }}>{expanded ? "▾" : "▸"} Automatic one-run plans · {plans.length}</Text>
    </Pressable> : null}
    {expanded ? <>
      {plans.slice(0, limit).map(plan => <PlanRow key={plan.definition.id} plan={plan} plans={allPlans} theme={theme} onOpen={onOpen} view={view} onList={onList} sessionKey={sessionKey} browse={browse} />)}
      {limit < plans.length ? <IconButton theme={theme} icon="ChevronDown" label={`Show ${Math.min(PLAN_PAGE_SIZE, plans.length - limit)} more plans (${plans.length - limit} remaining)`} showLabel onPress={() => updatePlanBrowse(sessionKey, state => ({ limits: { ...state.limits, [groupKey]: limit + PLAN_PAGE_SIZE } }))} /> : null}
    </> : null}
  </View>;
}

function PlanRow({ plan, plans, theme, onOpen, view, onList, sessionKey, browse }: { plan: WorkflowPlan; plans: readonly WorkflowPlan[]; theme: PluginTheme; onOpen(id: string): void } & StepView) {
  const expanded = browse.expanded[plan.definition.id] ?? false;
  const colors = theme.colors, used = planBudgetUsed(plan), delegated = planOwner(plan) === "firstmate";
  const budgetLabel = delegated ? "Budget used / cumulative cap: " : "Budget used / approved: ";
  const summary = planSummary(plan, plans);
  const meta = { color: colors.foregroundMuted, fontSize: 12 };
  return <View testID={`workflow-plan-${plan.definition.id}`} style={{ gap: 6, padding: 10, borderWidth: 1, borderColor: colors.border, borderRadius: 8, backgroundColor: colors.surface1 }}>
    <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
      <Pressable accessibilityRole="button" accessibilityLabel={`Open plan: ${plan.definition.title}`} onPress={() => onOpen(plan.definition.id)} style={{ flex: 1, gap: 3, paddingVertical: 3 }}>
        <Text style={{ color: colors.foreground, fontSize: 13, fontWeight: "600" }}>{plan.definition.title} ›</Text>
        <Text style={meta}>{planStatus(plan)} · {summary.progress} · Owner: {planOwner(plan) === "firstmate" ? "FirstMate" : "Captain"}</Text>
      </Pressable>
      <IconButton theme={theme} icon={expanded ? "ChevronUp" : "ChevronDown"} label={`${expanded ? "Collapse" : "Expand"} plan: ${plan.definition.title}`}
        onPress={() => updatePlanBrowse(sessionKey, state => ({ expanded: { ...state.expanded, [plan.definition.id]: !expanded } }))} />
    </View>
    {!expanded ? <Text style={meta}>Running: {summary.running}</Text> : null}
    {summary.attention ? <Text style={{ ...meta, color: colors.statusWarning }}>Attention: {summary.attention}</Text> : null}
    {!expanded ? <Text style={meta}>Next: {summary.next}</Text> : null}
    {summary.decisions ? <Text style={{ ...meta, color: colors.foreground }}>Captain: {summary.decisions}</Text> : null}
    {expanded ? <>
      {view === "graph" ? <WorkflowPlanGraph sessionKey={sessionKey} plan={plan} plans={plans} theme={theme} onOpen={onOpen} onList={onList} /> : planSteps(plan).map(({ node, reviews }) => <View key={node.id} testID={`workflow-step-${node.id}`} style={{ gap: 5, paddingTop: 8, borderTopWidth: 1, borderColor: colors.border }}>
        <Text style={{ color: colors.foreground, fontSize: 12 }}>{node.title} · {stepState(plan, node, plans)}</Text>
        <RunningDetails plan={plan} node={node} theme={theme} />
        <WorkflowTaskActions plan={plan} node={node} theme={theme} />
        {reviews.length ? <View style={{ flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 5 }}>
          <Text style={meta}>Reviews:</Text>
          {reviews.map(review => <Text key={review.id} accessibilityLabel={`${reviewLabel(review, plan.nodes[review.id])} review: ${stepState(plan, review, plans)}`}
            style={{ ...meta, paddingHorizontal: 6, paddingVertical: 3, borderWidth: 1, borderColor: colors.border, borderRadius: 6 }}>
            {reviewLabel(review, plan.nodes[review.id])} {reviewStatus(plan, review, plans)}
          </Text>)}
        </View> : null}
        {reviews.filter(review => plan.nodes[review.id]?.state === "running").map(review => <View key={review.id} style={{ gap: 5 }}><RunningDetails plan={plan} node={review} theme={theme} /><WorkflowTaskActions plan={plan} node={review} theme={theme} /></View>)}
        {node.kind === "decision" ? <Text style={meta}>{plan.nodes[node.id]?.answer ? "Chosen" : "Recommended"}: {node.options.find(o => o.id === (plan.nodes[node.id]?.answer ?? node.recommendation))?.label ?? "None yet"}</Text> : null}
      </View>)}
      <Text style={meta}>Running: {summary.running}</Text>
      <Text style={meta}>Next: {summary.next}</Text>
      <Text style={meta}>Posture: {plan.posture === "review" ? "Review before starting" : delegated ? "Sail within delegated work" : "Sail within approved work"} · {budgetLabel}{used.agents} / {delegated ? plan.definition.budget.agents : plan.approvedBudget.agents} workers · {used.turns} / {delegated ? plan.definition.budget.turns : plan.approvedBudget.turns} turns</Text>
    </> : null}
  </View>;
}

function RunningDetails({ plan, node, theme }: { plan: WorkflowPlan; node: PlanNode; theme: PluginTheme }) {
  const state = plan.nodes[node.id];
  if (node.kind !== "run" || state?.state !== "running") return null;
  const launch = state.launch ?? node.launch;
  return <Text selectable style={{ color: theme.colors.foregroundMuted, fontSize: 12 }}>
    Worker: {launch.agentTitle}{state.agentId ? ` (${state.agentId})` : ""} · Host: {launch.host === "local" ? "This machine" : launch.host}
  </Text>;
}
