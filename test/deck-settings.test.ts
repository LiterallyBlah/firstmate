/**
 * The pack linter: every setting pack under `art/settings/` held to what the engine needs of it, whatever the
 * setting — the schema and everything it names (`settingProblems`), its images present at their declared sizes and
 * hashes with nothing else in the folder, every sprite inside its image, every animation's frames one size, every
 * variant lined up with what it lays over, every drifting sprite in its palette's colours, and the whole small
 * enough to send — and its floor read against its own backdrop's pixels: every walkable point on the backdrop and
 * hidden only where a crowd may not spill, every post and mark on open floor, everything reachable from everything
 * else without avoidable path corners, and the fit taking in every part, flyby and effect — and its crowds: two dozen workers packed into a zone,
 * each in its areas, in sight, clear of the crew at work and in the pointer's reach. A new setting is held to all of
 * it by being there.
 */
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath, URL } from "node:url";
import { describe, expect, it } from "vitest";

import { ENGINE_FORMAT_VERSION, SettingManifestSchema, capabilitiesUsed, settingImageIds, type SettingManifest } from "../shared/deck-setting";
import { PACK_BYTES_MAX, SETTING_MANIFEST, SETTINGS_DIR } from "../server/deck-settings";
import { areaAt, clearLine, findPath, inRects, walkable, type Point } from "../client/deck-geometry";
import { compileStage, type ZoneAppearance } from "../client/deck-stage";
import { pieceDepths } from "../client/deck-parts";
import { choreographyAt } from "../client/deck-choreography";
import { compileCast } from "../client/deck-cast";
import { applyCrew, createCrew, crewFigures, type Figure } from "../client/deck-crew";
import { badgeTop, figureBox, sailorAt, type DeckBox } from "../client/deck-hover";
import { BADGE_SIZE } from "../client/deck-badges";
import type { DeckSailor, DeckState } from "../client/deck-scene";
import { decodePng, type Pixels } from "./png";
import { walkingEntryProblems } from "./deck-entry";

const root = fileURLToPath(new URL("..", import.meta.url));
const settings = join(root, SETTINGS_DIR);
const packs = readdirSync(settings).filter((name) => statSync(join(settings, name)).isDirectory());

type Sprite = { image: string; rect?: readonly [number, number, number, number] | undefined };

/** A worker on the stage, as the scene hands it over. */
function worker(key: string, state: DeckState): DeckSailor {
  return { key, label: key, state, identity: `agent-${key}`, stale: false, caption: { title: key, status: state, project: null, host: "This machine", line: null, stale: null } };
}

const STATES = ["working", "waiting", "blocked", "idle"] as const;

