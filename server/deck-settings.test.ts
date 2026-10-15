/**
 * What the Deck's RPCs serve: Pixi's vendored build, and the setting packs — listed, read whole, confined to their
 * folders, capped, and refused when this engine cannot draw them — with no switch: the Deck is a standard part of the
 * screen, and the fleet load carries nothing for it. What is in a pack is `test/deck-settings.test.ts`'s.
 */
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, URL } from "node:url";
import { describe, expect, it } from "vitest";

import { FleetSchema, type Fleet } from "../shared/fleet";
import { settingImageIds } from "../shared/deck-setting";
import { PACK_BYTES_MAX, PIXI_BUILD, SETTING_MANIFEST, SETTINGS_DIR, deckEngineSource, listDeckSettings, readDeckEngine, readDeckSetting } from "./deck-settings";

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

/** Runs `run` with these variables set (or unset) in the daemon's environment, then puts them back. */
async function withEnvironment(values: Record<string, string | undefined>, run: () => Promise<unknown>): Promise<void> {
  const before = Object.fromEntries(Object.keys(values).map((name) => [name, process.env[name]]));
  const put = (entries: Record<string, string | undefined>) => {
    for (const [name, value] of Object.entries(entries)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  };
  put(values);
  try {
    await run();
  } finally {
    put(before);
  }
}

const root = fileURLToPath(new URL("..", import.meta.url));
const shipFolder = join(root, SETTINGS_DIR, "ship");
const shipJson = () => JSON.parse(readFileSync(join(shipFolder, SETTING_MANIFEST), "utf8")) as Record<string, unknown> & { images: Record<string, { path: string }> };

/** A plugin folder of its own holding a copy of the ship's pack as `id`, its manifest changed by `change`. */
function pluginWith(packs: Record<string, (manifest: ReturnType<typeof shipJson>) => unknown>): string {
  const dir = mkdtempSync(join(tmpdir(), "firstmate-deck-settings-"));
  for (const [id, change] of Object.entries(packs)) {
    const folder = join(dir, SETTINGS_DIR, id);
    mkdirSync(folder, { recursive: true });
    cpSync(shipFolder, folder, { recursive: true });
    writeFileSync(join(folder, SETTING_MANIFEST), JSON.stringify(change({ ...shipJson(), id })));
  }
  return dir;
}

describe("the deck without a switch", () => {
  it("leaves the fleet load as it is: no deck key, and the contract drops one if it ever came", () => {
    const before = JSON.stringify(fleet);
    expect(JSON.stringify(FleetSchema.parse(fleet))).toBe(before);
    expect(FleetSchema.parse({ ...fleet, shipDeck: true })).not.toHaveProperty("shipDeck");
  });

  it("reads no FIRSTMATE_SHIP_DECK anywhere in the plugin's code", () => {
    for (const file of ["server/deck-settings.ts", "index.server.ts", "client/fleet.tsx", "client/deck-scene.ts", "shared/fleet.ts"]) {
      const code = readFileSync(join(root, file), "utf8").replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");
      expect(code, file).not.toContain("FIRSTMATE_SHIP_DECK");
    }
  });
});

describe("the Pixi build the daemon serves", () => {
  it("is served with no switch set in the daemon's environment, and an old `FIRSTMATE_SHIP_DECK=0` changes nothing", async () => {
    await withEnvironment({ FIRSTMATE_SHIP_DECK: undefined }, () => expect(readDeckEngine(async () => root)).resolves.toBeDefined());
    await withEnvironment({ FIRSTMATE_SHIP_DECK: "0" }, () => expect(readDeckEngine(async () => root)).resolves.toBeDefined());
  });

  it("on, is the vendored build with its version, no source map comment, and a sourceURL", async () => {
    const engine = await readDeckEngine(async () => root);
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

describe("the settings the daemon serves", () => {
  it("lists the ship, which this engine draws", async () => {
    const settings = await listDeckSettings(async () => root);
    expect(settings.map((setting) => setting.id)).toContain("ship");
    const ship = settings.find((setting) => setting.id === "ship");
    expect(ship).toMatchObject({ id: "ship", name: "Ship's deck", version: "1.3.0", formatVersion: 1, compatible: true, reason: null, preview: null });
    // Small enough to send whole: the bundle carries none of it.
    expect(ship!.bytes).toBeGreaterThan(200_000);
    expect(ship!.bytes).toBeLessThan(400_000);
  });

  it("is served with no switch set in the daemon's environment, and an old `FIRSTMATE_SHIP_DECK=0` changes nothing", async () => {
    await withEnvironment({ FIRSTMATE_SHIP_DECK: undefined }, () => expect(readDeckSetting("ship", async () => root)).resolves.toBeDefined());
    await withEnvironment({ FIRSTMATE_SHIP_DECK: "0" }, () => expect(readDeckSetting("ship", async () => root)).resolves.toBeDefined());
  });

  it("reads a pack whole: its manifest as written, and every image it names, byte for byte, by id", async () => {
    const setting = await readDeckSetting("ship", async () => root);
    expect(setting.manifest).toEqual(shipJson());
    expect(Object.keys(setting.images)).toEqual(settingImageIds(setting.manifest));
    expect(Object.keys(setting.images)).toHaveLength(81);
    for (const [id, png] of Object.entries(setting.images)) {
      expect(Buffer.from(png, "base64").equals(readFileSync(join(shipFolder, setting.manifest.images[id]!.path))), id).toBe(true);
    }
  });

  it("reads only a pack it found, by an id that is a folder's name", async () => {
    await expect(readDeckSetting("missing-test-setting", async () => root)).rejects.toThrow("no deck setting called missing-test-setting");
    await expect(readDeckSetting("../ship", async () => root)).rejects.toThrow("no deck setting called");
  });

  it("refuses an image that would leave its pack, or a pack that calls itself something else, and does not keep the failure", async () => {
    const dir = pluginWith({
      escape: (manifest) => ({ ...manifest, images: { ...manifest.images, deck: { ...manifest.images.deck, path: "../ship/deck.png" } } }),
      named: (manifest) => ({ ...manifest, id: "someone-else" }),
    });
    try {
      await expect(readDeckSetting("escape", async () => dir)).rejects.toThrow("relative .png path");
      await expect(readDeckSetting("named", async () => dir)).rejects.toThrow("calls itself someone-else");
      const listed = await listDeckSettings(async () => dir);
      expect(listed.map((setting) => [setting.id, setting.compatible])).toEqual([
        ["escape", false],
        ["named", false],
      ]);
      // Mended on disk, the next read finds it: a failure is not kept.
      writeFileSync(join(dir, SETTINGS_DIR, "named", SETTING_MANIFEST), JSON.stringify({ ...shipJson(), id: "named" }));
      await expect(readDeckSetting("named", async () => dir)).resolves.toHaveProperty("manifest.id", "named");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("lists a pack this engine cannot draw as incompatible, says why, and refuses to serve it", async () => {
    const dir = pluginWith({
      newer: (manifest) => ({ ...manifest, formatVersion: 2 }),
      walkers: (manifest) => ({ ...manifest, requires: [...(manifest.requires as string[]), "walkers@1"] }),
    });
    try {
      const listed = await listDeckSettings(async () => dir);
      expect(listed.find((setting) => setting.id === "newer")).toMatchObject({ compatible: false, reason: "it is format 2; this FirstMate draws format 1" });
      expect(listed.find((setting) => setting.id === "walkers")).toMatchObject({ compatible: false, reason: "it needs walkers@1, which this FirstMate does not have" });
      await expect(readDeckSetting("walkers", async () => dir)).rejects.toThrow("needs walkers@1");
      await expect(readDeckSetting("newer", async () => dir)).rejects.toThrow("Update FirstMate");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("refuses a pack that would serve more than it may", async () => {
    const dir = pluginWith({ heavy: (manifest) => manifest });
    try {
      // The atlas, padded past the cap with bytes after its end: still a PNG, too big to send.
      const atlas = join(dir, SETTINGS_DIR, "heavy", "deck.png");
      writeFileSync(atlas, Buffer.concat([readFileSync(atlas), Buffer.alloc(PACK_BYTES_MAX)]));
      await expect(readDeckSetting("heavy", async () => dir)).rejects.toThrow(`at most ${PACK_BYTES_MAX}`);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
