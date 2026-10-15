/**
 * The deck's tweaks, without Pixi: the sail and the crew's looks as the ship pack has them (`art/settings/ship/`), who
 * wears which look, the sail's billow, the plank's board, and the idle sailor at ease. The sprites themselves are
 * `deck-environment.test.ts`'s, through `startDeck` with a stand-in Pixi. The wake drawn in code is retired.
 */
import { readFileSync } from "node:fs";
import { URL } from "node:url";
import { inflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";

import { extrasImagePaths } from "../test/deck-legacy";
import { applyCrew, createCrew, crewFigures } from "./deck-crew";
import type { DeckExtrasImages } from "../test/deck-legacy";
import { compileParts, dutyFrame } from "./deck-parts";
import { compileStage } from "./deck-stage";
import type { DeckSailor, DeckState } from "./deck-scene";
import { shipCast, shipFile, shipManifest, shipStage, shipViews } from "../test/ship-pack";
import { availableLooks, breathSink as castBreathSink, laneOf, lookFor, settledPose, standing } from "./deck-cast";

// The ship's cast, under the names its constants had in the deck's code.
const STATE_POSES = Object.fromEntries((["working", "waiting", "blocked", "idle"] as const).map((state) => [state, shipCast().settled[state].pose])) as Record<DeckState, string>;
const BREATH_ROWS = shipCast().breath!.rows;
const BREATH_MS = shipCast().breath!.periodMs;
const SAILOR_POSES = [...shipCast().lanes.get("base")!.keys()];
const ATLAS_LOOKS = shipCast().looks.filter((look) => !look.optional).map((look) => look.id);
const looksFore = (seed: number) => settledPose(shipCast(), "idle", "front", seed).flip;
const breathSink = (seed: number, nowMs: number) => castBreathSink(shipCast(), seed, nowMs);
const lookLane = (look: string) => laneOf(shipCast(), look);
/** The looks to hand out when these extras' images arrived: the cast's that must draw, and each other one whose image is among them. */
const crewLooks = (extras: { images: ReadonlyMap<string, unknown> } | null) => availableLooks(shipCast(), (image) => extras?.images.has(shipViews().paths.get(image) ?? "") ?? false);

const art = (path: string) => shipFile(path);
const manifest = shipViews().extras;
/** The extra looks' images: the cast's, decoded with the rest of the pack, and handed to the deck beside the extras'. */
const lookPaths = shipCast()
  .looks.filter((look) => look.optional)
  .map((look) => shipViews().paths.get(look.image)!);
const extras: DeckExtrasImages = { manifest, images: new Map([...extrasImagePaths(manifest), ...lookPaths].map((path) => [path, { image: path }])) };

/** A PNG's size and the alpha of any pixel: RGBA, 8 bits, no interlace, as the art pipeline writes them. */
function decodePng(file: Buffer): { width: number; height: number; alpha: (x: number, y: number) => number } {
  const width = file.readUInt32BE(16);
  const height = file.readUInt32BE(20);
  expect([file[24], file[25], file[28]]).toEqual([8, 6, 0]);
  const chunks: Buffer[] = [];
  for (let at = 8; at < file.length; ) {
    const length = file.readUInt32BE(at);
    if (file.toString("ascii", at + 4, at + 8) === "IDAT") chunks.push(file.subarray(at + 8, at + 8 + length));
    at += length + 12;
  }
  const raw = inflateSync(Buffer.concat(chunks));
  const stride = width * 4;
  const pixels = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y += 1) {
    const filter = raw[y * (stride + 1)]!;
    for (let x = 0; x < stride; x += 1) {
      const value = raw[y * (stride + 1) + 1 + x]!;
      const left = x >= 4 ? pixels[y * stride + x - 4]! : 0;
      const up = y > 0 ? pixels[(y - 1) * stride + x]! : 0;
      const corner = x >= 4 && y > 0 ? pixels[(y - 1) * stride + x - 4]! : 0;
      let out = value;
      if (filter === 1) out = value + left;
      else if (filter === 2) out = value + up;
      else if (filter === 3) out = value + ((left + up) >> 1);
      else if (filter === 4) {
        const p = left + up - corner;
        const pa = Math.abs(p - left);
        const pb = Math.abs(p - up);
        const pc = Math.abs(p - corner);
        out = value + (pa <= pb && pa <= pc ? left : pb <= pc ? up : corner);
      }
      pixels[y * stride + x] = out & 0xff;
    }
  }
  return { width, height, alpha: (x, y) => pixels[y * stride + x * 4 + 3]! };
}

