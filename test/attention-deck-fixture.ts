import type { PluginTheme } from "@getpaseo/plugin";
import type { FleetCard, ColumnId } from "../shared/fleet";
import type { NeedsYouRequest, NeedsYouSnapshot, NeedsYouState } from "../shared/needs-you";

export const attentionTheme = { colors: { surface0: "#181B1A", surface1: "#1E2120", surface2: "#272A29", border: "#303937", foreground: "#fafafa", foregroundMuted: "#A1A5A4", accent: "#20744A", accentForeground: "#ffffff", statusSuccess: "#6cb17b", statusWarning: "#c09664", statusDanger: "#d8847b" } } as unknown as PluginTheme;
export function attentionCard(key: string, column: ColumnId, worker = true): FleetCard {
  return { key, taskId: key, column, title: key, project: "Sample", kind: "builder", backlog: null, report: null, url: null,
    agent: !worker ? null : { id: `agent-${key}`, workspaceId: "sample", title: key, provider: "codex", model: null, status: "idle", cwd: "/sample", pendingPermissions: 0, requiresAttention: false, lastError: null, updatedAt: "2026-10-19T12:00:00Z", labels: {} },
  };
}
export function attentionRequest(taskId: string, state: NeedsYouState = "new", hostId = "local"): NeedsYouRequest {
  return { id: `${hostId}:${taskId}`, source: { key: `${hostId}:${taskId}`, taskId, hostId, project: "Sample", title: taskId, ask: "Which option should we take?", url: null, reportPath: null, gateToken: null, section: "in-flight", disposition: "open", blockedBy: null },
    state, generation: 1, revision: 1, detectedAt: 1000, updatedAt: 2000, originalAsk: "Which option should we take?", baseline: false, seenAt: state === "seen" ? 2000 : null, seenRevision: state === "seen" ? 1 : null, snoozedUntil: state === "snoozed" ? 5000 : null, submissions: [], resolution: null,
  };
}
export function attentionSnapshot(requests: NeedsYouRequest[] = [attentionRequest("Choose the release"), attentionRequest("Pick the next project", "seen")]): NeedsYouSnapshot {
  return { homeId: "sample-home", version: 4, actionCount: requests.filter(r => r.state === "new" || r.state === "seen").length, newCount: requests.filter(r => r.state === "new").length, snoozedCount: requests.filter(r => r.state === "snoozed").length, pendingAnswerCount: requests.filter(r => r.state === "answer-sent" || r.state === "delivery-uncertain").length,
    freshness: { status: "fresh", asOf: 1792411200000, checkedAt: 1792411200000, problems: [] }, requests, parked: [], delivery: "off" };
}
export const attentionCards = [attentionCard("Choose the release", "working"), attentionCard("Review the patch", "ready"), attentionCard("Handle a failure", "failed"), attentionCard("Answer a permission", "blocked"), attentionCard("Build the feature", "working"), attentionCard("Run checks", "working"), attentionCard("Paused work", "parked"), attentionCard("Pick the next project", "queued", false)];
