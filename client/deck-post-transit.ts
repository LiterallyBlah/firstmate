/** Reversible, authored access from a navigable post to a station outside the floor. Pure pack data. */
import type { SettingManifest } from "../shared/deck-setting";
import type { Point } from "./deck-geometry";

type Post = SettingManifest["zones"]["zones"][number]["posts"][number];
export interface PostTransit {
  id: string;
  points: readonly Point[];
  ends: readonly number[];
  durationMs: number;
  poses: readonly string[];
  stepMs: number;
  settled: string;
  front: string;
  depth: number;
}

export function compilePostTransit(post: Post, depths: ReadonlyMap<string, number>): PostTransit | null {
  if (post.transit === undefined) return null;
  const { path, speed, ...art } = post.transit;
  const points = [post.at, ...path].map(([x, y]) => ({ x, y }));
  let durationMs = 0;
  const ends = points.slice(1).map((point, index) => {
    const from = points[index]!;
    durationMs += Math.hypot(point.x - from.x, point.y - from.y) / speed * 1000;
    return durationMs;
  });
  return { id: post.id, points, ends, durationMs, ...art, depth: depths.get(art.front)! + 1 };
}

/** The same scalar progress runs in either direction; reassigning a worker never jumps its body. */
export function postTransitAt(route: PostTransit, elapsedMs: number, settled: boolean) {
  const ms = Math.max(0, Math.min(route.durationMs, elapsedMs));
  const index = Math.max(0, route.ends.findIndex((end) => ms <= end));
  const from = route.points[index]!;
  const to = route.points[index + 1]!;
  const start = index === 0 ? 0 : route.ends[index - 1]!;
  const u = (ms - start) / (route.ends[index]! - start);
  return {
    x: from.x + (to.x - from.x) * u,
    y: from.y + (to.y - from.y) * u,
    pose: settled ? route.settled : route.poses[Math.floor(ms / route.stepMs) % route.poses.length]!,
  };
}
