/** One rigid stage transform, shared by drawing, focus, labels and pointer inversion. No timers. */
import type { SettingManifest } from "../shared/deck-setting";
import { clockOf, levelAt, type Weather } from "./deck-atmosphere";
import { bobAt } from "./deck-parts";

export interface StageTransform { x: number; y: number; rotation?: number }
type Point = { x: number; y: number };

export function stageMotionAt(motion: SettingManifest["stage"]["motion"], seconds: number, weather: Weather, moving: boolean): StageTransform {
  const bob = motion?.bob;
  const y = moving && bob !== undefined ? bobAt(clockOf(weather, bob.clock, seconds), bob.periodS, levelAt(bob.amplitude, weather)) : 0;
  const rock = motion?.rock;
  if (!moving || rock === undefined) return { x: 0, y };
  const wave = Math.sin(clockOf(weather, rock.clock, seconds) * Math.PI * 2 / rock.periodS);
  const rotation = wave * levelAt(rock.degrees, weather) * Math.PI / 180;
  const drift = wave * (rock.drift === undefined ? 0 : levelAt(rock.drift, weather));
  const [px, py] = rock.pivot, c = Math.cos(rotation), s = Math.sin(rotation);
  // Fold the pivot into translation: the exact same affine transform goes to Pixi and hit testing.
  return { x: px - px * c + py * s + drift, y: py - px * s - py * c + y, rotation };
}

export function stageToWorld(p: Point, t: StageTransform): Point {
  if (!t.rotation) return { x: p.x + t.x, y: p.y + t.y };
  const c = Math.cos(t.rotation), s = Math.sin(t.rotation);
  return { x: p.x * c - p.y * s + t.x, y: p.x * s + p.y * c + t.y };
}

export function worldToStage(p: Point, t: StageTransform): Point {
  const x = p.x - t.x, y = p.y - t.y;
  if (!t.rotation) return { x, y };
  const c = Math.cos(t.rotation), s = Math.sin(t.rotation);
  return { x: x * c + y * s, y: -x * s + y * c };
}

/** Exact envelope of a box rotated through [-degrees,+degrees], plus independent drift/bob bounds.
 * Endpoints alone miss extrema where a corner's radius crosses a horizontal or vertical axis. */
export function rockedBounds(box: { left: number; top: number; right: number; bottom: number }, pivot: readonly [number, number], degrees: number, drift: number, bob: number) {
  const angle = degrees * Math.PI / 180;
  const points: Point[] = [];
  for (const x of [box.left, box.right]) for (const y of [box.top, box.bottom]) {
    const dx = x - pivot[0], dy = y - pivot[1], phase = Math.atan2(dy, dx);
    const angles = [-angle, angle];
    for (let k = -4; k <= 4; k++) {
      const a = k * Math.PI / 2 - phase;
      if (a > -angle && a < angle) angles.push(a);
    }
    for (const a of angles) points.push({ x: pivot[0] + dx * Math.cos(a) - dy * Math.sin(a), y: pivot[1] + dx * Math.sin(a) + dy * Math.cos(a) });
  }
  return { left: Math.min(...points.map(p => p.x)) - drift, right: Math.max(...points.map(p => p.x)) + drift,
    top: Math.min(...points.map(p => p.y)) - bob, bottom: Math.max(...points.map(p => p.y)) + bob };
}
