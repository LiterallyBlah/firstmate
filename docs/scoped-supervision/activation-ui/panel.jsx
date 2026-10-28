import React from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { SupervisionActivationBoard } from "../../../client/supervision-activation";
import { theme as dark } from "../../board-list/theme";
const light = { colors: { surface0: "#ffffff", surface1: "#f4f6f5", surface2: "#e8ecea", border: "#ced5d1", foreground: "#17211b", foregroundMuted: "#4d5c53",
  accent: "#17603b", accentForeground: "#ffffff", statusWarning: "#79551f", statusDanger: "#a32d25", statusSuccess: "#24653d" } };
const theme = location.search.includes("light") ? light : dark;
window.fixtureTheme = theme;
const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
createRoot(document.getElementById("root")).render(<QueryClientProvider client={client}>
  <div style={{ minHeight: "100vh", width: "100%", background: theme.colors.surface0, color: theme.colors.foreground }}>
    <SupervisionActivationBoard theme={theme} compact={innerWidth < 600} />
  </div>
</QueryClientProvider>);
