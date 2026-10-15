/** The uninstalled office draft: geometry and the art delivery contract can be checked before pixels exist. */
import { existsSync, readFileSync } from "node:fs";
import { URL } from "node:url";
import { expect, it } from "vitest";
import { SettingManifestSchema, capabilitiesUsed, incompatibility, type SettingManifest } from "../shared/deck-setting";
import { createFloor, findPath, walkable } from "../client/deck-geometry";
import { compileStage } from "../client/deck-stage";
import { compileCast } from "../client/deck-cast";
import { applyCrew, createCrew, crewFigures } from "../client/deck-crew";
import { badgeTop, figureBox, sailorAt } from "../client/deck-hover";
import type { DeckSailor } from "../client/deck-scene";
import { walkingEntryProblems } from "./deck-entry";

const read = (name: string) => JSON.parse(readFileSync(new URL(`../docs/settings/office/${name}`, import.meta.url), "utf8"));
interface Asset { id: string; path: string; size: [number, number]; frameSize: [number, number]; frames: string[]; anchor: [number, number]; palette: string }
const contract = read("art-contract.json") as { assets: Asset[]; palettes: Record<string, string[]>; delivery: { maxImageBytes: number } };
const draft = read("setting.draft.json");

// Only the already supported portion is parsed. These explicit test substitutions are never emitted as a pack:
// zero digests are sentinels. Remaining capabilities get their own PRs.
function supportedDraft(): SettingManifest {
  const manifest = structuredClone(draft.manifest);
  for (const image of Object.values(manifest.images) as Array<{ sha256: string }>) image.sha256 = "0".repeat(64);
  manifest.ambience = manifest.ambience.filter((element: { behaviour: { kind: string } }) => element.behaviour.kind !== "phase-frames");
  manifest.requires = capabilitiesUsed(manifest);
  return SettingManifestSchema.parse(manifest);
}

it("keeps the office visibly incomplete and outside the installed pack scan", () => {
  expect(draft.status).toBe("not-installable");
  expect(existsSync(new URL("../art/settings/office", import.meta.url))).toBe(false);
  expect(SettingManifestSchema.safeParse(draft.manifest).success).toBe(false);
  expect(incompatibility(draft.manifest)).toContain(draft.pendingCapabilities.join(", "));
  expect(draft.pendingCapabilities).toEqual(["phase-frames@1"]);
  for (const image of Object.values(draft.manifest.images) as Array<{ sha256: unknown }>) expect(image.sha256).toBeNull();
});

