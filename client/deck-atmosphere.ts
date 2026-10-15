/**
 * The deck's weather follows the work: the more crewmates are working, the livelier the sea, the wind and the
 * sail. Pure — no Pixi and no browser globals (`client/deck-atmosphere.test.ts`); `client/deck-pixi.ts` steps it
 * every frame and `client/deck-environment.ts` draws the sea, the clouds and the wake with it.
 *
 * - **Intensity is work in progress.** Each sailor on deck counts by its state (`ACTIVITY_WEIGHTS`): a working one
 *   fully, one waiting on a job a little, a blocked or idle one not at all, and a greyed one (its feed lost) not
 *   at all either. Local and remote crew alike, since the scene holds both. `BUSY_CREW` of them is the top of the
 *   dial; more change nothing, so a crowded fleet stays readable.
 * - **Eased, never snapped.** The intensity drawn moves towards the crew's over `EASE_SECONDS` or so, so a crewmate
 *   starting or finishing turns the weather gradually. The deck opens in the crew's weather, as the crew already
 *   aboard is simply there.
 * - **One table** (`ATMOSPHERE`): what each part does at a few intensities, interpolated between. Every value is a
 *   multiple of the art's own timing, or an amplitude, so a stormier top end is one row's change.
 * - **Speeds change, phases do not jump.** Each animation runs on its own clock, advanced by the frame's step times
 *   its current pace, and the pure frame functions (`waterFrame`, `cloudX`, `sailFrame`, `shipBob`) are handed
 *   that clock instead of the scene's. Multiplying the scene's clock by a pace that changes would jump the sea,
 *   the clouds and the sail forwards or back as the crew changed.
 * - **Reduced motion is calm.** A still deck draws as it always has — the parts' first frames, no drift, the whole
 *   wake, the sky untinted (`deliveredWeather`) — and no ramp: its intensity follows the crew's at once, unseen, and
 *   its clocks stand, so motion resumes in the right weather. And no weather layers (`Weather.intensity` is null).
 * - **The top end can be a storm, in data.** The scenery is handed the eased intensity itself (`Weather.intensity`),
 *   and the extras' weather layers — variants over the sea, wake and clouds, cycles, the sky's mood overlays, flashes —
 *   each fade in along their own curve over it (`client/deck-variants.ts`, `client/deck-flash.ts`). Their thresholds
 *   are in the setting pack (`art/settings/ship/setting.json`), beside the art, not here; this table only paces and sizes the calm scene.
 */
import { advanceWater, type WaterClock, type WaterMotion } from "./deck-water";
import type { DeckSailor, DeckState } from "./deck-scene";

/** How much a sailor in each state stirs the weather: it is about work in progress. */
export const ACTIVITY_WEIGHTS: Record<DeckState, number> = { working: 1, waiting: 0.25, blocked: 0, idle: 0 };
/** The weighted crew at which the weather is at its liveliest. */
export const BUSY_CREW = 6;
/** How long the drawn intensity takes to get most of the way (63%) to the crew's: a few seconds. */
export const EASE_SECONDS = 3;

/** What the weather does at one intensity. */
export interface AtmosphereParams {
  /** The sea's, the foam's and the wake's frames (`pace`), and the sea's and foam's drift (`drift`), against the art's own timing. */
  water: WaterMotion;
  /** How fast the clouds drift, against their own speed. */
  wind: number;
  /** How fast the sail alternates its rest and billow, against its `frameMs`. */
  sail: number;
  /** The share of the sail's cycle it spends billowed: 0.5 is the art's even alternation. */
  billow: number;
  /** How fast the ship bobs and the masthead sways, against their six-second swell. */
  swell: number;
  /** How far the ship bobs, art pixels each way before rounding: 1.2 is the bob as it was. */
  heave: number;
  /** How much wake there is: the generated wake's opacity, and how far the code wake runs. 1 is all of it. */
  wake: number;
  /** How far the sky is shaded towards `STORM_SHADE`, 0 to 1. */
  mood: number;
}

/**
 * The weather at a few intensities, lowest first, interpolated between — the one place to tune it. Idle is
 * glassy: slower than the art's own timing, a short wake. Two crewmates working is the art as delivered. A busy fleet is spirited: a quick choppy sea, a fresh breeze, the sail snapping, a full wake and
 * a slightly moodier sky. Energetic, never a storm on its own: the heavy weather over the top end is the setting pack's.
 */
export const ATMOSPHERE: ReadonlyArray<{ at: number } & AtmosphereParams> = [
  { at: 0, water: { pace: 0.5, drift: 0.5 }, wind: 0.5, sail: 0.55, billow: 0.4, swell: 0.8, heave: 1, wake: 0.55, mood: 0 },
  { at: 2 / BUSY_CREW, water: { pace: 1, drift: 1 }, wind: 1, sail: 1, billow: 0.5, swell: 1, heave: 1.2, wake: 0.85, mood: 0 },
  { at: 1, water: { pace: 1.9, drift: 2.2 }, wind: 3, sail: 2.4, billow: 0.65, swell: 1.35, heave: 1.6, wake: 1, mood: 1 },
];

/** The sky's colour at full mood, as a tint: a shade greyer and bluer, never dark. */
export const STORM_SHADE = 0xdde1e8;

