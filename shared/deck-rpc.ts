/**
 * The Deck's three RPCs, answered by `server/deck-settings.ts`:
 *
 * - `firstmate.deck.engine` — PixiJS's browser build, as text (`client/deck-mount.ts` says why it is served).
 * - `firstmate.deck.settings` — the setting packs installed: each one's id, name, version, and whether this engine can
 *   draw it (`compatible`, and why not).
 * - `firstmate.deck.setting` — one pack by id: its manifest, and every image it draws with, base64, by image id.
 *
 * What a pack is, and every rule it is held to, is `shared/deck-setting.ts`; the server checks a manifest whole before
 * it serves it, so the client takes it as sent and carries none of those rules in its bundle.
 */
import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";

import type { SettingManifest } from "./deck-setting";

/** The setting drawn when none is chosen, or the chosen one cannot be drawn. */
export const DEFAULT_DECK_SETTING = "ship";

const Id = z.string().regex(/^[a-z0-9-]+$/);

export const loadDeckEngine = defineRpc({
  name: "firstmate.deck.engine",
  input: z.object({}),
  /** `version` is Pixi's, read from the build's own banner; the client checks the namespace says the same. */
  output: z.object({ version: z.string(), source: z.string() }),
});
export type DeckEngineSource = z.infer<typeof loadDeckEngine.output>;

/** One installed pack, as the settings picker and the Deck need to know it. */
const SettingSummary = z.object({
  id: Id,
  name: z.string(),
  version: z.string(),
  formatVersion: z.number(),
  /** Whether this engine can draw it, and why not. */
  compatible: z.boolean(),
  reason: z.string().nullable(),
  /** Its preview image, base64, or null. */
  preview: z.string().nullable(),
  /** The bytes of every image it serves. */
  bytes: z.number(),
});
export type DeckSettingSummary = z.infer<typeof SettingSummary>;

export const listDeckSettings = defineRpc({
  name: "firstmate.deck.settings",
  input: z.object({}),
  output: z.array(SettingSummary),
});

export const loadDeckSetting = defineRpc({
  name: "firstmate.deck.setting",
  input: z.object({ id: Id }),
  /** The manifest as the server checked it (`SettingManifestSchema`); `images` maps each image id it names to that PNG, base64. */
  output: z.object({
    manifest: z.custom<SettingManifest>((value) => typeof value === "object" && value !== null, "a setting's manifest"),
    images: z.record(Id, z.string()),
  }),
});
export type DeckSetting = z.infer<typeof loadDeckSetting.output>;
