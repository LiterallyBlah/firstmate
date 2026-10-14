/**
 * FIRSTMATE_SHIP_DECK: off by default, and off means the fleet load is exactly what it was — the same
 * object, no `shipDeck` key, the same JSON on the wire — and no Pixi is read or sent.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath, URL } from "node:url";
import { describe, expect, it } from "vitest";

import { FleetSchema, type Fleet } from "../shared/fleet";
import { PIXI_BUILD, SHIP_DECK_ENV, deckEngineSource, readDeckEngine, shipDeckEnabled, withShipDeck } from "./ship-deck";

const fleet: Fleet = {
  home: "/home/firstmate",
  homeReady: true,
  mate: null,
  mateMissing: false,
  mateInHome: true,
  homeGuests: [],
  cards: [],
  projects: [],
  suggestions: [{ label: "Bearings", prompt: "/bearings" }],
  watches: [],
  agentTools: true,
  charterOutdated: false,
  warnings: [],
};

describe("the ship deck's switch", () => {
  it("is off unless the daemon's environment says an explicit yes", () => {
    expect(shipDeckEnabled({})).toBe(false);
    for (const value of ["", "0", "false", "off", "no", "maybe"]) expect(shipDeckEnabled({ [SHIP_DECK_ENV]: value })).toBe(false);
    for (const value of ["1", "true", "ON", " yes "]) expect(shipDeckEnabled({ [SHIP_DECK_ENV]: value })).toBe(true);
  });

  it("off, leaves the fleet load byte-identical", () => {
    const before = JSON.stringify(fleet);
    const off = withShipDeck(fleet, {});
    expect(off).toBe(fleet);
    expect(JSON.stringify(off)).toBe(before);
    expect("shipDeck" in off).toBe(false);
    // And through the contract, as the app reads it.
    expect(JSON.stringify(FleetSchema.parse(off))).toBe(before);
  });

  it("on, marks the load and nothing else", () => {
    const on = withShipDeck(fleet, { [SHIP_DECK_ENV]: "1" });
    expect(on).toEqual({ ...fleet, shipDeck: true });
    expect(fleet).not.toHaveProperty("shipDeck");
    expect(FleetSchema.parse(on).shipDeck).toBe(true);
  });
});

describe("the Pixi build the daemon serves", () => {
  const root = fileURLToPath(new URL("..", import.meta.url));

  it("is refused while the switch is off, before the plugin's folder is even looked for", async () => {
    let looked = 0;
    await expect(
      readDeckEngine({}, async () => {
        looked += 1;
        return root;
      }),
    ).rejects.toThrow(`set ${SHIP_DECK_ENV}=1`);
    expect(looked).toBe(0);
  });

  it("on, is the vendored build with its version, no source map comment, and a sourceURL", async () => {
    const engine = await readDeckEngine({ [SHIP_DECK_ENV]: "1" }, async () => root);
    expect(engine.version).toBe("8.22.0");
    expect(engine.source).not.toContain("sourceMappingURL");
    expect(engine.source.endsWith("//# sourceURL=firstmate-pixi-8.22.0.js\n")).toBe(true);
    expect(engine.source.startsWith(readFileSync(join(root, PIXI_BUILD), "utf8").slice(0, 1000))).toBe(true);
  });

  it("is Pixi's own dist/pixi.min.js, byte for byte, at the version the plugin pins", () => {
    const manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as {
      files: string[];
      dependencies?: Record<string, string>;
      devDependencies: Record<string, string>;
    };
    const installed = JSON.parse(readFileSync(join(root, "node_modules/pixi.js/package.json"), "utf8")) as { version: string };
    expect(manifest.devDependencies["pixi.js"]).toBe(installed.version);
    // Shipped as one file: an npm install of the plugin does not pull Pixi's whole package.
    expect(manifest.dependencies?.["pixi.js"]).toBeUndefined();
    expect(manifest.files).toContain("vendor/");
    expect(readFileSync(join(root, PIXI_BUILD)).equals(readFileSync(join(root, "node_modules/pixi.js/dist/pixi.min.js")))).toBe(true);
  });

  it("refuses a file that is not a Pixi build", () => {
    expect(() => deckEngineSource("console.log('hello')")).toThrow("not a PixiJS build");
  });
});
