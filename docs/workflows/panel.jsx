import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";
import { View, Text } from "react-native";
import { WorkflowSurface, PlanNeeds, PlanChip, PlansControl } from "../../client/workflow-plans";
import { NeedsYouBadge } from "../../client/needs-you";
import { workflowFixture } from "../../test/workflow-fixture";
import { theme as dark } from "../board-list/theme";
const light = { colors: { ...dark.colors, surface0: "#f6f8f7", surface1: "#ffffff", surface2: "#edf1ee", border: "#c9d2cc", foreground: "#16241b", foregroundMuted: "#52635a", statusWarning: "#8a5813" } };
const theme = new URLSearchParams(location.search).get("theme") === "light" ? light : dark;
const definition = workflowFixture();
const plan = { definition, revision: 1, sequence: 0, hash: "a".repeat(64), posture: "review", status: "review", approvedBudget: { agents: 2, turns: 2 }, nodes: { trial: { state: "planned" }, database: { state: "planned" }, build: { state: "planned" } }, told: [], handled: [], history: [{ revision: 1, at: definition.request.at, by: "First mate", reason: "Drafted the storage trial and build." }] };
const now = [{ plan: "scheduler", title: "Scheduler", question: "Approve this plan", waits: [], neededBy: [], recommendation: "Review the trial and build." }];
const comingUp = [{ plan: "scheduler", node: "database", title: "Scheduler", question: "Choose the database", waits: ["Database trial"], neededBy: ["Build the scheduler"], recommendation: "SQLite — the workload fits one process." }];
Object.assign(window, { fixtureTheme: theme, workflowActions: [], workflowFixture: { homeId: "fixture-home", version: "fixture-1", plans: [plan], subjects: { scheduler: "b".repeat(64) }, now, comingUp } });
const snapshot = { homeId: "fixture-home", version: 1, actionCount: 1, newCount: 0, snoozedCount: 0, pendingAnswerCount: 0, freshness: { status: "fresh", asOf: Date.now(), checkedAt: Date.now(), problems: [] }, requests: [], parked: [], delivery: "off", planNow: now, comingUp };
const card = { taskId: "build", key: "build", title: "Build the scheduler", agent: null, backlog: null };
function Panel() {
  const [selected, setSelected] = useState(null);
  return <View style={{ minHeight: "100%", padding: 20, gap: 14, backgroundColor: theme.colors.surface0 }}>
    <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}><Text style={{ color: theme.colors.foreground, fontSize: 22, fontWeight: "600" }}>Needs you</Text><NeedsYouBadge theme={theme} snapshot={snapshot} /></View>
    <PlansControl theme={theme} selected={selected} onSelect={setSelected} />
    <PlanNeeds theme={theme} snapshot={snapshot} />
    <Text style={{ color: theme.colors.foregroundMuted }}>Queued · Build the scheduler</Text>
    <PlanChip card={card} theme={theme} />
    <Text style={{ color: theme.colors.foregroundMuted }}>Current filter: {selected ?? "All plans and tasks"}</Text>
  </View>;
}
createRoot(document.getElementById("root")).render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><WorkflowSurface theme={theme}><Panel /></WorkflowSurface></QueryClientProvider>);
