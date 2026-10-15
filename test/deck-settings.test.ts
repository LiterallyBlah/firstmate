/**
 * The pack linter: every setting pack under `art/settings/` held to what the engine needs of it, whatever the
 * setting — the schema and everything it names (`settingProblems`), its images present at their declared sizes and
 * hashes with nothing else in the folder, every sprite inside its image, every animation's frames one size, every
 * variant lined up with what it lays over, every drifting sprite in exactly its slots' colours, and the whole small
 * enough to send. A new setting is held to all of it by being there.
 */
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath, URL } from "node:url";
import { describe, expect, it } from "vitest";

import { ENGINE_FORMAT_VERSION, SettingManifestSchema, capabilitiesUsed, settingImageIds, type SettingManifest } from "../shared/deck-setting";
import { PACK_BYTES_MAX, SETTING_MANIFEST, SETTINGS_DIR } from "../server/deck-settings";
import { decodePng, type Pixels } from "./png";

const root = fileURLToPath(new URL("..", import.meta.url));
const settings = join(root, SETTINGS_DIR);
const packs = readdirSync(settings).filter((name) => statSync(join(settings, name)).isDirectory());

type Sprite = { image: string; rect?: readonly [number, number, number, number] | undefined };

/** Every file under `folder`, by its path there with forward slashes. */
function filesUnder(folder: string): string[] {
  const out: string[] = [];
  const walk = (at: string) => {
    for (const name of readdirSync(at)) {
      const path = join(at, name);
      if (statSync(path).isDirectory()) walk(path);
      else out.push(relative(folder, path).split(sep).join("/"));
    }
  };
  walk(folder);
  return out.sort();
}

it("has at least the ship, and ships every pack with the plugin", () => {
  expect(packs).toContain("ship");
  const manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as { files: string[] };
  expect(manifest.files).toContain("art/");
  // Nothing but packs under art/: generation sources, prompts and reviews belong in docs/.
  expect(readdirSync(join(root, "art"))).toEqual(["settings"]);
});

