/**
 * A setting's stage furniture compiled from its pack (`stage` in `shared/deck-setting.ts`): the backdrop and what is cut
 * out of it, the parts drawn over it, the pieces drawn back over the crew, and the lights — and how each moves. Pure,
 * once per pack (`client/deck-mount.ts`); `client/deck-pixi.ts` draws it.
 *
 * - **Parts** (the ship's tall mast, its topmast, the hull's own masthead, the sail) are drawn over the backdrop and
 *   under the floor in the order listed, each where its images arrived, under the same rules as the ambience
 *   (`resolveDrawn`): one that `needs` another goes with it, and a `fallback` is drawn only in place of what it stands
 *   in for, under that one's name (`place`). So without the tall mast's image the ship has no topmast and no sail, and
 *   the hull's own masthead sways in the topmast's place. A part that is not `optional: false` is left out alone.
 * - **The backdrop is drawn round the drawn parts' cutouts** (`cutout`: their bounds), so what a part replaces — the
 *   ship's short rig under the tall mast — is not drawn under it.
 * - **Pieces** are the backdrop's own pixels again at the row they stand on (`depth`, `client/deck-scene.ts`'s
 *   `depthOf`), so a worker behind one is drawn behind it; a drawn part's `replacesPiece` stands in for one, at the
 *   piece's row; a piece `{ over }` another is drawn just in front of it (the ship's plank over the near rail). An
 *   optional piece whose image did not arrive is not drawn — there is no board drawn in code any more.
 * - **Lights** are a style's pixel glyph, its glow and its glass, flickering on out-of-step sines (`flickerAt`).
 * - **How they move** is here too, as functions of a clock: the stage's bob (`bobAt`), a part's sway (`swayAt`), a
 *   cycle held past its first frame for its duty (`dutyFrame`), a light's level and its glass's tint. Whole pixels.
 */
import type { SettingManifest } from "../shared/deck-setting";
import { resolveDrawn } from "./deck-ambience";
import { depthOf } from "./deck-scene";

type Stage = SettingManifest["stage"];
type Part = Stage["parts"][number];
export type Rect = readonly [number, number, number, number];
export type LightStyle = Stage["lightStyles"][string];
type Sprite = { image: string; rect?: readonly [number, number, number, number] | undefined };

/** A sprite with its rectangle: its own, or its whole image's. */
export interface Cut {
  image: string;
  rect: Rect;
}

/** A part drawn: its sprite at its point, its behaviour, and the name of the place it is drawn in. */
export interface DrawnPart {
  id: string;
  /** Its own id, or for a fallback the id of the part it stands in for. */
  place: string;
  cut: Cut;
  at: readonly [number, number];
  behaviour: Part["behaviour"];
  /** A cycle's frames, cut. */
  frames: readonly Cut[];
  lite: Part["lite"];
  still: Part["still"];
}

/** A piece drawn back over the crew: its sprite at its point, its depth, and the part that stands in for it, if one does. */
export interface DrawnPiece {
  id: string;
  cut: Cut;
  at: readonly [number, number];
  depth: number;
  /** The part whose `replacesPiece` this is, or null for the piece itself. */
  by: string | null;
}

/** A light: its style, its point, its depth and seed. */
export interface DrawnLight {
  id: string;
  style: LightStyle;
  at: readonly [number, number];
  depth: number;
  seed: number;
  lite: Stage["lights"][number]["lite"];
  still: Stage["lights"][number]["still"];
}

export interface DeckParts {
  backdrop: Cut;
  /** What is left out of the backdrop for the parts drawn: their cutouts' bounds, or null. */
  cutout: Rect | null;
  parts: readonly DrawnPart[];
  pieces: readonly DrawnPiece[];
  lights: readonly DrawnLight[];
  /** The highest row anything drawn reaches: 0, or above the stage's top (the ship's tall mast). */
  top: number;
  /** The stage's bob, or null when it does not. */
  bob: NonNullable<Stage["motion"]>["bob"] | null;
  /** Every piece's depth, including pieces whose optional image did not arrive. */
  pieceDepths: ReadonlyMap<string, number>;
  /** Every image something was left out for lacking, once each, in the pack's order. */
  missing: readonly string[];
  /** The images a part or piece that is not optional lacked: the stage cannot be drawn without them. */
  required: readonly string[];
}