/** How busy the crew on deck is, 0 to 1. */
export function crewIntensity(sailors: ReadonlyArray<Pick<DeckSailor, "state" | "stale">>): number {
  let activity = 0;
  for (const sailor of sailors) if (!sailor.stale) activity += ACTIVITY_WEIGHTS[sailor.state] ?? 0;
  return Math.max(0, Math.min(1, activity / BUSY_CREW));
}

function lerp(from: number, to: number, t: number): number {
  return from + (to - from) * t;
}

/** The weather at `intensity`, interpolated between the table's rows; clamped to its ends. */
export function atmosphereAt(intensity: number, table: ReadonlyArray<{ at: number } & AtmosphereParams> = ATMOSPHERE): AtmosphereParams {
  const at = Number.isFinite(intensity) ? Math.max(table[0]!.at, Math.min(table[table.length - 1]!.at, intensity)) : table[0]!.at;
  let index = 1;
  while (index < table.length - 1 && table[index]!.at < at) index += 1;
  const low = table[index - 1] ?? table[0]!;
  const high = table[index] ?? low;
  const t = high.at === low.at ? 0 : (at - low.at) / (high.at - low.at);
  return {
    water: { pace: lerp(low.water.pace, high.water.pace, t), drift: lerp(low.water.drift, high.water.drift, t) },
    wind: lerp(low.wind, high.wind, t),
    sail: lerp(low.sail, high.sail, t),
    billow: lerp(low.billow, high.billow, t),
    swell: lerp(low.swell, high.swell, t),
    heave: lerp(low.heave, high.heave, t),
    wake: lerp(low.wake, high.wake, t),
    mood: lerp(low.mood, high.mood, t),
  };
}

/** The weather as it is drawn: the eased intensity, and each animation's own clock, in seconds of its art's timing. */
export interface Atmosphere {
  intensity: number;
  water: WaterClock;
  /** The clouds' clock. */
  wind: number;
  /** The sail's clock. */
  sail: number;
  /** The bob's and the sway's clock. */
  swell: number;
}

/** The weather at the scene's start, every clock at 0: at `intensity`, the crew's as the deck opens. */
export function openingAtmosphere(intensity = 0): Atmosphere {
  return { intensity: Math.max(0, Math.min(1, Number.isFinite(intensity) ? intensity : 0)), water: { frames: 0, drift: 0 }, wind: 0, sail: 0, swell: 0 };
}

/**
 * The weather `stepMs` on: the intensity eased towards `target`, then every clock advanced at the eased intensity's
 * pace. A still deck (not `moving`) takes `target` at once and its clocks stand.
 */
export function stepAtmosphere(state: Atmosphere, stepMs: number, target: number, moving: boolean): Atmosphere {
  const goal = Math.max(0, Math.min(1, Number.isFinite(target) ? target : 0));
  if (!moving) return { ...state, intensity: goal };
  const seconds = Number.isFinite(stepMs) && stepMs > 0 ? stepMs / 1000 : 0;
  const intensity = seconds === 0 ? state.intensity : goal + (state.intensity - goal) * Math.exp(-seconds / EASE_SECONDS);
  const params = atmosphereAt(intensity);
  return {
    intensity,
    water: advanceWater(state.water, seconds, params.water),
    wind: state.wind + seconds * Math.max(0, params.wind),
    sail: state.sail + seconds * Math.max(0, params.sail),
    swell: state.swell + seconds * Math.max(0, params.swell),
  };
}

/**
 * What the scenery is drawn with this frame: the water's and the clouds' clocks, the wake's strength, the sky's mood,
 * and the eased intensity its weather layers follow — null for none of them, as on a still deck.
 */
export interface Weather {
  water: WaterClock;
  wind: number;
  wake: number;
  mood: number;
  intensity: number | null;
}

/** The weather the art was made for at the scene's clock: every part at its own timing, a full wake, no mood, no weather layers. */
export function deliveredWeather(seconds: number): Weather {
  return { water: { frames: seconds, drift: seconds }, wind: seconds, wake: 1, mood: 0, intensity: null };
}

/** The scenery's weather from the atmosphere as it stands. */
export function weatherOf(atmosphere: Atmosphere): Weather {
  const params = atmosphereAt(atmosphere.intensity);
  return { water: atmosphere.water, wind: atmosphere.wind, wake: params.wake, mood: params.mood, intensity: atmosphere.intensity };
}

/** `colour` shaded by a tint, channel by channel, as Pixi's tint multiplies. */
export function shade(colour: number, tint: number): number {
  let shaded = 0;
  for (const shift of [16, 8, 0]) shaded |= Math.round((((colour >> shift) & 0xff) * ((tint >> shift) & 0xff)) / 255) << shift;
  return shaded;
}

/** The sky's tint at `mood`: white (the art as it is) at 0, `STORM_SHADE` at 1. */
export function moodTint(mood: number): number {
  const t = Math.max(0, Math.min(1, Number.isFinite(mood) ? mood : 0));
  let tint = 0;
  for (const shift of [16, 8, 0]) tint |= Math.round(lerp(0xff, (STORM_SHADE >> shift) & 0xff, t)) << shift;
  return tint;
}
