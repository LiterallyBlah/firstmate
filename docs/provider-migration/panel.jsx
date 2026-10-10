/** The actual FirstMate screen, with the board harness's synthetic host contracts. */
import React from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { FleetSurface } from "../../client/fleet";
import { theme as dark } from "../board-list/theme";

const theme = new URLSearchParams(location.search).has("light")
  ? {
      colors: {
        surface0: "#ffffff",
        surface1: "#f5f5f5",
        surface2: "#ebebeb",
        border: "#dedede",
        foreground: "#171717",
        foregroundMuted: "#686868",
        accent: "#20744a",
        accentForeground: "#ffffff",
        statusSuccess: "#307b40",
        statusWarning: "#996512",
        statusDanger: "#b53629",
      },
    }
  : dark;
window.fixtureTheme = theme;
window.fixtureOpenedAgents = [];
createRoot(document.getElementById("root")).render(
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <div style={{ height: "100vh", display: "flex", background: theme.colors.surface0 }}>
      <FleetSurface
        theme={theme}
        layout={{ compact: innerWidth < 600 }}
        navigation={{
          openAgent(id) {
            window.fixtureOpenedAgents.push(id);
          },
        }}
      />
    </div>
  </QueryClientProvider>,
);
