/** `choreography@1`: a finite sequence of actor segments and effect keys. No pack code or expressions.
 * Compile once per exit and drift; sample on a departure's own clock, independently of the live crew.
 */
import type { SettingManifest } from "../shared/deck-setting";
import { standing, type DeckCast } from "./deck-cast";
import type { Point } from "./deck-geometry";

export type DeckDeparture = keyof SettingManifest["portals"]["byDeparture"];
type Definition = Extract<SettingManifest["portals"]["exits"][string], { kind: "choreography" }>;
type Segment = Definition["actor"][number];
export type ActorLayer = Segment["layer"];
type EffectKey = Definition["effects"][number]["keys"][number];

export interface Timeline {
  segments: Array<{ start: number; ms: number; from: Point; to: Point; previousLayer: ActorLayer; segment: Segment }>;
  effects: Array<{ effect: string; track: number; order: number; mirror: boolean; definition: SettingManifest["effects"][string]; keys: Array<{ start: number; key: EffectKey }> }>;
  events: ReadonlyMap<string, number>;
  releaseMs: number;
  durationMs: number;
}

export interface Choreography {
  kind: "choreography";
  marks: Readonly<Record<string, Point>>;
  queue: { at: Point; spacing: readonly [number, number] };
  alternate: Definition["alternate"];
  timelines: ReadonlyMap<number, Timeline>;
}

export interface ChoreographyMoment {
  actor: { x: number; y: number; pose: string; flip: boolean; reveal: number; layer: ActorLayer; moving: boolean } | null;
  effects: Array<{ effect: string; track: number; order: number; frame: string; x: number; y: number; flip: boolean }>;
  done: boolean;
}

export function compileChoreography(definition: Definition, walkSpeed: number, effects: SettingManifest["effects"]): Choreography {
  const marks = Object.fromEntries(Object.entries(definition.marks).map(([id, [x, y]]) => [id, { x, y }]));
  const queue = { at: marks[definition.queue.at]!, spacing: definition.queue.spacing };
  const timelines = new Map<number, Timeline>();
  for (const drift of definition.alternate.drift) {
    if (timelines.has(drift)) continue;
    const events = new Map<string, number>([["start", 0]]);
    let start = 0;
    let from = queue.at;
    let previousLayer: ActorLayer = "floor";
    const segments = definition.actor.map((segment) => {
      const mark = segment.to === undefined ? from : marks[segment.to.mark]!;
      const to = { x: mark.x + (segment.to?.drift === true ? drift : 0), y: mark.y };
      const ms = segment.ms === "walk" ? Math.max(1, Math.round(Math.hypot(to.x - from.x, to.y - from.y) / walkSpeed * 1000)) : segment.ms;
      const compiled = { start, ms, from, to, previousLayer, segment };
      start += ms;
      if (segment.event !== undefined) events.set(segment.event, start);
      from = to;
      previousLayer = segment.layer;
      return compiled;
    });
    const tracks = definition.effects.map((track, index) => ({
      effect: track.effect, track: index, order: track.order, mirror: track.mirror === "side", definition: effects[track.effect]!,
      keys: track.keys.map((key) => ({ start: events.get(key.at.event)! + key.at.plusMs, key })),
    }));
    const durationMs = Math.max(start, ...tracks.flatMap((track) => track.keys.map(({ start, key }) => start + key.ms)));
    timelines.set(drift, { segments, effects: tracks, events, releaseMs: events.get(definition.queue.release)!, durationMs });
  }
  return { kind: "choreography", marks, queue, alternate: definition.alternate, timelines };
}

const between = (from: number, to: number, u: number) => from + (to - from) * u;

/** Whole-pixel paths, named cast cycles, cropped reveal, and anchored effect tracks. */
export function choreographyAt(choreography: Choreography, t: number, options: { side: -1 | 1; drift: number; cast: DeckCast; lane: string }): ChoreographyMoment {
  const { side, drift, cast, lane } = options;
  const timeline = choreography.timelines.get(drift)!;
  if (t >= timeline.durationMs) return { actor: null, effects: [], done: true };
  let actor: ChoreographyMoment["actor"] = null;
  const current = timeline.segments.find(({ start, ms }) => t >= start && t < start + ms);
  if (current !== undefined && current.segment.gone !== true) {
    const { start, ms, from, to, previousLayer, segment } = current;
    const elapsed = t - start;
    const u = elapsed / ms;
    const step = Math.floor(elapsed / cast.stepMs);
    const cycle = typeof segment.pose === "string" ? null : cast[segment.pose.cycle];
    const pose = typeof segment.pose === "string" ? segment.pose : cycle![step % cycle!.length]!;
    const height = standing(cast, lane, pose).frame[3];
    let y = between(from.y, to.y, u);
    if (typeof segment.path === "object") {
      if ("arc" in segment.path) y -= Math.sin(Math.PI * u) * segment.path.arc;
      else y = from.y + (to.y - from.y) * u * u - segment.path.ballistic * u * (1 - u);
    }
    const reveal = (value: NonNullable<Segment["reveal"]>[number]) => typeof value === "number" ? value : Math.min(1, value.rows / height);
    const share = segment.reveal === undefined ? 1 : between(reveal(segment.reveal[0]), reveal(segment.reveal[1]), u);
    const bob = segment.bob;
    actor = {
      x: Math.round(between(from.x, to.x, u)) + (segment.jiggle?.dx[Math.floor(elapsed / segment.jiggle.stepMs) % segment.jiggle.dx.length] ?? 0),
      y: Math.round(y) - (cycle !== null && step % cycle.length % 2 === 1 ? cast.rise : 0)
        + (bob !== undefined && Math.floor((t - timeline.events.get(bob.since)!) / bob.everyMs) % 2 === 1 ? bob.dy : 0),
      pose, flip: typeof segment.pose !== "string" && segment.pose.cycle === "walkSide" && to.x < from.x,
      reveal: Math.round(share * height) / height,
      layer: u < (segment.layerAt ?? 0) ? previousLayer : segment.layer,
      moving: segment.moving,
    };
  }
  const shown: ChoreographyMoment["effects"] = [];
  for (const track of timeline.effects) {
    const current = track.keys.find(({ start, key }) => t >= start && t < start + key.ms);
    if (current === undefined) continue;
    const { start, key } = current;
    const mark = choreography.marks[key.place.mark]!;
    const flip = track.mirror && side === 1;
    const offset = key.place.alignX === undefined ? 0 : track.definition.points[key.place.alignX]![0] - track.definition.points.anchor![0];
    const x = mark.x + (key.place.drift === true ? drift : 0) - (flip ? -offset : offset);
    shown.push({ effect: track.effect, track: track.track, order: track.order, frame: key.frame,
      x: Math.round(x + (key.approach === undefined ? 0 : side * key.approach.px * (1 - (t - start) / key.ms))), y: mark.y, flip });
  }
  return { actor, effects: shown, done: false };
}
