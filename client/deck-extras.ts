/**
 * The deck's extras (`docs/ship-deck-art/assets-2/README.md`): the tall mast and its sail and the plank's board,
 * served in the setting pack (`firstmate.deck.setting`), which also has the shark (`client/deck-plank.ts`) and the
 * sky's clouds (`client/deck-clouds.ts`). Pure: which of the sail's two states shows, and how the tall mast is cut.
 * The sprites are `client/deck-pixi.ts`'s. The crew's looks — the atlas's two outfits and the six extra ones — are
 * the cast's (`client/deck-cast.ts`).
 *
 * - **Nothing here is needed to draw.** The mount keeps every image that decodes (`packArt` in
 *   `client/deck-mount.ts`): the sail needs its strip and the tall mast both, or the short mast stays bare.
 * - **The tall mast** (`art/settings/ship/mast/`) stands in for the hull's own short one where it decoded: the
 *   hull's crow's nest, upper mast and stays are left out (`clears`), the mast is drawn behind the sail and
 *   the crew with its crow's nest and topmast swaying as the masthead did, and its own rows below the sail
 *   are the mast's depth piece (`mastLayout`), so the mast is still drawn over a sailor behind it without
 *   painting over the cloth. Without it, the short rig is drawn bare, as before the sail.
 * - **The sail** (`art/settings/ship/sails/`), fitted to the tall mast, hangs only on it: its yard on the mast's
 *   lashing point under the crow's nest. It alternates its rest and billow states every `frameMs` (850 ms)
 *   while the deck moves — quicker, and billowed longer, as the crew's work freshens the wind
 *   (`client/deck-atmosphere.ts`) — and rests under reduced motion. It rides the ship's bob but not the masthead's
 *   sway, and hangs behind the crew.
 * - **The plank** is the generated board (`art/settings/ship/plank/`) at its placement, where it decoded; the
 *   board drawn in code (`client/deck-plank.ts`) stands in for it otherwise, so a sailor never walks out on nothing.
 */
import type { DeckArtManifest, DeckExtrasManifest } from "./deck-legacy";

/** The extras as the mount hands them over: what the manifest says, and each image that decoded. */
export interface DeckExtrasImages {
  manifest: DeckExtrasManifest;
  images: ReadonlyMap<string, unknown>;
  /** Each cloud sprite cut into its three slot masks, by texture, for those that could be cut (`client/deck-clouds.ts`). */
  cloudMasks?: ReadonlyMap<string, readonly [unknown, unknown, unknown]>;
}

/** The sail, when it can be drawn: its strip decoded and the tall mast it is fitted to drawn (`drawnMast`). Null otherwise. */
export function drawnSail(extras: DeckExtrasImages | null, mast: DeckExtrasManifest["mast"] | null): DeckExtrasManifest["sail"] | null {
  if (extras === null || mast === null || mast === undefined) return null;
  return extras.images.has(extras.manifest.sail.texture) ? extras.manifest.sail : null;
}

/** The plank's generated board, when its image decoded; null leaves the board drawn in code (`plankPixels`). */
export function drawnPlank(extras: DeckExtrasImages | null): NonNullable<DeckExtrasManifest["plank"]> | null {
  const plank = extras?.manifest.plank;
  return plank === undefined || !extras!.images.has(plank.texture) ? null : plank;
}

/** The tall mast, when it can be drawn: its image decoded, and the piece it replaces is the atlas's. Null leaves the hull's own short rig. */
export function drawnMast(extras: DeckExtrasImages | null, pieces: DeckArtManifest["pieces"]): NonNullable<DeckExtrasManifest["mast"]> | null {
  const mast = extras?.manifest.mast;
  if (mast === undefined || !extras!.images.has(mast.texture)) return null;
  return pieces[mast.replaces] === undefined ? null : mast;
}

/** A frame of an image, [x, y, width, height], and where on the hull it is drawn. */
export interface Placed {
  frame: [number, number, number, number];
  x: number;
  y: number;
}

/** The tall mast cut for drawing, in hull pixels. */
export interface MastLayout {
  /** The crow's nest and the topmast: its top `sway` rows, which sway. */
  head: Placed;
  /** The rest of it, down to its foot, fixed to the hull. */
  shaft: Placed;
  /** Its depth piece on the replaced piece's row: its own rows from that piece's top down, and from below the sail's lower edge. */
  depth: Placed & { baseline: number | null };
  /** Its top row: the world's fit takes it in. */
  top: number;
}

/** How the tall mast is drawn over `piece`, the depth piece it replaces, with `sail` hanging on it (null: no sail). */
export function mastLayout(
  mast: NonNullable<DeckExtrasManifest["mast"]>,
  piece: { y: number; baseline: number | null },
  sail: { position: readonly [number, number]; frameSize: readonly [number, number] } | null,
): MastLayout {
  const [width, height] = mast.size;
  const [x, y] = mast.position;
  const sway = Math.min(mast.sway, height);
  const depthTop = Math.max(piece.y, sail === null ? piece.y : sail.position[1] + sail.frameSize[1], y);
  return {
    head: { frame: [0, 0, width, sway], x, y },
    shaft: { frame: [0, sway, width, height - sway], x, y: y + sway },
    depth: { frame: [0, depthTop - y, width, Math.max(0, y + height - depthTop)], x, y: depthTop, baseline: piece.baseline },
    top: Math.min(0, y),
  };
}

/**
 * Which of the sail's states shows `seconds` into the scene: alternating while the deck moves, the rest frame while
 * it is still. `billow` is the share of each cycle past the rest frame, shared evenly by the others: by default
 * every state has `frameMs`, and a fresher wind (`client/deck-atmosphere.ts`) holds the cloth out longer.
 */
export function sailFrame(seconds: number, sail: { frames: number; frameMs: number }, moving: boolean, billow?: number): number {
  if (!moving || sail.frames <= 1 || !Number.isFinite(seconds)) return 0;
  const cycle = (seconds * 1000) / (sail.frameMs * sail.frames);
  const phase = cycle - Math.floor(cycle);
  const even = (sail.frames - 1) / sail.frames;
  const out = Math.max(0.05, Math.min(0.95, billow !== undefined && Number.isFinite(billow) ? billow : even));
  if (phase < 1 - out) return 0;
  return Math.min(sail.frames - 1, 1 + Math.floor(((phase - (1 - out)) / out) * (sail.frames - 1)));
}