/** Every point a walk from `from` along `path` passes, a half pixel apart. */
function walkPoints(from: Point, path: readonly Point[]): Point[] {
  const points: Point[] = [from];
  let at = from;
  for (const next of path) {
    const steps = Math.max(1, Math.ceil(Math.hypot(next.x - at.x, next.y - at.y) * 2));
    for (let step = 1; step <= steps; step += 1) points.push({ x: at.x + ((next.x - at.x) * step) / steps, y: at.y + ((next.y - at.y) * step) / steps });
    at = next;
  }
  return points;
}

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
    for (const zone of manifest.zones.zones) if (zone.appearance !== undefined) inside(zone.appearance.sprite, zone.id);
    for (const look of manifest.cast.looks) {
      for (const [pose, standing] of Object.entries(manifest.cast.lanes[look.lane]!)) inside({ image: look.image, rect: standing.rect }, `${look.id} ${pose}`);
    }
    for (const element of manifest.ambience) if (element.behaviour.kind === "flyby") for (const sprite of Object.values(element.behaviour.poses)) inside(sprite, element.id);
    for (const element of manifest.ambience) if (element.behaviour.kind === "phase-frames") for (const sprite of element.behaviour.frames) inside(sprite, element.id);
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
        case "phase-frames":
          oneSize(behaviour.frames, element.id);
          break;
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

  describe("its floor, read against its backdrop", () => {
    const stage = compileStage(manifest);
    const { floor } = stage;
    /** Whether a sprite has an opaque pixel at (x, y) of itself. */
    const opaqueIn = (sprite: Sprite, x: number, y: number) => {
      const [width, height] = size(sprite);
      const [rx, ry] = sprite.rect ?? [0, 0];
      const px = Math.floor(x);
      const py = Math.floor(y);
      return px >= 0 && py >= 0 && px < width && py < height && image(sprite.image).alpha(rx + px, ry + py) === 255;
    };
    const onBackdrop = (point: Point) => opaqueIn(manifest.stage.backdrop.sprite, point.x, point.y);
    // What stands in front of everything on the floor: a worker's feet behind one of these are hidden.
    const fronts = manifest.stage.pieces.filter((piece) => piece.baseline === null);
    const depths = pieceDepths(manifest.stage.pieces);
    const hidden = (point: Point, appearance?: ZoneAppearance | null) => fronts.some((piece) =>
      (appearance == null || depths.get(piece.id)! >= appearance.depth) && opaqueIn(piece.sprite, point.x - piece.at[0], point.y - piece.at[1]));
    const posts = [...stage.zones.values()].flatMap((zone) => zone.posts.map((post) => ({ ...post, appearance: zone.appearance })));
    const queues = [...stage.exits.entries()].flatMap(([exitId, exit]) => (exit.kind === "choreography" ? [{ id: `${exitId} queue`, ...exit.queue.at }] : []));
    const sinks = [...stage.exits.entries()].flatMap(([exitId, exit]) => (exit.kind === "sink" ? [{ id: exitId, ...exit.at }] : []));
    const places: Array<Point & { id: string; appearance?: ZoneAppearance | null }> = [...posts, { id: "entry", ...stage.entry }, ...sinks, ...queues];
    const [gridLeft, gridTop, gridWidth, gridHeight] = manifest.floor.grid.bounds;

    it("keeps walking entry corridors clear and their actors inside the fit", () => {
      expect(walkingEntryProblems(manifest)).toEqual([]);
      if (stage.walkIn === null) return;
      for (const point of walkPoints(stage.walkIn.from, [stage.entry])) {
        expect(onBackdrop(point), "entry corridor on backdrop").toBe(true);
        expect(hidden(point), "entry corridor hidden by foreground").toBe(false);
      }
    });

    it("is all backdrop, and hidden behind what stands in front of everything only where a crowd may not spill", () => {
      let walkablePoints = 0;
      for (let y = gridTop; y < gridTop + gridHeight; y += 1) {
        for (let x = gridLeft; x < gridLeft + gridWidth; x += 1) {
          if (!walkable(floor, x, y)) continue;
          walkablePoints += 1;
          expect(onBackdrop({ x, y }), `${x},${y} on the backdrop`).toBe(true);
          if (hidden({ x, y })) expect(areaAt(floor, x, y)?.spill, `${x},${y} hidden, on an area a crowd spills onto`).toBe(false);
        }
      }
      expect(walkablePoints).toBeGreaterThan(0);
    });

    it("puts every post, the entry, every exit and every queue on open floor: walkable, in sight, where a crowd may stand", () => {
      for (const place of places) {
        expect(walkable(floor, place.x, place.y), place.id).toBe(true);
        expect(hidden(place, place.appearance), `${place.id} hidden`).toBe(false);
        if (place.appearance == null) expect(areaAt(floor, place.x, place.y)?.spill, place.id).toBe(true);
      }
    });

    it("blocks every obstacle's feet, its props' included", () => {
      for (const { id: obstacle, rect } of floor.obstacles) expect(walkable(floor, rect[0] + rect[2] / 2, rect[1] + rect[3] / 2), obstacle).toBe(false);
    });

    it("walks from every post, the entry and every queue to every other, on the floor without avoidable corners", () => {
      for (const from of places) {
        for (const to of places) {
          if (from === to || (from.x === to.x && from.y === to.y)) continue;
          const path = findPath(floor, from, to);
          expect(path.at(-1), `${from.id} → ${to.id} ends there`).toEqual({ x: to.x, y: to.y });
          for (const point of walkPoints(from, path)) expect(walkable(floor, point.x, point.y), `${from.id} → ${to.id} at ${point.x},${point.y}`).toBe(true);
          // A long obstacle can demand a long detour even between close posts. Test the path against the floor,
          // not a ship-specific straight-line ratio: no retained corner may be skipped along open floor.
          const route = [from, ...path];
          for (let i = 0; i < route.length - 2; i++) {
            for (let j = i + 2; j < route.length; j++) expect(clearLine(floor, route[i]!, route[j]!), `${from.id} → ${to.id} skips corner ${i + 1}`).toBe(false);
          }
        }
      }
    });

    it("keeps a packing zone's posts in its overflow areas, apart, and every other zone's out of them", () => {
      for (const zone of stage.zones.values()) {
        if (zone.overflow.kind !== "pack") continue;
        const { areas, spacing } = zone.overflow;
        for (const post of zone.posts) expect(inRects(areas, post), `${zone.id} ${post.id}`).toBe(true);
        for (const post of posts.filter((other) => other.place !== zone.id)) expect(inRects(areas, post), `${post.id} in ${zone.id}'s areas`).toBe(false);
        for (const a of zone.posts) {
          for (const b of zone.posts) if (a !== b) expect(Math.abs(a.x - b.x) >= spacing[0] || Math.abs(a.y - b.y) >= spacing[1], `${a.id} ${b.id}`).toBe(true);
        }
      }
    });

    it("packs two dozen workers into each packing zone: each in its areas, in sight, clear of the crew at work, and in the pointer's reach", () => {
      const cast = compileCast(manifest);
      const overlaps = (a: DeckBox, b: DeckBox) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
      /** Whether the pointer finds `figure` somewhere on its badge. */
      const reachable = (figures: readonly Figure[], figure: Figure) => {
        const top = badgeTop(figure, cast);
        for (let y = top; y < top + BADGE_SIZE.height; y += 1) {
          for (let x = figure.x - 3; x <= figure.x + 3; x += 1) if (sailorAt(figures, cast, { x: x + 0.5, y: y + 0.5 })?.key === figure.key) return true;
        }
        return false;
      };
      for (const zone of stage.zones.values()) {
        if (zone.overflow.kind !== "pack") continue;
        const { areas } = zone.overflow;
        const state = STATES.find((each) => stage.zoneOf(each).id === zone.id);
        if (state === undefined) continue;
        // Every post of every other state's zone held: the most crowded stage there is.
        const others = STATES.filter((each) => stage.zoneOf(each).id !== zone.id).flatMap((each) => stage.zoneOf(each).posts.map((_, index) => worker(`${each}-${index}`, each)));
        for (const count of [1, zone.posts.length, 24]) {
          const crew = createCrew(stage, cast);
          const packed = Array.from({ length: count }, (_, index) => worker(`packed-${String(index).padStart(2, "0")}`, state));
          applyCrew(crew, [...others, ...packed], { snap: true });
          const figures = crewFigures(crew, 0, { still: true });
          const inZone = figures.filter((figure) => figure.key.startsWith("packed-"));
          const awake = figures.filter((figure) => !figure.key.startsWith("packed-"));
          expect(new Set(inZone.map((figure) => `${figure.x},${figure.row}`)).size, `${zone.id}: ${count}`).toBe(count);
          for (const figure of inZone) {
            const feet = { x: figure.x, y: figure.row };
            expect(inRects(areas, feet), `${zone.id} ${count}: ${figure.key} in its areas`).toBe(true);
            expect(walkable(floor, feet.x, feet.y)).toBe(true);
            expect(hidden(feet, figure.appearance), `${zone.id} ${count}: ${figure.key} hidden`).toBe(false);
            const box = figureBox(figure, cast)!;
            if (figure.appearance !== undefined) {
              const appearance = figure.appearance;
              expect(box.left).toBeGreaterThanOrEqual(0);
              expect(box.right).toBeLessThanOrEqual(stage.width);
              expect(box.top).toBeGreaterThanOrEqual(stage.fit.top);
              expect(box.bottom).toBeLessThanOrEqual(stage.fit.bottom);
              const [rx, ry, width, height] = appearance.frame;
              let visible = 0;
              for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
                if (image(appearance.image).alpha(rx + x, ry + y) < 128) continue;
                const point = { x: figure.x - appearance.feet[0] + x, y: figure.y - appearance.feet[1] + y };
                expect(onBackdrop(point), `${zone.id}: handle off backdrop`).toBe(true);
                expect(hidden(point, appearance), `${zone.id}: hidden handle pixel`).toBe(false);
                visible++;
              }
              expect(visible).toBeGreaterThan(0);
            }
            for (const other of awake) expect(overlaps(box, figureBox(other, cast)!), `${zone.id} ${count}: ${figure.key} on ${other.key}`).toBe(false);
            expect(reachable(figures, figure), `${zone.id} ${count}: ${figure.key} out of reach`).toBe(true);
          }
          for (const other of awake) expect(reachable(figures, other), `${zone.id} ${count}: ${other.key} out of reach`).toBe(true);
        }
      }
    });

    it("fits what is drawn: every part, the flyby's whole sprite, and every effect where its choreography puts it", () => {
      const { fit } = manifest.stage;
      expect(fit.top).toBeLessThanOrEqual(0);
      expect(fit.bottom).toBeGreaterThanOrEqual(stage.height);
      for (const part of manifest.stage.parts) expect(part.at[1], part.id).toBeGreaterThanOrEqual(fit.top);
      for (const element of manifest.ambience) {
        const behaviour = element.behaviour;
        if (behaviour.kind === "phase-frames") {
          for (const frame of behaviour.frames) {
            const [width, height] = size(frame);
            const x = behaviour.at[0] - behaviour.anchor[0], y = behaviour.at[1] - behaviour.anchor[1];
            expect(x, element.id).toBeGreaterThanOrEqual(0);
            expect(x + width, element.id).toBeLessThanOrEqual(stage.width);
            expect(y, element.id).toBeGreaterThanOrEqual(fit.top);
            expect(y + height, element.id).toBeLessThanOrEqual(fit.bottom);
          }
        }
        if (behaviour.kind !== "flyby") continue;
        expect(behaviour.rows[0] - Math.abs(behaviour.wobble.px) - behaviour.anchor[1], element.id).toBeGreaterThanOrEqual(fit.top);
        expect(behaviour.rows[1] + Math.abs(behaviour.wobble.px) + behaviour.size[1] - behaviour.anchor[1], element.id).toBeLessThanOrEqual(stage.height);
      }
      const cast = compileCast(manifest);
      const lane = cast.looks[0]!.lane;
      const portals = [...stage.exits];
      if (stage.walkIn !== null) portals.push(["entry", stage.walkIn.choreography]);
      for (const [id, exit] of portals) {
        if (exit.kind !== "choreography") continue;
        for (const [drift, timeline] of exit.timelines) for (const side of new Set(exit.alternate.side)) {
          for (const track of timeline.effects) for (const { start, key } of track.keys) {
            const sprite = track.definition.frames[key.frame]!;
            const [width, height] = size(sprite);
            let left = Infinity, right = -Infinity, top = Infinity, bottom = -Infinity;
            for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) if (opaqueIn(sprite, x, y)) {
              left = Math.min(left, x); right = Math.max(right, x); top = Math.min(top, y); bottom = Math.max(bottom, y);
            }
            if (left === Infinity) continue;
            const anchor = track.definition.points.anchor!;
            // Effect approach is linear; its endpoints bound the whole key. Sample both and the midpoint
            // through the actual engine, including drift, named-point alignment and mirroring.
            for (const at of [start, start + key.ms / 2, start + key.ms * (1 - 1e-9)]) {
              const shown = choreographyAt(exit, at, { drift, side, cast, lane }).effects.find((effect) => effect.track === track.track)!;
              const x1 = shown.x + (shown.flip ? anchor[0] - right - 1 : left - anchor[0]);
              const x2 = shown.x + (shown.flip ? anchor[0] - left : right + 1 - anchor[0]);
              const label = `${id}/${track.effect}/${key.frame} side=${side} drift=${drift}`;
              expect(x1, label).toBeGreaterThanOrEqual(0);
              expect(x2, label).toBeLessThanOrEqual(stage.width);
              expect(shown.y + top - anchor[1], label).toBeGreaterThanOrEqual(fit.top);
              expect(shown.y + bottom + 1 - anchor[1], label).toBeLessThanOrEqual(fit.bottom);
            }
          }
        }
      }
    });
  });

  it("says in words what each of its zones is", () => {
    for (const zone of manifest.zones.zones) expect(manifest.copy.zones[zone.id]?.length ?? 0, zone.id).toBeGreaterThan(0);
  });
});
