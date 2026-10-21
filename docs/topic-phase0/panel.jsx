import React from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { FleetSurface } from "../../client/fleet";
import { AgentPanel } from "../../client/panels";
import { theme as dark } from "../board-list/theme";
import { fleet } from "../board-list/fixtures";

fleet.homeGuests = [
  { ...fleet.mate, id: "guest-1", title: "A guest conversation about future work" },
  { ...fleet.mate, id: "guest-2", title: "A former first mate with a very long remembered role and conversation title" },
];
const params = new URLSearchParams(location.search);
const theme = params.get("theme") === "light" ? { colors: { ...dark.colors, surface0: "#fff", surface1: "#f5f5f5", surface2: "#e8e8e8", border: "#d3d3d3", foreground: "#171717", foregroundMuted: "#646464", statusWarning: "#88601d" } } : dark;
const navigation = { openAgent: ({ agentId }) => { window.openedGuest = agentId; } };
const shell = { openDecision() {}, openHome() {}, openView() {} };
createRoot(document.getElementById("root")).render(
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <div style={{ height: "100vh", display: "flex", flexDirection: "column" }}>
      {params.get("panel") ? <AgentPanel theme={theme} layout={{ compact: innerWidth < 600 }} agentId="guest-1" workspaceId="home" navigation={navigation} shell={shell} /> :
        <FleetSurface theme={theme} layout={{ compact: innerWidth < 600 }} host={{ id: "fixture-local", label: "Local", online: true }} navigation={navigation} shell={shell} />}
    </div>
  </QueryClientProvider>,
);