function sailor(key: string, state: DeckState = "idle", identity = `agent-${key}`): DeckSailor {
  return {
    key,
    label: key,
    state,
    identity,
    stale: false,
    caption: { title: key, status: state, project: null, host: "This machine", line: null, stale: null },
  };
}

describe("the sail and the crew's looks, as served", () => {
  it("fit the atlas: every look the atlas's size, with every pose drawn at the base lane's frames and nothing outside them", () => {
    const frames = SAILOR_POSES.flatMap((pose) => [standing(shipCast(), "base", pose).frame, standing(shipCast(), "outfit", pose).frame]);
    const inside = (x: number, y: number) => frames.some(([fx, fy, fw, fh]) => x >= fx && x < fx + fw && y >= fy && y < fy + fh);
    for (const look of shipCast().looks.filter((each) => each.image !== shipManifest().stage.backdrop.sprite.image)) {
      const png = decodePng(readFileSync(art(shipManifest().images[look.image]!.path)));
      expect([png.width, png.height], look.id).toEqual(shipManifest().images[shipManifest().stage.backdrop.sprite.image]!.size);
      for (const pose of SAILOR_POSES) {
        const [fx, fy, fw, fh] = standing(shipCast(), "base", pose).frame;
        let opaque = 0;
        for (let y = fy; y < fy + fh; y += 1) for (let x = fx; x < fx + fw; x += 1) if (png.alpha(x, y) === 255) opaque += 1;
        expect(opaque, `${look.id} ${pose}`).toBeGreaterThan(40);
      }
      for (let y = 0; y < png.height; y += 1) {
        for (let x = 0; x < png.width; x += 1) if (!inside(x, y)) expect(png.alpha(x, y), `${look.id} at ${x},${y}`).toBe(0);
      }
    }
  }, 20_000);

  it("hang the taller sail on the tall mast, its yard at the mast's lashing point, under the crow's nest and clear of the deck", () => {
    const parts = shipManifest().stage.parts;
    const part = parts.find((each) => each.id === "sail")!;
    if (part.behaviour?.kind !== "cycle") throw new Error("the sail is a cycle");
    const frames = part.behaviour.frames.sprites.map((sprite) => sprite.rect!);
    const sail = { texture: shipManifest().images[part.sprite.image]!.path, frames: frames.length, frameSize: [frames[0]![2], frames[0]![3]] as const, position: part.at };
    // The tall mast's top: its topmast's place.
    const mast = { position: parts.find((each) => each.id === "topmast")!.at };
    expect(part.needs).toEqual(["tall-mast"]);
    const strip = decodePng(readFileSync(art(sail.texture)));
    expect([strip.width, strip.height]).toEqual([sail.frameSize[0] * sail.frames, sail.frameSize[1]]);
    expect([sail.frames, sail.frameSize[0], sail.frameSize[1]]).toEqual([2, 114, 84]);
    const [x, y] = sail.position;
    // The yard's lashing (the strip's (57, 3)) on the tall mast's (its own (24, 68), docs/ship-deck-art/mast/README.md).
    expect([x + 57, y + 3]).toEqual([mast.position[0] + 24, mast.position[1] + 68]);
    // Across the mast's shaft, below the crow's nest (its floor is the mast's row 44), and its hem above the
    // open deck (the far bulwark is about row 86) and the mast's foot.
    expect(x).toBeLessThan(207);
    expect(x + sail.frameSize[0]).toBeGreaterThan(216);
    expect(y).toBeGreaterThan(mast.position[1] + 44);
    expect(y + sail.frameSize[1]).toBeLessThanOrEqual(72);
    // The yard and its top rows hold still between the two states: only the cloth below them breathes.
    for (let row = 0; row < 8; row += 1) for (let column = 0; column < sail.frameSize[0]; column += 1) expect(strip.alpha(column, row)).toBe(strip.alpha(column + sail.frameSize[0], row));
  });
});

