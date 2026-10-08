/**
 * What a crewmate says about itself.
 *
 * Every crewmate brief ends with the same instruction: finish every turn with
 * one status line, `<state>: <one short line>`, as the last line of the last
 * message. That line is the whole protocol between a crewmate and everything
 * that watches it — the board files the card under it, and the hooks decide
 * from it whether the first mate has to be woken.
 *
 * A turn that ends without one is not an error: the card falls back to what
 * Paseo knows (running, idle, waiting on a permission), and the first mate is
 * told the crewmate stopped without saying why.
 */
import type { CrewState } from "../shared/fleet";

export interface CrewReport {
  state: CrewState;
  /** The words after the colon, trimmed. */
  text: string;
}

const STATES: ReadonlyArray<CrewState> = [
  "working",
  "needs-decision",
  "blocked",
  "paused",
  "done",
  "failed",
  "resolved",
];

/**
 * `done: PR https://…`, and the spellings an agent drifts into: a bullet or
 * bold in front, `status:` before the state, a `[key=…]` tag before the colon.
 */
const STATUS_LINE =
  /^\s*(?:[-*>]\s*)?(?:\*\*|__)?(?:status\s*[:=]\s*)?(working|needs[-_ ]decision|blocked|paused|done|failed|resolved)(?:\*\*|__)?\s*(?:\[[^\]]*\]\s*)?:\s*(.*?)\s*(?:\*\*|__)?\s*$/i;

function normalizeState(raw: string): CrewState | null {
  const state = raw.toLowerCase().replace(/[_ ]/g, "-");
  return STATES.find((candidate) => candidate === state) ?? null;
}

/**
 * The status line in a crewmate's last message: the last line that matches,
 * searched from the end, within the final few non-empty lines. A status word
 * earlier in the message is prose ("the build is done: …"), not a report.
 */
export function parseCrewReport(message: string | null | undefined, window = 4): CrewReport | null {
  if (message === null || message === undefined) return null;
  const lines = message
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "" && !/^```/.test(line));
  for (const line of lines.slice(-window).reverse()) {
    const match = STATUS_LINE.exec(line);
    if (match === null) continue;
    const state = normalizeState(match[1] ?? "");
    if (state === null) continue;
    return { state, text: (match[2] ?? "").trim() };
  }
  return null;
}

/** The first `https://` URL in a report — a pull request, when the state is `done`. */
export function reportUrl(text: string): string | null {
  return /https?:\/\/[^\s()<>]+/.exec(text)?.[0]?.replace(/[.,;]+$/, "") ?? null;
}

/**
 * What a status line says its worker is waiting on, once its turn has ended: `outside` — a gate, a
 * run, a watcher, a background job, another worker, "until …" — that will move on its own; the
 * `captain`, whose word it needs; the `first-mate`, who has to act; or null when it waits on nothing,
 * and a worker that stopped saying `working` has stalled.
 */
export type WaitTarget = "outside" | "captain" | "first-mate";

const WAITING =
  /\b(?:wait(?:s|ing)?|await(?:s|ing)?|until|pending|watch(?:er|ers|es|ing)?|gates?|background|running|polling|sleep(?:s|ing)?|queued|wakes?|check(?:ing)? back|in progress|blocked (?:on|by)|behind)\b/i;
const CAPTAIN = /\b(?:captain|approval|go-ahead|sign-?off|decision|your (?:answer|reply|call|word))\b/i;
const FIRST_MATE = /\bfirst[- ]?mate\b/i;

export function waitTarget(text: string): WaitTarget | null {
  if (!WAITING.test(text)) return null;
  if (CAPTAIN.test(text)) return "captain";
  if (FIRST_MATE.test(text)) return "first-mate";
  return "outside";
}
