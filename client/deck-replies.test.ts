/**
 * The deck's replies: which of the first mate's suggestions hang over which sailor, the store that clears a
 * picked one, where the speech bubble hangs, and where each reply marker goes on a crowded deck — never on
 * another sailor, its badge or another marker.
 */
import { readFileSync } from "node:fs";
import { URL } from "node:url";
import { describe, expect, it } from "vitest";

import type { FleetCard, Suggestion } from "../shared/fleet";
import { ASK_GLYPH, ASK_LIFT_MS, ASK_SIZE, BADGE_GLYPHS, BADGE_SIZE, askFramePixels, askLift, askPixels } from "./deck-badges";
import { applyCrew, createCrew, crewFigures, type Figure } from "./deck-crew";
import { inRects } from "./deck-geometry";
import { askMarks, badgeBox, boxesOverlap, figureBox, hoverOf, markBox, sailorAt, type DeckHover } from "./deck-hover";
import {
  BUBBLE_GAP,
  BUBBLE_MARGIN,
  BUBBLE_ROOM,
  BUBBLE_WIDTH,
  bubblePlacement,
  cardReplies,
  createAnsweredReplies,
  repliesByCard,
  replyBlockedText,
} from "./deck-replies";
import type { DeckSailor, DeckState } from "./deck-scene";
import { shipManifest, shipStage, shipViews } from "../test/ship-pack";


// The ship's stage, under the names its constants had in the deck's code.
const stage = shipStage();
const restOverflow = stage.zones.get("rest")!.overflow as { areas: ReadonlyArray<readonly [number, number, number, number]>; spacing: readonly [number, number] };
const REST_SPACING = { x: restOverflow.spacing[0], y: restOverflow.spacing[1] };
const PLACES = Object.fromEntries((Object.keys(shipManifest().zones.byState) as DeckState[]).map((state) => [state, stage.zoneOf(state).id])) as Record<DeckState, string>;
const anchorsAt = (place: string) => stage.zones.get(place)!.posts;

const manifest = shipViews().art;

function card(key: string, extra: Partial<FleetCard> = {}): FleetCard {
  return {
    key,
    column: "blocked",
    taskId: key,
    title: `Task ${key}`,
    project: "web",
    kind: "builder",
    backlog: null,
    agent: null,
    report: null,
    url: null,
    ...extra,
  };
}
const say = (label: string, prompt: string): Suggestion => ({ label, prompt });

