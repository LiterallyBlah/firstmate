/** Registered workspace panels in a synthetic host shell. No daemon or native resources. */
import { useState } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { View, Text, Pressable } from "react-native";
import { Icon } from "../plans-view/stubs";
import { registerFleetViews } from "../../client/workspace-panels";
import { compactPlansFixture, closedTrialsFixture } from "../../test/compact-plans-fixture";
import { compactWorkflowBearings } from "../../shared/workflow-plan-summary";
import { bearingsMessage } from "../../shared/bearings";
import { theme as dark } from "../board-list/theme";
import { fleet, entries } from "../board-list/fixtures";
const params = new URLSearchParams(location.search);
const theme = params.get("theme") === "light" ? { colors: { ...dark.colors, surface0: "#f6f8f7", surface1: "#ffffff", surface2: "#edf1ee", border: "#c9d2cc", foreground: "#16241b", foregroundMuted: "#52635a", statusWarning: "#8a5813" } } : dark;
const plans = params.get("scenario") === "empty" ? [] : compactPlansFixture();
if (params.has("attention")) {
  const builds = plans[0].definition.nodes.filter(n => n.kind === "run" && n.launch.kind === "ship");
  [{ state: "unresolved" }, { state: "landed", invalidated: "Head changed" }, { state: "failed" }, { state: "done" }]
    .forEach((state, i) => { plans[0].nodes[builds[i].id] = state; });
}
if (params.has("trials")) plans.push(...closedTrialsFixture());
Object.assign(window, { fixtureTheme: theme, plansScenario: params.get("scenario"), planActions: [], planReads: 0, navigationCalls: [], workflowFixture: {
  homeId: "fixture-home", version: "fixture-compact", plans, subjects: Object.fromEntries(plans.map(p => [p.definition.id, "b".repeat(64)])), now: [], comingUp: [],
  problems: params.get("scenario") === "partial" ? ["A damaged plan was isolated; healthy plans remain available."] : [],
} });
if (params.has("guests")) fleet.homeGuests = [{ ...fleet.mate, id: "guest-chat", title: "Planning notes" }];
if (params.has("bearings")) {
  window.workflowFixture.comingUp = plans.slice(0, 2).map(p => ({ plan: p.definition.id, node: p.definition.nodes.find(n => n.kind === "decision").id,
    title: p.definition.title, question: p.definition.nodes.find(n => n.kind === "decision").title, waits: [p === plans[0] ? "Scheduler slice 13 landing" : "Reader route landing"], neededBy: [], recommendation: "Review the recorded evidence first." }));
  const overview = compactWorkflowBearings(window.workflowFixture);
  const text = bearingsMessage("Bearings, please.", overview);
  window.bearingsPayload = text;
  entries.push({ ...entries.at(-1), seqStart: 1000, seqEnd: 1000, item: { type: "user_message", text, clientMessageId: "firstmate-bearings-11111111-1111-4111-8111-111111111111" } });
}
fleet.mate.requiresAttention = true;
if (params.has("adopted")) fleet.mateInHome = false;
const screens = new Map(), panels = new Map();
let navigate;
registerFleetViews({
  addScreen: item => screens.set(item.id, item), addWorkspacePanel: item => panels.set(item.id, item),
  openPanel(id, options) { window.navigationCalls.push({ id, ...options }); navigate({ id, ...options }); },
  openScreen(input) { window.navigationCalls.push(input); navigate({ id: input.screenId }); },
});
window.panelDescriptors = [...panels.values()].map(({ id, title, icon, context, locations }) => ({ id, title, icon, context, locations }));
function App() {
  const [route, setRoute] = useState({ id: params.get("view") ? `firstmate-${params.get("view")}` : "fleet", workspaceId: params.get("workspace") ?? "sample" });
  const [menu, setMenu] = useState(false);
  navigate = setRoute;
  const descriptor = screens.get(route.id) ?? panels.get(route.id), Component = descriptor?.Component;
  const colors = theme.colors;
  return <View style={{ flex: 1, minHeight: 0, backgroundColor: colors.surface0 }}>
    <View style={{ zIndex: 10, padding: 8, flexDirection: "row", alignItems: "center", gap: 12, borderBottomWidth: 1, borderColor: colors.border }}>
      <Text style={{ color: colors.foregroundMuted, fontSize: 12, flex: 1 }}>Workspace tabs · host fixture</Text>
      <Pressable accessibilityRole="button" accessibilityLabel="New workspace tab" onPress={() => setMenu(v => !v)} style={{ padding: 6 }}><Icon name="Plus" size={16} color={colors.foreground} /></Pressable>
      {menu ? <View style={{ position: "absolute", right: 8, top: 38, padding: 6, width: 180, borderWidth: 1, borderColor: colors.border, borderRadius: 8, backgroundColor: colors.surface1 }}>
        {[...panels.values()].map(panel => <Pressable key={panel.id} accessibilityRole="button" accessibilityLabel={`New tab: ${panel.title}`} onPress={() => { setRoute({ id: panel.id, workspaceId: "sample" }); setMenu(false); }} style={{ flexDirection: "row", gap: 8, padding: 8 }}>
          <Icon name={panel.icon} size={16} color={colors.foreground} /><Text style={{ color: colors.foreground, fontSize: 13 }}>{panel.title}</Text>
        </Pressable>)}
      </View> : null}
    </View>
    {Component ? <Component key={route.id + route.workspaceId} theme={theme} layout={{ compact: innerWidth < 638 }} host={{ id: "sample-local", label: "Local", online: true }}
      workspaceId={route.workspaceId} context="workspace" params={{}} navigation={{ openAgent() {} }} /> : <Text style={{ color: colors.foreground }}>Panel unavailable in this revision.</Text>}
  </View>;
}
createRoot(document.getElementById("root")).render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><App /></QueryClientProvider>);
