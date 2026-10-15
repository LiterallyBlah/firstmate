import type { PluginTheme } from "@getpaseo/plugin";

import {
  COLUMN_IDS,
  type AgentSummary,
  type ColumnId,
  type FleetCard,
  type WatchResult,
  type WatchSummary,
} from "../shared/fleet";

export interface ColumnMeta {
  id: ColumnId;
  title: string;
  /** Lucide icon name. */
  icon: string;
}

export const COLUMNS: Readonly<Record<ColumnId, ColumnMeta>> = {
  queued: { id: "queued", title: "Queued", icon: "Inbox" },
  working: { id: "working", title: "Working", icon: "Hammer" },
  blocked: { id: "blocked", title: "Blocked", icon: "Ban" },
  parked: { id: "parked", title: "Parked", icon: "Clock" },
  done: { id: "done", title: "Done", icon: "Check" },
  failed: { id: "failed", title: "Failed", icon: "AlertTriangle" },
  idle: { id: "idle", title: "Idle", icon: "CircleDot" },
  ready: { id: "ready", title: "Ready", icon: "UserCheck" },
};

/** The saved order, known ids only, followed by any column it does not mention. */
export function orderedColumns(saved: readonly string[]): ColumnId[] {
  const known = new Set<string>(COLUMN_IDS);
  const kept = saved.filter((id): id is ColumnId => known.has(id));
  const seen = new Set<string>(kept);
  return [...new Set([...kept, ...COLUMN_IDS.filter((id) => !seen.has(id))])];
}

/**
 * Moves one column by `delta` places among the `shown` ones, clamped to the
 * ends, and returns the whole order. A column that is not shown keeps its place
 * relative to its neighbours, so hiding a column never loses where it goes; the
 * moved one lands just past the shown column it swaps with, so every press of an
 * arrow moves it on screen.
 */
export function moveColumn(
  order: readonly ColumnId[],
  id: ColumnId,
  delta: number,
  shown: readonly ColumnId[] = order,
): ColumnId[] {
  const visible = order.filter((column) => shown.includes(column));
  const from = visible.indexOf(id);
  const to = Math.max(0, Math.min(visible.length - 1, from + delta));
  const neighbour = visible[to];
  if (from === -1 || to === from || neighbour === undefined) return [...order];
  const next = order.filter((column) => column !== id);
  const past = next.indexOf(neighbour);
  next.splice(to < from ? past : past + 1, 0, id);
  return next;
}

export const LIST_GROUPS = [
  { id: "needs-you", title: "Needs you" },
  { id: "working", title: "Working" },
  { id: "queued", title: "Queued" },
  { id: "idle", title: "Idle / stalled" },
  { id: "done", title: "Done" },
] as const;
export type ListGroupId = (typeof LIST_GROUPS)[number]["id"];

/** Urgency wins over placement, including a held or permission-waiting Done item. */
export function listGroup(card: FleetCard): ListGroupId {
  if (
    ["blocked", "ready", "failed"].includes(card.column) ||
    Boolean(card.backlog?.hold?.trim()) ||
    (card.agent?.pendingPermissions ?? card.remote?.worker?.pendingPermissions ?? 0) > 0 ||
    card.agent?.status === "error" ||
    card.remote?.worker?.status === "error" ||
    card.report?.state === "needs-decision"
  )
    return "needs-you";
  if (card.column === "working") return "working";
  if (card.column === "queued") return "queued";
  if (card.column === "done") return "done";
  // Parked work remains visible here too, with its own state icon and status.
  return "idle";
}

export function listGroups(cards: readonly FleetCard[]): Map<ListGroupId, FleetCard[]> {
  const groups = new Map<ListGroupId, FleetCard[]>(LIST_GROUPS.map(({ id }) => [id, []]));
  for (const card of cards) groups.get(listGroup(card))!.push(card);
  return groups;
}

/** Only failing, invalid or switched-off watches draw attention in the header. */
export function watchAttention(watches: readonly WatchSummary[]): {
  count: number;
  failing: boolean;
} {
  const failing = (watch: WatchSummary) => watch.invalid !== null || ["failed", "invalid"].includes(watch.lastResult);
  return {
    count: watches.filter((watch) => !watch.enabled || failing(watch)).length,
    failing: watches.some(failing),
  };
}

/**
 * Whether a card opens the way it was left. One that has moved column since —
 * its crewmate finished, failed, started again — goes back to rest, because
 * the actions it was showing were for where it was; one with something in
 * progress in it (a steer half-typed, an End waiting to be confirmed) stays
 * open, so the move never costs the captain what they were doing.
 */
export function opensAsLeft(left: { column: ColumnId; inProgress: boolean }, column: ColumnId): boolean {
  return left.inProgress || left.column === column;
}

