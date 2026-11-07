/** Real Home surface; every RPC is a local fixture. */
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { FleetSurface } from "../../client/fleet";
import { theme as dark } from "../board-list/theme";
const light = { colors: { ...dark.colors, surface0: "#f6f8f7", surface1: "#ffffff", surface2: "#edf1ee", border: "#c9d2cc", foreground: "#16241b", foregroundMuted: "#52635a", statusWarning: "#8a5813" } };
const theme = new URLSearchParams(location.search).get("theme") === "light" ? light : dark;
window.fixtureTheme = theme;
createRoot(document.getElementById("root")).render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
  <FleetSurface theme={theme} layout={{ compact: innerWidth < 638 }} host={{ id: "fixture", label: "Isolated preview", online: true }} navigation={{ openAgent() {} }} />
</QueryClientProvider>);
