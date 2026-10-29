/** Synthetic retained records; actual production components. No host/model effects. */
import React from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ProjectOwnershipView } from "../../client/project-ownership";
import { SupervisionActivationBoard } from "../../client/supervision-activation";
import { MaintenanceOwnershipBoard } from "../../client/maintenance-ownership";
import { theme as dark } from "../board-list/theme";

const light = { colors: { ...dark.colors, surface0: "#f6f8f7", surface1: "#fff", border: "#c9d2cc", foreground: "#16241b", foregroundMuted: "#52635a" } };
const theme = new URLSearchParams(location.search).get("theme") === "light" ? light : dark;
const uuid = n => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const pause = "Paused for new work; checking 2 saved operations";
const project = { enabled: false, homeId: "fixture-home", registryDigest: "a".repeat(64), sequence: 42, hash: "a".repeat(64), freshness: "current", problems: [], pause,
  general: { agentId: "general", scopeId: uuid(1), slots: 4, headroom: 1, providerAvailability: "unknown" },
  projects: [{ name: "Reader", projectId: uuid(2), scopeId: uuid(3), hostId: "local", directory: "C:/Projects/Reader", state: "admitted", reason: "Opening reply has not been confirmed.",
    version: 2, aliases: [], agentId: uuid(4), workspaceId: "reader-workspace", provisionRequestId: uuid(5), sessions: 1, turns: 1, uncertain: 1, memoryPending: 0,
    profile: { provider: "codex/test", modeId: "full-access" }, limits: { supervisorSessions: 1, supervisorTurns: 4 }, plans: [] }] };
window.policyActivation = { enabled: false, homeId: "fixture-home", problems: [], pause, migrations: [], dispositions: [],
  audits: [{ at: "2026-10-29T10:00:00Z", plan: "reader-pass", supervisor: uuid(6), source: "client UI (unverified)", authorization: "by convention, not verified" }],
  plans: [{ plan: "reader-pass", title: "Check reader history", hash: "b".repeat(64), scopeId: uuid(7), scopeVersion: 2, supervisorId: uuid(6), canAttach: false,
    binding: "active", opening: "uncertain", resumeRequestId: null }] };
window.policyMaintenance = { enabled: false, homeId: "fixture-home", sequence: 42, freshness: "current", lowerBound: false, problems: [], pause,
  cleanup: { state: "held", reason: "Automatic cleanup is unavailable.", conditions: [] }, reservations: [], jobs: [], occurrences: [], hosts: [], incidents: [],
  owners: [{ scopeId: uuid(8), state: "active", agentId: uuid(9), epoch: 1, sessions: 1, turns: 2, uncertain: 1, admission: null, opening: "succeeded" }],
  deliveries: [], captainDecisions: [], decisions: [], outbox: [] };
window.policyReads = []; window.fixtureErrors = [];
document.body.style.cssText = `margin:0;background:${theme.colors.surface0};font-family:system-ui`;
createRoot(document.getElementById("root")).render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
  <main style={{ maxWidth: 850, color: theme.colors.foreground, padding: 16 }}>
    <h1 style={{ fontSize: 20 }}>Saved work after turning help off</h1>
    <p style={{ color: theme.colors.foregroundMuted }}>Isolated component fixture · no agent or message is created.</p>
    <ProjectOwnershipView theme={theme} compact={innerWidth < 638} data={project} onRefresh={() => {}} onProvision={() => { throw new Error("No effects in a read fixture"); }} />
    <SupervisionActivationBoard theme={theme} compact={innerWidth < 638} />
    <MaintenanceOwnershipBoard theme={theme} compact={innerWidth < 638} />
  </main>
</QueryClientProvider>);
