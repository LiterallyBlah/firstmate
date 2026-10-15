import React from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { FleetSurface } from "../../client/fleet";
import { fleet } from "../board-list/fixtures";
import { theme as dark } from "../board-list/theme";
const params = new URLSearchParams(location.search);
const theme = params.get("theme") === "light" ? { colors: { ...dark.colors,
  surface0: "#ffffff", surface1: "#f5f5f5", surface2: "#e8e8e8", border: "#d3d3d3",
  foreground: "#171717", foregroundMuted: "#646464", statusDanger: "#a52d25", statusWarning: "#88601d",
} } : dark;
window.fixtureTheme = theme;
const local = fleet.cards.find((card) => card.agent);
const remote = fleet.cards.find((card) => card.remote);
function task(base, id, title, column) {
  const card = structuredClone(base);
  Object.assign(card, { key: id, taskId: id, title, column, tags: [], report: null, url: null });
  Object.assign(card.backlog, { id, title, tags: [], hold: null, section: column === "done" ? "done" : column === "queued" ? "queued" : "in-flight" });
  if (card.agent) Object.assign(card.agent, { id, title, status: column === "working" ? "running" : "idle" });
  if (card.remote) Object.assign(card.remote.worker, { id, name: title, status: "running" });
  if (column === "queued" || column === "done") { card.agent = null; delete card.remote; }
  return card;
}
fleet.cards = [
  task(local, "local-ui", "Polish item tags", "working"),
  task(remote, "remote-ui", "Review remote dashboard", "working"),
  task(local, "queued-ui", "Queue the next frontend task", "queued"),
  task(local, "done-ui", "Ship accessible tag controls", "done"),
  task(local, "untagged", "An untagged task", "idle"),
];
fleet.suggestions = [];
window.fixtureFleet = fleet;
window.fixtureAttachWorker = () => {
  const card = fleet.cards.find((entry) => entry.key === "queued-ui");
  card.agent = { ...structuredClone(local.agent), id: "new-worker", title: card.title };
  card.column = "working";
};
const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
createRoot(document.getElementById("root")).render(
  <QueryClientProvider client={client}>
    <div style={{ height: "100vh", display: "flex", flexDirection: "column", background: theme.colors.surface0 }}>
      <div style={{ height: 28, flexShrink: 0, color: theme.colors.foregroundMuted, padding: "4px 12px", fontSize: 12 }}>
        Synthetic Converse · {params.get("view")} · {params.get("theme")} · {innerWidth}px
      </div>
      <FleetSurface theme={theme} layout={{ compact: innerWidth < 600 }} workspaceId="sample"
        view={params.get("view") === "list" ? "crew" : "board"} navigation={{ openAgent() {} }} />
    </div>
  </QueryClientProvider>,
);