it("matches every requested PNG to its draft image, explicit frame grid, palette and anchor", () => {
  expect(new Set(contract.assets.map((asset) => asset.path)).size).toBe(contract.assets.length);
  expect(contract.assets.map((asset) => asset.id).sort()).toEqual(Object.keys(draft.manifest.images).sort());
  for (const asset of contract.assets) {
    expect(draft.manifest.images[asset.id]).toEqual({ path: asset.path, size: asset.size, sha256: null });
    expect(asset.size).toEqual([asset.frameSize[0] * asset.frames.length, asset.frameSize[1]]);
    expect(new Set(asset.frames).size).toBe(asset.frames.length);
    expect(asset.path).toMatch(/^[a-z0-9/-]+\.png$/);
    expect(asset.anchor[0]).toBeGreaterThanOrEqual(0);
    expect(asset.anchor[1]).toBeGreaterThanOrEqual(0);
    expect(asset.anchor[0]).toBeLessThanOrEqual(asset.frameSize[0]);
    expect(asset.anchor[1]).toBeLessThanOrEqual(asset.frameSize[1]);
    expect(contract.palettes[asset.palette]!.length).toBeLessThanOrEqual(24);
    for (const hex of contract.palettes[asset.palette]!) expect(hex).toMatch(/^#[0-9A-F]{6}$/);
  }
  expect(contract.delivery.maxImageBytes).toBe(1_000_000);
});

it("has a valid supported manifest core with poses and effect frames registered to the art contract", () => {
  const manifest = supportedDraft();
  for (const look of manifest.cast.looks) {
    const asset = contract.assets.find((asset) => asset.id === look.image)!;
    for (const [pose, registration] of Object.entries(manifest.cast.lanes[look.lane]!)) {
      const index = asset.frames.indexOf(pose);
      expect(index).toBeGreaterThanOrEqual(0);
      expect(registration).toEqual({ rect: [index * asset.frameSize[0], 0, ...asset.frameSize], feet: asset.anchor });
    }
  }
  for (const [id, effect] of Object.entries(manifest.effects)) {
    const asset = contract.assets.find((asset) => asset.id === id)!;
    expect(effect.points.anchor).toEqual(asset.anchor);
    expect(effect.size).toEqual(asset.frameSize);
    for (const [frame, sprite] of Object.entries(effect.frames)) expect(sprite).toEqual({ image: id, rect: [asset.frames.indexOf(frame) * asset.frameSize[0], 0, ...asset.frameSize] });
  }
});

it("connects all proposed posts and portal queues without walking through furniture", () => {
  const manifest = supportedDraft();
  expect(walkingEntryProblems(manifest)).toEqual([]);
  const floor = createFloor({ ...manifest.floor, obstacles: [...manifest.floor.obstacles, ...manifest.stage.props.map((prop) => ({ id: prop.id, rect: prop.obstacle }))] });
  const points = [...manifest.zones.zones.flatMap((zone) => zone.posts.map((post) => post.at)), manifest.portals.entry.at,
    ...Object.values(manifest.portals.exits).flatMap((exit) => exit.kind === "choreography" ? [exit.marks[exit.queue.at]!] : [exit.at])].map(([x, y]) => ({ x, y }));
  for (const point of points) expect(walkable(floor, point.x, point.y), JSON.stringify(point)).toBe(true);
  for (const from of points) for (const to of points) {
    if (from.x === to.x && from.y === to.y) continue;
    const path = findPath(floor, from, to);
    expect(path.at(-1)).toEqual(to);
    let previous = from;
    for (const next of path) {
      const count = Math.ceil(Math.hypot(next.x - previous.x, next.y - previous.y) * 2);
      for (let i = 1; i <= count; i++) expect(walkable(floor, previous.x + (next.x - previous.x) * i / count, previous.y + (next.y - previous.y) * i / count)).toBe(true);
      previous = next;
    }
  }
});

it("fits a full break-area crowd clear of every other post, with each badge reachable", () => {
  const manifest = supportedDraft(), stage = compileStage(manifest), cast = compileCast(manifest);
  const worker = (key: string, state: DeckSailor["state"]): DeckSailor => ({ key, identity: key, state, label: key, stale: false, caption: { title: key, status: state, project: null, host: "local", line: null, stale: null } });
  const others = (["working", "waiting", "blocked"] as const).flatMap((state) => stage.zoneOf(state).posts.map((_, i) => worker(`${state}-${i}`, state)));
  const crew = createCrew(stage, cast);
  applyCrew(crew, [...others, ...Array.from({ length: 24 }, (_, i) => worker(`idle-${i}`, "idle"))], { snap: true });
  const figures = crewFigures(crew, 0, { still: true });
  const resting = figures.filter((figure) => figure.state === "idle");
  expect(new Set(resting.map((figure) => `${figure.x},${figure.y}`)).size).toBe(24);
  for (const figure of resting) {
    const box = figureBox(figure, cast)!;
    for (const awake of figures.filter((other) => other.state !== "idle")) {
      const other = figureBox(awake, cast)!;
      expect(box.left < other.right && other.left < box.right && box.top < other.bottom && other.top < box.bottom, `${figure.key} overlaps ${awake.key}`).toBe(false);
    }
    let reachable = false;
    for (let y = badgeTop(figure, cast); y < badgeTop(figure, cast) + 8; y++) for (let x = figure.x - 3; x <= figure.x + 3; x++) if (sailorAt(figures, cast, { x: x + 0.5, y: y + 0.5 })?.key === figure.key) reachable = true;
    expect(reachable, figure.key).toBe(true);
  }
});
