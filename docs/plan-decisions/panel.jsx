/** Real decision drawer, List and Board; invented, isolated host data. */
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Text, View } from "react-native";
import { DecisionDrawer } from "../../client/decision-drawer";
import { DecisionActionContext } from "../../client/decision-action";
import { TaskList } from "../../client/task-list";
import { TaskBoard } from "../../client/task-board";
import { WorkflowSurface } from "../../client/workflow-plans";
import { DEFAULT_TASK_LAYOUT } from "../../shared/task-layout";
import { NEEDS_YOU_QUERY_KEY } from "../../client/needs-you-query";
import { readNeedsYou } from "../../shared/needs-you";
import { useRpc } from "@getpaseo/plugin/client";
import { attentionSnapshot, attentionRequest, attentionTheme } from "../../test/attention-deck-fixture";
import { planDecisionNeed } from "../../test/plan-decision-fixture";

const params = new URLSearchParams(location.search), view = params.get("view") ?? "needs-you";
const theme = params.get("theme") === "day" ? { colors: { ...attentionTheme.colors, surface0: "#f6f8f7", surface1: "#ffffff", surface2: "#edf1ee", border: "#c9d2cc", foreground: "#16241b", foregroundMuted: "#52635a", statusWarning: "#8a5813" } } : attentionTheme;
const need = planDecisionNeed(), at = Date.parse("2026-10-22T11:00:00Z");
need.decision.brief.content = `# Reader checks

## Question
Should the reader pass check both accidental spoilers and foreshadowing before a chapter is shared?

## Background
The reader pass runs before chapter review. These checks help protect a reader's first experience without rewriting the chapter.

## Recommendation
Keep both checks. Flag possible spoilers and unclear foreshadowing for the author to review.`;
const backlog = attentionRequest("Choose the review pilot", "seen");
Object.assign(backlog, { detectedAt: at, updatedAt: at, seenAt: at, seenRevision: 1 });
backlog.source.ask = "Which pilot should prove the reader pass first?";
const later = ["Connect Claude", "Choose the rollout audience", "Confirm the author handoff"].map((title, i) => ({
  plan: need.plan, node: `later-${i}`, title: need.title, question: title, waits: ["Build the Claude connection", "Review connection evidence"], neededBy: ["Roll out the reader pass"],
  waitingFor: "after the connection is ready", recommendation: "Use the recommended rollout — keep the first release small.",
}));
window.fixtureTheme = theme;
window.fixtureErrors = [];
window.fixtureCalls = [];
window.fixtureActions = [];
const onlyPlan = view === "needs-you" || params.has("last");
window.decisionFixture = { ...attentionSnapshot(onlyPlan ? [] : [backlog]), homeId: "fixture-home", planNow: [need], comingUp: later, actionCount: onlyPlan ? 1 : 2 };
window.workflowFixture = { homeId: "fixture-home", version: "fixture", plans: [], subjects: {}, now: [need], comingUp: later };
const cache = new QueryClient({ defaultOptions: { queries: { retry: false } } });
window.fixtureCache = cache;

function App() {
  const read = useRpc(readNeedsYou), query = useQuery({ queryKey: NEEDS_YOU_QUERY_KEY, queryFn: () => read({}) });
  const [destination, select] = useState(view === "needs-you" || view === "all" ? { requestId: "next" } : null);
  const [layout, setLayout] = useState(DEFAULT_TASK_LAYOUT);
  const props = { cards: [], allCards: [], snapshot: query.data, offline: false, theme, compact: innerWidth < 638, density: "comfortable", conversing: null, onConverse() {}, onChanged() {}, showDone: false, onShowDone() {} };
  return <DecisionActionContext.Provider value={next => select(next ?? { requestId: "next" })}>
    <View style={{ flex: 1, minHeight: 0, backgroundColor: theme.colors.surface0 }}>
      <View style={{ padding: 16, borderBottomWidth: 1, borderColor: theme.colors.border, flexDirection: "row", gap: 16 }}>
        <Text style={{ fontSize: 18, fontWeight: "600", color: theme.colors.foreground }}>FirstMate · {view === "list" ? "List" : view === "board" ? "Board" : "Home"}</Text>
        <Text accessibilityLabel="Decision count" style={{ fontSize: 13, color: theme.colors.statusWarning }}>Needs you · {query.data?.actionCount ?? "…"}</Text>
      </View>
      {query.data && destination ? <View style={{ flex: 1, minHeight: 0, width: view === "board" || view === "list" ? "100%" : "min(760px, 100%)", alignSelf: "center" }}>
        <DecisionDrawer theme={theme} snapshot={query.data} destination={destination} onSelect={select} onClose={() => select(null)} mateId="mate" suggestions={[]} compact={innerWidth < 638} offline={false} />
      </View> : view === "board" ? <TaskBoard {...props} layout={layout} layoutDisabled={false} onLayout={patch => setLayout(old => ({ ...old, ...patch }))} /> :
        view === "list" ? <TaskList {...props} /> : <Text style={{ padding: 20, color: theme.colors.foreground }}>Returned to Home</Text>}
    </View>
  </DecisionActionContext.Provider>;
}
createRoot(document.getElementById("root")).render(<QueryClientProvider client={cache}><WorkflowSurface theme={theme}><App /></WorkflowSurface></QueryClientProvider>);