describe.each(packs)("the %s pack", (id) => {
  const folder = join(settings, id);
  const manifest: SettingManifest = SettingManifestSchema.parse(JSON.parse(readFileSync(join(folder, SETTING_MANIFEST), "utf8")));
  const pixels = new Map<string, Pixels>();
  const image = (imageId: string) => {
    let read = pixels.get(imageId);
    if (read === undefined) {
      read = decodePng(readFileSync(join(folder, manifest.images[imageId]!.path)));
      pixels.set(imageId, read);
    }
    return read;
  };
  const size = (sprite: Sprite): [number, number] => {
    if (sprite.rect !== undefined) return [sprite.rect[2], sprite.rect[3]];
    const declared = manifest.images[sprite.image]!.size;
    return [declared[0], declared[1]];
  };

  it("is itself: named for its folder, in a format this engine draws, needing exactly what it uses", () => {
    expect(manifest.id).toBe(id);
    expect(manifest.formatVersion).toBeLessThanOrEqual(ENGINE_FORMAT_VERSION);
    expect([...manifest.requires].sort()).toEqual([...capabilitiesUsed(manifest)].sort());
  });

  it("has every image it names, at its declared size and hash, uses every image it declares, and holds nothing else", () => {
    for (const [imageId, declared] of Object.entries(manifest.images)) {
      const file = readFileSync(join(folder, declared.path));
      expect([file.readUInt32BE(16), file.readUInt32BE(20)], imageId).toEqual(declared.size);
      expect(createHash("sha256").update(file).digest("hex"), imageId).toBe(declared.sha256);
    }
    expect([...settingImageIds(manifest)].sort()).toEqual(Object.keys(manifest.images).sort());
    expect(filesUnder(folder)).toEqual([SETTING_MANIFEST, ...Object.values(manifest.images).map((declared) => declared.path)].sort());
  });

  it("is small enough to send whole", () => {
    const bytes = Object.values(manifest.images).reduce((sum, declared) => sum + statSync(join(folder, declared.path)).size, 0);
    expect(bytes).toBeLessThanOrEqual(PACK_BYTES_MAX);
  });

  it("cuts every sprite from inside its image, and draws every look's every pose inside its own", () => {
    const inside = (sprite: Sprite, where: string) => {
      if (sprite.rect === undefined) return;
      const [x, y, width, height] = sprite.rect;
      const [imageWidth, imageHeight] = manifest.images[sprite.image]!.size;
      expect(x >= 0 && y >= 0 && x + width <= imageWidth && y + height <= imageHeight, `${where}: ${sprite.image} ${sprite.rect.join(",")}`).toBe(true);
    };
    const { stage } = manifest;
    inside(stage.backdrop.sprite, "backdrop");
    for (const part of stage.parts) {
      inside(part.sprite, part.id);
      if (part.replacesPiece !== undefined) inside(part.replacesPiece.sprite, part.id);
      if (part.behaviour?.kind === "cycle") for (const sprite of part.behaviour.frames.sprites) inside(sprite, part.id);
    }
    for (const piece of stage.pieces) inside(piece.sprite, piece.id);
    for (const prop of stage.props) inside(prop.sprite, prop.id);
    for (const look of manifest.cast.looks) {
      for (const [pose, standing] of Object.entries(manifest.cast.lanes[look.lane]!)) inside({ image: look.image, rect: standing.rect }, `${look.id} ${pose}`);
    }
    for (const element of manifest.ambience) if (element.behaviour.kind === "flyby") for (const sprite of Object.values(element.behaviour.poses)) inside(sprite, element.id);
  });

  it("plays every animation's frames at one size, and lays every variant over its element frame for frame", () => {
    const oneSize = (sprites: readonly Sprite[], where: string) => {
      for (const sprite of sprites) expect(size(sprite), where).toEqual(size(sprites[0]!));
    };
    const lined = (base: readonly Sprite[], variants: ReadonlyArray<{ id: string; frames: readonly Sprite[] }> | undefined, where: string) => {
      for (const variant of variants ?? []) {
        expect(variant.frames.length, `${where} ${variant.id}`).toBe(base.length);
        for (const frame of variant.frames) expect(size(frame), `${where} ${variant.id}`).toEqual(size(base[0]!));
      }
    };
    for (const part of manifest.stage.parts) if (part.behaviour?.kind === "cycle") oneSize(part.behaviour.frames.sprites, part.id);
    for (const element of manifest.ambience) {
      const behaviour = element.behaviour;
      switch (behaviour.kind) {
        case "tile":
        case "strip":
        case "cycle":
          oneSize(behaviour.frames.sprites, element.id);
          lined(behaviour.frames.sprites, behaviour.variants, element.id);
          break;
        case "drifters":
          for (const sprite of behaviour.sprites) {
            expect(manifest.images[sprite.image]!.size, `${element.id} ${sprite.id}`).toEqual(sprite.size);
            lined([{ image: sprite.image }], sprite.variants, `${element.id} ${sprite.id}`);
          }
          break;
        case "flyby":
          oneSize(Object.values(behaviour.poses), element.id);
          expect(size(Object.values(behaviour.poses)[0]!), element.id).toEqual(behaviour.size);
          break;
        case "flash":
          for (const frame of behaviour.frames) expect(size(frame.sprite), element.id).toEqual(behaviour.size);
          break;
        case "backdrop-cycle":
          for (const phase of Object.values(behaviour.phases)) expect(size({ image: phase }), element.id).toEqual(behaviour.size);
          break;
        case "overlay": {
          // In its backdrop's placement, so its backdrop's size.
          const space = manifest.ambience.find((other) => other.id === behaviour.space)!.behaviour;
          if (space.kind === "backdrop-cycle") expect(size({ image: behaviour.image }), element.id).toEqual(space.size);
          break;
        }
      }
    }
    for (const [effectId, effect] of Object.entries(manifest.effects)) for (const sprite of Object.values(effect.frames)) expect(size(sprite), effectId).toEqual(effect.size);
  });

  it("draws every drifting sprite in its palette's colours alone, so each slot can be recoloured by the day", () => {
    for (const element of manifest.ambience) {
      const behaviour = element.behaviour;
      if (behaviour.kind !== "drifters") continue;
      const sprites = behaviour.sprites.flatMap((sprite) => [
        { image: sprite.image, palette: behaviour.palette },
        ...(sprite.variants ?? []).flatMap((variant) => variant.frames.map((frame) => ({ image: frame.image, palette: variant.palette ?? behaviour.palette }))),
      ]);
      for (const sprite of sprites) {
        expect(sprite.palette, element.id).toHaveLength(behaviour.slots);
        const allowed = new Set(sprite.palette.map((hex) => Number.parseInt(hex.slice(1), 16)));
        const read = image(sprite.image);
        const colours = new Set<number>();
        for (let y = 0; y < read.height; y += 1) for (let x = 0; x < read.width; x += 1) if (read.alpha(x, y) >= 128) colours.add(read.at(x, y) >>> 8);
        expect([...colours].filter((colour) => !allowed.has(colour)), `${element.id} ${sprite.image}`).toEqual([]);
        expect(colours.size, `${element.id} ${sprite.image}`).toBeGreaterThan(0);
      }
    }
  });

  it("says in words what each of its zones is", () => {
    for (const zone of manifest.zones.zones) expect(manifest.copy.zones[zone.id]?.length ?? 0, zone.id).toBeGreaterThan(0);
  });
});
