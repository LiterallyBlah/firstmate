/** The real Home surface with synthetic plans and host APIs; no daemon access. */
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { FleetSurface } from "../../client/fleet";
import { workflowFixture } from "../../test/workflow-fixture";
import { theme as dark } from "../board-list/theme";
const params = new URLSearchParams(location.search);
const light = { colors: { ...dark.colors, surface0: "#f6f8f7", surface1: "#ffffff", surface2: "#edf1ee", border: "#c9d2cc", foreground: "#16241b", foregroundMuted: "#52635a", statusWarning: "#8a5813" } };
const theme = params.get("theme") === "light" ? light : dark;
function plan(id, implicit = false, finished = false) {
  const definition = workflowFixture(); definition.id = id; definition.title = id === "scheduler" ? "Scheduler" : implicit ? `Task ${id}` : "Documentation voyage";
  definition.implicit = implicit;
  if (implicit) {
    definition.nodes = [{ ...definition.nodes[0], id, title: `Investigate ${id}`, launch: { ...definition.nodes[0].launch, id, agentTitle: `Engineer ${id}`, host: "Remote lab", brief: { file: `data/${id}/brief.md` } } }];
    definition.budget = { agents: 1, turns: 1 };
  }
  const nodes = Object.fromEntries(definition.nodes.map(n => [n.id, finished ? { state: n.kind === "decision" ? "done" : "landed", answer: n.kind === "decision" ? "sqlite" : undefined, completedAt: "2026-10-21T11:00:00Z", spent: n.kind === "run" ? 1 : 0 } : { state: "planned" }]));
  if (!implicit && !finished) nodes.trial = { state: "running", agentId: "worker-storage", spent: 1, attempt: "trial-1" };
  return { definition, revision: 1, sequence: 0, hash: "a".repeat(64), posture: implicit ? "sail" : "review", status: implicit || finished ? "active" : "review", approvedBudget: definition.budget, nodes, told: [], handled: [], history: [{ revision: 1, at: definition.request.at, by: "mate", reason: "Drafted plan" }] };
}
const scenario = params.get("scenario"), plans = scenario === "empty" ? [] : [plan("scheduler"), plan("documentation", false, true), ...Array.from({ length: 26 }, (_, i) => plan(`automatic-${i.toString().padStart(2, "0")}`, true)), ...Array.from({ length: 13 }, (_, i) => plan(`finished-${i}`, true, true))];
Object.assign(window, { fixtureTheme: theme, plansScenario: scenario, planActions: [], planReads: 0, workflowFixture: {
  homeId: "fixture-home", version: "fixture-1", plans, subjects: Object.fromEntries(plans.map(p => [p.definition.id, "b".repeat(64)])), now: [], comingUp: [],
  problems: scenario === "partial" ? ["A damaged plan was isolated; healthy plans remain available."] : [],
} });
createRoot(document.getElementById("root")).render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
  <FleetSurface theme={theme} layout={{ compact: innerWidth < 638 }} host={{ id: "sample-local", label: "Local", online: true }} navigation={{ openAgent() {} }} />
</QueryClientProvider>);
