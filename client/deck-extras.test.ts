/**
 * The deck's four tweaks, without Pixi: the sail and the crew's looks as served (the ship pack, `art/settings/ship/`),
 * who wears which look, the sail's billow, the wake's pattern, and the idle sailor at ease. The sprites
 * themselves are `deck-environment.test.ts`'s, through `startDeck` with a stand-in Pixi.
 */
import { readFileSync } from "node:fs";
import { URL } from "node:url";
import { inflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";

import { SAILOR_POSES, extrasImagePaths } from "./deck-legacy";
import { WATERLINE } from "./deck-ambient";
import { BREATH_MS, BREATH_ROWS, STATE_POSES, applyCrew, breathSink, createCrew, crewFigures, looksFore } from "./deck-crew";
import { ATLAS_LOOKS, crewLooks, drawnPlank, drawnSail, lookFor, lookLane, sailFrame, type DeckExtrasImages } from "./deck-extras";
import type { DeckSailor, DeckState } from "./deck-scene";
import { BOW, CHURN_LENGTH, STERN, WAKE_ARMS, wakeRuns } from "./deck-wake";
import { shipFile, shipManifest, shipViews } from "../test/ship-pack";

const art = (path: string) => shipFile(path);
const deck = shipViews().art;
const manifest = shipViews().extras;
const extras: DeckExtrasImages = { manifest, images: new Map(extrasImagePaths(manifest).map((path) => [path, { image: path }])) };

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
    const frames = SAILOR_POSES.flatMap((pose) => [deck.crew.base[pose].frame, deck.crew.outfit[pose].frame]);
    const inside = (x: number, y: number) => frames.some(([fx, fy, fw, fh]) => x >= fx && x < fx + fw && y >= fy && y < fy + fh);
    for (const look of manifest.crew) {
      const png = decodePng(readFileSync(art(look.texture)));
      expect([png.width, png.height], look.id).toEqual(shipManifest().images[shipManifest().stage.backdrop.sprite.image]!.size);
      for (const pose of SAILOR_POSES) {
        const [fx, fy, fw, fh] = deck.crew.base[pose].frame;
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
    const { sail } = manifest;
    const mast = manifest.mast!;
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
    const crew = createCrew(looks);
    applyCrew(crew, [sailor("a", "working"), sailor("b", "idle")], { snap: true });
    const before = crew.walkers.get("a")!.look;
    expect(before).toBe(lookFor("agent-a", looks));
    applyCrew(crew, [sailor("a", "blocked"), sailor("c"), sailor("d")], { snap: false });
    applyCrew(crew, [sailor("a", "waiting"), sailor("c")], { snap: false });
    expect(crew.walkers.get("a")!.look).toBe(before);
    const alone = createCrew(looks);
    applyCrew(alone, [sailor("a", "idle")], { snap: true });
    expect(alone.walkers.get("a")!.look).toBe(before);
    const figure = crewFigures(crew, 0, { still: true }).find((each) => each.key === "a")!;
    expect([figure.look, figure.outfit]).toEqual([before, lookLane(before)]);
    // Relaunched — the same card, a new agent — it dresses as the new agent.
    const other = Array.from({ length: 50 }, (_, index) => `agent-new-${index}`).find((id) => lookFor(id, looks) !== before)!;
    applyCrew(crew, [sailor("a", "waiting", other), sailor("c")], { snap: false });
    expect(crew.walkers.get("a")!.look).toBe(lookFor(other, looks));
  });

  it("without any extra look, wears the atlas's two outfits as before", () => {
    const crew = createCrew();
    applyCrew(crew, ["a", "b", "c"].map((key) => sailor(key)), { snap: true });
    expect([...crew.walkers.values()].every((walker) => walker.look === "base" || walker.look === "outfit")).toBe(true);
  });
});

describe("the sail's billow", () => {
  it("alternates its states every 850 ms while the deck moves, and rests while it is still", () => {
    const { sail } = manifest;
    expect(sail.frameMs).toBe(850);
    expect([0, 0.849, 0.85, 1.69, 1.7].map((seconds) => sailFrame(seconds, sail, true))).toEqual([0, 0, 1, 1, 0]);
    for (const seconds of [0, 0.9, 12.3]) expect(sailFrame(seconds, sail, false)).toBe(0);
    expect(sailFrame(Number.NaN, sail, true)).toBe(0);
  });

  it("is drawn only with its strip, on the tall mast it is fitted to", () => {
    expect(drawnSail(extras, manifest.mast)).toBe(manifest.sail);
    expect(drawnSail(null, manifest.mast)).toBeNull();
    expect(drawnSail(extras, null)).toBeNull();
    const without = { manifest, images: new Map([...extras.images].filter(([each]) => each !== manifest.sail.texture)) };
    expect(drawnSail(without, manifest.mast)).toBeNull();
  });
});

