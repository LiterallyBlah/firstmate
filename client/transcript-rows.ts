import { decisionAnswerSummary, type DecisionAnswerSummary } from "./decision-answer-summary";
import { readBearingsMessage } from "../shared/bearings";
/**
 * The first mate's timeline, turned into the rows the chat pane draws.
 *
 * The full transcript is one click away — the pane's Open button shows the
 * first mate in Paseo itself, with every tool call and its output. This pane
 * is for the conversation with the captain, so it keeps the words and folds
 * the machinery: a tool call is one line, reasoning is left out, and the
 * notes Paseo and the board inject into the first mate's inbox are shown as
 * the one line that says what happened rather than as the raw envelope.
 */
import type { usePaseo } from "@getpaseo/plugin/client";

import { isWatchMessageId } from "../shared/fleet";

type PaseoApi = ReturnType<typeof usePaseo>;
export type TimelinePage = Awaited<ReturnType<ReturnType<PaseoApi["agents"]["ref"]>["timeline"]["refetch"]>>;
export type TimelineEntry = TimelinePage["entries"][number];
type TimelineItem = TimelineEntry["item"];
type ToolCallItem = Extract<TimelineItem, { type: "tool_call" }>;

export type TranscriptRow =
  | { key: string; kind: "plan-ready"; text: string; planId: string }
  | { key: string; kind: "decision-answer"; text: string; answer: DecisionAnswerSummary }
  /** A decision the first mate raised, placed by `./decision-raised`; drawn from the Needs-you snapshot. */
  | { key: string; kind: "decision-raised"; text: string; requestId: string }
  /** `messageId` is the message's `clientMessageId`, under which the chat keeps the images it carried. */
  | { key: string; kind: "captain"; text: string; messageId?: string; overview?: string }
  | { key: string; kind: "mate"; text: string }
  | { key: string; kind: "event"; text: string }
  | { key: string; kind: "tool"; text: string; status: ToolCallItem["status"] }
  | { key: string; kind: "error"; text: string };

/** Envelopes a message is wrapped in when it did not come from the captain. */
const ENVELOPES = ["paseo-system", "firstmate-board"] as const;

/**
 * A watch message — `<firstmate-watch name=… ran=…>` blocks one after another, a
 * `<firstmate-watch-dropped count="N"/>` first when older ones were dropped — as one line naming the
 * watches: "Watch: pr-watch", "Watches: pr-watch, hello (failed) · 3 older dropped". Null for anything
 * else. Called only for a message the plugin sent as one (`isWatchMessageId`); a script cannot write a
 * tag into its own output (the runner escapes them), so every one found is the plugin's.
 */
export function watchSummary(trimmed: string): string | null {
  if (!/^<firstmate-watch(-dropped)?[\s>/]/.test(trimmed)) return null;
  if (!/(<\/firstmate-watch>|\/>)$/.test(trimmed)) return null;
  const blocks = [...trimmed.matchAll(/<firstmate-watch name="([^"]*)"([^>]*)>/g)].map((match) => ({
    name: match[1] ?? "",
    failed: (match[2] ?? "").includes("failed="),
  }));
  const names = [...new Set(blocks.map((block) => block.name))].map((name) =>
    blocks.some((block) => block.name === name && block.failed) ? `${name} (failed)` : name,
  );
  const dropped = /<firstmate-watch-dropped count="(\d+)"\/>/.exec(trimmed)?.[1];
  const head = names.length === 0 ? "Watches" : `${names.length === 1 ? "Watch" : "Watches"}: ${names.join(", ")}`;
  return dropped === undefined ? head : `${head} · ${dropped} older dropped`;
}

/**
 * The first line inside an injected note — "Agent 3f2a… (Fix login) finished." — or null for the captain's
 * own words. `clientMessageId` is the timeline item's: only a message the plugin sent as a watch message
 * is folded as one, so the captain's words stay visible even when they look like a watch note.
 */
export function injectedSummary(text: string, clientMessageId?: string): string | null {
  const trimmed = text.trim();
  const plan = planNoteSummary(trimmed, clientMessageId);
  if (plan) return plan;
  if (isWatchMessageId(clientMessageId)) {
    const watch = watchSummary(trimmed);
    if (watch !== null) return watch;
  }
  for (const tag of ENVELOPES) {
    if (!trimmed.startsWith(`<${tag}>`)) continue;
    const body = trimmed.slice(tag.length + 2).replace(new RegExp(`</${tag}>\\s*$`), "");
    const first = body
      .split("\n")
      .map((line) => line.trim())
      .find((line) => line !== "" && !line.startsWith("<"));
    return first ?? tag;
  }
  return null;
}

/** Every captain action a plan records (`PlanCaptainCommandSchema`); a newer one reads "Plan updated". */
const PLAN_ACTIONS = new Map(Object.entries({ approve: "Plan approved", edit: "Plan approved with edits", changes: "Plan changes requested", hold: "Plan held", resume: "Plan resumed", decline: "Plan declined", answer: "Plan decision answered", transfer: "Plan owner transferred" }));

/** Only an owned, complete plan-action envelope can fold; pasted examples remain the captain's words. */
export function planNoteSummary(text: string, clientMessageId?: string): string | null {
  if (!/^firstmate-plan-[0-9a-f-]{36}$/.test(clientMessageId ?? "")) return null;
  const body = /^<firstmate-plan>\r?\n([\s\S]*)\r?\n<\/firstmate-plan>$/.exec(text.trim())?.[1];
  if (!body || /<\/?firstmate-plan>/.test(body)) return null;
  try {
    const action: unknown = JSON.parse(body.trim().split(/\r?\n/).at(-1)!);
    if (!action || typeof action !== "object" || !("action" in action) || typeof action.action !== "string") return null;
    const head = PLAN_ACTIONS.get(action.action) ?? "Plan updated";
    const plan = "plan" in action && typeof action.plan === "string" && /^[a-z0-9][a-z0-9-]{0,63}$/.test(action.plan) ? action.plan : null;
    return plan === null ? head : `${head} · ${plan}`;
  } catch { return null; }
}

