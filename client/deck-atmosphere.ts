/**
 * Intensity is engine-owned: weighted work in progress, eased over a few seconds. The pack owns its appearance:
 * named channels interpolated from a table, calm values, and clocks advanced by step times their channel's pace.
 * Compiled once at mount; no setting-specific names. Reduced motion holds the live clocks and disables layers
 * driven by intensity. Every animation keeps its phase when its speed changes.
 */
import type { SettingManifest } from "../shared/deck-setting";
import { curveAt, type Curve } from "./deck-variants";
import type { DeckSailor, DeckState } from "./deck-scene";

export const ACTIVITY_WEIGHTS: Record<DeckState, number> = { working: 1, waiting: 0.25, blocked: 0, idle: 0 };
/** The weighted crew at the top of the intensity dial. */
export const BUSY_CREW = 6;
/** Seconds to get most of the way (63%) to the crew's intensity. */
export const EASE_SECONDS = 3;

/** The pack's channels and clock bindings, with table values in channel order. */
export interface DeckAtmosphere {
  readonly channels: readonly string[];
  readonly table: ReadonlyArray<{ at: number; values: readonly number[] }>;
  readonly clocks: ReadonlyArray<readonly [clock: string, channel: string]>;
  readonly delivered: Readonly<Record<string, number>>;
}

export function compileAtmosphere(manifest: Pick<SettingManifest, "atmosphere">): DeckAtmosphere {
  const definition = manifest.atmosphere;
  const channels = Object.keys(definition?.table[0] ?? {}).filter((key) => key !== "at");
  return {
    channels,
    table: (definition?.table ?? []).map((row) => ({ at: row.at, values: channels.map((channel) => row[channel]!) })),
    clocks: Object.entries(definition?.clocks ?? {}),
    delivered: { ...definition?.delivered },
  };
}

/** How busy the crew is, 0 to 1; a lost feed never counts. */
export function crewIntensity(sailors: ReadonlyArray<Pick<DeckSailor, "state" | "stale" | "activityState" | "activityStale">>): number {
  let activity = 0;
  for (const sailor of sailors) if (!(sailor.activityStale ?? sailor.stale)) activity += ACTIVITY_WEIGHTS[sailor.activityState ?? sailor.state] ?? 0;
  return Math.max(0, Math.min(1, activity / BUSY_CREW));
}

function lerp(from: number, to: number, t: number): number {
  return from + (to - from) * t;
}

/** Channels at this intensity, clamped to the table's ends; no channels without a table. */
export function atmosphereAt(definition: DeckAtmosphere, intensity: number): Record<string, number> {
  const { table, channels } = definition;
  if (table.length === 0) return {};
  const at = Number.isFinite(intensity) ? Math.max(table[0]!.at, Math.min(table[table.length - 1]!.at, intensity)) : table[0]!.at;
  let index = 1;
  while (index < table.length - 1 && table[index]!.at < at) index += 1;
  const low = table[index - 1] ?? table[0]!;
  const high = table[index] ?? low;
  const t = high.at === low.at ? 0 : (at - low.at) / (high.at - low.at);
  return Object.fromEntries(channels.map((channel, i) => [channel, lerp(low.values[i]!, high.values[i]!, t)]));
}

/** Eased intensity and animation clocks in seconds of their art's timing. Per mount. */
export interface Atmosphere {
  intensity: number;
  clocks: Readonly<Record<string, number>>;
}

export function openingAtmosphere(definition: DeckAtmosphere, intensity = 0): Atmosphere {
  return {
    intensity: Math.max(0, Math.min(1, Number.isFinite(intensity) ? intensity : 0)),
    clocks: Object.fromEntries(definition.clocks.map(([clock]) => [clock, 0])),
  };
}

/** Ease towards the target, then advance clocks at their channel's pace, never backwards. Still holds all clocks. */
export function stepAtmosphere(definition: DeckAtmosphere, state: Atmosphere, stepMs: number, target: number, moving: boolean): Atmosphere {
  const goal = Math.max(0, Math.min(1, Number.isFinite(target) ? target : 0));
  if (!moving) return { ...state, intensity: goal };
  const seconds = Number.isFinite(stepMs) && stepMs > 0 ? stepMs / 1000 : 0;
  const intensity = seconds === 0 ? state.intensity : goal + (state.intensity - goal) * Math.exp(-seconds / EASE_SECONDS);
  const channels = atmosphereAt(definition, intensity);
  return {
    intensity,
    clocks: Object.fromEntries(definition.clocks.map(([clock, channel]) => [clock, state.clocks[clock]! + seconds * Math.max(0, channels[channel]!)])),
  };
}

/** Null intensity disables curves, variants and flashes on a still deck. */
export interface Weather {
  clocks: Readonly<Record<string, number>>;
  channels: Readonly<Record<string, number>>;
  intensity: number | null;
}

/** The pack's calm values at their delivered pace on the scene clock, without intensity-driven layers. */
export function deliveredWeather(definition: DeckAtmosphere, seconds: number): Weather {
  return {
    clocks: Object.fromEntries(definition.clocks.map(([clock, channel]) => [clock, seconds * Math.max(0, definition.delivered[channel]!)])),
    channels: definition.delivered,
    intensity: null,
  };
}

export function weatherOf(definition: DeckAtmosphere, atmosphere: Atmosphere): Weather {
  return { clocks: atmosphere.clocks, channels: atmosphereAt(definition, atmosphere.intensity), intensity: atmosphere.intensity };
}

/** A colour shaded by a tint, channel by channel, as Pixi's tint multiplies. */
export function shade(colour: number, tint: number): number {
  let shaded = 0;
  for (const shift of [16, 8, 0]) shaded |= Math.round((((colour >> shift) & 0xff) * ((tint >> shift) & 0xff)) / 255) << shift;
  return shaded;
}

/** A tint from white (the art as it is) at 0 to the target at 1. */
export function tintToward(to: number, amount: number): number {
  const t = Math.max(0, Math.min(1, Number.isFinite(amount) ? amount : 0));
  let tint = 0;
  for (const shift of [16, 8, 0]) tint |= Math.round(lerp(0xff, (to >> shift) & 0xff, t)) << shift;
  return tint;
}

/** A fixed number, a channel times its scale, or a curve over intensity. */
export type Level = number | { channel: string; scale?: number | undefined } | { curve: Curve };

/** Any channel named by the pack; an unknown one reads zero. */
export function channelOf(weather: Weather, channel: string): number {
  const value = weather.channels[channel];
  return typeof value === "number" ? value : 0;
}

/** A named animation clock, or the scene clock when none was supplied. */
export function clockOf(weather: Weather, clock: string | undefined, seconds: number): number {
  const value = clock === undefined ? undefined : weather.clocks[clock];
  return typeof value === "number" ? value : seconds;
}

/** A curve reads nothing on a still deck, which has no intensity. */
export function levelAt(level: Level, weather: Weather): number {
  if (typeof level === "number") return level;
  if ("channel" in level) return channelOf(weather, level.channel) * (level.scale ?? 1);
  return weather.intensity === null ? 0 : curveAt(level.curve, weather.intensity);
}