/**
 * The stage's furniture as it can be drawn: `has` says which images arrived.
 */
export function compileParts(manifest: SettingManifest, has: (image: string) => boolean): DeckParts {
  const { stage } = manifest;
  const missing = new Set<string>();
  const required = new Set<string>();
  const cut = (sprite: Sprite): Cut => {
    const size = manifest.images[sprite.image]?.size ?? [1, 1];
    return { image: sprite.image, rect: sprite.rect ?? [0, 0, size[0], size[1]] };
  };
  const arrived = (images: readonly string[], optional = true) =>
    images.filter(function (image) {
      if (has(image)) return false;
      missing.add(image);
      if (!optional) required.add(image);
      return true;
    }).length === 0;

  // The parts: each drawable where every image it draws with arrived; then which are drawn, fallbacks and needs resolved.
  const imagesOf = (part: Part) => [
    part.sprite.image,
    ...(part.replacesPiece === undefined ? [] : [part.replacesPiece.sprite.image]),
    ...(part.behaviour?.kind === "cycle" ? part.behaviour.frames.sprites.map((sprite) => sprite.image) : []),
  ];
  const can = new Map(stage.parts.map((part) => [part.id, arrived(imagesOf(part), part.optional !== false)]));
  const { drawn, standsInFor } = resolveDrawn(
    stage.parts,
    (part) => can.get(part.id)!,
    (part) => part.needs ?? [],
  );
  const parts = stage.parts
    .filter((part) => drawn.has(part.id))
    .map(
      (part): DrawnPart => ({
        id: part.id,
        place: standsInFor.get(part.id) ?? part.id,
        cut: cut(part.sprite),
        at: part.at,
        behaviour: part.behaviour,
        frames: part.behaviour?.kind === "cycle" ? part.behaviour.frames.sprites.map(cut) : [],
        lite: part.lite,
        still: part.still,
      }),
    );

  // What is cut out of the backdrop: the drawn parts' cutouts, bounded.
  const cutouts = stage.parts.filter((part) => drawn.has(part.id) && part.cutout !== undefined).map((part) => part.cutout!);
  const cutout: Rect | null =
    cutouts.length === 0
      ? null
      : (() => {
          const left = Math.min(...cutouts.map((rect) => rect[0]));
          const top = Math.min(...cutouts.map((rect) => rect[1]));
          const right = Math.max(...cutouts.map((rect) => rect[0] + rect[2]));
          const bottom = Math.max(...cutouts.map((rect) => rect[1] + rect[3]));
          return [left, top, right - left, bottom - top] as const;
        })();

  // The pieces: each at its row, or a drawn part's own rows in its place; one `over` another just in front of it.
  const depthById = new Map<string, number>();
  for (const piece of stage.pieces) if (typeof piece.baseline !== "object" || piece.baseline === null) depthById.set(piece.id, depthOf(piece.baseline, 1));
  const resolving = new Set<string>();
  const pieceDepth = (id: string): number => {
    const found = depthById.get(id);
    if (found !== undefined) return found;
    if (resolving.has(id)) throw new Error(`cyclic piece depth at ${id}`);
    const piece = stage.pieces.find((piece) => piece.id === id);
    if (piece === undefined || typeof piece.baseline !== "object" || piece.baseline === null) throw new Error(`missing piece depth for ${id}`);
    resolving.add(id);
    const depth = pieceDepth(piece.baseline.over) + 1;
    resolving.delete(id);
    depthById.set(id, depth);
    return depth;
  };
  for (const piece of stage.pieces) pieceDepth(piece.id);
  const pieces = stage.pieces.flatMap(function (piece): DrawnPiece[] {
    const depth = depthById.get(piece.id)!;
    const by = stage.parts.find((part) => drawn.has(part.id) && part.replacesPiece?.piece === piece.id);
    if (by !== undefined) return [{ id: piece.id, cut: cut(by.replacesPiece!.sprite), at: by.replacesPiece!.at, depth, by: by.id }];
    return arrived([piece.sprite.image], piece.optional === true) ? [{ id: piece.id, cut: cut(piece.sprite), at: piece.at, depth, by: null }] : [];
  });

  const lights = stage.lights.map(
    (light): DrawnLight => ({
      id: light.id,
      style: stage.lightStyles[light.style]!,
      at: light.at,
      depth: depthOf(light.row, 1) + 0.5,
      seed: light.seed,
      lite: light.lite,
      still: light.still,
    }),
  );

  const order = Object.keys(manifest.images);
  const inOrder = (images: ReadonlySet<string>) => [...images].sort((a, b) => order.indexOf(a) - order.indexOf(b));
  return {
    backdrop: cut(stage.backdrop.sprite),
    cutout,
    parts,
    pieces,
    lights,
    top: Math.min(0, ...parts.map((part) => part.at[1])),
    bob: stage.motion?.bob ?? null,
    pieceDepths: depthById,
    missing: inOrder(missing),
    required: inOrder(required),
  };
}