describe("who wears which look", () => {
  it("offers the atlas's two outfits, then each extra look whose image arrived", () => {
    expect(crewLooks(null)).toEqual(["base", "outfit"]);
    expect(crewLooks(extras)).toEqual(["base", "outfit", "bosun", "old-salt", "navigator", "carpenter", "rigger", "deckhand"]);
    const missing = { manifest, images: new Map([...extras.images].filter(([path]) => !path.includes("navigator"))) };
    expect(crewLooks(missing)).not.toContain("navigator");
    expect(crewLooks(missing)).toHaveLength(7);
    expect(ATLAS_LOOKS).toEqual(["base", "outfit"]);
    expect([lookLane("base"), lookLane("outfit"), lookLane("bosun")]).toEqual(["base", "outfit", "base"]);
  });

  it("dresses each sailor by its agent id, spreading a crew over every look", () => {
    const looks = crewLooks(extras);
    expect(lookFor("agent-123", looks)).toBe(lookFor("agent-123", looks));
    expect(new Set(Array.from({ length: 200 }, (_, index) => lookFor(`agent-${index}`, looks)))).toEqual(new Set(looks));
    // A small crew is varied: of twelve, at least five looks.
    expect(new Set(Array.from({ length: 12 }, (_, index) => lookFor(`crew-${index}`, looks))).size).toBeGreaterThanOrEqual(5);
  });

  it("keeps a sailor's look by its agent id: from poll to poll, as others come and go, and on any deck it opens on", () => {
    const looks = crewLooks(extras);
    const crew = createCrew(shipStage(), shipCast(), looks);
    applyCrew(crew, [sailor("a", "working"), sailor("b", "idle")], { snap: true });
    const before = crew.walkers.get("a")!.look;
    expect(before).toBe(lookFor("agent-a", looks));
    applyCrew(crew, [sailor("a", "blocked"), sailor("c"), sailor("d")], { snap: false });
    applyCrew(crew, [sailor("a", "waiting"), sailor("c")], { snap: false });
    expect(crew.walkers.get("a")!.look).toBe(before);
    const alone = createCrew(shipStage(), shipCast(), looks);
    applyCrew(alone, [sailor("a", "idle")], { snap: true });
    expect(alone.walkers.get("a")!.look).toBe(before);
    const figure = crewFigures(crew, 0, { still: true }).find((each) => each.key === "a")!;
    expect([figure.look, figure.lane]).toEqual([before, lookLane(before)]);
    // Relaunched — the same card, a new agent — it dresses as the new agent.
    const other = Array.from({ length: 50 }, (_, index) => `agent-new-${index}`).find((id) => lookFor(id, looks) !== before)!;
    applyCrew(crew, [sailor("a", "waiting", other), sailor("c")], { snap: false });
    expect(crew.walkers.get("a")!.look).toBe(lookFor(other, looks));
  });

  it("without any extra look, wears the atlas's two outfits as before", () => {
    const crew = createCrew(shipStage(), shipCast());
    applyCrew(crew, ["a", "b", "c"].map((key) => sailor(key)), { snap: true });
    expect([...crew.walkers.values()].every((walker) => walker.look === "base" || walker.look === "outfit")).toBe(true);
  });
});

