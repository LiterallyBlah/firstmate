import type { FleetCard } from "../shared/fleet";
import type { NeedsYouRequest, NeedsYouSnapshot } from "../shared/needs-you";
import type { TaskColumn } from "../shared/task-layout";
import { decisionQueue } from "./needs-you-state";
import { doneCards } from "./format";
import { decisionCardSnapshot } from "../shared/plan-decisions";

export type TaskOwner = "first-mate" | "worker" | "parked" | "unknown";
export const OWNER_LABELS: Record<TaskOwner, string> = {
  "first-mate": "With the first mate",
  worker: "At work",
  parked: "Parked",
  unknown: "Decision data unavailable",
};
export const TASK_TITLES: Record<TaskColumn, string> = {
  "needs-you": "Needs you",
  "in-hand": "In hand",
  later: "Later",
  done: "Done",
};
export interface TaskPresentation {
  group: TaskColumn;
  owner: TaskOwner;
  line: string;
  request?: NeedsYouRequest;
  reason?: "failure" | "permission" | "review" | "next" | "working" | "waiting" | "parked" | "unknown";
}

export const TASK_REASON_ICONS = { failure: "TriangleAlert", permission: "KeyRound", review: "CircleCheck",
  next: "Compass", working: "Rocket", waiting: "Clock", parked: "Pause", unknown: "CircleHelp" } as const;

/** Last worker update is the observable start of the wait, corrected for a known remote clock skew. */
export function waitingOver30Minutes(entries: readonly { card: FleetCard; summary: TaskPresentation }[], now = Date.now()): number {
  return entries.filter(({ card, summary }) => {
    if (summary.group !== "in-hand" || summary.owner !== "first-mate" || card.remote?.online === false) return false;
    const iso = card.agent?.updatedAt ?? card.remote?.worker?.updatedAt;
    const at = iso ? Date.parse(iso) - (card.remote?.clockSkewSeconds ?? 0) * 1000 : NaN;
    return Number.isFinite(at) && now - at > 30 * 60 * 1000;
  }).length;
}

/** Same structured identity as the ledger, never a title, worker id, column or file position. */
export function taskSourceKey(card: FleetCard): string | null {
  const task = card.backlog?.id ?? card.taskId;
  if (task === null || (card.remote && !card.remote.serverId)) return null;
  return JSON.stringify([
    card.remote ? ["remote", card.remote.serverId] : ["local"],
    (card.backlog ? card.backlog.project : card.project) ?? "",
    task,
  ]);
}
export function requestForCard(card: FleetCard, snapshot?: NeedsYouSnapshot): NeedsYouRequest | undefined {
  const key = taskSourceKey(card);
  return snapshot && decisionCardSnapshot(snapshot).requests.find((request) => request.source.key === key && request.state !== "resolved");
}
export function activeDecisions(snapshot?: NeedsYouSnapshot): NeedsYouRequest[] {
  return decisionQueue(snapshot ? decisionCardSnapshot(snapshot).requests : []).filter(
    (request) => request.state === "new" || request.state === "seen",
  );
}
/** Presentation only. Worker finishes and failures cannot create either decisions or task outcomes. */
export function taskPresentation(card: FleetCard, snapshot?: NeedsYouSnapshot): TaskPresentation {
  const summary = observedTaskPresentation(card, snapshot);
  // Decisions and backlog outcomes are local records; only the remote worker's activity is historical.
  if (card.remote?.online === false && card.remote.worker && summary.group === "in-hand" && !summary.request && summary.reason !== "unknown")
    return { ...summary, line: `Last seen ${summary.line.charAt(0).toLowerCase()}${summary.line.slice(1)}` };
  return summary;
}

