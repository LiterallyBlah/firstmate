/**
 * The ship deck's four RPCs, answered by `server/ship-deck.ts`:
 *
 * - `firstmate.deck.engine` — PixiJS's browser build, as text, for the client to evaluate in a web
 *   renderer (`client/deck-mount.ts`). It reads `vendor/pixi.min.js` in the plugin's folder and nothing else.
 * - `firstmate.deck.art` — the deck's art: one atlas PNG, base64, and the manifest that says where the
 *   hull, its depth pieces, each sailor's pose and each prop are in it. Read from `art/ship-deck/` in the
 *   plugin's folder; built by `docs/ship-deck-art/build-art.py`.
 * - `firstmate.deck.environment` — the generated sea, sky and gull: each image, base64, and what
 *   `art/ship-deck/environment.json` says about drawing them. See below.
 * - `firstmate.deck.extras` — the sail, the crew's extra looks, the shark, the splash and the sky's clouds: each image, base64, and what
 *   `art/ship-deck/extras.json` says about drawing them. See the last note.
 */
import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";

export const loadDeckEngine = defineRpc({
  name: "firstmate.deck.engine",
  input: z.object({}),
  /** `version` is Pixi's, read from the build's own banner; the client checks the namespace says the same. */
  output: z.object({ version: z.string(), source: z.string() }),
});
export type DeckEngineSource = z.infer<typeof loadDeckEngine.output>;

/** A rectangle in the atlas: x, y, width, height, in atlas pixels. */
const Frame = z.tuple([z.number().int(), z.number().int(), z.number().int().positive(), z.number().int().positive()]);
/** A sprite's frame and where it stands: its feet, in whole pixels from the frame's top left. */
const Standing = z.object({ frame: Frame, feet: z.tuple([z.number().int(), z.number().int()]) });

export const SAILOR_POSES = [
  "front-idle",
  "front-walk-a",
  "front-walk-b",
  "side-idle",
  "side-walk-a",
  "side-walk-b",
  "hauling",
  "leaning",
  "waiting",
] as const;
export type SailorPose = (typeof SAILOR_POSES)[number];
export const SAILOR_OUTFITS = ["base", "outfit"] as const;
export type SailorOutfit = (typeof SAILOR_OUTFITS)[number];
export const DECK_PROP_NAMES = ["barrel", "crate", "rope"] as const;
export type DeckPropName = (typeof DECK_PROP_NAMES)[number];

const Poses = z.object(Object.fromEntries(SAILOR_POSES.map((pose) => [pose, Standing])) as Record<SailorPose, typeof Standing>);

export const DeckArtManifestSchema = z.object({
  atlas: z.object({ width: z.number().int().positive(), height: z.number().int().positive(), colours: z.number().int() }),
  /** The whole hull: the backdrop every sailor stands on. Its size is the deck's coordinate space. */
  ship: z.object({ frame: Frame }),
  /**
   * Parts of the hull cut out again to stand in front of a sailor: where each sits on the hull, and the
   * deck row it stands on. A sailor whose feet are on or above that row (further back) is drawn behind it.
   * `null` is in front of everything on deck — the near rail, the stairs and the hull below them.
   */
  pieces: z.record(z.string(), z.object({ frame: Frame, x: z.number().int(), y: z.number().int(), baseline: z.number().int().nullable() })),
  crew: z.object({ base: Poses, outfit: Poses }),
  props: z.object(Object.fromEntries(DECK_PROP_NAMES.map((name) => [name, Standing])) as Record<DeckPropName, typeof Standing>),
  sources: z.record(z.string(), z.object({ file: z.string(), sha256: z.string() })),
});
export type DeckArtManifest = z.infer<typeof DeckArtManifestSchema>;

export const loadDeckArt = defineRpc({
  name: "firstmate.deck.art",
  input: z.object({}),
  /** `png` is the atlas, base64; the client decodes it once a session. */
  output: z.object({ png: z.string(), manifest: DeckArtManifestSchema }),
});
export type DeckArt = z.infer<typeof loadDeckArt.output>;

