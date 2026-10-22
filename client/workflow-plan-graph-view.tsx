import type { PluginTheme } from "@getpaseo/plugin";
import { Modal } from "@getpaseo/plugin/client/react-native";
import { useEffect, useMemo, useRef, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import type { WorkflowPlan } from "../shared/workflow-plans";
import { dependencyText, stepState } from "../shared/workflow-plan-summary";
import { IconButton } from "./ui";
import { GRAPH_CARD, planGraph, type GraphEdge } from "./workflow-plan-graph";

const reasons = ["builds-on", "needs-evidence", "decision", "shared-state"] as const;
type Reason = typeof reasons[number];
function edgeInk(reason: Reason, theme: PluginTheme) {
  return { "builds-on": theme.colors.foregroundMuted, "needs-evidence": theme.colors.statusSuccess,
    decision: theme.colors.statusWarning, "shared-state": theme.colors.foreground }[reason];
}
function edgeStyle(reason: Reason): "solid" | "dashed" | "dotted" {
  return reason === "needs-evidence" ? "dashed" : reason === "shared-state" ? "dotted" : "solid";
}
function stateInk(state: string, theme: PluginTheme) {
  return ["failed", "cancelled"].includes(state) ? theme.colors.statusDanger :
    ["on hold", "uncertain", "waiting for your decision", "awaiting plan approval"].includes(state) ? theme.colors.statusWarning :
    ["landed", "done", "answered", "closed without landing"].includes(state) ? theme.colors.statusSuccess : theme.colors.foreground;
}

/** Native primitives only: orthogonal connectors and arrows need no graph/SVG runtime. */
function Edge({ edge, theme, active, dim }: { edge: GraphEdge; theme: PluginTheme; active: boolean; dim: boolean }) {
  const color = edgeInk(edge.reason, theme), end = edge.points.at(-1)!;
  return <View testID={`workflow-edge-${edge.node}-${edge.to}`} pointerEvents="none" accessible={false} style={{ position: "absolute", top: 0, left: 0, opacity: dim ? 0.2 : active ? 1 : 0.65 }}>
    {edge.points.slice(1).map((point, i) => {
      const previous = edge.points[i]!, vertical = previous.x === point.x;
      return <View key={i} style={{ position: "absolute", left: Math.min(previous.x, point.x), top: Math.min(previous.y, point.y),
        width: vertical ? 0 : Math.abs(point.x - previous.x), height: vertical ? Math.abs(point.y - previous.y) : 0,
        borderLeftWidth: vertical ? active ? 2 : 1 : 0, borderTopWidth: vertical ? 0 : active ? 2 : 1,
        borderColor: color, borderStyle: edgeStyle(edge.reason) }} />;
    })}
    <View style={{ position: "absolute", left: end.x - 4, top: end.y - 8, width: 8, height: 8,
      borderRightWidth: 2, borderBottomWidth: 2, borderColor: color, transform: [{ rotate: "45deg" }] }} />
  </View>;
}

export function WorkflowPlanGraph({ plan, plans, theme, onOpen, onList }: {
  plan: WorkflowPlan; plans: readonly WorkflowPlan[]; theme: PluginTheme; onOpen(id: string): void; onList(): void;
}) {
  const graph = useMemo(() => planGraph(plan, plans), [plan, plans]);
  const scroller = useRef<ScrollView>(null), [viewportWidth, setViewportWidth] = useState(0);
  useEffect(() => { scroller.current?.scrollTo({ x: Math.max(0, (graph.width - viewportWidth) / 2), animated: false }); }, [graph.width, viewportWidth]);
  const [selected, setSelected] = useState<string | null>(null), [details, setDetails] = useState(false);
  const current = graph.nodes.find(n => n.id === selected);
  const colors = theme.colors, meta = { color: colors.foregroundMuted, fontSize: 12 };
  if (graph.problem) return <View style={{ gap: 8 }}>
    <Text style={meta}>{graph.problem} Use List to see all steps.</Text>
    <IconButton theme={theme} icon="List" label="Show steps as list" showLabel onPress={onList} />
  </View>;
  return <View testID={`workflow-graph-${plan.definition.id}`} style={{ gap: 8 }}>
    <Text style={meta}>Prerequisites ↓ dependents. {graph.incomplete ? "Steps are arranged by dependency depth." : "Steps in the same level can run in parallel when prerequisites and approval allow."} Select a step for details; scroll sideways for wider levels.</Text>
    {graph.incomplete ? <Text style={{ ...meta, color: colors.statusWarning }}>Some prerequisites are unavailable. Parallelism cannot be confirmed from this snapshot.</Text> : null}
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 12 }}>
      {reasons.map(reason => <View key={reason} style={{ flexDirection: "row", alignItems: "center", gap: 5 }}>
        <View style={{ width: 18, borderTopWidth: 2, borderColor: edgeInk(reason, theme), borderStyle: edgeStyle(reason) }} />
        <Text style={meta}>{reason}</Text>
      </View>)}
    </View>
    <ScrollView ref={scroller} horizontal nestedScrollEnabled onLayout={event => setViewportWidth(event.nativeEvent.layout.width)}
      accessibilityLabel={`Dependency graph: ${plan.definition.title}`} contentContainerStyle={{ flexGrow: 1 }}>
      <View testID={`workflow-graph-canvas-${plan.definition.id}`} style={{ width: graph.width, height: graph.height, marginHorizontal: "auto" }}>
        {graph.levels.map((level, i) => <Text key={i} style={{ ...meta, position: "absolute", zIndex: 1, backgroundColor: colors.surface1, paddingRight: 6,
          top: i * GRAPH_CARD.stage + 6, left: Math.max(0, (graph.width - viewportWidth) / 2) }}>
          Level {i + 1}{level.length > 1 && !graph.incomplete ? ` · ${level.length} can run in parallel` : ""}
        </Text>)}
        {[...graph.edges].sort((a, b) => Number(a.node === selected || a.to === selected) - Number(b.node === selected || b.to === selected)).map(edge =>
          <Edge key={`${edge.node}:${edge.to}`} edge={edge} theme={theme} active={edge.node === selected || edge.to === selected} dim={!!selected && edge.node !== selected && edge.to !== selected} />)}
        {graph.nodes.map(entry => {
          const state = entry.node && entry.plan ? stepState(entry.plan, entry.node, plans) : "unavailable";
          const kind = !entry.node ? "Prerequisite" : entry.node.kind === "decision" ? "Decision" : entry.node.launch.kind === "scout" ? "Scout / review" : "Build";
          return <Pressable key={entry.id} testID={`workflow-node-${entry.id}`} accessibilityRole="button"
            accessibilityLabel={`Step: ${entry.title} · ${state}`} accessibilityHint="Show step details and dependencies"
            accessibilityState={{ selected: selected === entry.id }} onPress={() => { setSelected(entry.id); setDetails(true); }}
            style={{ position: "absolute", left: entry.x, top: entry.y, width: GRAPH_CARD.width, height: GRAPH_CARD.height, gap: 5, padding: 10,
              borderWidth: selected === entry.id ? 2 : 1, borderColor: selected === entry.id ? colors.accent : colors.border, borderRadius: 8, backgroundColor: colors.surface0 }}>
            <Text numberOfLines={1} style={meta}>{kind}{entry.external ? " · Other plan" : ""} ›</Text>
            <Text numberOfLines={3} style={{ color: colors.foreground, fontSize: 12, lineHeight: 16, fontWeight: "600", flex: 1 }}>{entry.title}</Text>
            <Text numberOfLines={1} style={{ color: stateInk(state, theme), fontSize: 12 }}>{state}</Text>
          </Pressable>;
        })}
      </View>
    </ScrollView>
    <Modal title={current?.title ?? "Step details"} open={details && !!current} onOpenChange={setDetails}>
      <Modal.Content>
        {current?.node && current.plan ? <View style={{ gap: 10 }}>
          <Text style={{ color: stateInk(stepState(current.plan, current.node, plans), theme), fontSize: 13 }}>{stepState(current.plan, current.node, plans)}</Text>
          <Text selectable style={{ color: colors.foreground, fontSize: 13 }}>{current.node.summary}</Text>
          {current.external ? <Text style={meta}>From plan: {current.plan.definition.title}</Text> : null}
          {current.node.kind === "run" && current.plan.nodes[current.id]?.state === "running" ? <Text selectable style={meta}>
            Worker: {(current.plan.nodes[current.id]?.launch ?? current.node.launch).agentTitle} {current.plan.nodes[current.id]?.agentId ?? ""} · Host: {(current.plan.nodes[current.id]?.launch ?? current.node.launch).host}
          </Text> : null}
          {current.node.kind === "decision" ? <Text style={meta}>
            {current.plan.nodes[current.id]?.answer ? "Chosen" : "Recommended"}: {current.node.options.find(o => o.id === (current.plan!.nodes[current.id]?.answer ?? (current.node?.kind === "decision" ? current.node.recommendation : null)))?.label ?? "None yet"}
          </Text> : null}
          <Text style={{ color: colors.foreground, fontSize: 12, fontWeight: "600" }}>Prerequisites</Text>
          {current.node.after.length ? current.node.after.map(edge => <Text key={edge.node} style={meta}>{edge.reason}: {dependencyText(edge, [current.plan!, ...plans])}</Text>) : <Text style={meta}>No prerequisites.</Text>}
          <IconButton theme={theme} icon="ExternalLink" label="Open plan details" showLabel onPress={() => { setDetails(false); onOpen(current.plan!.definition.id); }} />
        </View> : <Text style={meta}>This prerequisite is unavailable in the current snapshot. Open the plan for its recorded dependencies.</Text>}
      </Modal.Content>
    </Modal>
  </View>;
}
