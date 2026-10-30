import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ProjectOwnershipBoard } from "../../client/project-ownership";
import { theme as dark } from "../board-list/theme";
const params = new URLSearchParams(location.search);
const theme = params.get("theme") === "light" ? { colors: { ...dark.colors, surface0: "#f6f8f7", surface1: "#ffffff", border: "#c9d2cc", foreground: "#16241b", foregroundMuted: "#52635a", statusWarning: "#8a5813", statusDanger: "#a52c2c" } } : dark;
window.fixtureTheme = theme;
window.projectCalls = [];
const input = { homeId: "fixture-home", requestId: "00000000-0000-4000-8000-000000000099", projectId: "00000000-0000-4000-8000-000000000001", projectVersion: 2 };
window.projectSnapshot = { enabled: true, homeId: input.homeId, registryDigest: "a".repeat(64), sequence: 527, hash: "a".repeat(64), freshness: "current", problems: [],
  general: { agentId: "general", scopeId: null, slots: 4, headroom: 1, providerAvailability: "unknown" }, projects: [{ name: "Ariadne", projectId: input.projectId, scopeId: "00000000-0000-4000-8000-000000000002", hostId: "local", directory: "C:/Projects/Aradne", state: "admitted", version: 2, aliases: [],
    reason: params.get("scenario") === "resume" ? "Provisioning incomplete; inspect and resume the recorded request." : null,
    agentId: null, workspaceId: null, provisionRequestId: params.get("scenario") === "resume" ? input.requestId : null,
    provisionInput: params.get("scenario") === "resume" ? input : null,
    sessions: 0, turns: 0, uncertain: 0, memoryPending: 0, profile: { provider: "codex/gpt-6.1-sol", modeId: "full-access", thinkingOptionId: "xhigh" }, limits: { supervisorSessions: 1, supervisorTurns: 12 }, plans: [] }] };
document.body.style.cssText = `margin:0;background:${theme.colors.surface0};color:${theme.colors.foreground};font-family:system-ui`;
createRoot(document.getElementById("root")).render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
  <ProjectOwnershipBoard theme={theme} compact={innerWidth < 638} advanced />
</QueryClientProvider>);
