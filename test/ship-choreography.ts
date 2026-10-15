/** Frozen ship expectations and adapters for migration regression tests; all sampling runs the generic engine. */
import { choreographyAt, type ActorLayer } from "../client/deck-choreography";
import { departureEffects, exitFree, type Crew } from "../client/deck-crew";
import { choreography } from "../client/deck-stage";
import { shipStage, shipCast } from "./ship-pack";
export type DeckDeparture = "done" | "failed" | "closed" | "removed";

export const PLANK_DEPARTURES: ReadonlySet<DeckDeparture> = new Set<DeckDeparture>(["done", "failed", "closed", "removed"]);

export function exitFor(departure: DeckDeparture): "plank" | "hatch" {
  return PLANK_DEPARTURES.has(departure) ? "plank" : "hatch";
}

export interface PlankMarks {
  foot: { x: number; y: number };
  rail: { x: number; y: number };
  tip: { x: number; y: number };
  water: { x: number; y: number };
}

export const HOP_MS = 160;
export const PLANK_WALK_MS = 531;
export const TEETER_MS = 300;
export const JUMP_MS = 420;
export const IMPACT_AT = HOP_MS + PLANK_WALK_MS + TEETER_MS + JUMP_MS;
export const SPLASH_FRAMES = [
  { id: "impact", ms: 100 },
  { id: "burst", ms: 140 },
] as const;
export const PLUNGE_MS = 140;
export const BOB_UP_MS = 200;
export const SWIM_ROWS = 11;
export const FIN_AT = IMPACT_AT + 120;
export const FIN_MS = 560;
export const FIN_RUN = 40;
export const SURFACE_MS = 160;
export const CHOMP_MS = 180;
export const SUBMERGE_MS = 200;
export const CHOMP_AT = FIN_AT + FIN_MS + SURFACE_MS;
export const PLANK_EXIT_MS = CHOMP_AT + CHOMP_MS + SUBMERGE_MS;

export type SharkFrame = "fin" | "surface" | "chomp" | "submerge";
export type SplashFrame = "impact" | "burst";

export type PlankLayer = "deck" | "rail" | "sea";

export interface PlankMoment {
    sailor: { x: number; y: number; pose: string; reveal: number; layer: PlankLayer; moving: boolean } | null;
    shark: { frame: SharkFrame; x: number; y: number; flip: boolean } | null;
    splash: { frame: SplashFrame; x: number; y: number } | null;
  done: boolean;
}

export const HATCH_MS = 700;
export const FADE_MS = 600;
export const SHARK_MOUTH: readonly [number, number] = [13, -22];
export const legacyLayer = (layer: ActorLayer): PlankLayer => typeof layer === "object" ? "rail" : layer === "floor" ? "deck" : "sea";
export function plankExit(t: number, options: { side: -1 | 1; drift: number }): PlankMoment {
  const moment = choreographyAt(choreography(shipStage(), "plank"), t, { ...options, cast: shipCast(), lane: shipCast().looks[0]!.lane });
  const actor = moment.actor;
  const shark = moment.effects.find((effect) => effect.effect === "shark");
  const splash = moment.effects.find((effect) => effect.effect === "splash");
  return {
    sailor: actor === null ? null : { x: actor.x, y: actor.y, pose: actor.pose, reveal: actor.reveal, layer: legacyLayer(actor.layer), moving: actor.moving },
    shark: shark === undefined ? null : { frame: shark.frame as SharkFrame, x: shark.x, y: shark.y, flip: shark.flip },
    splash: splash === undefined ? null : { frame: splash.frame as SplashFrame, x: splash.x, y: splash.y },
    done: moment.done,
  };
}
export const plankFree = (crew: Crew) => exitFree(crew, "plank");
export function plankEffects(crew: Crew) {
  const groups = new Map<string, { key: string; shark: PlankMoment["shark"]; splash: PlankMoment["splash"] }>();
  for (const effect of departureEffects(crew)) {
    const key = effect.key.slice(0, effect.key.lastIndexOf(":"));
    let group = groups.get(key);
    if (group === undefined) { group = { key, shark: null, splash: null }; groups.set(key, group); }
    if (effect.effect === "shark") group.shark = { ...effect, frame: effect.frame as SharkFrame };
    if (effect.effect === "splash") group.splash = { ...effect, frame: effect.frame as SplashFrame };
  }
  return [...groups.values()];
}
