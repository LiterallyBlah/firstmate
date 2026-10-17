/**
 * A setting's cast, compiled once from its pack (`cast` in `shared/deck-setting.ts`): the poses each lane draws and
 * where their feet are, the looks a worker can wear, and the roles the engine asks poses of — standing, the walk
 * cycles, the pose each activity state settles in — with each state's fidget and the at-ease breath. Pure, and per
 * pack. The engine never names a pose: it asks the cast for one by role.
 *
 * - **Looks** are handed out by identity (`lookFor`): a worker wears the look its agent id hashes to among the looks
 *   whose image arrived, whoever else is aboard. A look is drawn with its lane's frames, from its own image.
 * - **Settled.** Each state's pose once its worker has arrived, mirrored by the worker's facing (`facing`), by its
 *   seed (`seed`: half the crew one way, half the other) or never.
 * - **Fidgets** are whole-pixel keyframes on a loop, out of step by the worker's seed; `towardFacing` turns a key's
 *   step the way the worker faces. The at-ease **breath** sinks the top rows of a worker settled in its state a pixel
 *   for the out-breath.
 * - **Walking** steps through the side cycle (drawn facing right, mirrored for left) or the front one, a step every
 *   `stepMs`, the body raised `rise` pixels on the odd steps.
 */
import type { ActivityState, SettingManifest } from "../shared/deck-setting";
import type { Facing } from "./deck-geometry";

/** A pose's frame in its image, and where its feet are in it. */
export interface Standing {
  frame: readonly [number, number, number, number];
  feet: readonly [number, number];
}

type Fidget = NonNullable<SettingManifest["cast"]["fidgets"][ActivityState]>;

export interface DeckCast {
  /** Uniform size on stage; atlas frames and cropped row counts remain unscaled. */
  scale: number;
  /** Each lane's poses, by id. */
  lanes: ReadonlyMap<string, ReadonlyMap<string, Standing>>;
  /** The looks, in the order identities hash into: each one's image and lane, and whether it must draw. */
  looks: ReadonlyArray<{ id: string; image: string; lane: string; optional: boolean }>;
  /** Entering, queueing, waiting to leave. */
  stand: string;
  walkFront: readonly string[];
  walkSide: readonly string[];
  rise: number;
  stepMs: number;
  settled: Readonly<Record<ActivityState, { pose: string; mirror: "facing" | "seed" | "none" }>>;
  fidgets: Readonly<Record<ActivityState, Fidget | null>>;
  breath: { state: ActivityState; rows: number; periodMs: number; inMs: number; seedMs: number } | null;
  /** The stand pose's rows in the first look's lane: how tall a worker is, for a choreography that crops it. */
  standRows: number;
}

export function compileCast(manifest: SettingManifest): DeckCast {
  const { cast } = manifest;
  const lanes = new Map(
    Object.entries(cast.lanes).map(([lane, poses]) => [lane, new Map(Object.entries(poses).map(([pose, standing]) => [pose, { frame: standing.rect, feet: standing.feet }]))]),
  );
  const looks = cast.looks.map((look) => ({ id: look.id, image: look.image, lane: look.lane, optional: look.optional !== false }));
  const first = lanes.get(looks[0]!.lane)!;
  return {
    scale: cast.scale ?? 1,
    lanes,
    looks,
    stand: cast.roles.stand,
    walkFront: cast.roles.walkFront,
    walkSide: cast.roles.walkSide,
    rise: cast.roles.rise,
    stepMs: cast.roles.stepMs,
    settled: cast.roles.settled,
    fidgets: cast.fidgets,
    breath: cast.breath ?? null,
    standRows: first.get(cast.roles.stand)!.frame[3],
  };
}

/** A pose's frame and feet in a lane; the first lane's when the lane has no such pose. */
export function standing(cast: DeckCast, lane: string, pose: string): Standing {
  const found = cast.lanes.get(lane)?.get(pose) ?? cast.lanes.get(cast.looks[0]!.lane)?.get(pose);
  if (found === undefined) throw new Error(`the setting's cast has no pose ${pose}`);
  return found;
}

/** The lane a look is drawn with: its own, or the first look's for a look the cast does not have. */
export function laneOf(cast: DeckCast, look: string): string {
  return (cast.looks.find((each) => each.id === look) ?? cast.looks[0]!).lane;
}

/**
 * The looks there are to hand out: every look the cast must draw, and each optional one whose image arrived
 * (`hasImage`), in the cast's order.
 */
export function availableLooks(cast: DeckCast, hasImage: (image: string) => boolean): string[] {
  return cast.looks.filter((look) => !look.optional || hasImage(look.image)).map((look) => look.id);
}

function hashOf(text: string): number {
  // FNV-1a: unrelated to the walk's seed, so a worker's look and its idle rhythm do not go together.
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) hash = Math.imul(hash ^ text.charCodeAt(index), 0x01000193) >>> 0;
  return hash;
}

/** The look a worker wears: the one its `identity` (its agent's id) hashes to among `looks`. */
export function lookFor(identity: string, looks: readonly string[]): string {
  return looks[hashOf(identity) % looks.length] ?? looks[0] ?? "";
}

/** The pose a worker settles in for `state`, and whether it is mirrored. */
export function settledPose(cast: DeckCast, state: ActivityState, facing: Facing, seed: number): { pose: string; flip: boolean } {
  const { pose, mirror } = cast.settled[state];
  return { pose, flip: mirror === "facing" ? facing === "left" : mirror === "seed" ? seed % 2 === 1 : false };
}

/** The key of a state's loop at `nowMs`: whole-pixel offsets and, optionally, a pose override. Still/stale workers skip this. */
export function fidgetAt(cast: DeckCast, state: ActivityState, facing: Facing, seed: number, nowMs: number): { dx: number; dy: number; pose?: string } {
  const fidget = cast.fidgets[state];
  if (fidget === null) return { dx: 0, dy: 0 };
  const t = nowMs + seed * fidget.seedMs;
  const at = ((t % fidget.periodMs) + fidget.periodMs) % fidget.periodMs;
  let key = fidget.keys[0]!;
  for (const each of fidget.keys) if (each.fromMs <= at) key = each;
  return { dx: key.towardFacing === true && facing === "left" ? -key.dx : key.dx, dy: key.dy, ...(key.pose === undefined ? {} : { pose: key.pose }) };
}

/** Whether a worker settled in the breath's state is on its out-breath, its top rows a pixel lower: 1 or 0. */
export function breathSink(cast: DeckCast, seed: number, nowMs: number): number {
  const { breath } = cast;
  if (breath === null) return 0;
  const t = (((nowMs + seed * breath.seedMs) % breath.periodMs) + breath.periodMs) % breath.periodMs;
  return t >= breath.inMs ? 1 : 0;
}

/** A walking worker's pose `walkedMs` into its walk: the side cycle mirrored for left, or the front one, and how far it rises. */
export function walkPose(cast: DeckCast, facing: Facing, walkedMs: number): { pose: string; flip: boolean; rise: number } {
  const cycle = facing === "front" ? cast.walkFront : cast.walkSide;
  const step = Math.floor(walkedMs / cast.stepMs) % cycle.length;
  return { pose: cycle[step]!, flip: facing === "left", rise: step % 2 === 1 ? cast.rise : 0 };
}
