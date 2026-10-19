import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { registerFleetViews } from "../../client/workspace-panels";
import { FleetSidebarItem } from "../../client/sidebar";
import { theme as dark } from "../board-list/theme.js";
const params = new URLSearchParams(location.search);
const theme = params.has("light")
  ? {
      colors: {
        ...dark.colors,
        surface0: "#ffffff",
        surface1: "#f4f5f4",
        surface2: "#e9ece9",
        border: "#d6dbd6",
        foreground: "#151915",
        foregroundMuted: "#5b655b",
      },
    }
  : dark;
const screens = new Map(),
  panels = new Map();
let navigate;
const openScreen = (input) =>
  navigate({ id: input.screenId, params: input.params });
const shell = registerFleetViews({
  addScreen: (r) => screens.set(r.id, r),
  addWorkspacePanel: (r) => panels.set(r.id, r),
  openPanel: (id) => navigate({ id }),
  openScreen,
});
window.openDecision = shell.openDecision;
window.openFixturePanel = (view) =>
  navigate({ id: view === "home" ? "fleet" : `firstmate-${view}` });
window.queryClient = new QueryClient({
  defaultOptions: { queries: { retry: false } },
});
window.refreshDecisions = () =>
  window.queryClient.invalidateQueries({
    queryKey: ["firstmate", "needs-you"],
  });
function App() {
  const [route, setRoute] = useState({
    id: params.get("view") ? `firstmate-${params.get("view")}` : "fleet",
    params: params.has("decision")
      ? {
          decision: params.get("decision"),
          decisionHome: params.get("home") ?? "fixture-home",
          decisionRevision: params.get("revision") ?? "1",
        }
      : {},
  });
  navigate = setRoute;
  const Component = (screens.get(route.id) ?? panels.get(route.id)).Component;
  return (
    <>
      <div style={{ display: "none" }}>
        <FleetSidebarItem
          theme={theme}
          currentScreen={{ screenId: route.id }}
          openScreen={openScreen}
        />
      </div>
      <Component
        theme={theme}
        host={{ id: "fixture-host", label: "Fixture" }}
        layout={{ compact: params.has("compact"), platform: "web" }}
        params={route.params ?? {}}
        workspaceId="sample"
        context="workspace"
        shell={shell}
        navigation={{ openAgent() {}, openWorkspace() {} }}
      />
    </>
  );
}
createRoot(document.getElementById("root")).render(
  <QueryClientProvider client={window.queryClient}>
    <App />
  </QueryClientProvider>,
);
