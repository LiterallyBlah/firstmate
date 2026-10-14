/**
 * The ship deck's one RPC: PixiJS's browser build, as text, for the client to evaluate in a web renderer
 * (`client/deck-mount.ts`). It reads `vendor/pixi.min.js` in the plugin's folder and nothing else, and is
 * refused while `FIRSTMATE_SHIP_DECK` is off (`server/ship-deck.ts`).
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