/** One line, at most `max` characters. */
export function clip(text: string, max = 120): string {
  const single = text.replace(/\s+/g, " ").trim();
  return single.length <= max ? single : `${single.slice(0, max - 1)}…`;
}

/** One line for a tool call: what it did, in the fewest words its detail allows. */
export function toolSummary(item: ToolCallItem): string {
  const detail = item.detail;
  switch (detail.type) {
    case "shell":
      return `$ ${clip(detail.command, 100)}`;
    case "read":
      return `Read ${detail.filePath}`;
    case "edit":
      return `Edit ${detail.filePath}`;
    case "write":
      return `Write ${detail.filePath}`;
    case "search":
      return `Search ${clip(detail.query, 80)}`;
    case "fetch":
      return `Fetch ${detail.url}`;
    case "sub_agent":
      return `Agent ${clip(detail.description ?? detail.subAgentType ?? "", 80)}`.trim();
    case "plain_text":
      return clip(detail.label ?? detail.text ?? item.name, 100);
    case "plan":
      return "Plan";
    default:
      return toolDisplayName(item.name);
  }
}

/** MCP tools arrive as `mcp__paseo__create_agent`; the server name is noise. */
export function toolDisplayName(name: string): string {
  return name.replace(/^mcp__[^_]+__/, "").replace(/_/g, " ");
}

const COMPACTING = "Compacting context…";

/**
 * Adds a compaction's line to `rows`. A compaction arrives as two entries, one
 * as it starts and one as it ends, and the second takes the first's place, so
 * a finished compaction is one line rather than two.
 */
export function pushCompaction<Row extends { kind: string; text?: string; key: string }>(
  rows: Row[],
  key: string,
  status: "loading" | "completed",
  make: (key: string, text: string) => Row,
): void {
  const last = rows[rows.length - 1];
  if (status === "completed" && last !== undefined && last.kind === "event" && last.text === COMPACTING) {
    rows[rows.length - 1] = make(last.key, "Context compacted");
    return;
  }
  rows.push(make(key, status === "loading" ? COMPACTING : "Context compacted"));
}

/**
 * A row's key: where its entry starts in the timeline. The end moves while a
 * reply streams or a tool call runs, and a position in the page shifts once
 * the tail is full, so neither is in it — a key that changes remounts the row
 * and forgets that it was open.
 */
export function rowKey(entry: TimelineEntry): string {
  return String(entry.seqStart);
}

/**
 * Whether adjacent text entries continue the same streamed message. The
 * daemon's projected timeline already joins most chunks, but older hosts can
 * leave pieces. Preserve its turn/message boundaries even when a system
 * prompt is omitted, and do not bridge entries hidden by this view.
 */
export function continuesText(previous: TimelineEntry | undefined, entry: TimelineEntry): boolean {
  if (
    previous === undefined ||
    previous.provider !== entry.provider ||
    previous.turnId !== entry.turnId ||
    previous.seqEnd + 1 !== entry.seqStart
  ) return false;
  const item = entry.item;
  if (item.type === "assistant_message" && previous.item.type === "assistant_message") {
    return previous.item.messageId === item.messageId;
  }
  return item.type === "reasoning" && previous.item.type === "reasoning";
}

/** A captain's row for a message with no words, only attachments. */
export const ATTACHMENTS_ONLY = "(attachments)";

/** Timeline entries to rows, joining only continuous chunks of one message. */
export function transcriptRows(entries: readonly TimelineEntry[]): TranscriptRow[] {
  const rows: TranscriptRow[] = [];
  entries.forEach((entry, index) => {
    const key = rowKey(entry);
    const item = entry.item;
    switch (item.type) {
      case "user_message": {
        const bearings = readBearingsMessage(item.text, item.clientMessageId);
        if (bearings) { rows.push({ key, kind: "captain", text: bearings.visible, overview: bearings.overview, messageId: item.clientMessageId! }); break; }
        const answer = decisionAnswerSummary(item.text, item.clientMessageId);
        if (answer) { rows.push({ key, kind: "decision-answer", text: item.text, answer }); break; }
        const summary = injectedSummary(item.text, item.clientMessageId);
        // A message of attachments alone has no words; the row still says the captain sent something.
        const text = item.text.trim() === "" ? ATTACHMENTS_ONLY : item.text;
        const messageId = item.clientMessageId;
        rows.push(
          summary !== null
            ? { key, kind: "event", text: summary }
            : messageId === undefined
              ? { key, kind: "captain", text }
              : { key, kind: "captain", text, messageId },
        );
        break;
      }
      case "assistant_message": {
        const last = rows[rows.length - 1];
        if (last !== undefined && last.kind === "mate" && continuesText(entries[index - 1], entry)) last.text += item.text;
        else rows.push({ key, kind: "mate", text: item.text });
        break;
      }
      case "tool_call":
        rows.push({ key, kind: "tool", text: toolSummary(item), status: item.status });
        break;
      case "error":
        rows.push({ key, kind: "error", text: item.message });
        break;
      case "notification":
        rows.push({ key, kind: item.level === "error" ? "error" : "event", text: item.message });
        break;
      case "compaction":
        pushCompaction(rows, key, item.status, (rowKey, text) => ({ key: rowKey, kind: "event" as const, text }));
        break;
      default:
        break;
    }
  });
  return rows.filter((row) => row.kind !== "mate" || row.text.trim() !== "");
}
