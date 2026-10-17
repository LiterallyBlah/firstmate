/** `precip@1`: bounded, seeded rain. No renderer, timers, global random source or pack callbacks.
 * Positions integrate velocity, so changing fleet intensity never seeks a looping animation.
 * Every new fall gets independent attributes; three interleaved depth strata prevent a flat curtain.
 */
import type { Behaviour } from "./deck-ambience";
import { hashUnit } from "./deck-ambient";
import type { VisibleWorld } from "./deck-environment";
import { flashSalt } from "./deck-flash";
import { opacityAt } from "./deck-variants";

export type Precip = Behaviour<"precip">;
type Kind = Precip["kinds"][number];
export const PRECIP_CAP = 600;
/** One slot per 6000 CSS pixels, at most 600 even on a 4K pane; DPR does not multiply the work. */
export function precipBudget(width: number, height: number): number {
  const area = width * height;
  return Number.isFinite(area) && width > 0 && height > 0 ? Math.min(PRECIP_CAP, Math.ceil(area / 6000)) : 0;
}
const mix = (a: number, b: number, t: number) => a + (b - a) * t;
const range = (r: readonly [number, number], t: number) => mix(r[0], r[1], t);
/** Far/mid/near in a 3:2:1 mix; near streaks stay sparse. */
export const precipDepth = (index: number): number => index % 6 < 3 ? 0 : index % 6 < 5 ? 1 : 2;

/** Numeric kind ranges interpolate with the same smoothstep as the weather's curves. */
export function precipKinds(kinds: Precip["kinds"], intensity: number): { low: Kind; high: Kind; t: number; density: number } {
  let index = 0;
  while (index < kinds.length - 1 && kinds[index + 1]!.at <= intensity) index++;
  const low = kinds[index]!, high = kinds[Math.min(index + 1, kinds.length - 1)]!;
  const linear = high.at === low.at ? 0 : Math.max(0, Math.min(1, (intensity - low.at) / (high.at - low.at)));
  const t = linear * linear * (3 - 2 * linear);
  return { low, high, t, density: mix(low.density, high.density, t) };
}

export interface PrecipDrop {
  x: number; y: number; angle: number; length: number; alpha: number; depth: number; sprite: number;
  /** Attributes redrawn only on respawn; public for deterministic inspection. */
  life: number; samples: number[]; impact: number;
}
export interface PrecipSplash { x: number; y: number; age: number; frame: number; scale: number; alpha: number }