describe("the sail's billow", () => {
  const sailPart = shipManifest().stage.parts.find((each) => each.id === "sail")!;
  const behaviour = sailPart.behaviour!;
  if (behaviour.kind !== "cycle") throw new Error("the sail is a cycle");
  const sail = { count: behaviour.frames.sprites.length, frameMs: behaviour.frames.frameMs };
  const drawn = (...gone: string[]) =>
    compileParts(shipManifest(), (image) => !gone.includes(image))
      .parts.map((part) => part.id);

  it("alternates its states every 850 ms while the deck moves, and rests while it is still", () => {
    expect([sail.frameMs, behaviour.frames.clock, behaviour.duty]).toEqual([850, "sail", { channel: "billow" }]);
    expect([0, 0.849, 0.85, 1.69, 1.7].map((seconds) => dutyFrame(seconds, sail, true))).toEqual([0, 0, 1, 1, 0]);
    for (const seconds of [0, 0.9, 12.3]) expect(dutyFrame(seconds, sail, false)).toBe(0);
    expect(dutyFrame(Number.NaN, sail, true)).toBe(0);
  });

  it("is drawn only with its strip, on the tall mast it is fitted to", () => {
    expect(drawn()).toEqual(["tall-mast", "topmast", "sail"]);
    expect(drawn("sails-main-sail")).toEqual(["tall-mast", "topmast"]);
    expect(drawn("mast-tall-mast")).toEqual(["masthead"]);
  });
});

describe("the plank's board", () => {
  it("is the generated one where its image decoded, and none otherwise: the code board is retired", () => {
    const plank = (...gone: string[]) => compileParts(shipManifest(), (image) => !gone.includes(image)).pieces.find((piece) => piece.id === "plank");
    expect(plank()).toMatchObject({ cut: { image: "plank-plank" }, at: [241, 120] });
    expect(plank("plank-plank")).toBeUndefined();
  });
});

describe("a sailor at ease", () => {
  it("stands in profile, arms at its sides — never the arm-forward lean", () => {
    expect(STATE_POSES.idle).toBe("side-idle");
    expect(Object.values(STATE_POSES)).not.toContain("leaning");
  });

  it("looks fore or aft along the rail by its seed, and breathes: head and shoulders settle a pixel and rise, feet planted", () => {
    // This cast behaviour remains available to zones that draw the actor itself.
    const stage = compileStage(shipManifest());
    stage.zoneOf("idle").appearance = null;
    const crew = createCrew(stage, shipCast());
    applyCrew(crew, Array.from({ length: 6 }, (_, index) => sailor(`idle-${index}`)), { snap: true });
    const flips = new Set(crewFigures(crew, 0, { still: true }).map((figure) => figure.flip));
    expect(flips).toEqual(new Set([true, false]));
    for (const walker of crew.walkers.values()) {
      const sinks = new Set<number>();
      for (let at = 0; at < BREATH_MS * 2; at += 100) {
        const figure = crewFigures(crew, at, { still: false }).find((each) => each.key === walker.key)!;
        expect(figure.y).toBe(figure.row);
        expect(figure.x).toBe(Math.round(walker.x));
        expect(figure.flip).toBe(looksFore(walker.seed));
        sinks.add(figure.sink);
      }
      expect(sinks).toEqual(new Set([0, 1]));
    }
    // Out for about half of each four seconds; never under reduced motion, never for another state.
    let out = 0;
    for (let at = 0; at < BREATH_MS; at += 10) out += breathSink(7, at);
    expect(out / (BREATH_MS / 10)).toBeGreaterThan(0.4);
    expect(out / (BREATH_MS / 10)).toBeLessThan(0.6);
    for (let at = 0; at < BREATH_MS; at += 100) expect(crewFigures(crew, at, { still: true }).every((figure) => figure.sink === 0)).toBe(true);
    const busy = createCrew(shipStage(), shipCast());
    applyCrew(busy, [sailor("w", "working"), sailor("b", "blocked"), sailor("q", "waiting")], { snap: true });
    for (let at = 0; at < BREATH_MS; at += 100) expect(crewFigures(busy, at, { still: false }).every((figure) => figure.sink === 0)).toBe(true);
    expect(BREATH_ROWS).toBeLessThan(standing(shipCast(), "base", "side-idle").frame[3] / 2);
  });
});
