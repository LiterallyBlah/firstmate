/**
 * The ship deck's two RPCs, both refused while `FIRSTMATE_SHIP_DECK` is off (`server/ship-deck.ts`):
 *
 * - `firstmate.deck.engine` — PixiJS's browser build, as text, for the client to evaluate in a web
 *   renderer (`client/deck-mount.ts`). It reads `vendor/pixi.min.js` in the plugin's folder and nothing else.
 * - `firstmate.deck.art` — the deck's art: one atlas PNG, base64, and the manifest that says where the
 *   hull, its depth pieces, each sailor's pose and each prop are in it. Read from `art/ship-deck/` in the
 *   plugin's folder; built by `docs/ship-deck-art/build-art.py`.
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
