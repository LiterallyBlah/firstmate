/**
 * The replies the captain can give a sailor from the deck, and where its speech bubble hangs. Pure but for
 * the answered store, which is module scope like the suggestion gate.
 *
 * A reply is one of the first mate's suggestions (`data/suggestions.md`) — the buttons the Crew tab shows
 * above the board, which send their words to the first mate as the captain's. The deck adds no option and
 * no way to send one: it hangs the suggestions that **name a crewmate** over that crewmate's sailor, and a
 * chip sends through the board's own `suggest`. A suggestion names a crewmate when its label or prompt
 * carries the card's task id, its pull request (the URL, or `repo#42`), or its agent id (eight characters at
 * least) as a whole word (`cardReplies`). One that names several crewmates hangs over each; one that names
 * none is still available in the shark's full suggestion list and the board's strip.
 *
 * The board's strip keeps a suggestion until the first mate rewrites the file, which can be a turn later.
 * The deck clears a sailor's marker and bubble as soon as the captain has picked one of its replies, from the
 * deck or the strip (`answeredReplies`) — its other replies with it, since they are most often the other
 * answers to the same question — and offers them again only if the send fails, or once the file has dropped
 * the one picked.
 */
import type { FleetCard, Suggestion } from "../shared/fleet";
import type { DeckHover } from "./deck-hover";

/** The shortest agent-id prefix that names a crewmate, as `paseo` accepts one. */
export const AGENT_ID_MIN = 8;
/** The shortest task id read as a name: anything shorter is too likely a word. */
export const TASK_ID_MIN = 3;

