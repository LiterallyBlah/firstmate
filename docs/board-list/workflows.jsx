import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { FleetSurface } from "../../client/fleet";
import { NeedsYouBadge } from "../../client/needs-you";
import { theme as dark } from "./theme";
const light = { colors: { ...dark.colors, surface0: "#f6f8f7", surface1: "#ffffff", surface2: "#edf1ee", border: "#c9d2cc", foreground: "#16241b", foregroundMuted: "#52635a", statusWarning: "#8a5813" } };
const theme = new URLSearchParams(location.search).get("theme") === "light" ? light : dark;
window.fixtureTheme = theme;
const fixture = await fetch("/fixture.json").then(r => r.json());
window.integratedWorkflow = fixture;
createRoot(document.getElementById("root")).render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
  <div style={{ height: "100vh", display: "flex", flexDirection: "column", background: theme.colors.surface0 }}>
    <div data-testid="integrated-workflow-badge"><NeedsYouBadge theme={theme} snapshot={fixture.needs} /></div>
    <FleetSurface theme={theme} layout={{ compact: innerWidth < 638 }} view="crew" workspaceId="sample" host={{ id: "sample-local", label: "Local", online: true }} navigation={{ openAgent() {} }} />
  </div>
</QueryClientProvider>);