export function createPrecip(definition: Precip, scene: string, session: number) {
  const salt = flashSalt(scene) ^ Math.trunc(session);
  const drops: PrecipDrop[] = [], splashes: PrecipSplash[] = [];
  let bounds: VisibleWorld = { left: 0, right: 0, top: 0, bottom: 0 };
  let area = 0, budget = 0, count = 0, lastTime: number | null = null;
  let lastStill: number | null | undefined, layoutVersion = 0, drawnLayout = -1;
  const indices = new Map(definition.drops.map((drop, i) => [drop.id, i]));
  const meanAngle = definition.drops.reduce((sum, drop) => sum + drop.angle, 0) / definition.drops.length;
  const kinds = new Map(definition.kinds.map((kind) => [kind.id, ["far", "mid", "near"].map((depth) =>
    kind.drops.filter((id) => definition.drops[indices.get(id)!]!.depth === depth))]));
  const margin = Math.max(...definition.kinds.map((kind) => kind.length[1] * kind.depth[1])) * 2;
  function respawn(drop: PrecipDrop, index: number, scattered: boolean): void {
    drop.life++;
    const seed = salt + Math.imul(index + 1, 374761393) + Math.imul(drop.life, 668265263);
    for (let i = 0; i < 10; i++) drop.samples[i] = hashUnit(seed + i * 127);
    drop.x = mix(bounds.left - margin, bounds.right + margin, drop.samples[0]!);
    drop.y = scattered ? mix(bounds.top - margin, bounds.bottom + margin, drop.samples[1]!) : bounds.top - margin;
    drop.impact = definition.splashes === undefined ? Infinity : range(definition.splashes.rows, drop.samples[9]!);
  }
  return {
    drops, splashes,
    layout(visible: VisibleWorld, pane: { width: number; height: number }): void {
      bounds = { ...visible };
      budget = precipBudget(pane.width, pane.height);
      area = Math.max(0, pane.width * pane.height) / 1_000_000;
      const reserve = definition.splashes === undefined ? 0 : Math.floor(budget / 10);
      drops.length = Math.min(drops.length, budget - reserve);
      while (drops.length < budget - reserve) drops.push({ x: 0, y: 0, angle: 0, length: 1, alpha: 0, depth: 1, sprite: 0, life: -1, samples: [], impact: Infinity });
      // Layout is seeded independently of the number of resizes and camera moves.
      drops.forEach((drop, i) => { drop.life = -1; drop.alpha = 0; respawn(drop, i, true); });
      splashes.length = 0;
      while (splashes.length < reserve) splashes.push({ x: 0, y: 0, age: Infinity, frame: 0, scale: 1, alpha: 0 });
      count = 0;
      layoutVersion++;
    },
    /** Returns false for an unchanged held field: no per-particle work on lite frames. */
    draw(seconds: number, intensity: number | null, motion: "run" | "hold" | "hide"): boolean {
      const time = Number.isFinite(seconds) ? seconds : 0;
      const elapsed = lastTime === null ? 0 : Math.max(0, Math.min(0.1, time - lastTime));
      lastTime = time;
      const opacity = motion === "hide" ? 0 : opacityAt(definition.opacity, intensity);
      const stillKey = opacity === 0 ? null : intensity;
      if (motion !== "run" && lastStill === stillKey && drawnLayout === layoutVersion) return false;
      const reset = motion !== "run" && (lastStill !== stillKey || drawnLayout !== layoutVersion);
      lastStill = motion === "run" ? undefined : stillKey;
      drawnLayout = layoutVersion;
      const blend = precipKinds(definition.kinds, intensity ?? 0);
      const target = opacity > 0 ? Math.min(drops.length, blend.density * area) : 0;
      const nextCount = Math.ceil(target);
      const step = motion === "run" ? elapsed : 0;
      const phase = hashUnit(salt) * Math.PI * 2;
      const gustTime = motion === "run" ? time : 0;
      const gust = definition.wind.gust * (0.7 * Math.sin(gustTime * Math.PI * 2 / definition.wind.periodS + phase)
        + 0.3 * Math.sin(gustTime * Math.PI * 2 / (definition.wind.periodS * 1.618) + phase * 2));
      for (const splash of splashes) {
        splash.age += step;
        splash.frame = Math.floor(splash.age * 1000 / (definition.splashes?.frameMs ?? 1));
        if (motion !== "run" || splash.frame >= (definition.splashes?.frames.length ?? 0)) splash.alpha = 0;
      }
      for (let i = 0; i < Math.max(count, nextCount); i++) {
        const drop = drops[i]!;
        drop.alpha = 0;
        if (i >= nextCount) continue;
        if (reset) { drop.life = -1; respawn(drop, i, true); }
        else if (i >= count && count > 0) respawn(drop, i, true);
        const s = drop.samples;
        const sample = (key: "speed" | "length" | "opacity" | "depth", value: number) =>
          mix(range(blend.low[key], value), range(blend.high[key], value), blend.t);
        const layer = precipDepth(i);
        drop.depth = sample("depth", (layer + s[2]!) / 3);
        drop.length = sample("length", s[3]!) * drop.depth;
        drop.alpha = opacity * sample("opacity", s[4]!) * Math.min(1, target - i);
        const kind = s[6]! < blend.t ? blend.high : blend.low;
        const choices = kinds.get(kind.id)![layer]!;
        drop.sprite = indices.get(choices[Math.min(choices.length - 1, Math.floor(s[7]! * choices.length))]!)!;
        drop.angle = Math.max(-75, Math.min(75, definition.drops[drop.sprite]!.angle - meanAngle
          + definition.wind.angle + gust + (s[5]! * 2 - 1) * definition.wind.jitter));
        const before = drop.y;
        const dy = sample("speed", s[8]!) * drop.depth * step;
        drop.y += dy;
        drop.x += dy * Math.tan(drop.angle * Math.PI / 180);
        const width = bounds.right - bounds.left + 2 * margin;
        drop.x = bounds.left - margin + ((drop.x - bounds.left + margin) % width + width) % width;
        const splashDef = definition.splashes;
        if (splashDef !== undefined && before < drop.impact && drop.y >= drop.impact && s[9]! < splashDef.chance && opacity > 0) {
          const splash = splashes.find((entry) => entry.alpha <= 0);
          if (splash !== undefined) Object.assign(splash, { x: drop.x, y: drop.impact, age: 0, frame: 0, scale: range(splashDef.scale, s[2]!), alpha: drop.alpha });
        }
        if (drop.y > bounds.bottom + margin) respawn(drop, i, false);
      }
      count = nextCount;
      return true;
    },
  };
}