function escaped(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Whether `name` is in `text` as a whole word, not inside a longer id or word; a path's step counts, as in `fm/<task>`. */
function names(text: string, name: string): boolean {
  return new RegExp(`(^|[^\\w-])${escaped(name)}($|[^\\w-])`, "i").test(text);
}

/** What a suggestion would have to say to name this card's crewmate. */
function cardNames(card: FleetCard): { words: string[]; urls: string[] } {
  const words: string[] = [];
  const urls: string[] = [];
  if (card.taskId !== null && card.taskId.trim().length >= TASK_ID_MIN) words.push(card.taskId.trim());
  const agentId = card.agent?.id ?? card.remote?.worker?.id ?? null;
  if (agentId !== null && agentId.length >= AGENT_ID_MIN) words.push(agentId, agentId.slice(0, AGENT_ID_MIN));
  if (card.url !== null && card.url !== "") {
    const url = card.url.replace(/[/#?]+$/, "");
    urls.push(url);
    const pull = /github\.com\/([^/\s]+)\/([^/\s]+)\/pull\/(\d+)/i.exec(url);
    if (pull !== null) words.push(`${pull[2]}#${pull[3]}`, `${pull[1]}/${pull[2]}#${pull[3]}`);
  }
  return { words, urls };
}

/** The suggestions that name this card's crewmate, in the file's order. */
export function cardReplies(card: FleetCard, suggestions: readonly Suggestion[]): Suggestion[] {
  const { words, urls } = cardNames(card);
  if (words.length === 0 && urls.length === 0) return [];
  return suggestions.filter(function (suggestion) {
    const text = `${suggestion.label}\n${suggestion.prompt}`;
    const lower = text.toLowerCase();
    // A URL is followed by `/files` or a fragment as often as by a space; `pull/42` must not match `pull/421`.
    return (
      urls.some((url) => new RegExp(`${escaped(url.toLowerCase())}($|[^\\w])`).test(lower)) ||
      words.some((word) => names(text, word))
    );
  });
}

/**
 * Every card's replies still waiting for the captain, by card key; a card with none is left out. A card is
 * answered once any of its replies has been picked: its replies are usually alternatives ("Reviewed PR",
 * "Local-only"), and the rest wait for the first mate to rewrite the file.
 */
export function repliesByCard(
  cards: readonly FleetCard[],
  suggestions: readonly Suggestion[],
  answered: (suggestion: Suggestion) => boolean,
): Map<string, Suggestion[]> {
  const byCard = new Map<string, Suggestion[]>();
  if (suggestions.length === 0) return byCard;
  for (const card of cards) {
    const replies = cardReplies(card, suggestions);
    if (replies.length > 0 && !replies.some(answered)) byCard.set(card.key, replies);
  }
  return byCard;
}

/** The replies the captain has picked, by their words: shared by the board's strip, the deck and the focus panel. */
export interface AnsweredReplies {
  has(suggestion: Suggestion): boolean;
  /** Picked: the deck stops offering it. */
  mark(prompt: string): void;
  /** Its send failed: the deck offers it again. */
  unmark(prompt: string): void;
  /** Forgets those the file no longer has, so one that comes back later is offered again. */
  keepOnly(suggestions: readonly Suggestion[]): void;
  subscribe(listener: () => void): () => void;
  version(): number;
}

export function createAnsweredReplies(): AnsweredReplies {
  const prompts = new Set<string>();
  const listeners = new Set<() => void>();
  let version = 0;
  function changed(): void {
    version += 1;
    listeners.forEach((listener) => listener());
  }
  return {
    has: (suggestion) => prompts.has(suggestion.prompt),
    mark(prompt) {
      if (prompts.has(prompt)) return;
      prompts.add(prompt);
      changed();
    },
    unmark(prompt) {
      if (prompts.delete(prompt)) changed();
    },
    keepOnly(suggestions) {
      const kept = new Set(suggestions.map((suggestion) => suggestion.prompt));
      let dropped = false;
      for (const prompt of [...prompts]) {
        if (kept.has(prompt)) continue;
        prompts.delete(prompt);
        dropped = true;
      }
      if (dropped) changed();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    version: () => version,
  };
}

/** In module scope, like the send gate: the board's strip marks a reply the deck then stops offering. */
export const answeredReplies = createAnsweredReplies();

/** Why the replies cannot be sent just now, in the words a disabled chip gives; null while they can. */
export function replyBlockedText(state: { mate: boolean; sending: boolean }): string | null {
  if (!state.mate) return "There is no first mate aboard to send it to.";
  if (state.sending) return "A message to the first mate is on its way; wait for it to go.";
  return null;
}

/** The bubble's widest, its room from the region's edges, and its gap from the sailor. */
export const BUBBLE_WIDTH = 280;
export const BUBBLE_MARGIN = 8;
export const BUBBLE_GAP = 8;
/** Room the bubble wants above a sailor before it hangs below instead: a line or two and a row of chips. */
export const BUBBLE_ROOM = 96;
/** How far in from the bubble's corners its tail may sit. */
export const TAIL_INSET = 16;

export interface DeckRegion {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/**
 * Where a sailor's speech bubble hangs on the canvas, inside `region` — the whole canvas, or with a sailor
 * focused the room its panel leaves. Above the sailor's marker when there is room, its tail pointing down at
 * the head; for a sailor at rest on the whole deck, under the near rail like its label, so it covers none of
 * the sleepers packed round it; otherwise wherever has more room, below the feet. `maxHeight` is the room it
 * has there, so the bubble scrolls rather than leave the canvas. Given as `bottom` above, so its height need
 * not be measured. `tail` is the tail's middle, from the bubble's left.
 */
export interface BubblePlacement {
  left: number;
  width: number;
  top?: number;
  bottom?: number;
  maxHeight: number;
  side: "above" | "below";
  tail: number;
}

export function bubblePlacement(at: DeckHover, region: DeckRegion, options: { focused: boolean }): BubblePlacement {
  const inner = {
    left: region.left + BUBBLE_MARGIN,
    right: region.right - BUBBLE_MARGIN,
    top: region.top + BUBBLE_MARGIN,
    bottom: region.bottom - BUBBLE_MARGIN,
  };
  const width = Math.round(Math.max(0, Math.min(BUBBLE_WIDTH, inner.right - inner.left)));
  const left = Math.round(Math.max(inner.left, Math.min(at.x - width / 2, inner.right - width)));
  const tail = Math.round(Math.max(Math.min(TAIL_INSET, width / 2), Math.min(at.x - left, width - Math.min(TAIL_INSET, width / 2))));
  const above = at.top - BUBBLE_GAP - inner.top;
  const below = (from: number) => inner.bottom - from - BUBBLE_GAP;
  const hang = (from: number): BubblePlacement => ({
    left,
    width,
    top: Math.round(from + BUBBLE_GAP),
    maxHeight: Math.max(0, Math.floor(below(from))),
    side: "below",
    tail,
  });
  if (!options.focused && at.floor !== null && below(at.floor) >= BUBBLE_ROOM) return hang(at.floor);
  if (above >= BUBBLE_ROOM || above >= below(at.bottom)) {
    return { left, width, bottom: Math.round(at.height - at.top + BUBBLE_GAP), maxHeight: Math.max(0, Math.floor(above)), side: "above", tail };
  }
  return hang(at.bottom);
}
