import { readFileSync } from "node:fs";
import { URL } from "node:url";
import { describe, expect, it } from "vitest";
import { ACTIVITY_STATES, capabilitiesUsed, SettingManifestSchema, settingProblems } from "../shared/deck-setting";
import { shipManifest } from "../test/ship-pack";
import { compileCast, standing } from "./deck-cast";
import { applyCrew, createCrew, crewFigures, figureScale } from "./deck-crew";
import { askMarks, badgeTop, figureBox, sailorAt } from "./deck-hover";
import { choreography, compileStage } from "./deck-stage";
import type { DeckSailor, DeckState } from "./deck-scene";

const worker = (key: string, state: DeckState): DeckSailor => ({
  key, identity: key, label: key, state, stale: false, asks: true,
  caption: { title: key, status: state, host: "This machine", project: null, line: null, stale: null },
});

describe("a scaled cast", () => {
  it("opts in explicitly, leaving legacy atlas coordinates and default drawing size unchanged", () => {
    const manifest = structuredClone(shipManifest());
    const original = compileCast(manifest);
    expect(original.scale).toBe(1);
    manifest.cast.scale = 2;
    expect(capabilitiesUsed(manifest)).toContain("cast-scale@1");
    expect(settingProblems(manifest).length).toBeGreaterThan(0);
    manifest.requires.push("cast-scale@1");
    expect(settingProblems(manifest)).toEqual([]);
    const scaled = compileCast(manifest);
    expect(scaled.lanes).toEqual(original.lanes);
    expect(scaled.standRows).toBe(original.standRows);
    for (const scale of [0, -1, 4, NaN, Infinity]) {
      manifest.cast.scale = scale;
      expect(SettingManifestSchema.safeParse(manifest).success).toBe(false);
    }
  });

  it.each([1, 1.125, 1.25, 2])("keeps full, mirrored and cropped hit boxes on the drawn feet at scale %s", scale => {
    const manifest = structuredClone(shipManifest()); manifest.cast.scale = scale;
    const cast = compileCast(manifest), crew = createCrew(compileStage(manifest), cast);
    applyCrew(crew, [worker("one", "waiting")], { snap: true });
    const figure = crewFigures(crew, 0, { still: true })[0]!;
    const pose = standing(cast, figure.lane, figure.pose);
    for (const flip of [false, true]) for (const reveal of [0, 0.23, 0.71, 1]) {
      const f = { ...figure, flip, reveal }, box = figureBox(f, cast);
      const rows = Math.round(pose.frame[3] * reveal);
      if (!rows) { expect(box).toBeNull(); continue; }
      const left = f.x - (flip ? pose.frame[2] - pose.feet[0] : pose.feet[0]) * scale;
      expect(box!.left).toBe(left);
      expect(box!.right - box!.left).toBe(pose.frame[2] * scale);
      expect(box!.top).toBe(reveal < 1 ? f.y - rows * scale : badgeTop(f, cast));
      expect(box!.bottom).toBe(reveal < 1 ? f.y : f.y + (pose.frame[3] - pose.feet[1]) * scale);
      expect(sailorAt([f], cast, { x: left + 0.1, y: box!.bottom - 0.1 })?.key).toBe(f.key);
      expect(sailorAt([f], cast, { x: left - 0.1, y: box!.bottom - 0.1 })).toBeNull();
    }
  });
});

describe.each(["ship", "sky-airship", "ghost-ship"])("%s enlarged crew", id => {
  const manifest = SettingManifestSchema.parse(JSON.parse(readFileSync(new URL(`../art/settings/${id}/setting.json`, import.meta.url), "utf8")));
  const cast = compileCast(manifest), stage = compileStage(manifest);
  it("keeps the eater larger than a sailor and its existing poses visible for 1.5–2.5 seconds", () => {
    for (const timeline of choreography(stage, "plank").timelines.values()) {
      const eater = timeline.effects.find(effect => !["splash", "puff"].includes(effect.effect))!;
      const first = Math.min(...eater.keys.map(key => key.start));
      const last = Math.max(...eater.keys.map(key => key.start + key.key.ms));
      expect(last - first).toBeGreaterThanOrEqual(1500);
      expect(last - first).toBeLessThanOrEqual(2500);
      expect(eater.definition.size[0]).toBeGreaterThan(cast.standRows * cast.scale);
    }
  });
  it.each(ACTIVITY_STATES)("keeps 24 %s workers distinct and reachable with their reply markers", state => {
    const crew = createCrew(stage, cast);
    applyCrew(crew, Array.from({ length: 24 }, (_, i) => worker(`${state} ${i}`, state)), { snap: true });
    const figures = crewFigures(crew, 0, { still: true }), marks = askMarks(figures, cast);
    if (id === "sky-airship") {
      expect(cast.looks).toHaveLength(8);
      expect(new Set(figures.map(f => f.look)).size).toBe(8);
      expect(cast.looks.slice(2).every(look => look.lane === "navy")).toBe(true);
    }
    expect(new Set(figures.map(f => `${f.x},${f.y}`)).size).toBe(24);
    for (const f of figures) {
      const box = figureBox(f, cast, marks.get(f.key))!;
      expect(box.left).toBeGreaterThan(0);
      expect(box.right).toBeLessThan(stage.width);
      expect(box.top).toBeGreaterThan(stage.fit.top);
      expect(box.bottom).toBeLessThan(stage.fit.bottom);
      let reachable = false;
      for (let y = box.top + 1; y < box.bottom && !reachable; y++) for (let x = box.left + 1; x < box.right && !reachable; x++) {
        reachable = [[0, 0], [-0.5, 0], [0.5, 0], [0, -0.5], [0, 0.5]].every(([dx, dy]) => sailorAt(figures, cast, { x: x + dx!, y: y + dy! }, marks)?.key === f.key);
      }
      expect(reachable, f.key).toBe(true);
      if (state === "idle") {
        expect(f.appearance).toBeDefined();
        expect(figureScale(cast, f)).toBe(1); // Windows/hammocks retain their registration in the hull.
      }
    }
  });
});
