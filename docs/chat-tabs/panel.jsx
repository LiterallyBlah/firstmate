import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { registerFleetViews } from "../../client/workspace-panels";
import { WorkspacePanel } from "../../client/panels";
import { theme as dark } from "../board-list/theme.js";

const params = new URLSearchParams(location.search);
const theme = params.has("light")
  ? {
      colors: {
        ...dark.colors,
        surface0: "#fff",
        surface1: "#f5f5f5",
        surface2: "#eee",
        foreground: "#171717",
        foregroundMuted: "#686868",
        border: "#ddd",
      },
    }
  : dark;
window.fixtureTheme = theme;
const screens = new Map(),
  panels = new Map();
let navigate;
window.navigationCalls = [];
const shell = registerFleetViews({
  addScreen: (item) => screens.set(item.id, item),
  addWorkspacePanel: (item) => panels.set(item.id, item),
  openPanel(id, options) {
    window.navigationCalls.push({ id, ...options });
    navigate(id);
  },
  openScreen(input) {
    window.navigationCalls.push(input);
    navigate(input.screenId);
  },
});
window.registeredPanels = [...panels.values()].map(({ id, title }) => ({ id, title }));
const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
window.refreshFleet = () => client.invalidateQueries({ queryKey: ["firstmate", "fleet"] });
function App() {
  const [route, setRoute] = useState(params.get("view") ?? "firstmate-chat");
  const [revision, setRevision] = useState(0);
  const [both, setBoth] = useState(params.has("both"));
  navigate = setRoute;
  window.remountChats = () => setRevision((n) => n + 1);
  window.showBoth = setBoth;
  const props = {
    theme,
    host: { id: "fixture" },
    layout: { compact: innerWidth < 600, platform: "web" },
    workspaceId: "foreign-workspace",
    params: {},
    navigation: { openAgent: (input) => window.navigationCalls.push(input) },
  };
  const Current =
    route === "here"
      ? (props) => <WorkspacePanel {...props} shell={shell} />
      : (panels.get(route) ?? screens.get(route)).Component;
  const Home = screens.get("fleet").Component;
  return (
    <QueryClientProvider client={client}>
      <main key={revision} style={{ display: "flex", height: "100vh", background: theme.colors.surface0 }}>
        <section data-testid="chat" style={{ display: "flex", flexDirection: "column", flex: 1, minWidth: 0 }}>
          <Current {...props} />
        </section>
        {both ? (
          <section data-testid="home" style={{ display: "flex", flexDirection: "column", flex: 1, minWidth: 0 }}>
            <Home {...props} />
          </section>
        ) : null}
      </main>
    </QueryClientProvider>
  );
}
createRoot(document.getElementById("root")).render(<App />);
