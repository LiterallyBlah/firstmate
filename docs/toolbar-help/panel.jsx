/** Real controls and layouts; every host/session operation is fixture-local. */
import React from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { FleetSurface, bindSettingsOpener } from "../../client/fleet";
import { fleet } from "../board-list/fixtures";
import { theme as dark } from "../board-list/theme";

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
const local = structuredClone(fleet.cards.find((c) => c.agent));
const remote = structuredClone(fleet.cards.find((c) => c.remote));
function task(base, id, title, status, online = true, followed = false) {
  const card = structuredClone(base);
  Object.assign(card, {
    key: id,
    taskId: id,
    title,
    column: status === "running" ? "working" : "idle",
    report: null,
  });
  card.backlog.id = id;
  card.backlog.title = title;
  card.backlog.hold = null;
  if (card.agent) Object.assign(card.agent, { id, title, status });
  if (card.remote) {
    card.remote.online = online;
    Object.assign(card.remote.worker, { id, name: title, status, followed });
  }
  return card;
}
fleet.cards = [
  task(local, "local-running", "Local running worker", "running"),
  task(local, "local-idle", "Local idle worker", "idle"),
  task(remote, "remote-running", "Remote running worker", "running"),
  task(remote, "remote-offline", "Unreachable remote worker", "running", false),
  task(
    remote,
    "remote-followed",
    "Followed remote session",
    "idle",
    true,
    true,
  ),
];
fleet.suggestions = [];
window.fixtureFleet = fleet;
window.fixtureMigration = params.has("recovery")
  ? {
      sourceId: fleet.mate.id,
      agentId: "replacement",
      target: { provider: "codex/gpt" },
      handoffPath: "data/handoffs/replacement.md",
    }
  : null;
bindSettingsOpener((id) => (window.fixtureSettingsOpened = id));
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
          height: 30,
          flexShrink: 0,
          color: theme.colors.foregroundMuted,
          padding: "6px 12px",
          fontSize: 12,
        }}
      >
        Synthetic FirstMate fixture · {params.get("label") ?? "Toolbar help"} ·{" "}
        {light ? "light" : "dark"} · {innerWidth} px
      </div>
      <FleetSurface
        theme={theme}
        layout={{ compact: false }}
        navigation={{
          openAgent(input) {
            window.fixtureOpenedAgent = input;
          },
        }}
      />
    </div>
  </QueryClientProvider>,
);