function observedTaskPresentation(card: FleetCard, snapshot?: NeedsYouSnapshot): TaskPresentation {
  const item = card.backlog,
    worker = card.agent ?? card.remote?.worker;
  const request = requestForCard(card, snapshot);
  if (item?.section === "done")
    return { group: "done", owner: "first-mate", line: item.outcome || "Completed in the backlog" };
  if (request?.state === "new" || request?.state === "seen")
    return { group: "needs-you", owner: "first-mate", line: request.source.ask, request };
  if (request?.state === "snoozed")
    return {
      group: "later",
      owner: "first-mate",
      line: `Snoozed until ${new Date(request.snoozedUntil!).toLocaleString()}`,
      request,
    };
  if (request?.state === "answer-sent" || request?.state === "delivery-uncertain")
    return {
      group: "in-hand",
      owner: "first-mate",
      line:
        request.state === "answer-sent"
          ? "Answer sent; waiting for the first mate to record the outcome"
          : "Delivery uncertain; check the first mate's conversation",
      request,
    };
  if (item?.blockedBy?.trim()) return { group: "later", owner: "first-mate", line: `After ${item.blockedBy}` };
  if (item?.kind === "captain" && !item.hold?.trim())
    return { group: "later", owner: "first-mate", line: "Parked choice; no question recorded" };
  if (item?.section === "queued" && !worker && !item.hold?.trim())
    return { group: "later", owner: "first-mate", line: "Queued with the first mate" };
  if (item?.hold?.trim() && !request)
    return { group: "in-hand", owner: "unknown", reason: "unknown", line: `Decision unavailable: ${item.hold.trim()}` };
  const status = card.report?.text?.trim();
  if (
    card.column === "failed" ||
    worker?.status === "error" ||
    card.agent?.lastError ||
    card.report?.state === "failed"
  )
    return { group: "in-hand", owner: "first-mate", reason: "failure", line: `Handling a failure: ${card.agent?.lastError || status || "the worker stopped with an error"}` };
  if ((worker?.pendingPermissions ?? 0) > 0) {
    const permission = card.remote?.worker?.permissionDetails[0];
    const detail = permission ? [permission.tool, permission.description].filter(Boolean).join(" · ") : status;
    return { group: "in-hand", owner: "first-mate", reason: "permission", line: `Answering a permission: ${detail || "a tool is waiting for approval"}` };
  }
  if (worker?.status === "running" || worker?.status === "initializing")
    return { group: "in-hand", owner: "worker", reason: "working", line: status ? `Working: ${status}` : "Work is under way" };
  if (card.note === "waiting") return { group: "in-hand", owner: "worker", reason: "waiting", line: status ? `Waiting: ${status}` : "Waiting for work already under way" };
  if (
    card.column === "ready" ||
    card.column === "done" ||
    card.report?.state === "done" ||
    card.report?.state === "resolved"
  )
    return { group: "in-hand", owner: "first-mate", reason: "review", line: status ? `Reviewing: ${status}` : "With the first mate for review" };
  if (card.column === "parked" || card.report?.state === "paused")
    return { group: "in-hand", owner: "parked", reason: "parked", line: status ? `Parked: ${status}` : "Work is parked with the first mate" };
  if (
    card.column === "blocked" ||
    card.report?.state === "needs-decision" ||
    card.report?.state === "blocked" ||
    card.note === "stalled"
  )
    return { group: "in-hand", owner: "first-mate", reason: "next", line: status ? `Deciding the next step: ${status}` : "With the first mate for the next step" };
  return { group: "in-hand", owner: "first-mate", reason: "next", line: status ? `First mate: ${status}` : "With the first mate" };
}
export function presentedTasks(cards: readonly FleetCard[], snapshot?: NeedsYouSnapshot) {
  // Sorting affects only Done; other groups retain fleet order. No cards are hidden by a display cap.
  const done = doneCards(
    cards.filter((card) => card.backlog?.section === "done"),
    true,
  ).shown;
  return [...cards.filter((card) => card.backlog?.section !== "done"), ...done]
    .map((card) => ({ card, summary: taskPresentation(card, snapshot) }))
    .filter(({ summary }) => summary.group !== "needs-you");
}

/** Why a nonempty filtered selection has no ordinary tasks; workers sharing one task count once. */
export function matchingDecisionMessage(cards: readonly FleetCard[], snapshot?: NeedsYouSnapshot): string | null {
  if (!cards.length || cards.some(card => taskPresentation(card, snapshot).group !== "needs-you")) return null;
  const count = new Set(cards.map(taskSourceKey)).size;
  return `${count} matching task${count === 1 ? " is" : "s are"} in Needs you.`;
}