describe("the plank's board", () => {
  it("is the generated one where its image decoded, and the code board's otherwise", () => {
    expect(drawnPlank(extras)).toBe(manifest.plank);
    expect(drawnPlank(null)).toBeNull();
    const without = { manifest, images: new Map([...extras.images].filter(([each]) => each !== manifest.plank!.texture)) };
    expect(drawnPlank(without)).toBeNull();
    const { plank: _plank, ...older } = manifest;
    expect(drawnPlank({ manifest: older, images: extras.images })).toBeNull();
  });
});

describe("the wake", () => {
  const reach = { right: 440, bottom: 300 };

  it("trails from the stern and the bow, on and below the waterline, never forward of the bow or over the hull above the water", () => {
    const runs = wakeRuns(0, reach);
    expect(runs.length).toBeGreaterThan(40);
    for (const run of runs) {
      expect(Number.isInteger(run.x) && Number.isInteger(run.y) && run.width >= 1).toBe(true);
      expect(run.x).toBeGreaterThanOrEqual(BOW.x);
      expect(run.x + run.width - 1).toBeLessThanOrEqual(reach.right);
      expect(run.y).toBeLessThanOrEqual(reach.bottom);
      // Only the churn reaches above the waterline, by a row, and only aft of the stern's foot.
      if (run.y < WATERLINE) expect([run.y, run.x >= STERN.x - 4]).toEqual([WATERLINE - 1, true]);
    }
    // Astern there is broken water right at the hull.
    expect(runs.some((run) => run.x <= STERN.x + 8 && run.y <= WATERLINE + 1 && run.tone === "crest")).toBe(true);
  });

  it("thins as it trails away", () => {
    const pixels = (from: number, to: number) => {
      let count = 0;
      for (let offset = 0; offset < 60; offset += 1) {
        for (const run of wakeRuns(offset, reach)) for (let x = run.x; x < run.x + run.width; x += 1) if (x >= from && x < to && run.y <= WATERLINE + 3) count += 1;
      }
      return count;
    };
    expect(pixels(STERN.x, STERN.x + 20)).toBeGreaterThan(pixels(STERN.x + 100, STERN.x + 120) * 2);
  });

  it("keeps its outline while its foam scrolls aft with the water, a whole pixel at a time", () => {
    const at = (offset: number) => wakeRuns(offset, { right: 1000, bottom: 1000 });
    const set = (runs: ReturnType<typeof wakeRuns>) => new Set(runs.flatMap((run) => Array.from({ length: run.width }, (_, i) => `${run.x + i},${run.y}`)));
    expect(at(17)).toEqual(at(17));
    expect(set(at(0))).not.toEqual(set(at(1)));
    // Twelve pixels on, the same dashes are twelve pixels further aft, wherever the outline lets them show.
    const before = set(at(0));
    const after = set(at(12));
    const churnRows = [...before].filter((point) => {
      const [x, y] = point.split(",").map(Number) as [number, number];
      return y === WATERLINE && x >= STERN.x + 4 && x < STERN.x + 30;
    });
    const carried = churnRows.filter((point) => {
      const [x, y] = point.split(",").map(Number) as [number, number];
      return after.has(`${x + 12},${y}`);
    });
    expect(carried.length / churnRows.length).toBeGreaterThan(0.6);
    // The arms leave the water where the hull meets it.
    for (const arm of WAKE_ARMS) expect(arm.from.y).toBe(WATERLINE);
    expect(CHURN_LENGTH).toBeGreaterThan(100);
  });

  it("goes no further than the screen shows", () => {
    const small = wakeRuns(0, { right: STERN.x + 10, bottom: WATERLINE + 2 });
    expect(small.every((run) => run.x + run.width - 1 <= STERN.x + 10 && run.y <= WATERLINE + 2)).toBe(true);
  });
});

describe("a sailor at ease", () => {
  it("stands in profile, arms at its sides — never the arm-forward lean", () => {
    expect(STATE_POSES.idle).toBe("side-idle");
    expect(Object.values(STATE_POSES)).not.toContain("leaning");
  });

  it("looks fore or aft along the rail by its seed, and breathes: head and shoulders settle a pixel and rise, feet planted", () => {
    const crew = createCrew();
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
    const busy = createCrew();
    applyCrew(busy, [sailor("w", "working"), sailor("b", "blocked"), sailor("q", "waiting")], { snap: true });
    for (let at = 0; at < BREATH_MS; at += 100) expect(crewFigures(busy, at, { still: false }).every((figure) => figure.sink === 0)).toBe(true);
    expect(BREATH_ROWS).toBeLessThan(deck.crew.base["side-idle"].frame[3] / 2);
  });
});