describe("which suggestions are a sailor's replies", () => {
  it("names a crewmate by its task id as a whole word, its branch included, never inside a longer id", () => {
    const deck = card("deck-clouds");
    expect(cardReplies(deck, [say("Land deck-clouds", "Merge it")])).toHaveLength(1);
    expect(cardReplies(deck, [say("Land it", "Merge the branch fm/deck-clouds, captain's word.")])).toHaveLength(1);
    expect(cardReplies(deck, [say("Ship", "Rebase DECK-CLOUDS on main.")])).toHaveLength(1);
    expect(cardReplies(deck, [say("Ship", "Land deck-clouds-2 instead")])).toHaveLength(0);
    expect(cardReplies(deck, [say("Ship", "Land my-deck-clouds")])).toHaveLength(0);
    expect(cardReplies(deck, [say("Install the deck update", "Install the latest FirstMate revision")])).toHaveLength(0);
    // A task id too short to be a name is not read as one.
    expect(cardReplies(card("ui"), [say("Fix the ui", "Fix the ui")])).toHaveLength(0);
  });

  it("names it by its pull request: the URL, or repo#number, but not a longer number", () => {
    const pr = card("t1", { url: "https://github.com/you/web/pull/42" });
    expect(cardReplies(pr, [say("Land", "Merge https://github.com/you/web/pull/42, captain's word.")])).toHaveLength(1);
    expect(cardReplies(pr, [say("Review", "Read https://github.com/you/web/pull/42/files first")])).toHaveLength(1);
    expect(cardReplies(pr, [say("Land web#42", "Merge it")])).toHaveLength(1);
    expect(cardReplies(pr, [say("Land", "Merge you/web#42")])).toHaveLength(1);
    expect(cardReplies(pr, [say("Land", "Merge https://github.com/you/web/pull/421")])).toHaveLength(0);
    expect(cardReplies(pr, [say("Land web#421", "Merge it")])).toHaveLength(0);
    expect(cardReplies(pr, [say("Land api#42", "Merge it")])).toHaveLength(0);
  });

  it("names it by its agent id, whole or its first eight characters, local or remote", () => {
    const agent = card("t2", {
      taskId: null,
      agent: {
        id: "3c14b11a-b4bd-4e9f-b140-70a023c69b0a",
        workspaceId: "ws",
        title: "t2",
        provider: "claude",
        model: null,
        status: "idle",
        cwd: "/w",
        pendingPermissions: 0,
        requiresAttention: false,
        lastError: null,
        updatedAt: "",
        labels: {},
      },
    });
    expect(cardReplies(agent, [say("Nudge", "Tell 3c14b11a to rebase")])).toHaveLength(1);
    expect(cardReplies(agent, [say("Nudge", "Tell 3c14b11a-b4bd-4e9f-b140-70a023c69b0a to rebase")])).toHaveLength(1);
    expect(cardReplies(agent, [say("Nudge", "Tell 3c14b11 to rebase")])).toHaveLength(0);
    const remote = card("t3", {
      taskId: null,
      remote: {
        serverId: "light",
        host: "Light",
        online: true,
        clockSkewSeconds: 0,
        worker: { id: "abcdef0123", name: "t3", status: "idle", updatedAt: "", pendingPermissions: 0, permissionDetails: [], recentTools: [], followed: false },
      },
    });
    expect(cardReplies(remote, [say("Nudge", "Ask abcdef01 on Light")])).toHaveLength(1);
  });

  it("keeps the file's order, hangs a suggestion naming two crewmates over both, and answers a card with any one picked", () => {
    const a = card("alpha-task");
    const b = card("beta-task");
    const both = say("Land both", "Merge alpha-task and beta-task");
    const first = say("Land alpha", "Merge alpha-task");
    const neither = say("Coffee", "Make coffee");
    const byCard = repliesByCard([a, b, card("gamma-task")], [first, neither, both], () => false);
    expect(byCard.get("alpha-task")).toEqual([first, both]);
    expect(byCard.get("beta-task")).toEqual([both]);
    expect(byCard.has("gamma-task")).toBe(false);
    // One reply picked answers its crewmate: the other replies, often the other answers, go with it.
    const picked = repliesByCard([a, b], [first, both], (suggestion) => suggestion === first);
    expect(picked.has("alpha-task")).toBe(false);
    expect(picked.get("beta-task")).toEqual([both]);
    const shared = repliesByCard([a, b], [first, both], (suggestion) => suggestion === both);
    expect([...shared.keys()]).toEqual([]);
  });
});

describe("the replies the captain has picked", () => {
  it("are marked by their words, offered again when the send fails, and forgotten once the file drops them", () => {
    const store = createAnsweredReplies();
    let heard = 0;
    const stop = store.subscribe(() => (heard += 1));
    const reply = say("Land", "Merge web#42");
    expect(store.has(reply)).toBe(false);
    store.mark(reply.prompt);
    store.mark(reply.prompt);
    expect([store.has(reply), heard, store.version()]).toEqual([true, 1, 1]);
    store.unmark(reply.prompt);
    expect(store.has(reply)).toBe(false);
    store.mark(reply.prompt);
    store.keepOnly([reply]);
    expect(store.has(reply)).toBe(true);
    store.keepOnly([]);
    expect(store.has(reply)).toBe(false);
    stop();
    store.mark(reply.prompt);
    expect(heard).toBe(4);
  });

  it("says why a reply cannot go, as a disabled chip does", () => {
    expect(replyBlockedText({ mate: true, sending: false })).toBeNull();
    expect(replyBlockedText({ mate: false, sending: false })).toMatch(/no first mate/);
    expect(replyBlockedText({ mate: true, sending: true })).toMatch(/on its way/);
  });
});

