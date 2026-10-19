/** Real FleetSurface/Deck/DecisionSurface/DecisionDrawer, with only host APIs stubbed. */
import React from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { FleetSurface } from "../../client/fleet";
import { fleet } from "../board-list/fixtures.js";
import { attentionCards, attentionSnapshot, attentionTheme } from "../../test/attention-deck-fixture";

const snapshot = attentionSnapshot();
snapshot.requests[0].originalAsk = "Which release should sail?";
snapshot.requests[1].originalAsk = "Which project should the first mate start next?";
for (const request of snapshot.requests) request.source.ask = request.originalAsk;
window.fixtureFleet = { ...fleet, cards: attentionCards, needsYou: snapshot };
window.fixtureCalls = [];
const query = new QueryClient({ defaultOptions: { queries: { retry: false } } });
const unexpectedNavigation = () => { throw new Error("Deck decisions must open in place"); };
createRoot(document.getElementById("root")).render(
  <QueryClientProvider client={query}>
    <FleetSurface view="deck" theme={attentionTheme} host={{ id: "fixture-host" }} workspaceId="sample"
      layout={{ compact: false, platform: "web" }} params={{}}
      shell={{ openDecision: unexpectedNavigation, openHome: unexpectedNavigation, openView: unexpectedNavigation }} />
  </QueryClientProvider>,
);