export function columnTone(theme: PluginTheme, column: ColumnId): string {
  switch (column) {
    case "working":
      return theme.colors.accent;
    case "blocked":
    case "parked":
      return theme.colors.statusWarning;
    case "done":
      return theme.colors.statusSuccess;
    case "failed":
      return theme.colors.statusDanger;
    default:
      return theme.colors.foregroundMuted;
  }
}

/** What a crewmate's status chip says. A remote worker's status is Paseo's too, as a plain string. */
type StatusOf = Pick<AgentSummary, "pendingPermissions"> & {
  status: string;
  requiresAttention?: boolean;
};

export function agentStatusLabel(agent: StatusOf): string {
  if (agent.pendingPermissions > 0) {
    return agent.pendingPermissions === 1
      ? "waiting on a permission"
      : `waiting on ${agent.pendingPermissions} permissions`;
  }
  switch (agent.status) {
    case "running":
      return "working";
    case "initializing":
      return "starting";
    case "error":
      return "errored";
    case "closed":
      return "closed";
    case "idle":
      return "idle";
    default:
      return agent.status;
  }
}

export function agentStatusTone(theme: PluginTheme, agent: StatusOf): string {
  if (agent.pendingPermissions > 0 || agent.requiresAttention === true) return theme.colors.statusWarning;
  if (agent.status === "error") return theme.colors.statusDanger;
  if (agent.status === "running" || agent.status === "initializing") return theme.colors.accent;
  return theme.colors.foregroundMuted;
}

/** A token count as Paseo's own context meter writes it: "840", "84k", "1m". */
export function formatTokenCount(value: number): string {
  if (value >= 1_000_000) return `${Math.round(value / 1_000_000)}m`;
  if (value >= 1_000) return `${Math.round(value / 1_000)}k`;
  return Math.round(value).toString();
}

/** How full a context window is, in percent, or null while the provider has not said. */
export function contextPercent(used: number | null | undefined, max: number | null | undefined): number | null {
  if (typeof used !== "number" || typeof max !== "number") return null;
  if (!Number.isFinite(used) || !Number.isFinite(max) || used < 0 || max <= 0) return null;
  return (used / max) * 100;
}

/** The meter's colour, at Paseo's own thresholds: past 90% it is danger, from 70% a warning. */
export function contextTone(theme: PluginTheme, percent: number): string {
  if (percent > 90) return theme.colors.statusDanger;
  if (percent >= 70) return theme.colors.statusWarning;
  return theme.colors.foregroundMuted;
}

const WATCH_RESULTS: Readonly<Record<WatchResult, string>> = {
  never: "not run yet",
  silent: "nothing new",
  queued: "waiting for the first mate",
  dropped: "dropped before the first mate could take it",
  delivered: "sent to the first mate",
  failed: "failed",
  invalid: "cannot run",
};

/** One line on how a watch stands: "every 5 min" is the schedule's, this is the rest — "off · ran 5m ago · nothing new". */
export function watchStatusText(watch: WatchSummary, now: number = Date.now()): string {
  const parts: string[] = [];
  if (!watch.enabled) parts.push("off");
  if (watch.running) parts.push("running now");
  if (watch.lastRunAt !== null && watch.lastResult !== "invalid")
    parts.push(`ran ${relativeTime(watch.lastRunAt, now)}`);
  parts.push(WATCH_RESULTS[watch.lastResult]);
  return parts.join(" · ");
}

export function watchTone(theme: PluginTheme, watch: WatchSummary): string {
  if (!watch.enabled) return theme.colors.foregroundMuted;
  switch (watch.lastResult) {
    case "failed":
    case "invalid":
      return theme.colors.statusDanger;
    case "queued":
    case "dropped":
      return theme.colors.statusWarning;
    case "delivered":
      return theme.colors.accent;
    default:
      return theme.colors.foregroundMuted;
  }
}

/** "just now", "5m ago", "3h ago", "2d ago". */
export function relativeTime(iso: string, now: number = Date.now()): string {
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return "";
  const seconds = Math.max(0, Math.round((now - then) / 1000));
  if (seconds < 45) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 36) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

/**
 * What showing the Files view changes about the saved layout: a wide layout
 * whose right pane is hidden brings it back, or opening a file there would
 * draw nothing. A phone shows Files as a tab, and a shown pane needs nothing.
 */
export function revealFilesPatch(compact: boolean, boardCollapsed: boolean): { boardCollapsed: false } | null {
  return !compact && boardCollapsed ? { boardCollapsed: false } : null;
}

/** The last `max` characters of a path, from a separator, so the end — the part that differs — survives. */
export function shortPath(path: string, max = 48): string {
  if (path.length <= max) return path;
  const tail = path.slice(-max);
  const cut = tail.indexOf("/");
  return `…${cut > 0 ? tail.slice(cut) : tail}`;
}

/** The provider and model, `claude/opus` style, or whichever of the two is known. */
export function modelLabel(agent: Pick<AgentSummary, "provider" | "model">): string {
  return agent.model === null ? agent.provider : `${agent.provider}/${agent.model}`;
}

