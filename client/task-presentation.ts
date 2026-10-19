import type { FleetCard } from "../shared/fleet";
import type { NeedsYouRequest, NeedsYouSnapshot } from "../shared/needs-you";
import type { TaskColumn } from "../shared/task-layout";
import { decisionQueue } from "./needs-you-state";
import { doneCards } from "./format";

export type TaskOwner = "first-mate" | "worker" | "parked";
export const OWNER_LABELS: Record<TaskOwner, string> = {
  "first-mate": "With the first mate",
  worker: "At work",
  parked: "Parked",
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
  return snapshot?.requests.find((request) => request.source.key === key && request.state !== "resolved");
}
export function activeDecisions(snapshot?: NeedsYouSnapshot): NeedsYouRequest[] {
  return decisionQueue(snapshot?.requests ?? []).filter(
    (request) => request.state === "new" || request.state === "seen",
  );
}
/** Presentation only. Worker finishes and failures cannot create either decisions or task outcomes. */
export function taskPresentation(card: FleetCard, snapshot?: NeedsYouSnapshot): TaskPresentation {
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
  if (
    card.column === "failed" ||
    worker?.status === "error" ||
    card.agent?.lastError ||
    card.report?.state === "failed"
  )
    return { group: "in-hand", owner: "first-mate", line: "The first mate is handling a failed run" };
  if ((worker?.pendingPermissions ?? 0) > 0)
    return { group: "in-hand", owner: "first-mate", line: "With the first mate for a permission" };
  if (worker?.status === "running" || worker?.status === "initializing")
    return { group: "in-hand", owner: "worker", line: "Work is under way" };
  if (card.note === "waiting") return { group: "in-hand", owner: "worker", line: "Waiting for work already under way" };
  if (
    card.column === "ready" ||
    card.column === "done" ||
    card.report?.state === "done" ||
    card.report?.state === "resolved"
  )
    return { group: "in-hand", owner: "first-mate", line: "With the first mate for review" };
  if (card.column === "parked" || card.report?.state === "paused")
    return { group: "in-hand", owner: "parked", line: "Work is parked with the first mate" };
  if (
    card.column === "blocked" ||
    card.report?.state === "needs-decision" ||
    card.report?.state === "blocked" ||
    card.note === "stalled"
  )
    return { group: "in-hand", owner: "first-mate", line: "With the first mate for the next step" };
  return { group: "in-hand", owner: "first-mate", line: "With the first mate" };
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