const TAU = Math.PI * 2;

/** The stage's bob, whole pixels: a sine of `periodS` on its clock, `amplitude` each way before rounding. */
export function bobAt(seconds: number, periodS: number, amplitude: number): number {
  return Math.round(Math.sin((seconds * TAU) / periodS) * amplitude);
}

/** A part's sway, whole pixels: a sine of `periodS` on its clock, `phase` radians on, `amplitude` each way, held to `limit`. */
export function swayAt(seconds: number, sway: { periodS: number; phase: number; limit: number }, amplitude: number): number {
  return Math.max(-sway.limit, Math.min(sway.limit, Math.round(Math.sin((seconds * TAU) / sway.periodS + sway.phase) * amplitude)));
}

/**
 * Which of `count` frames shows `seconds` into a cycle of `frameMs` each, held past the first for `duty` of each cycle
 * (the rest shared evenly; by default every frame has its `frameMs`): the ship's sail, held out longer in a fresher
 * wind. The first while it does not move.
 */
export function dutyFrame(seconds: number, cycle: { count: number; frameMs: number }, moving: boolean, duty?: number): number {
  const { count, frameMs } = cycle;
  if (!moving || count <= 1 || !Number.isFinite(seconds)) return 0;
  const turn = (seconds * 1000) / (frameMs * count);
  const phase = turn - Math.floor(turn);
  const even = (count - 1) / count;
  const out = Math.max(0.05, Math.min(0.95, duty !== undefined && Number.isFinite(duty) ? duty : even));
  if (phase < 1 - out) return 0;
  return Math.min(count - 1, 1 + Math.floor(((phase - (1 - out)) / out) * (count - 1)));
}

/** A light's level `seconds` in: its base and each wave's sine, out of step by its seed, within 0 to 1. */
export function flickerAt(seconds: number, seed: number, flicker: Pick<LightStyle["flicker"], "base" | "waves">): number {
  const value = flicker.waves.reduce((level, [amplitude, rate, offset]) => level + amplitude * Math.sin(seconds * rate + seed * offset), flicker.base);
  return Math.max(0, Math.min(1, value));
}

/** A light's glass at `level`: the first tint whose threshold it is over, else the last. */
export function glassTint(level: number, tints: LightStyle["tints"]): string {
  return (tints.find(([over]) => level > over) ?? tints[tints.length - 1]!)[1];
}

/**
 * A glyph's pixels as rectangles, by ink, relative to its `origin`: each row's runs of one ink, and a run the same as
 * the one below it in the row above made one taller. In the order they first appear, top to bottom, left to right.
 */
export function glyphRects(glyph: readonly string[], origin: readonly [number, number]): Map<string, Array<[number, number, number, number]>> {
  const rects = new Map<string, Array<[number, number, number, number]>>();
  /** The runs still open at the row above, by "ink:x:width". */
  let open = new Map<string, [number, number, number, number]>();
  glyph.forEach(function (row, y) {
    const next = new Map<string, [number, number, number, number]>();
    for (let x = 0; x < row.length; ) {
      const ink = row[x]!;
      let end = x + 1;
      while (end < row.length && row[end] === ink) end += 1;
      if (ink !== ".") {
        const key = `${ink}:${x}:${end - x}`;
        const above = open.get(key);
        if (above !== undefined) {
          above[3] += 1;
          next.set(key, above);
        } else {
          const rect: [number, number, number, number] = [x - origin[0], y - origin[1], end - x, 1];
          rects.set(ink, [...(rects.get(ink) ?? []), rect]);
          next.set(key, rect);
        }
      }
      x = end;
    }
    open = next;
  });
  return rects;
}