describe("where the speech bubble hangs", () => {
  const at = (extra: Partial<DeckHover> = {}): DeckHover => ({ key: "a", x: 400, top: 300, bottom: 360, width: 900, height: 600, floor: null, ...extra });
  const whole = { left: 0, top: 0, right: 900, bottom: 600 };

  it("hangs over the sailor's marker, its tail at the sailor, by its bottom so nothing need be measured", () => {
    const place = bubblePlacement(at(), whole, { focused: false });
    expect(place).toMatchObject({ side: "above", width: BUBBLE_WIDTH, left: 400 - BUBBLE_WIDTH / 2, bottom: 600 - 300 + BUBBLE_GAP, maxHeight: 300 - BUBBLE_GAP - BUBBLE_MARGIN });
    expect(place.left + place.tail).toBe(400);
  });

  it("stays inside the canvas at either edge, its tail still pointing at the sailor as far as its corners allow", () => {
    const left = bubblePlacement(at({ x: 6 }), whole, { focused: false });
    expect(left.left).toBe(BUBBLE_MARGIN);
    expect(left.tail).toBeGreaterThan(0);
    const right = bubblePlacement(at({ x: 896 }), whole, { focused: false });
    expect(right.left + right.width).toBe(900 - BUBBLE_MARGIN);
    expect(right.tail).toBeLessThan(right.width);
    const narrow = bubblePlacement(at({ x: 100, width: 200 }), { ...whole, right: 200 }, { focused: false });
    expect(narrow.width).toBe(200 - BUBBLE_MARGIN * 2);
  });

  it("hangs below the feet when there is no room above, and scrolls rather than leave the canvas", () => {
    const low = bubblePlacement(at({ top: 40, bottom: 100 }), whole, { focused: false });
    expect(low).toMatchObject({ side: "below", top: 100 + BUBBLE_GAP, maxHeight: 600 - BUBBLE_MARGIN - 100 - BUBBLE_GAP });
    // A short canvas: wherever has more room, held to it.
    const short = bubblePlacement(at({ top: 70, bottom: 110, height: 160 }), { ...whole, bottom: 160 }, { focused: false });
    expect(short.side).toBe("above");
    expect(short.maxHeight).toBe(70 - BUBBLE_GAP - BUBBLE_MARGIN);
  });

  it("hangs a sleeper's under the near rail on the whole deck, like its label, but over it when focused", () => {
    expect(bubblePlacement(at({ floor: 380 }), whole, { focused: false })).toMatchObject({ side: "below", top: 380 + BUBBLE_GAP });
    expect(bubblePlacement(at({ floor: 380 }), whole, { focused: true }).side).toBe("above");
    // No room under the rail: over the sailor as for any other.
    expect(bubblePlacement(at({ floor: 600 - BUBBLE_ROOM / 2 }), whole, { focused: false }).side).toBe("above");
  });

  it("keeps to the room a focused sailor's panel leaves", () => {
    const room = { left: 0, top: 0, right: 588, bottom: 600 };
    const place = bubblePlacement(at({ x: 560 }), room, { focused: true });
    expect(place.left + place.width).toBeLessThanOrEqual(588 - BUBBLE_MARGIN);
  });
});

