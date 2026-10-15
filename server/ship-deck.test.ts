/**
 * What the ship deck's RPCs serve: Pixi's vendored build, the atlas, the generated environment and the
 * extras — with no switch: the Deck is a standard part of the screen, and the fleet load carries nothing for it.
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, URL } from "node:url";
import { describe, expect, it } from "vitest";

import { FleetSchema, type Fleet } from "../shared/fleet";
import { DeckArtManifestSchema, environmentImagePaths, extrasImagePaths } from "../shared/ship-deck";
import {
  DECK_ATLAS,
  DECK_ENVIRONMENT_DIR,
  DECK_ENVIRONMENT_MANIFEST,
  DECK_EXTRAS_MANIFEST,
  DECK_MANIFEST,
  PIXI_BUILD,
  deckEngineSource,
  readDeckArt,
  readDeckEngine,
  readDeckEnvironment,
  readDeckExtras,
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

describe("the deck without a switch", () => {
  it("leaves the fleet load as it is: no deck key, and the contract drops one if it ever came", () => {
    const before = JSON.stringify(fleet);
    expect(JSON.stringify(FleetSchema.parse(fleet))).toBe(before);
    expect(FleetSchema.parse({ ...fleet, shipDeck: true })).not.toHaveProperty("shipDeck");
  });

  it("reads no FIRSTMATE_SHIP_DECK anywhere in the plugin's code", () => {
    const root = fileURLToPath(new URL("..", import.meta.url));
    for (const file of ["server/ship-deck.ts", "index.server.ts", "client/fleet.tsx", "client/deck-scene.ts", "shared/fleet.ts"]) {
      const code = readFileSync(join(root, file), "utf8").replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");
      expect(code, file).not.toContain("FIRSTMATE_SHIP_DECK");
    }
  });
});

describe("the Pixi build the daemon serves", () => {
  const root = fileURLToPath(new URL("..", import.meta.url));

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

describe("the art the daemon serves", () => {
  const root = fileURLToPath(new URL("..", import.meta.url));

  it("is served with no switch set in the daemon's environment, and an old `FIRSTMATE_SHIP_DECK=0` changes nothing", async () => {
    await withEnvironment({ FIRSTMATE_SHIP_DECK: undefined }, () => expect(readDeckArt(async () => root)).resolves.toBeDefined());
    await withEnvironment({ FIRSTMATE_SHIP_DECK: "0" }, () => expect(readDeckArt(async () => root)).resolves.toBeDefined());
  });

  it("on, is the atlas byte for byte as base64, and its manifest checked against the contract", async () => {
    const art = await readDeckArt(async () => root);
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
      await expect(readDeckArt(async () => dir)).rejects.toThrow();
      writeFileSync(join(dir, DECK_MANIFEST), readFileSync(join(root, DECK_MANIFEST)));
      await expect(readDeckArt(async () => dir)).resolves.toHaveProperty("png");
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

describe("the generated environment the daemon serves", () => {
  const root = fileURLToPath(new URL("..", import.meta.url));

  it("is served with no switch set in the daemon's environment, and an old `FIRSTMATE_SHIP_DECK=0` changes nothing", async () => {
    await withEnvironment({ FIRSTMATE_SHIP_DECK: undefined }, () => expect(readDeckEnvironment(async () => root)).resolves.toBeDefined());
    await withEnvironment({ FIRSTMATE_SHIP_DECK: "0" }, () => expect(readDeckEnvironment(async () => root)).resolves.toBeDefined());
  });

  it("on, is every image the manifest names, byte for byte, and small enough to send whole", async () => {
    const environment = await readDeckEnvironment(async () => root);
    const paths = environmentImagePaths(environment.manifest);
    expect(Object.keys(environment.images)).toEqual(paths);
    expect(paths).toHaveLength(10);
    for (const path of paths) {
      expect(Buffer.from(environment.images[path]!, "base64").equals(readFileSync(join(root, DECK_ENVIRONMENT_DIR, path))), path).toBe(true);
    }
    expect(environment.manifest.sky.phases.map((phase) => phase.id)).toEqual(["dawn", "morning", "midday", "afternoon", "dusk", "night"]);
    const total = Object.values(environment.images).reduce((sum, png) => sum + png.length, 0);
    expect(total).toBeLessThan(100_000);
  });

  it("refuses a manifest whose images would leave art/ship-deck/, and does not keep the failure", async () => {
    const dir = mkdtempSync(join(tmpdir(), "firstmate-deck-environment-"));
    try {
      mkdirSync(join(dir, DECK_ENVIRONMENT_DIR), { recursive: true });
      const manifest = JSON.parse(readFileSync(join(root, DECK_ENVIRONMENT_MANIFEST), "utf8")) as { sea: { texture: string } };
      writeFileSync(join(dir, DECK_ENVIRONMENT_MANIFEST), JSON.stringify({ ...manifest, sea: { ...manifest.sea, texture: "../../vendor/pixi.png" } }));
      await expect(readDeckEnvironment(async () => dir)).rejects.toThrow("relative .png path");
      writeFileSync(join(dir, DECK_ENVIRONMENT_MANIFEST), JSON.stringify({ ...manifest, sea: { ...manifest.sea, texture: "/etc/passwd.png" } }));
      await expect(readDeckEnvironment(async () => dir)).rejects.toThrow("relative .png path");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("the sail and the crew's looks the daemon serves", () => {
  const root = fileURLToPath(new URL("..", import.meta.url));

  it("is served with no switch set in the daemon's environment, and an old `FIRSTMATE_SHIP_DECK=0` changes nothing", async () => {
    await withEnvironment({ FIRSTMATE_SHIP_DECK: undefined }, () => expect(readDeckExtras(async () => root)).resolves.toBeDefined());
    await withEnvironment({ FIRSTMATE_SHIP_DECK: "0" }, () => expect(readDeckExtras(async () => root)).resolves.toBeDefined());
  });

  it("on, is the sail, its occluder, six looks, the plank's shark and splash and five clouds, byte for byte, and small enough to send whole", async () => {
    const extras = await readDeckExtras(async () => root);
    const paths = extrasImagePaths(extras.manifest);
    expect(Object.keys(extras.images)).toEqual(paths);
    expect(paths).toHaveLength(19);
    for (const path of paths) {
      expect(Buffer.from(extras.images[path]!, "base64").equals(readFileSync(join(root, DECK_ENVIRONMENT_DIR, path))), path).toBe(true);
    }
    expect(extras.manifest.crew.map((look) => look.id)).toEqual(["bosun", "old-salt", "navigator", "carpenter", "rigger", "deckhand"]);
    expect(extras.manifest.clouds?.sprites.map((cloud) => cloud.id)).toEqual(["wisp", "puff", "cumulus", "long-bank", "twin-bank"]);
    const total = Object.values(extras.images).reduce((sum, png) => sum + png.length, 0);
    expect(total).toBeLessThan(60_000);
  });

  it("puts the occluder exactly where the mast piece it replaces stands, at its size and on its row", () => {
    const extras = JSON.parse(readFileSync(join(root, DECK_EXTRAS_MANIFEST), "utf8")) as {
      sail: { occluder: { texture: string; replaces: string; position: [number, number]; baseline: number | null } };
    };
    const deck = DeckArtManifestSchema.parse(JSON.parse(readFileSync(join(root, DECK_MANIFEST), "utf8")));
    const { occluder } = extras.sail;
    const mast = deck.pieces[occluder.replaces]!;
    expect([occluder.position, occluder.baseline]).toEqual([[mast.x, mast.y], mast.baseline]);
    const png = readFileSync(join(root, DECK_ENVIRONMENT_DIR, occluder.texture));
    expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([mast.frame[2], mast.frame[3]]);
  });

  it("refuses a manifest whose images would leave art/ship-deck/, or two looks of one name, and does not keep the failure", async () => {
    const dir = mkdtempSync(join(tmpdir(), "firstmate-deck-extras-"));
    try {
      mkdirSync(join(dir, DECK_ENVIRONMENT_DIR), { recursive: true });
      const manifest = JSON.parse(readFileSync(join(root, DECK_EXTRAS_MANIFEST), "utf8")) as { sail: { texture: string }; crew: Array<{ id: string }> };
      writeFileSync(join(dir, DECK_EXTRAS_MANIFEST), JSON.stringify({ ...manifest, sail: { ...manifest.sail, texture: "../../vendor/pixi.png" } }));
      await expect(readDeckExtras(async () => dir)).rejects.toThrow("relative .png path");
      writeFileSync(join(dir, DECK_EXTRAS_MANIFEST), JSON.stringify({ ...manifest, crew: [...manifest.crew, manifest.crew[0]] }));
      await expect(readDeckExtras(async () => dir)).rejects.toThrow("its own id");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
