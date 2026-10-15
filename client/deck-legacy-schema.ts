/**
 * The zod contracts of the three manifests the deck's art was once served in (`client/deck-legacy.ts`): what
 * `legacyViews` must produce, and what the records in `docs/ship-deck-art/legacy/` are checked against
 * (`client/ship-pack.test.ts`). Types only, for the engine: nothing here is in the client bundle.
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

/**
 * The generated still sea and foam (`docs/ship-deck-art/ENVIRONMENT.md`). Apart from the atlas so a deck whose
 * environment fails to load still draws its ship and crew, on a plain sea (`client/deck-mount.ts`). The record has the
 * sky and the gull too, which the pack draws itself now: parsing it leaves them out.
 */
/** A file inside the pack: a relative path to a PNG, never climbing out. */
const ArtPath = z
  .string()
  .regex(/^[a-z0-9_-]+(\/[a-z0-9_-]+)*\.png$/i, "an image must be a relative .png path inside its pack");
const Size = z.tuple([z.number().int().positive(), z.number().int().positive()]);
const Point = z.tuple([z.number().int(), z.number().int()]);
const HexColour = z.string().regex(/^#[0-9a-f]{6}$/i, "a colour must be #RRGGBB");
/** A cloud's three colours, shadow to highlight. */
const CloudPalette = z.tuple([HexColour, HexColour, HexColour]);

export const DeckEnvironmentManifestSchema = z.object({
  /** The water: one opaque tile repeating both ways, scrolled sideways in whole pixels. */
  sea: z.object({
    texture: ArtPath,
    period: Size,
    animation: z.object({ xPixelsPerSecond: z.number().positive() }),
  }),
  /** The foam at the hull's waterline: a transparent strip repeating sideways. */
  foam: z.object({ texture: ArtPath, period: z.number().int().positive(), xPixelsPerSecond: z.number().positive() }),
});
export type DeckEnvironmentManifest = z.infer<typeof DeckEnvironmentManifestSchema>;

/**
 * The extras: the tall mast and its sail (`docs/ship-deck-art/mast/README.md`, `docs/ship-deck-art/sails/README.md`),
 * the plank's board (`docs/ship-deck-art/plank/README.md`),
 * the shark and splash that see a sailor off the plank (`docs/ship-deck-art/shark/README.md`), and the animated sea,
 * foam and wake (`docs/ship-deck-art/water/README.md`):
 * not needed to draw: the client keeps whatever of it decodes, so a missing sail is the bare mast (`client/deck-mount.ts`).
 * The record has the clouds, the sky's mood and the flashes too, which the pack draws itself now: parsing it leaves
 * them out, but for the clouds' variants among the rest.
 */
const Id = z.string().regex(/^[a-z0-9-]+$/);
const uniqueIds = (items: ReadonlyArray<{ id: string }>) => new Set(items.map((item) => item.id)).size === items.length;
/** A cloud's colours under each sky phase. */
const CloudStages = z.record(z.string(), CloudPalette);
/**
 * A value over the weather's intensity: points [intensity, value], intensity rising, eased between them and held
 * past either end (`curveAt` in `client/deck-variants.ts`).
 */
const Curve = z
  .array(z.tuple([z.number().min(0).max(1), z.number().nonnegative()]))
  .min(1)
  .refine((points) => points.every((point, index) => index === 0 || point[0] > points[index - 1]![0]), "a curve's intensities must rise");
/** An opacity over the weather's intensity, 0 to 1. */
const Opacity = Curve.refine((points) => points.every((point) => point[1] <= 1), "an opacity is at most 1");

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
  /**
   * The animated water (`docs/ship-deck-art/water/README.md`): each part `frames`, images of `frameSize` played in
   * order every `frameMs` and looped, the first held while the deck is still. The `sea` tiles both ways from
   * the horizon and drifts right; the `foam` lies across the waterline from `top`, repeating sideways
   * within `span` ([left, right)) and drifting; the `wake` is one sprite, its `anchor` on `position` at the
   * stern, never drifting. Each part stands in for the environment's tile, its foam strip and the wake drawn
   * in code; a part with a frame missing is not drawn, and the one it would replace is (`client/deck-water.ts`).
   */
  water: z
    .object({
      sea: z.object({ frames: z.array(ArtPath).min(1), frameSize: Size, frameMs: z.number().positive(), xPixelsPerSecond: z.number().nonnegative() }),
      foam: z.object({
        frames: z.array(ArtPath).min(1),
        frameSize: Size,
        frameMs: z.number().positive(),
        top: z.number().int(),
        span: z.tuple([z.number().int(), z.number().int()]),
        xPixelsPerSecond: z.number().nonnegative(),
      }),
      wake: z.object({ frames: z.array(ArtPath).min(1), frameSize: Size, frameMs: z.number().positive(), anchor: Point, position: Point }),
    })
    .optional(),
  /**
   * Layers over the scene that follow the deck's weather (`client/deck-variants.ts`): each
   * fades in and out along its own `opacity` curve over the weather's intensity (`client/deck-atmosphere.ts`, 0 an
   * idle crew, 1 a busy fleet), so how and when a setting's weather comes in is data, here, and not code. None of them
   * is drawn under reduced motion. The heavy weather (the ship pack's `storm/`) is the first set of them.
   *
   * - `variants` — a second set of frames over one of the scene's elements (`variantOf`): the animated water's `sea`
   *   tile, `foam` strip or `wake`, a `cycle:<id>`, or a `cloud:<id>`, on that element's own clock, frame for
   *   frame — so its frames must be as many as the element's and its `frameSize` the element's, or it is not drawn.
   *   `over` draws it over the whole element (opaque art); `crossfade` fades the element out as it comes in. A cloud's
   *   variant is three slot colours like the clouds, so it names its own `palette` and `stages`.
   * - `cycles` — a sprite whose frames loop on the water's clock, its `anchor` on `position`, in front of the hull's waterline.
   */
  variants: z
    .array(
      z
        .object({
          id: Id,
          variantOf: z.string().regex(/^(sea|foam|wake|cycle:[a-z0-9-]+|cloud:[a-z0-9-]+)$/, "a variant is of sea, foam, wake, cycle:<id> or cloud:<id>"),
          frames: z.array(ArtPath).min(1),
          frameSize: Size,
          blend: z.enum(["over", "crossfade"]),
          opacity: Opacity,
          palette: CloudPalette.optional(),
          stages: CloudStages.optional(),
        })
        .refine((variant) => !variant.variantOf.startsWith("cloud:") || (variant.palette !== undefined && variant.stages !== undefined), "a cloud's variant needs its palette and stages"),
    )
    .refine(uniqueIds, "each variant needs its own id")
    .optional(),
  cycles: z
    .array(z.object({ id: Id, frames: z.array(ArtPath).min(1), frameSize: Size, frameMs: z.number().positive(), anchor: Point, position: Point, opacity: Opacity }))
    .refine(uniqueIds, "each cycle needs its own id")
    .optional(),
});
export type DeckExtrasManifest = z.infer<typeof DeckExtrasManifestSchema>;

