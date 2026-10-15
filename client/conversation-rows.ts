/**
 * The Converse drawer's Conversation view: a worker's activity, words first.
 *
 * Activity (`activity-rows.ts`) keeps the machinery, because that is what
 * diagnosis needs. Conversing is about what was said, so this is a pure fold
 * over those rows: prompts and replies in full, each with who said it;
 * reasoning left out; a run of tool calls one line that opens to the calls;
 * the latest plan one line. Notes and errors stay as they are.
 *
 * A prompt is the captain's only when it carries the captain's steer id
 * (`isCaptainSteerId`). Anything else — the first mate's brief and later
 * prompts, words typed in Paseo's own tab, a steer sent before steers were
 * tagged — is just a prompt: nothing in the timeline says who sent it.
 */
import type { ActivityRow, PlanStatus } from "./activity-rows";

type ToolRow = Extract<ActivityRow, { kind: "tool" }>;

export type ConversationRow =
  | { key: string; kind: "said"; speaker: "you" | "prompt" | "worker"; text: string }
  | { key: string; kind: "tools"; tools: ToolRow[]; running: boolean; failed: number }
  | { key: string; kind: "plan"; done: number; total: number; current: string | null }
  | { key: string; kind: "event"; text: string }
  | { key: string; kind: "error"; text: string };

/** What a speaker is called on the page, in text and not only in colour. */
export const SPEAKER_LABELS: Record<Extract<ConversationRow, { kind: "said" }>["speaker"], string> = {
  you: "YOU",
  prompt: "PROMPT",
  worker: "WORKER",
};

function planLine(items: readonly { text: string; status: PlanStatus }[]): { done: number; total: number; current: string | null } {
  return {
    done: items.filter((item) => item.status === "completed").length,
    total: items.length,
    current: items.find((item) => item.status === "in_progress")?.text ?? null,
  };
}

export function conversationRows(rows: readonly ActivityRow[]): ConversationRow[] {
  const out: ConversationRow[] = [];
  for (const row of rows) {
    const last = out[out.length - 1];
    switch (row.kind) {
      case "prompt":
        out.push({ key: row.key, kind: "said", speaker: row.captain ? "you" : "prompt", text: row.text });
        break;
      case "reply":
        out.push({ key: row.key, kind: "said", speaker: "worker", text: row.text });
        break;
      case "reasoning":
        break;
      case "tool":
        // Keyed by the run's first call, which does not move as the run grows.
        if (last?.kind === "tools") {
          last.tools.push(row);
          last.running ||= row.status === "running";
          if (row.status === "failed") last.failed += 1;
        } else {
          out.push({ key: row.key, kind: "tools", tools: [row], running: row.status === "running", failed: row.status === "failed" ? 1 : 0 });
        }
        break;
      case "plan":
        out.push({ key: row.key, kind: "plan", ...planLine(row.items) });
        break;
      case "event":
      case "error":
        out.push({ key: row.key, kind: row.kind, text: row.text });
        break;
    }
  }
  return out;
}

/** "6 tool calls", "1 tool call · 1 failed". */
export function toolRunText(row: Extract<ConversationRow, { kind: "tools" }>): string {
  const count = `${row.tools.length} tool call${row.tools.length === 1 ? "" : "s"}`;
  return row.failed === 0 ? count : `${count} · ${row.failed} failed`;
}

/** "Plan 2/5 · Write the tests". */
export function planText(row: Extract<ConversationRow, { kind: "plan" }>): string {
  return `Plan ${row.done}/${row.total}${row.current === null ? "" : ` · ${row.current}`}`;
}

/** A message the captain sent from the drawer, shown at the foot until the transcript has it. */
export interface SentMessage {
  id: string;
  text: string;
  state: "sending" | "sent" | "failed";
  error?: string;
}

/**
 * The captain's sends the transcript does not show yet. A send is shown once
 * the transcript has as many prompts of its text as were seen when it went,
 * plus one — so saying the same thing twice is two rows, and the second is not
 * taken as delivered by the first.
 */
export function unseenSends(
  sends: readonly (SentMessage & { seenBefore: number })[],
  shown: (text: string) => number,
): (SentMessage & { seenBefore: number })[] {
  const claimed = new Map<string, number>();
  return sends.filter((send) => {
    if (send.state !== "sent") return true;
    const text = send.text.trim();
    const used = claimed.get(text) ?? 0;
    if (shown(text) - send.seenBefore - used > 0) {
      claimed.set(text, used + 1);
      return false;
    }
    return true;
  });
}

/** How many prompts in `rows` say `text`, trimmed: the count `unseenSends` compares against. */
export function promptCount(rows: readonly ActivityRow[], text: string): number {
  return rows.filter((row) => row.kind === "prompt" && row.text.trim() === text).length;
}

/** How many times a remote worker's log shows `text`: it has no rows, only what it printed. */
export function logCount(log: string, text: string): number {
  if (text === "") return 0;
  return log.split(text).length - 1;
}