/**
 * `firstmate.deck.environment` — the generated sea, sky and gull (`art/ship-deck/ENVIRONMENT.md`): the
 * parts of `environment.json` the deck draws with, and each image it names, base64. Separate from the atlas so a deck whose environment fails to load
 * still draws its ship and crew, on a plain sea (`client/deck-mount.ts`).
 */
/** A file inside `art/ship-deck/`: a relative path to a PNG, never climbing out. */
const ArtPath = z
  .string()
  .regex(/^[a-z0-9_-]+(\/[a-z0-9_-]+)*\.png$/i, "an environment image must be a relative .png path inside art/ship-deck/");
const Size = z.tuple([z.number().int().positive(), z.number().int().positive()]);
const Point = z.tuple([z.number().int(), z.number().int()]);
const HexColour = z.string().regex(/^#[0-9a-f]{6}$/i, "a colour must be #RRGGBB");
/** A cloud's three colours, shadow to highlight. */
const CloudPalette = z.tuple([HexColour, HexColour, HexColour]);

/** The six sky phases, in the order of the day. */
export const SKY_PHASES = ["dawn", "morning", "midday", "afternoon", "dusk", "night"] as const;
export type SkyPhaseId = (typeof SKY_PHASES)[number];
export const GULL_POSES = ["up", "mid", "down"] as const;
export type GullPose = (typeof GULL_POSES)[number];

const MINUTES_PER_DAY = 1440;

export const DeckEnvironmentManifestSchema = z.object({
  /** The water: one opaque tile repeating both ways, scrolled sideways in whole pixels. */
  sea: z.object({
    texture: ArtPath,
    period: Size,
    animation: z.object({ xPixelsPerSecond: z.number().positive() }),
  }),
  /** The foam at the hull's waterline: a transparent strip repeating sideways. */
  foam: z.object({ texture: ArtPath, period: z.number().int().positive(), xPixelsPerSecond: z.number().positive() }),
  /**
   * The sky: six registered backdrops, each with the local wall-clock minute it is shown alone at, and
   * overlays (the stars) faded with the night. The phases are listed in the order of the day.
   */
  sky: z.object({
    size: Size,
    phases: z
      .array(z.object({ id: z.enum(SKY_PHASES), path: ArtPath, localMinute: z.number().int().min(0).max(MINUTES_PER_DAY - 1) }))
      .length(SKY_PHASES.length)
      .refine((phases) => phases.every((phase, index) => phase.id === SKY_PHASES[index]), "the sky's phases must be dawn to night, in order")
      .refine((phases) => phases.every((phase, index) => index === 0 || phase.localMinute > phases[index - 1]!.localMinute), "the sky's phases must be in the order of the day"),
    overlays: z.array(z.object({ path: ArtPath, size: Size })),
  }),
  /** The gull: three poses in one strip, drawn flying right, registered at the beak. */
  gull: z.object({
    sheet: ArtPath,
    frameSize: Size,
    anchor: z.tuple([z.number().int(), z.number().int()]),
    frames: z
      .array(z.object({ id: z.enum(GULL_POSES), rect: Frame }))
      .length(GULL_POSES.length)
      .refine((frames) => frames.every((frame, index) => frame.id === GULL_POSES[index]), "the gull's frames must be up, mid and down"),
    sequence: z.array(z.enum(GULL_POSES)).min(1),
    frameMs: z.number().positive(),
  }),
});
export type DeckEnvironmentManifest = z.infer<typeof DeckEnvironmentManifestSchema>;

/** Every image the manifest names, once each, in a stable order. */
export function environmentImagePaths(manifest: DeckEnvironmentManifest): string[] {
  const paths = [
    manifest.sea.texture,
    manifest.foam.texture,
    ...manifest.sky.phases.map((phase) => phase.path),
    ...manifest.sky.overlays.map((overlay) => overlay.path),
    manifest.gull.sheet,
  ];
  return [...new Set(paths)];
}

export const loadDeckEnvironment = defineRpc({
  name: "firstmate.deck.environment",
  input: z.object({}),
  /** `images` maps each path the manifest names to that PNG, base64. */
  output: z.object({ manifest: DeckEnvironmentManifestSchema, images: z.record(z.string(), z.string()) }),
});
export type DeckEnvironment = z.infer<typeof loadDeckEnvironment.output>;

/**
 * `firstmate.deck.extras` — the tall mast and its sail (`art/ship-deck/mast/README.md`, `art/ship-deck/sails/README.md`),
 * the crew's extra looks (`art/ship-deck/assets-2/README.md`), the plank's board (`art/ship-deck/plank/README.md`),
 * the shark and splash that see a sailor off the plank (`art/ship-deck/shark/README.md`), and the clouds that
 * drift across the sky (`art/ship-deck/clouds/README.md`):
 * the parts of `art/ship-deck/extras.json` the deck draws with, and each image it names, base64. Apart from
 * the atlas and the environment, and not needed to
 * draw: the client keeps whatever of it decodes, so a missing sail is the bare mast and a missing look is
 * one fewer to hand out (`client/deck-mount.ts`).
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
   * The crew's extra looks: each a texture the atlas's size holding every pose at exactly the atlas's
   * own crew rectangles and feet (`deck.json`), so a look is drawn with the base lane's frames.
   */
  crew: z
    .array(z.object({ id: z.string().regex(/^[a-z0-9-]+$/), texture: ArtPath }))
    .refine((looks) => new Set(looks.map((look) => look.id)).size === looks.length, "each crew look needs its own id"),
  /**
   * The way off by the plank (`art/ship-deck/shark/README.md`): the shark's four keys and the splash's two,
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
   * The sky's drifting clouds (`art/ship-deck/clouds/README.md`): neutral sprites in three colours,
   * `palette` — shadow, body, highlight — each recoloured to the same slot of the showing sky phase's
   * entry in `stages`, and drifted right at about `pixelsPerSecond` sky pixels a second. Without it, or
   * without a sprite's image, the sky has fewer clouds or none (`client/deck-clouds.ts`).
   */
  clouds: z
    .object({
      palette: CloudPalette,
      stages: z.object(Object.fromEntries(SKY_PHASES.map((phase) => [phase, CloudPalette])) as Record<SkyPhaseId, typeof CloudPalette>),
      sprites: z
        .array(z.object({ id: z.string().regex(/^[a-z0-9-]+$/), texture: ArtPath, size: Size, pixelsPerSecond: z.number().positive().max(4) }))
        .min(1)
        .refine((sprites) => new Set(sprites.map((sprite) => sprite.id)).size === sprites.length, "each cloud needs its own id"),
    })
    .optional(),
  /**
   * The plank's generated board (`art/ship-deck/plank/README.md`), a `size` image drawn with its upper left
   * at `position` on the hull in place of the board drawn in code. Without it, or without its image, the
   * code board stays.
   */
  plank: z.object({ texture: ArtPath, size: Size, position: z.tuple([z.number().int(), z.number().int()]) }).optional(),
  /**
   * The tall mast (`art/ship-deck/mast/README.md`): a `size` image drawn with its upper left at `position`
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
export type DeckExtrasManifest = z.infer<typeof DeckExtrasManifestSchema>;

/** Every image the extras manifest names, once each, in a stable order. */
export function extrasImagePaths(manifest: DeckExtrasManifest): string[] {
  const exit = manifest.exit === undefined ? [] : [...Object.values(manifest.exit.shark.frames), ...Object.values(manifest.exit.splash.frames)];
  const clouds = manifest.clouds?.sprites.map((sprite) => sprite.texture) ?? [];
  const plank = manifest.plank === undefined ? [] : [manifest.plank.texture];
  const mast = manifest.mast === undefined ? [] : [manifest.mast.texture];
  return [...new Set([manifest.sail.texture, ...manifest.crew.map((look) => look.texture), ...exit, ...clouds, ...plank, ...mast])];
}

export const loadDeckExtras = defineRpc({
  name: "firstmate.deck.extras",
  input: z.object({}),
  /** `images` maps each path the manifest names to that PNG, base64. */
  output: z.object({ manifest: DeckExtrasManifestSchema, images: z.record(z.string(), z.string()) }),
});
export type DeckExtras = z.infer<typeof loadDeckExtras.output>;