/** How a crewmate's status line names its state. */
export const REPORT_STATES: Readonly<Record<string, string>> = {
  working: "Working",
  "needs-decision": "Needs a decision",
  blocked: "Blocked",
  paused: "Paused",
  done: "Done",
  failed: "Failed",
  resolved: "Resolved",
};

/**
 * The one line a card shows at rest: the most pressing thing about it. A
 * remote permission waiting, then an error, then the captain's call, then the
 * crewmate's own status line; an in-flight item with no worker says so, and a
 * queued one names what it waits for. The open card shows every one of them, in full. `lead` is drawn in the column's
 * colour; `danger` draws the whole line in the danger colour.
 */
export interface CardHeadline {
  lead: string | null;
  text: string;
  tone: "column" | "danger" | "muted";
}

export function cardHeadline(card: FleetCard): CardHeadline | null {
  const remote = card.remote ?? null;
  const worker = remote?.worker ?? null;
  const permission = worker?.permissionDetails[0];
  if (permission !== undefined) {
    return {
      lead: `Waiting on ${permission.tool}`,
      text: permission.description ?? `answer it on ${remote?.host ?? "its host"}`,
      tone: "column",
    };
  }
  if ((card.agent?.pendingPermissions ?? worker?.pendingPermissions ?? 0) > 0) {
    return {
      lead: "Waiting on a permission",
      text: "Converse to answer it",
      tone: "column",
    };
  }
  const error = card.agent?.lastError ?? null;
  if (error !== null && error !== "") return { lead: null, text: error, tone: "danger" };
  const hold = card.backlog?.hold ?? null;
  if (hold !== null && hold !== "") return { lead: "Captain's call", text: hold, tone: "column" };
  if (card.report !== null) {
    return {
      lead: REPORT_STATES[card.report.state] ?? card.report.state,
      text: card.report.text,
      tone: "column",
    };
  }
  if (card.agent === null && worker === null && card.backlog?.section === "in-flight") {
    return { lead: null, text: orphanText(remote), tone: "muted" };
  }
  const after = card.backlog?.blockedBy ?? null;
  if (after !== null && after !== "") return { lead: null, text: `After ${after}`, tone: "muted" };
  return null;
}

/** What an in-flight item with no worker found for it says. */
export function orphanText(remote: FleetCard["remote"] | null): string {
  if (remote === null || remote === undefined) return "No worker is running for this item.";
  if (remote.serverId === null) return "Paseo has no saved host by this name.";
  return `No worker of this first mate's was found on ${remote.host}.`;
}

/** How many Done cards the board shows until the captain asks for all of them. */
export const DONE_SHOWN = 3;

/** The date a card's work finished or last moved, `YYYY-MM-DD…`, for ordering Done; "" when nothing says. */
function finishedOn(card: FleetCard): string {
  const written = /\d{4}-\d{2}-\d{2}/.exec(card.backlog?.outcome ?? card.backlog?.since ?? "")?.[0];
  return written ?? card.agent?.updatedAt ?? card.remote?.worker?.updatedAt ?? "";
}

/**
 * Done, most recent first — by the date the backlog line records (`merged 2026-10-08`), else the
 * agent's last update — and cut to `DONE_SHOWN` unless `all`. Undated cards keep their order, after
 * the dated ones. `hidden` is how many were cut.
 */
export function doneCards(cards: readonly FleetCard[], all: boolean): { shown: FleetCard[]; hidden: number } {
  const sorted = cards
    .map((card, index) => ({ card, index, on: finishedOn(card) }))
    .sort((a, b) => (a.on === b.on ? a.index - b.index : a.on === "" ? 1 : b.on === "" ? -1 : b.on.localeCompare(a.on)))
    .map((entry) => entry.card);
  const shown = all ? sorted : sorted.slice(0, DONE_SHOWN);
  return { shown, hidden: sorted.length - shown.length };
}

/** Cards grouped by column, each column in the order the daemon sent them. */
export function groupCards(cards: readonly FleetCard[]): Map<ColumnId, FleetCard[]> {
  const groups = new Map<ColumnId, FleetCard[]>(COLUMN_IDS.map((id) => [id, []]));
  for (const card of cards) groups.get(card.column)?.push(card);
  return groups;
}

/**
 * The sentence a failure is worth showing. An RPC that fails in the daemon
 * reaches the app as "Request failed: <the handler's message>
 * requestType=plugin.rpc.invoke.request code=handler_error"; the wrapper is
 * for logs, and the captain gets the message the handler wrote.
 */
export function errorText(caught: unknown): string {
  const raw = caught instanceof Error ? caught.message : String(caught);
  const clean = raw
    .replace(/^Request failed:\s*/, "")
    .replace(/\s+requestType=\S+(\s+code=\S+)?\s*$/, "")
    .trim();
  return clean === "" ? raw : clean;
}
