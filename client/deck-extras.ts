/**
 * The deck's extras (`art/ship-deck/assets-2/README.md`): the sail on hull C's mast and the crew's six
 * extra looks — bosun, old salt, navigator, carpenter, rigger, deckhand — served by `firstmate.deck.extras`,
 * which also sends the shark (`client/deck-plank.ts`) and the sky's clouds (`client/deck-clouds.ts`).
 * Pure: which looks there are, who wears which, and which of the sail's two states shows. The sprites
 * are `client/deck-pixi.ts`'s.
 *
 * - **Nothing here is needed to draw.** The mount keeps every image that decodes (`decodeExtras` in
 *   `client/deck-mount.ts`): the sail needs its strip and the mast occluder both, or the mast stays bare;
 *   a look whose image is missing is simply not handed out. The atlas's own two outfits are always there.
 * - **A look per crewmate, stable by agent id.** A sailor wears the look its agent id hashes to, whoever
 *   else is aboard, from poll to poll and from one opening of the deck to the next. Two crewmates can
 *   hash to the same look; with eight looks a small crew is mostly varied, and the hover label says who
 *   is who. A look that did not load is not in the list, so the crew is then dressed from the rest.
 * - **A look is drawn with the atlas's frames.** Each extra look is a texture the atlas's size with every
 *   pose at exactly the atlas's own crew rectangles and feet, so it is drawn, hit-tested and badged with the
 *   base lane's frames (`lookLane`).
 * - **The sail** alternates its rest and billow states every `frameMs` (850 ms) while the deck moves, and
 *   rests under reduced motion. It rides the ship's bob but not the masthead's sway, and hangs behind the
 *   crew; while it shows, the occluder — the mast with the rows behind the cloth cleared — stands in for
 *   the mast's depth piece, so the mast is still drawn over a sailor behind it without painting through the sail.
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

/** The sail, when it can be drawn: its strip and the occluder both decoded, and the piece it replaces is the atlas's. Null otherwise. */
export function drawnSail(extras: DeckExtrasImages | null, pieces: DeckArtManifest["pieces"]): DeckExtrasManifest["sail"] | null {
  if (extras === null) return null;
  const { sail } = extras.manifest;
  if (!extras.images.has(sail.texture) || !extras.images.has(sail.occluder.texture)) return null;
  return pieces[sail.occluder.replaces] === undefined ? null : sail;
}

/** Which of the sail's states shows `seconds` into the scene: alternating while the deck moves, the rest frame while it is still. */
export function sailFrame(seconds: number, sail: { frames: number; frameMs: number }, moving: boolean): number {
  if (!moving || sail.frames <= 1 || !Number.isFinite(seconds)) return 0;
  const step = Math.floor((seconds * 1000) / sail.frameMs) % sail.frames;
  return step < 0 ? step + sail.frames : step;
}
