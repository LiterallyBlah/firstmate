/** Real List/Board/cards and tag controls; only host APIs are synthetic. */
import React from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { FleetSurface } from "../../client/fleet";
import { fleet } from "../board-list/fixtures";
import { theme as dark } from "../board-list/theme";
import { itemTagKey } from "../../shared/item-tags";

const params = new URLSearchParams(location.search);
const light = params.get("theme") === "light";
const theme = light
  ? {
      colors: {
        ...dark.colors,
        surface0: "#ffffff",
        surface1: "#f5f5f5",
        surface2: "#e8e8e8",
        border: "#d3d3d3",
        foreground: "#171717",
        foregroundMuted: "#646464",
        statusDanger: "#a52d25",
        statusWarning: "#88601d",
      },
    }
  : dark;
window.fixtureTheme = theme;
const local = fleet.cards.find((card) => card.agent);
const remote = fleet.cards.find((card) => card.remote);
function task(base, id, title, column, tags, options = {}) {
  const card = structuredClone(base);
  Object.assign(card, {
    key: id,
    taskId: id,
    title,
    column,
    tags,
    report: null,
    url: null,
  });
  Object.assign(card.backlog, {
    id,
    title,
    tags,
    hold: null,
    section:
      column === "done" ? "done" : column === "queued" ? "queued" : "in-flight",
  });
  if (card.agent)
    Object.assign(card.agent, {
      id,
      title,
      status: column === "working" ? "running" : "idle",
    });
  if (card.remote)
    Object.assign(card.remote.worker, { id, name: title, status: "running" });
  if (column === "queued" || column === "done") {
    card.agent = null;
    delete card.remote;
  }
  Object.assign(card, options);
  return card;
}
fleet.cards = [
  task(local, "local-ui", "Polish item tags", "working", [
    "Frontend",
    "Dashboard",
  ]),
  task(remote, "remote-ui", "Review remote dashboard", "working", [
    "Dashboard",
  ]),
  task(local, "queued-ui", "Queue the next frontend task", "queued", [
    "Frontend",
  ]),
  task(local, "done-ui", "Ship accessible tag controls", "done", [
    "Frontend",
    "Dashboard",
  ]),
  task(local, "untagged", "An untagged task", "idle", []),
];
// Optional overflow fixture: 19 realistic choices, including two Done-only tags.
if (params.get("tags") === "19") {
  fleet.cards[0].tags = [
    "Accessibility",
    "Agent lifecycle",
    "Backlog",
    "Build tooling",
    "Captain approval",
    "Charter",
    "Context controls",
    "Dashboard",
    "Dependencies",
    "Documentation",
  ];
  fleet.cards[1].tags = [
    "FirstMate",
    "Frontend",
    "Permissions",
    "Remote hosts",
  ];
  fleet.cards[2].tags = [
    "Test coverage",
    "Tooltips",
    "Windows support",
    "Dashboard",
  ];
  fleet.cards[3].tags = ["Archived release", "Legacy migration", "Dashboard"];
  for (const card of fleet.cards) card.backlog.tags = [...card.tags];
}
fleet.suggestions = [];
const savedTags = JSON.parse(localStorage.getItem("fixture-item-tags") ?? "{}");
for (const card of fleet.cards)
  card.tags = savedTags[itemTagKey(card)] ?? card.tags;
window.fixtureFleet = fleet;
const client = new QueryClient({
  defaultOptions: { queries: { retry: false } },
});
createRoot(document.getElementById("root")).render(
  <QueryClientProvider client={client}>
    <div
      style={{
        height: "100vh",
        display: "flex",
        flexDirection: "column",
        background: theme.colors.surface0,
      }}
    >
      <div
        style={{
          height: 32,
          flexShrink: 0,
          color: theme.colors.foregroundMuted,
          padding: "6px 12px",
          fontSize: 12,
        }}
      >
        Synthetic item tags · {params.get("view")} · {light ? "light" : "dark"}{" "}
        · {innerWidth}px
      </div>
      <FleetSurface
        theme={theme}
        layout={{ compact: innerWidth < 600 }}
        navigation={{ openAgent() {} }}
      />
    </div>
  </QueryClientProvider>,
);
