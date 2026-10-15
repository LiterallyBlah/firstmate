/**
 * The zod contracts of the manifests the deck's art was once served in: what the records in
 * `docs/ship-deck-art/legacy/` are read with (`client/ship-pack.test.ts`), and the shape of what is left of them,
 * the extras' shark and splash, that `legacyViews` (`client/deck-legacy.ts`) still produces until step 7. Types only,
 * for the engine: nothing here is in the client bundle.
 */
import { z } from "zod";

/** A rectangle in the atlas: x, y, width, height, in atlas pixels. */
const Frame = z.tuple([z.number().int(), z.number().int(), z.number().int().positive(), z.number().int().positive()]);

export const DeckArtManifestSchema = z.object({
  /** The whole hull: the backdrop every sailor stands on. Its size is the deck's coordinate space. */
  ship: z.object({ frame: Frame }),
  /**
   * Parts of the hull cut out again to stand in front of a sailor: where each sits on the hull, and the
   * deck row it stands on. A sailor whose feet are on or above that row (further back) is drawn behind it.
   * `null` is in front of everything on deck — the near rail, the stairs and the hull below them.
   */
  pieces: z.record(z.string(), z.object({ frame: Frame, x: z.number().int(), y: z.number().int(), baseline: z.number().int().nullable() })),
});
export type DeckArtManifest = z.infer<typeof DeckArtManifestSchema>;

/** A file inside the pack: a relative path to a PNG, never climbing out. */
const ArtPath = z
  .string()
  .regex(/^[a-z0-9_-]+(\/[a-z0-9_-]+)*\.png$/i, "an image must be a relative .png path inside its pack");
const Size = z.tuple([z.number().int().positive(), z.number().int().positive()]);
const Point = z.tuple([z.number().int(), z.number().int()]);

/**
 * The extras: the tall mast and its sail (`docs/ship-deck-art/mast/README.md`, `docs/ship-deck-art/sails/README.md`),
 * the plank's board (`docs/ship-deck-art/plank/README.md`),
 * and the shark and splash that see a sailor off the plank (`docs/ship-deck-art/shark/README.md`):
 * the record as last served. Of it the engine reads only the shark and splash now; the pack draws the rest itself — the
 * tall mast, the sail and the plank are its stage's parts and pieces — and the record's clouds, sky's mood, flashes,
 * animated water and weather are left out by parsing it, as is all of the environment's record.
 */
export const DeckExtrasManifestSchema = z.object({
  /**
   * The sail: `frames` states of `frameSize` side by side in one strip, drawn at `position` on the hull
   * and alternated every `frameMs`. It is fitted to the tall mast (`mast`), its yard on the mast's, and
   * hangs only on it.
   */
  sail: z.object({
    texture: ArtPath,
    frameSize: Size,
    frames: z.number().int().positive(),
    position: z.tuple([z.number().int(), z.number().int()]),
    frameMs: z.number().positive(),
  }),
  /**
   * The way off by the plank (`docs/ship-deck-art/shark/README.md`): the shark's four keys and the splash's two,
   * each a `size` image whose `anchor` is where it meets the water. `mouth` is the shark's open mouth from
   * that anchor, drawn facing right. Without it, or without an image of it, a sailor still walks the plank
   * and drops into the sea, and the shark or the splash is simply not drawn.
   */
  exit: z
    .object({
      shark: z.object({
        size: Size,
        anchor: Point,
        mouth: Point,
        frames: z.object({ fin: ArtPath, surface: ArtPath, chomp: ArtPath, submerge: ArtPath }),
      }),
      splash: z.object({ size: Size, anchor: Point, frames: z.object({ impact: ArtPath, burst: ArtPath }) }),
    })
    .optional(),
  /**
   * The plank's generated board (`docs/ship-deck-art/plank/README.md`), a `size` image drawn with its upper left
   * at `position` on the hull in place of the board drawn in code. Without it, or without its image, the
   * code board stays.
   */
  plank: z.object({ texture: ArtPath, size: Size, position: z.tuple([z.number().int(), z.number().int()]) }).optional(),
  /**
   * The tall mast (`docs/ship-deck-art/mast/README.md`): a `size` image drawn with its upper left at `position`
   * on the hull, reaching above the hull's top row into the sky, in place of the hull's own short rig —
   * its crow's nest, upper mast and stays, all of it within `clears` ([x, y, width, height], open sky
   * besides), which is left out of the hull. Its top `sway` rows (the crow's nest and the topmast) sway as the
   * masthead did. The depth piece it `replaces` is its own rows from that piece's top down, and from below
   * the sail's lower edge while the sail hangs on it.
   */
  mast: z
    .object({
      texture: ArtPath,
      size: Size,
      position: z.tuple([z.number().int(), z.number().int()]),
      sway: z.number().int().nonnegative(),
      clears: z.tuple([z.number().int(), z.number().int(), z.number().int().positive(), z.number().int().positive()]),
      replaces: z.string(),
    })
    .optional(),
});
/** What the engine still reads of the extras: the way off by the plank's shark and splash. */
export type DeckExtrasManifest = Pick<z.infer<typeof DeckExtrasManifestSchema>, "exit">;

