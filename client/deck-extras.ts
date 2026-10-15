/**
 * The deck's extras (`art/ship-deck/assets-2/README.md`): the tall mast and its sail, the plank's board and the
 * crew's six extra looks — bosun, old salt, navigator, carpenter, rigger, deckhand — served by
 * `firstmate.deck.extras`, which also sends the shark (`client/deck-plank.ts`) and the sky's clouds
 * (`client/deck-clouds.ts`). Pure: which looks there are, who wears which, which of the sail's two states
 * shows, and how the tall mast is cut. The sprites
 * are `client/deck-pixi.ts`'s.
 *
 * - **Nothing here is needed to draw.** The mount keeps every image that decodes (`decodeExtras` in
 *   `client/deck-mount.ts`): the sail needs its strip and the tall mast both, or the short mast stays bare;
 *   a look whose image is missing is simply not handed out. The atlas's own two outfits are always there.
 * - **A look per crewmate, stable by agent id.** A sailor wears the look its agent id hashes to, whoever
 *   else is aboard, from poll to poll and from one opening of the deck to the next. Two crewmates can
 *   hash to the same look; with eight looks a small crew is mostly varied, and the hover label says who
 *   is who. A look that did not load is not in the list, so the crew is then dressed from the rest.
 * - **A look is drawn with the atlas's frames.** Each extra look is a texture the atlas's size with every
 *   pose at exactly the atlas's own crew rectangles and feet, so it is drawn, hit-tested and badged with the
 *   base lane's frames (`lookLane`).
 * - **The tall mast** (`art/ship-deck/mast/`) stands in for the hull's own short one where it decoded: the
 *   hull's crow's nest, upper mast and stays are left out (`clears`), the mast is drawn behind the sail and
 *   the crew with its crow's nest and topmast swaying as the masthead did, and its own rows below the sail
 *   are the mast's depth piece (`mastLayout`), so the mast is still drawn over a sailor behind it without
 *   painting over the cloth. Without it, the short rig is drawn bare, as before the sail.
 * - **The sail** (`art/ship-deck/sails/`), fitted to the tall mast, hangs only on it: its yard on the mast's
 *   lashing point under the crow's nest. It alternates its rest and billow states every `frameMs` (850 ms)
 *   while the deck moves, and rests under reduced motion. It rides the ship's bob but not the masthead's
 *   sway, and hangs behind the crew.
 * - **The plank** is the generated board (`art/ship-deck/plank/`) at its placement, where it decoded; the
 *   board drawn in code (`client/deck-plank.ts`) stands in for it otherwise, so a sailor never walks out on nothing.
 */
import type { DeckArtManifest, DeckExtrasManifest, SailorOutfit } from "../shared/ship-deck";

/** The extras as the mount hands them over: what the manifest says, and each image that decoded. */
export interface DeckExtrasImages {
  manifest: DeckExtrasManifest;
  images: ReadonlyMap<string, unknown>;
  /** Each cloud sprite cut into its three slot masks, by texture, for those that could be cut (`client/deck-clouds.ts`). */
  cloudMasks?: ReadonlyMap<string, readonly [unknown, unknown, unknown]>;
}

/** The atlas's own two outfits, always there: the first two looks. */
export const ATLAS_LOOKS: readonly SailorOutfit[] = ["base", "outfit"];

/** Every look the crew can wear: the atlas's two, then each extra look whose image arrived, in the manifest's order. */
export function crewLooks(extras: DeckExtrasImages | null): string[] {
  const looks: string[] = [...ATLAS_LOOKS];
  for (const look of extras?.manifest.crew ?? []) {
    if (extras!.images.has(look.texture) && !looks.includes(look.id)) looks.push(look.id);
  }
  return looks;
}

/** Whose frames a look is drawn with: an atlas outfit its own, an extra look the base lane's. */
export function lookLane(look: string): SailorOutfit {
  return look === "outfit" ? "outfit" : "base";
}

function hashOf(text: string): number {
  // FNV-1a: unrelated to the walk's seed, so a sailor's look and its idle rhythm do not go together.
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) hash = Math.imul(hash ^ text.charCodeAt(index), 0x01000193) >>> 0;
  return hash;
}

/** The look a sailor wears: the one its `identity` (its agent's id) hashes to among `looks`. */
export function lookFor(identity: string, looks: readonly string[]): string {
  return looks[hashOf(identity) % looks.length] ?? "base";
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

/** Which of the sail's states shows `seconds` into the scene: alternating while the deck moves, the rest frame while it is still. */
export function sailFrame(seconds: number, sail: { frames: number; frameMs: number }, moving: boolean): number {
  if (!moving || sail.frames <= 1 || !Number.isFinite(seconds)) return 0;
  const step = Math.floor((seconds * 1000) / sail.frameMs) % sail.frames;
  return step < 0 ? step + sail.frames : step;
}
