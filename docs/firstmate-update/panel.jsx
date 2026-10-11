import React from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { FleetSurface, bindSettingsOpener } from "../../client/fleet";
import { theme as dark } from "../board-list/theme";
import { fleet } from "../board-list/fixtures";

fleet.cards[0].tags = ["UI check"];
fleet.cards[1].tags = ["UI check"];
window.fixtureTagTitles = fleet.cards.slice(0, 3).map((card) => card.title);

const params = new URLSearchParams(location.search);
const light = params.get("theme") === "light";
const theme = light
  ? {
      colors: {
        ...dark.colors,
        surface0: "#fff",
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
bindSettingsOpener(() => {});
createRoot(document.getElementById("root")).render(
  <QueryClientProvider
    client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
  >
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
          padding: "6px 12px",
          fontSize: 12,
          color: theme.colors.foregroundMuted,
        }}
      >
        Synthetic FirstMate update fixture ·{" "}
        {params.get("state") ?? "available"} · {light ? "light" : "dark"} ·{" "}
        {innerWidth}px
      </div>
      <FleetSurface
        theme={theme}
        layout={{ compact: false }}
        navigation={{ openAgent() {} }}
      />
    </div>
  </QueryClientProvider>,
);