describe("the reply marker", () => {
  it("is a speech bubble with three dots, seven wide like a badge so packed sleepers' marks never touch", () => {
    expect(ASK_GLYPH.every((row) => row.length === ASK_SIZE.width)).toBe(true);
    expect(ASK_GLYPH).toHaveLength(ASK_SIZE.height);
    expect(ASK_SIZE.width).toBe(BADGE_SIZE.width);
    expect(ASK_SIZE.width).toBeLessThan(REST_SPACING.x);
    expect(askPixels().filter((pixel) => pixel.kind === "dot")).toHaveLength(3);
    // Unlike every badge: its sign is no square, and its tail is off to one side.
    for (const glyph of Object.values(BADGE_GLYPHS)) expect(glyph).not.toEqual(ASK_GLYPH.slice(1, 6));
    expect(askPixels(true).map((pixel) => `${6 - pixel.x},${pixel.y}`).sort()).toEqual(askPixels().map((pixel) => `${pixel.x},${pixel.y}`).sort());
    // The fallback frame is the badge's own edge: nothing outside the badge's square.
    expect(askFramePixels().every((pixel) => pixel.x >= 0 && pixel.x < 7 && pixel.y >= 0 && pixel.y < 7)).toBe(true);
  });

  it("bobs a pixel now and then, out of step per sailor", () => {
    expect(askLift(0, 0)).toBe(1);
    expect(askLift(0, ASK_LIFT_MS)).toBe(0);
    const lifts = Array.from({ length: 40 }, (_, step) => askLift(0, step * 100));
    expect(new Set(lifts)).toEqual(new Set([0, 1]));
    expect(askLift(20, 0)).not.toBe(askLift(0, 0));
  });

  const sailor = (key: string, state: DeckState, asks = true): DeckSailor => ({
    key,
    label: key,
    state,
    identity: `agent-${key}`,
    stale: false,
    asks,
    caption: { title: key, status: state, project: null, host: "This machine", line: null, stale: null },
  });
  function deck(sailors: DeckSailor[]): Figure[] {
    const crew = createCrew(shipStage());
    applyCrew(crew, sailors, { snap: true });
    return crewFigures(crew, 0, { still: true });
  }

  it("hangs over the badge on an open deck, and the pointer finds the sailor on it", () => {
    const figures = deck([sailor("a", "blocked"), sailor("b", "working", false)]);
    const marks = askMarks(figures, manifest);
    expect([...marks.keys()]).toEqual(["a"]);
    const a = figures.find((figure) => figure.key === "a")!;
    const mark = marks.get("a")!;
    const badge = badgeBox(a, manifest);
    expect(mark).toMatchObject({ framed: false, flip: false });
    expect(markBox(mark).bottom).toBeLessThan(badge.top);
    expect(sailorAt(figures, manifest, { x: mark.left + 3.5, y: mark.top + 2.5 }, marks)?.key).toBe("a");
    expect(sailorAt(figures, manifest, { x: mark.left + 3.5, y: mark.top + 2.5 })).toBeNull();
    // The label and bubble go over the marker, not the badge.
    const fit = { scale: 2, x: 0, y: 0 };
    expect(hoverOf(a, manifest, fit, { x: 0, y: 0 }, { width: 900, height: 400 }, shipStage().zoneOf(a.state).labelFloor, mark).top).toBe(mark.top * 2);
  });

  it("is never on another sailor, its badge or another marker, however crowded the deck — the badge's frame when nothing round it is clear", () => {
    for (const extra of [0, 3, 6]) {
      for (const idle of [1, 6, anchorsAt("rest").length, 16, 24]) {
        const others = (["working", "waiting", "blocked"] as const).flatMap((state) =>
          Array.from({ length: anchorsAt(PLACES[state]).length + extra }, (_, index) => sailor(`${state}-${index}`, state)),
        );
        const sleepers = Array.from({ length: idle }, (_, index) => sailor(`idle-${String(index).padStart(2, "0")}`, "idle"));
        const figures = deck([...others, ...sleepers]);
        const marks = askMarks(figures, manifest);
        expect(marks.size).toBe(figures.length);
        const placed = [...marks.entries()];
        for (const [key, mark] of placed) {
          const box = markBox(mark);
          const own = figures.find((figure) => figure.key === key)!;
          if (mark.framed) {
            expect(box).toEqual(badgeBox(own, manifest));
            continue;
          }
          for (const other of figures) {
            if (other.key === key) continue;
            expect(boxesOverlap(box, figureBox(other, manifest)!), `${extra}/${idle}: ${key} on ${other.key}`).toBe(false);
          }
          for (const [otherKey, other] of placed) {
            if (otherKey !== key) expect(boxesOverlap(box, markBox(other)), `${extra}/${idle}: ${key} on ${otherKey}'s marker`).toBe(false);
          }
        }
      }
    }
  });

  it("shows on a stale sailor never, and on one still climbing out of the hatch not yet", () => {
    const crew = createCrew(shipStage());
    applyCrew(crew, [sailor("a", "working")], { snap: true });
    applyCrew(crew, [sailor("a", "working"), sailor("b", "working")], { snap: false });
    const climbing = crewFigures(crew, 0, { still: false });
    expect(askMarks(climbing, manifest).has("b")).toBe(false);
    expect(askMarks(climbing, manifest).has("a")).toBe(true);
    expect(askMarks(deck([{ ...sailor("c", "working"), stale: true }]), manifest).size).toBe(0);
  });
});
