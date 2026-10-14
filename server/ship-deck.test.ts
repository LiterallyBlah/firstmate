/**
 * FIRSTMATE_SHIP_DECK: off by default, and off means the fleet load is exactly what it was — the same
 * object, no `shipDeck` key, the same JSON on the wire — and no Pixi or art is read or sent.
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, URL } from "node:url";
import { describe, expect, it } from "vitest";

import { FleetSchema, type Fleet } from "../shared/fleet";
import {
  DECK_ATLAS,
  DECK_MANIFEST,
  PIXI_BUILD,
  SHIP_DECK_ENV,
  deckEngineSource,
  readDeckArt,
  readDeckEngine,
  shipDeckEnabled,
  withShipDeck,
} from "./ship-deck";

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

describe("the art the daemon serves", () => {
  const root = fileURLToPath(new URL("..", import.meta.url));

  it("is refused while the switch is off, before the plugin's folder is even looked for", async () => {
    let looked = 0;
    await expect(
      readDeckArt({}, async () => {
        looked += 1;
        return root;
      }),
    ).rejects.toThrow(`set ${SHIP_DECK_ENV}=1`);
    expect(looked).toBe(0);
  });

  it("on, is the atlas byte for byte as base64, and its manifest checked against the contract", async () => {
    const art = await readDeckArt({ [SHIP_DECK_ENV]: "1" }, async () => root);
    expect(Buffer.from(art.png, "base64").equals(readFileSync(join(root, DECK_ATLAS)))).toBe(true);
    expect(art.manifest).toEqual(JSON.parse(readFileSync(join(root, DECK_MANIFEST), "utf8")));
    // Small enough to send whole: the bundle carries none of it.
    expect(art.png.length).toBeLessThan(150_000);
  });

  it("refuses a manifest that is not the contract's, and does not keep the failure", async () => {
    const dir = mkdtempSync(join(tmpdir(), "firstmate-deck-art-"));
    try {
      mkdirSync(join(dir, "art/ship-deck"), { recursive: true });
      writeFileSync(join(dir, DECK_ATLAS), readFileSync(join(root, DECK_ATLAS)));
      writeFileSync(join(dir, DECK_MANIFEST), JSON.stringify({ ship: {} }));
      await expect(readDeckArt({ [SHIP_DECK_ENV]: "1" }, async () => dir)).rejects.toThrow();
      writeFileSync(join(dir, DECK_MANIFEST), readFileSync(join(root, DECK_MANIFEST)));
      await expect(readDeckArt({ [SHIP_DECK_ENV]: "1" }, async () => dir)).resolves.toHaveProperty("png");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("ships with the plugin, and names the generated sources it was built from", () => {
    const manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as { files: string[] };
    expect(manifest.files).toContain("art/");
    const art = JSON.parse(readFileSync(join(root, DECK_MANIFEST), "utf8")) as { sources: Record<string, { file: string; sha256: string }> };
    expect(Object.values(art.sources).map((source) => source.file)).toEqual([
      "10-ship-low-rig.png",
      "01-crew-base.png",
      "02-crew-outfit.png",
      "03-barrel.png",
      "04-crate.png",
      "05-rope.png",
    ]);
    for (const source of Object.values(art.sources)) expect(source.sha256).toMatch(/^[0-9a-f]{64}$/);
  });
});
