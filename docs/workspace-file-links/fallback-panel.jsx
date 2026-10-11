import React from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { FleetSurface } from "../../client/fleet";
import { theme as dark } from "../board-list/theme";
import { fleet } from "../board-list/fixtures";
import { navigationFactory } from "./.generated/native-runtime.js";

const theme = location.search.includes("light") ? { colors: { ...dark.colors, surface0: "#fff", surface1: "#f5f5f5", surface2: "#ececec", border: "#d8d8d8", foreground: "#171717", foregroundMuted: "#686868" } } : dark;
window.fixtureTheme = theme;
fleet.cards = fleet.cards.slice(0, 5);
const navigation = navigationFactory("local-fixture", {
  browserAvailable: false,
  openWorkspace: input => window.fallbackEvidence.workspaceNavigation.push(input),
  openAgent: () => {},
});
const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
createRoot(document.getElementById("root")).render(<QueryClientProvider client={client}>
  <main style={{ height: "100vh", display: "flex", flexDirection: "column", background: theme.colors.surface0, color: theme.colors.foreground, fontFamily: "Segoe UI,sans-serif" }}>
    <header style={{ padding: 12, fontSize: 13, borderBottom: `1px solid ${theme.colors.border}` }}>FirstMate workspace-only fallback · local/remote API fixtures · installed public navigation bridge · no daemon or file bytes</header>
    <FleetSurface theme={theme} host={{ id: "local-fixture", label: "Desktop" }} layout={{ compact: innerWidth < 600, platform: "web" }} navigation={navigation} params={{}} />
  </main>
</QueryClientProvider>);
