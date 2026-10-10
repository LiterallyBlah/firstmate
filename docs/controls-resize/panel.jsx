import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { FleetSurface } from "../../client/fleet";
import { theme as dark } from "../board-list/theme";

const params = new URLSearchParams(location.search);
const zoom = Number(params.get("zoom") ?? 1);
const light = params.get("theme") === "light";
const compact = params.get("compact") === "true";
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
const client = new QueryClient({
  defaultOptions: { queries: { retry: false } },
});
function Panel() {
  const [key, remount] = useState(0);
  window.fixtureRemount = () => remount((k) => k + 1);
  return (
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
          Synthetic FirstMate fixture ·{" "}
          {params.get("label") ?? "resize investigation"} ·{" "}
          {light ? "light" : "dark"} · {innerWidth} px · scale {zoom}
        </div>
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            flex: 1,
            minHeight: 0,
            zoom,
          }}
        >
          <FleetSurface
            key={key}
            theme={theme}
            layout={{ compact }}
            navigation={{ openAgent() {} }}
          />
        </div>
      </div>
    </QueryClientProvider>
  );
}
createRoot(document.getElementById("root")).render(<Panel />);
