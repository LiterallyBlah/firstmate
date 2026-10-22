/** Real surfaces, synthetic host data; no daemon or installation. */
import React from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { FleetSurface } from "../../client/fleet";
import { fleet } from "../board-list/fixtures";
import { attentionCards, attentionRequest, attentionSnapshot, attentionTheme } from "../../test/attention-deck-fixture";
import { workflowFixture } from "../../test/workflow-fixture";

const params = new URLSearchParams(location.search);
const theme = params.get("theme") === "light" ? { colors: { ...attentionTheme.colors,
  surface0: "#f6f8f7", surface1: "#ffffff", surface2: "#edf1ee", foreground: "#16241b", foregroundMuted: "#52635a", border: "#c9d2cc", statusWarning: "#8a5813" } } : attentionTheme;
const snapshot = attentionSnapshot();
snapshot.requests[0].source.ask = snapshot.requests[0].originalAsk = "Which release should sail?";
snapshot.requests[1].source.ask = snapshot.requests[1].originalAsk = "Which project should the first mate start next?";
if (["unreadable", "mixed-unreadable"].includes(params.get("scenario"))) {
  snapshot.requests = params.get("scenario") === "unreadable" ? [] : [snapshot.requests[0]];
  snapshot.actionCount = snapshot.requests.length + 1; snapshot.newCount = snapshot.requests.length;
  snapshot.quarantined = [{ line: 5, taskId: "damaged-task", key: null, hasHold: true, problem: "Task scope could not be read." }];
  snapshot.freshness.problems = [snapshot.quarantined[0].problem];
}
const definition = workflowFixture(); definition.title = "Release voyage";
const plan = { definition, revision: 1, sequence: 0, hash: "a".repeat(64), posture: "review", status: "review",
  approvedBudget: definition.budget, nodes: Object.fromEntries(definition.nodes.map(node => [node.id, { state: "planned" }])),
  told: [], handled: [], history: [] };
Object.assign(window, { fixtureErrors: [], fixtureCalls: [], fixtureFleet: { ...fleet, cards: attentionCards, needsYou: snapshot,
  suggestions: [{ label: "Review release", prompt: "Review agent-Choose the release before merging." }] },
  workflowFixture: { homeId: snapshot.homeId, version: "1", plans: [plan], subjects: { [definition.id]: "b".repeat(64) }, now: [], comingUp: [] } });
const query = new QueryClient({ defaultOptions: { queries: { retry: false } } });
window.setDecisionCount = count => {
  const next = attentionSnapshot(Array.from({ length: count }, (_, i) => attentionRequest(`Choice ${i + 1}`)));
  next.version = window.fixtureFleet.needsYou.version + 1;
  next.freshness.checkedAt = window.fixtureFleet.needsYou.freshness.checkedAt + 1;
  window.fixtureFleet.needsYou = next;
  query.setQueryData(["firstmate", "fleet"], structuredClone(window.fixtureFleet));
  query.setQueryData(["firstmate", "needs-you"], next);
};
const unexpectedNavigation = () => { throw new Error("Deck decisions must open in place"); };
createRoot(document.getElementById("root")).render(<QueryClientProvider client={query}>
  <FleetSurface view={params.get("view") === "toolbar" ? "crew" : "deck"} theme={theme}
    host={{ id: "fixture-host" }} workspaceId="sample" layout={{ compact: false, platform: "web" }} params={{}}
    shell={{ openDecision: unexpectedNavigation, openHome: unexpectedNavigation, openView: unexpectedNavigation }} />
</QueryClientProvider>);
