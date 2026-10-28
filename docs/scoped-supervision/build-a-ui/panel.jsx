import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ProjectOwnershipView } from "../../../client/project-ownership";
import { theme as dark } from "../../board-list/theme";
const light = { colors: { ...dark.colors, surface0: "#f6f8f7", surface1: "#ffffff", border: "#c9d2cc", foreground: "#16241b", foregroundMuted: "#52635a", statusWarning: "#8a5813", statusDanger: "#a52c2c" } };
const theme = new URLSearchParams(location.search).get("theme") === "light" ? light : dark;
window.fixtureTheme = theme;
const uuid = n => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const project = (name, n, extra = {}) => ({ name, projectId: uuid(n), scopeId: uuid(n + 20), hostId: "local", directory: `C:/Projects/${name}`, state: "admitted", reason: null,
  version: 2, aliases: [], agentId: null, workspaceId: null, provisionRequestId: null, sessions: 0, turns: 0, uncertain: 0, memoryPending: 0,
  profile: { provider: "codex/gpt-6.1-sol", modeId: "full-access", thinkingOptionId: "xhigh" }, limits: { supervisorSessions: 1, supervisorTurns: 12 }, plans: [], ...extra });
const fixture = { enabled: true, homeId: "fixture-home", registryDigest: "a".repeat(64), sequence: 527, hash: "a".repeat(64), freshness: "current", problems: [],
  general: { agentId: "general", scopeId: uuid(30), slots: 4, headroom: 1, providerAvailability: "unknown" }, projects: [
    project("Starpath", 1, { agentId: "starpath-mate", workspaceId: "starpath-workspace", sessions: 1, turns: 4, plans: [{ id: "reader-pass", title: "Verify the saved reader history", backend: "legacy", state: "Pending migration; project oversight only", projectIds: [uuid(1)], sponsorScopeId: null, ownerScopeId: null }] }),
    project("FirstMate", 2, { memoryPending: 1, plans: [{ id: "owned-runtime", title: "Project mates and durable project ownership", backend: "scoped", state: "sponsorship granted", projectIds: [uuid(2), uuid(1)], sponsorScopeId: uuid(30), ownerScopeId: uuid(40) }] }),
    project("Remote storage", 3, { state: "held", reason: "Project directory is unavailable; identity was not guessed.", profile: null, version: 0 }),
  ] };
window.projectActions = [];
document.body.style.cssText = `margin:0;background:${theme.colors.surface0};font-family:system-ui`;
createRoot(document.getElementById("root")).render(<QueryClientProvider client={new QueryClient()}>
  <ProjectOwnershipView theme={theme} compact={innerWidth < 638} data={fixture} onRefresh={() => {}} onProvision={p => window.projectActions.push(p.projectId)} onOpen={() => {}} />
</QueryClientProvider>);
