import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { registerFleetViews } from "../../client/workspace-panels";
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
window.navigationCalls = [];
registerFleetViews({
  addScreen: (item) => screens.set(item.id, item),
  addWorkspacePanel: (item) => panels.set(item.id, item),
  openPanel(id, options) {
    window.navigationCalls.push({ id, ...options });
    navigate({ id, ...options });
  },
  openScreen(input) {
    window.navigationCalls.push(input);
    navigate({ id: input.screenId, params: input.params });
  },
});
window.openFixturePanel = (view, workspaceId = "sample") => navigate({ id: `firstmate-${view}`, workspaceId });
function App() {
  const [route, setRoute] = useState({
    id: params.get("view") ? `firstmate-${params.get("view")}` : "fleet",
    workspaceId: params.get("workspace") ?? "sample",
  });
  navigate = setRoute;
  const Component = (screens.get(route.id) ?? panels.get(route.id)).Component;
  return (
    <Component
      key={route.id + route.workspaceId}
      theme={theme}
      host={{ id: "fixture-host", label: "Fixture" }}
      layout={{ compact: innerWidth < 600, platform: "web" }}
      params={route.params ?? {}}
      workspaceId={route.workspaceId}
      context="workspace"
      navigation={{
        openAgent(input) {
          window.navigationCalls.push({ agent: input });
        },
        openWorkspace(input) {
          window.navigationCalls.push({ workspace: input });
        },
      }}
    />
  );
}
createRoot(document.getElementById("root")).render(
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <App />
  </QueryClientProvider>,
);
