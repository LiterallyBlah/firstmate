/**
 * A deck setting: what the Deck's scene engine draws the crew in — a ship, an office — as pure data. A setting is
 * a pack, `art/settings/<id>/`: one `setting.json`, checked against `SettingManifestSchema` below, and the PNGs it
 * names. No code: everything a pack can ask for is one of the engine's own behaviours (`ENGINE_CAPABILITIES`),
 * instantiated with numbers, ids, sprites and curves. A pack cannot add a behaviour; a new one is an engine change,
 * setting-agnostic and versioned (`drifters@1`), and a pack lists the ones it uses in `requires`.
 *
 * The engine keeps what must read the same in every setting: how cards become workers and states, the badges,
 * marks, legend, hover label, focus panel and reply bubble, the motion plan, and the meaning of intensity (how busy
 * the fleet is). A setting decides how those look and where they happen, never what they say.
 *
 * The server reads packs with this (`server/deck-settings.ts`); the client is sent them already checked
 * (`shared/deck-rpc.ts`), so none of this is in its bundle.
 *
 * Coordinates are the stage's logical pixels, integers, sampled `nearest`; a point on the floor is a worker's feet,
 * and the row it is on is its depth. `docs/deck-settings/README.md` explains the format and how to author a pack.
 */
import { z } from "zod";
import { walkInChoreography } from "./deck-portals";

/** The format this engine reads, and the newest it can draw. */
export const SETTING_FORMAT = "firstmate.deck-setting";
export const ENGINE_FORMAT_VERSION = 1;

/**
 * Every behaviour this engine draws, by name and version. Closed: a pack picks from it and never adds to it, and
 * the server marks a pack that needs one it lacks as incompatible.
 */
export const ENGINE_CAPABILITIES = [
  "stage@1",
  "floor@1",
  "zones@1",
  "zone-appearance@1",
  "stable-posts@1",
  "cast@1",
  "pose-fidgets@1",
  "rise@1",
  "walk-in@1",
  "sink@1",
  "choreography@1",
  "phase-tint@1",
  "bob@1",
  "sway@1",
  "cycle@1",
  "phase-frames@1",
  "flicker@1",
  "backdrop-cycle@1",
  "overlay@1",
  "flash@1",
  "drifters@1",
  "flyby@1",
  "tile@1",
  "strip@1",
  "variants@1",
  "day-cycle@1",
  "atmosphere@1",
] as const;

/** The four things a worker can be doing, derived by the engine from its card; a setting never changes this. */
export const ACTIVITY_STATES = ["working", "waiting", "blocked", "idle"] as const;
export type ActivityState = (typeof ACTIVITY_STATES)[number];

/** Why a worker leaves: its work done, failed, its worker closed, or its card gone from the board. */
export const DEPARTURES = ["done", "failed", "closed", "removed"] as const;

const Id = z.string().regex(/^[a-z0-9-]+$/, "an id is lower-case letters, digits and dashes");
/** A pack's own id: its folder's name. */
export const SettingId = Id;
const Px = z.number().int();
const Positive = z.number().int().positive();
const Point = z.tuple([Px, Px]);
const Size = z.tuple([Positive, Positive]);
const Rect = z.tuple([Px, Px, Positive, Positive]);
const Hex = z.string().regex(/^#[0-9a-f]{6}$/i, "a colour is #RRGGBB");
const Ms = z.number().positive();
/** A file inside the pack's folder: a relative path to a PNG, never climbing out. */
export const PackPath = z.string().regex(/^[a-z0-9_-]+(\/[a-z0-9_-]+)*\.png$/i, "an image is a relative .png path inside its pack");

/**
 * A value over the weather's intensity (0 an idle fleet, 1 a busy one): [intensity, value] points, intensity rising,
 * eased between them and held past either end. This is a numeric lookup table, never an expression.
 */
const Curve = z
  .array(z.tuple([z.number().min(0).max(1), z.number().nonnegative()]))
  .min(1)
  .refine((points) => points.every((point, index) => index === 0 || point[0] > points[index - 1]![0]), "a curve's intensities must rise");
const Opacity = Curve.refine((points) => points.every((point) => point[1] <= 1), "an opacity is at most 1");

/** A number fixed by the pack, read from an atmosphere channel (times `scale`), or read off a curve over intensity. */
const Level = z.union([z.number(), z.strictObject({ channel: Id, scale: z.number().optional() }), z.strictObject({ curve: Curve })]);

/** A sprite: a whole image, or a rectangle of one. */
const Sprite = z.strictObject({ image: Id, rect: Rect.optional() });
/** Frames played in order, `frameMs` each, on a clock (`atmosphere.clocks`); the scene's own clock without one. */
const Frames = z.strictObject({ sprites: z.array(Sprite).min(1), frameMs: Ms, clock: Id.optional() });
const Drift = z.strictObject({ pxPerSecond: z.number().nonnegative(), clock: Id.optional() });

/**
 * What every drawn element says about itself. `optional` (the default) means a failed image drops only this element.
 * `fallback` names the element drawn instead when this one cannot be, and an element named as a fallback is drawn
 * only in that place. `needs` names elements that must be drawn for this one to be. `lite` is what it does on a
 * software renderer, `still` under reduced motion; the engine holds it to both.
 */
const ElementBase = {
  id: Id,
  optional: z.boolean().optional(),
  fallback: Id.optional(),
  needs: z.array(Id).optional(),
  lite: z.enum(["run", "freeze", "hide"]),
  still: z.enum(["first-frame", "hide"]),
};

/** A second set of frames over an element, on its clock and frame index, faded in along `opacity` (`variants@1`). */
const Variant = z.strictObject({
  id: Id,
  frames: z.array(Sprite).min(1),
  /** `over` hides the element once the variant is whole (opaque art); `crossfade` fades the element out as it comes in. */
  blend: z.enum(["over", "crossfade"]),
  opacity: Opacity,
  /** A drifting sprite's variant has its own three slot colours: a neutral palette, and one per day phase. */
  palette: z.tuple([Hex, Hex, Hex]).optional(),
  byPhase: z.record(Id, z.tuple([Hex, Hex, Hex])).optional(),
});
const Variants = z.array(Variant).optional();

/** `sway@1`: whole pixels each way on a clock, `phase` radians behind the stage's bob, clamped to `limit`. */
const Sway = z.strictObject({ kind: z.literal("sway"), amplitude: Level, periodS: z.number().positive(), phase: z.number(), limit: Positive, clock: Id });
/** `cycle@1`: frames in turn. `duty` is the share of each cycle past the first frame; `opacity` is clamped to 0–1. */
const Cycle = z.strictObject({ kind: z.literal("cycle"), frames: Frames, duty: Level.optional(), opacity: Level.optional(), variants: Variants });

/**
 * A part: a sprite fixed to the stage, over the backdrop and under the floor, drawn in the order listed. `cutout` is
 * the rectangle of the backdrop it leaves out; `replacesPiece` draws its own rows in a piece's place.
 */
const Part = z.strictObject({
  ...ElementBase,
  sprite: Sprite,
  at: Point,
  cutout: Rect.optional(),
  replacesPiece: z.strictObject({ piece: Id, sprite: Sprite, at: Point }).optional(),
  behaviour: z.discriminatedUnion("kind", [Sway, Cycle]).optional(),
});

/**
 * Part of the backdrop drawn again in front, at the row it stands on (`baseline`): a worker whose feet are on or
 * above that row is behind it. `null` is in front of everything on the floor; `{ over }` just in front of a piece.
 */
const Piece = z.strictObject({
  id: Id,
  optional: z.boolean().optional(),
  sprite: Sprite,
  at: Point,
  baseline: z.union([Px, z.null(), z.strictObject({ over: Id })]),
});

/** A prop: a sprite standing on the floor, its feet at `at`, and the footprint nobody walks through. */
const Prop = z.strictObject({ id: Id, sprite: Sprite, feet: Point, at: Point, obstacle: Rect });

/**
 * `flicker@1`: a lamp drawn from a pixel glyph, its glow and glass flickering on out-of-step sines. Level =
 * `base` + Σ amplitude · sin(seconds · rate + seed · offset), clamped to 0–1; `still` under reduced motion.
 */
const LightStyle = z.strictObject({
  /** Rows of the lamp, one character a pixel: `.` is nothing, any other is a key of `inks`. */
  glyph: z.array(z.string().min(1)).min(1),
  /** The glyph's pixel that sits on the lamp's point. */
  origin: Point,
  inks: z.record(z.string().length(1), Hex),
  /** The ink whose pixels are glass, tinted by the level: the first tint whose threshold the level is over, else the last. */
  glass: z.string().length(1),
  tints: z.array(z.tuple([z.number(), Hex])).min(1),
  glow: z.array(z.strictObject({ at: Point, radius: Positive, colour: Hex, alpha: z.number().min(0).max(1) })),
  /** The glow's alpha: `base` + `gain` × level. */
  glowAlpha: z.strictObject({ base: z.number(), gain: z.number() }),
  flicker: z.strictObject({ base: z.number(), waves: z.array(z.tuple([z.number(), z.number(), z.number()])), still: z.number().min(0).max(1) }),
});
const Light = z.strictObject({ id: Id, style: Id, at: Point, row: Px, seed: z.number(), lite: ElementBase.lite, still: ElementBase.still });

const Stage = z.strictObject({
  size: Size,
  /** The rows the exact fit takes in, top (0 or above it) to bottom, and its margin. */
  fit: z.strictObject({ top: Px.max(0), bottom: Px, margin: z.number().positive().max(1) }),
  /** A worker's height with its badge, for the focus shot. */
  actorHeight: Positive,
  /** `phase-tint@1`: RGB multipliers by day phase; omitted phases keep the art's colours. */
  tintByPhase: z.record(Id, Hex).refine((tints) => Object.keys(tints).length > 0, "phase tint needs at least one phase").optional(),
  /** `bob@1`: the stage rides a whole-pixel sine. */
  motion: z.strictObject({ bob: z.strictObject({ periodS: z.number().positive(), amplitude: Level, clock: Id }) }).optional(),
  backdrop: z.strictObject({ sprite: Sprite }),
  parts: z.array(Part),
  pieces: z.array(Piece),
  props: z.array(Prop),
  lightStyles: z.record(Id, LightStyle),
  lights: z.array(Light),
});

const Floor = z.strictObject({
  /** Walkable polygons, as feet. `spill: false` keeps an overflowing crowd off this area (the stairs). */
  areas: z.array(z.strictObject({ id: Id, polygon: z.array(Point).min(3), spill: z.boolean().optional() })).min(1),
  obstacles: z.array(z.strictObject({ id: Id, rect: Rect })),
  /** The pathing grid: cell size, and the rectangle it covers. */
  grid: z.strictObject({ cell: Positive, bounds: Rect }),
  /** Walking pace, stage pixels a second. */
  walkSpeed: z.number().positive(),
});

const Spacing = z.tuple([Positive, Positive]);
const Zones = z.strictObject({
  /** Where each activity state sends its worker. */
  byState: z.strictObject({ working: Id, waiting: Id, blocked: Id, idle: Id }),
  zones: z.array(
    z.strictObject({
      id: Id,
      posts: z.array(z.strictObject({ id: Id, at: Point, facing: z.enum(["left", "right", "front"]) })).min(1),
      /** `nearest`: nearest the worker; `ordered`: first free; `stable`: identity-hashed preference, nearest free on collision. */
      assign: z.enum(["nearest", "ordered", "stable"]),
      /**
       * Once every post is held: `beside` stands the worker by the least crowded post, `spacing` apart; `pack` packs
       * it into `areas`, `spacing` apart, then closer (`fallback`) when they are full.
       */
      overflow: z.discriminatedUnion("kind", [
        z.strictObject({ kind: z.literal("beside"), spacing: Spacing }),
        z.strictObject({ kind: z.literal("pack"), areas: z.array(Rect).min(1), spacing: Spacing, fallback: Spacing }),
      ]),
      /** Hover labels for workers here hang from this row, below the floor, instead of over their heads. */
      labelFloor: Px.optional(),
      /** `zone-appearance@1`: a settled worker's visible handle, ahead of a depth piece. Badges and identity stay engine-owned. */
      appearance: z.strictObject({ sprite: Sprite, feet: Point, front: Id }).optional(),
    }),
  ),
});

const Standing = z.strictObject({ rect: Rect, feet: Point });
const Fidget = z.strictObject({
  periodMs: Ms,
  /** The worker's seed shifts its fidget by this much, so a crowd is out of step. */
  seedMs: z.number().nonnegative(),
  /** Whole-pixel offsets; `towardFacing` turns `dx`. Optional `pose` swaps the settled pose, retaining its mirror rule. */
  keys: z.array(z.strictObject({ fromMs: z.number().nonnegative(), dx: Px, dy: Px, towardFacing: z.boolean().optional(), pose: Id.optional() })).min(1),
});
const Settled = z.strictObject({ pose: Id, mirror: z.enum(["facing", "seed", "none"]) });
const Cast = z.strictObject({
  /** Pose frames, by lane and pose id. Every look is drawn with its lane's frames. */
  lanes: z.record(Id, z.record(Id, Standing)),
  /** The looks, in the order identities hash into; an `optional: false` look must draw. */
  looks: z.array(z.strictObject({ id: Id, image: Id, lane: Id, optional: z.boolean().optional() })).min(1),
  roles: z.strictObject({
    /** Entering, queueing, waiting to leave. */
    stand: Id,
    walkFront: z.array(Id).min(1),
    /** Drawn facing right, mirrored to walk left. */
    walkSide: z.array(Id).min(1),
    /** How far the body rises on the walk's odd steps. */
    rise: Px,
    stepMs: Ms,
    /** The pose once there, and when it is mirrored: by facing (left), by the worker's seed, or never. */
    settled: z.strictObject({ working: Settled, waiting: Settled, blocked: Settled, idle: Settled }),
  }),
  fidgets: z.strictObject({ working: Fidget.nullable(), waiting: Fidget.nullable(), blocked: Fidget.nullable(), idle: Fidget.nullable() }),
  /** At ease: the top `rows` of a settled worker in `state` sink a pixel for the out-breath, `inMs` into each `periodMs`. */
  breath: z.strictObject({ state: z.enum(ACTIVITY_STATES), rows: Positive, periodMs: Ms, inMs: Ms, seedMs: z.number().nonnegative() }).optional(),
});

/** Where an effect (a shark, a splash) is put: a mark, shifted by the departure's drift, its anchor there, or the x of a named point. */
const EffectPlace = z.strictObject({ mark: Id, drift: z.boolean().optional(), alignX: Id.optional() });
/** A moment of a choreography: from the start, or so long after a named event. */
const Moment = z.strictObject({ event: Id, plusMs: z.number().nonnegative() });
const Segment = z.strictObject({
  /** How long it lasts: milliseconds, or `walk` — its distance at the floor's walking pace. */
  ms: z.union([Ms, z.literal("walk")]),
  /** Names the moment it ends. */
  event: Id.optional(),
  /** Where it ends: a mark, and whether the departure's drift moves it across. It starts where the last one ended. */
  to: z.strictObject({ mark: Id, drift: z.boolean().optional() }).optional(),
  /** How it gets there: a straight line, a hop `arc` pixels high, or a jump `ballistic` pixels up then down. */
  path: z.union([z.literal("line"), z.strictObject({ arc: Positive }), z.strictObject({ ballistic: Positive })]).optional(),
  /** A pose, or a walk cycle (with its rise). */
  pose: z.union([Id, z.strictObject({ cycle: z.enum(["walkFront", "walkSide"]) })]),
  /** Rocking in place: a whole-pixel `dx` every `stepMs`. */
  jiggle: z.strictObject({ dx: z.array(Px).min(1), stepMs: Ms }).optional(),
  /** How much of the worker shows, cut at its feet: a share of its rows, or so many rows. */
  reveal: z.tuple([z.union([z.number().min(0).max(1), z.strictObject({ rows: Positive })]), z.union([z.number().min(0).max(1), z.strictObject({ rows: Positive })])]).optional(),
  /** A pixel down every other `everyMs`, counted from an event. */
  bob: z.strictObject({ dy: Px, everyMs: Ms, since: Id }).optional(),
  /** Where it is drawn: among the floor by its row, just in front of a piece, or in the effects layer; switched `layerAt` (0–1) in. */
  layer: z.union([z.literal("floor"), z.strictObject({ front: Id }), z.literal("effects")]),
  layerAt: z.number().min(0).max(1).optional(),
  moving: z.boolean(),
  /** The worker is no longer drawn. */
  gone: z.literal(true).optional(),
});
/** `choreography@1`: one departure as a timeline, its worker and its effects. */
const Choreography = z.strictObject({
  kind: z.literal("choreography"),
  marks: z.record(Id, Point),
  /** Departures wait their turn at `at`, `spacing` apart; the next goes once the one before has reached `release`. */
  queue: z.strictObject({ at: Id, release: Id, spacing: Spacing }),
  /** By departure serial: which side effects come from, and how far across the worker lands. */
  alternate: z.strictObject({ side: z.array(z.union([z.literal(-1), z.literal(1)])).min(1), drift: z.array(Px).min(1) }),
  actor: z.array(Segment).min(1),
  effects: z.array(
    z.strictObject({
      effect: Id,
      /** Depth above actors in the effects slot. */
      order: Positive,
      /** `side`: mirrored when it comes from the right. */
      mirror: z.literal("side").optional(),
      keys: z.array(
        z.strictObject({
          frame: Id,
          at: Moment,
          /** How long it shows. */
          ms: Ms,
          place: EffectPlace,
          /** Slides in from `px` off, on its side, over the key. */
          approach: z.strictObject({ px: Positive }).optional(),
        }),
      ),
    }),
  ),
});
const Portals = z.strictObject({
  /** `rise@1` crops at `at`; `walk-in@1` walks the authored corridor to the floor, then waits for any effects. */
  entry: z.discriminatedUnion("kind", [
    z.strictObject({ kind: z.literal("rise"), at: Point, ms: Ms }),
    z.strictObject({ kind: z.literal("walk-in"), from: Point, at: Point, effects: Choreography.shape.effects.optional() }),
  ]),
  /** `sink@1` back down, or `choreography@1`. */
  exits: z.record(Id, z.union([z.strictObject({ kind: z.literal("sink"), at: Point, ms: Ms }), Choreography])),
  byDeparture: z.strictObject({ done: Id, failed: Id, closed: Id, removed: Id }),
  /** Under reduced motion a departure fades where it stands. */
  still: z.strictObject({ fadeMs: Ms }),
});

const EffectDef = z.strictObject({ size: Size, points: z.record(Id, Point).refine((points) => points.anchor !== undefined, "an effect needs its anchor"), frames: z.record(Id, Sprite) });

/** `backdrop-cycle@1`: a backdrop per day phase, cross-faded, its `horizonRow` on the stage's `stageRow`, centred, never tiled. */
const BackdropCycle = z.strictObject({
  kind: z.literal("backdrop-cycle"),
  size: Size,
  phases: z.record(Id, Id),
  placement: z.strictObject({ horizonRow: Px, stageRow: Px }),
  /** Tinted towards `to` by `amount` (0 the art, 1 the tint). */
  tint: z.strictObject({ to: Hex, amount: Level }).optional(),
});
/**
 * `overlay@1`: a sprite in a backdrop's placement. Its alpha is the night's share, or a curve over intensity faded out
 * at night (`dayOnly`); `tint: "space"` takes the backdrop's tint; `hiddenBy` overlays cover it as far as they show by day.
 */
const Overlay = z.strictObject({
  kind: z.literal("overlay"),
  image: Id,
  space: Id,
  alpha: z.union([z.literal("night"), z.strictObject({ curve: Opacity })]),
  dayOnly: z.boolean().optional(),
  tint: z.literal("space").optional(),
  hiddenBy: z.array(Id).optional(),
});
/** `flash@1`: a moment now and then, `perMinute` at an intensity (capped by the engine), under a drifting sprite in view. */
const Flash = z.strictObject({
  kind: z.literal("flash"),
  frames: z
    .array(z.strictObject({ sprite: Sprite, ms: Ms, alpha: z.number().min(0).max(1) }))
    .min(1)
    .max(2)
    .refine((frames) => frames.reduce((sum, frame) => sum + frame.ms, 0) <= 3500, "a flash lasts at most 3500 ms"),
  size: Size,
  anchor: Point,
  under: Id,
  opacity: Opacity.refine((points) => points.every((point) => point[1] <= 0.6), "flash opacity is at most 0.6"),
  perMinute: Curve,
});
/**
 * `drifters@1`: a seeded field of sprites, one a lane above a backdrop's horizon, drifting right in whole pixels on a
 * clock and wrapped wholly off screen, each in `slots` colours recoloured by the day.
 */
const Drifters = z.strictObject({
  kind: z.literal("drifters"),
  space: Id,
  clock: Id,
  slots: z.literal(3),
  margin: Px,
  topMin: Px,
  /** Each lane: from and to, in the backdrop's pixels above its horizon row, lowest first. */
  lanes: z.array(z.tuple([Px, Px])).min(1),
  palette: z.tuple([Hex, Hex, Hex]),
  byPhase: z.record(Id, z.tuple([Hex, Hex, Hex])),
  sprites: z.array(z.strictObject({ id: Id, image: Id, size: Size, pxPerSecond: z.number().positive().max(4), variants: Variants })).min(1),
});
/** `flyby@1`: now and then one crosses the stage in a time slot, flapping in bursts, mirrored by direction. */
const Flyby = z.strictObject({
  kind: z.literal("flyby"),
  poses: z.record(Id, Sprite),
  sequence: z.array(Id).min(1),
  frameMs: Ms,
  /** The pose between bursts. */
  glide: Id,
  size: Size,
  anchor: Point,
  slotS: z.number().positive(),
  chance: z.number().min(0).max(1),
  /** When in its slot it sets off, seconds. */
  start: z.tuple([z.number().nonnegative(), z.number().nonnegative()]),
  speed: z.number().positive(),
  margin: Px,
  /** Its lowest and highest row, before its wobble. */
  rows: z.tuple([Px, Px]),
  wobble: z.strictObject({ px: z.number(), rate: z.number() }),
  flap: z.strictObject({ everyS: z.number().positive(), forS: z.number().positive() }),
  /** Not while the night's share is this much or more. */
  nightBelow: z.number().min(0).max(1),
  most: Positive,
});
/** `tile@1`: frames repeated both ways in bands sharing one origin row, drifting sideways in whole pixels. */
const Tile = z.strictObject({
  kind: z.literal("tile"),
  frames: Frames,
  drift: Drift,
  origin: Px,
  bands: z.array(z.strictObject({ slot: z.enum(["back", "front"]), fromRow: Px })).min(1),
  variants: Variants,
});
/** `strip@1`: frames repeated sideways within a span from a row, drifting, cut into crops a frame. */
const Strip = z.strictObject({ kind: z.literal("strip"), frames: Frames, top: Px, span: z.tuple([Px, Px]), drift: Drift, variants: Variants });
/** `cycle@1` in the ambience: frames in turn with an anchor on a point. */
const AmbientCycle = Cycle.extend({ at: Point, anchor: Point });
/** `phase-frames@1`: a discrete local hour or minute, modulo the frame count; no simulation clock or expression. */
const PhaseFrames = z.strictObject({
  kind: z.literal("phase-frames"),
  frames: z.array(Sprite).min(1),
  by: z.enum(["local-hour", "local-minute"]),
  at: Point,
  anchor: Point,
});

const AmbienceElement = z.strictObject({
  ...ElementBase,
  slot: z.enum(["back", "front"]),
  order: z.number(),
  behaviour: z.discriminatedUnion("kind", [BackdropCycle, Overlay, Flash, Drifters, Flyby, Tile, Strip, AmbientCycle, PhaseFrames]),
});

const DayCycle = z.strictObject({
  phases: z
    .array(z.strictObject({ id: Id, localMinute: z.number().int().min(0).max(1439) }))
    .min(1)
    .refine((phases) => phases.every((phase, index) => index === 0 || phase.localMinute > phases[index - 1]!.localMinute), "the phases must be in the order of the day"),
  fadeMinutes: Positive,
  /** The phase whose share is the night. */
  night: Id,
  /** Shown when the clock will not say. */
  fallback: Id,
});

const Atmosphere = z.strictObject({
  /** Rows lowest first, interpolated; every channel in every row. */
  table: z
    .array(z.strictObject({ at: z.number().min(0).max(1) }).catchall(z.number()))
    .min(1)
    .refine((rows) => rows.every((row, index) => index === 0 || row.at > rows[index - 1]!.at), "atmosphere intensities must rise"),
  /** What the art was made for: a still deck's weather. */
  delivered: z.record(Id, z.number()),
  /** Each clock advanced every frame by its step times its channel. */
  clocks: z.record(Id, Id),
});

const Copy = z.strictObject({
  /** The pane switch's word, and its tooltip. */
  pane: z.string().min(1),
  tooltip: z.string().min(1),
  /** The pane's heading, and the setting as a noun inside a sentence. */
  title: z.string().min(1),
  noun: z.string().min(1),
  /** While it starts, and where the crew is: "10 on deck". */
  starting: z.string().min(1),
  aboard: z.string().min(1),
  actor: z.strictObject({ one: z.string().min(1), many: z.string().min(1) }),
  /** The legend's words for each zone. */
  zones: z.record(Id, z.string().min(1)),
});

const Images = z.record(Id, z.strictObject({ path: PackPath, size: Size, sha256: z.string().regex(/^[0-9a-f]{64}$/) }));

const ManifestShape = z.strictObject({
  format: z.literal(SETTING_FORMAT),
  formatVersion: z.number().int().positive(),
  id: Id,
  name: z.string().min(1),
  /** The pack's own version: what changed, and caches. */
  version: z.string().regex(/^\d+\.\d+\.\d+$/),
  requires: z.array(z.string()),
  preview: Id.optional(),
  copy: Copy,
  images: Images,
  stage: Stage,
  floor: Floor,
  zones: Zones,
  cast: Cast,
  portals: Portals,
  effects: z.record(Id, EffectDef),
  ambience: z.array(AmbienceElement),
  dayCycle: DayCycle.optional(),
  atmosphere: Atmosphere.optional(),
  palette: z.strictObject({ fallbackFill: Hex, veil: Hex, staleTint: Hex, staleAlpha: z.number().min(0).max(1) }),
});

export type SettingManifest = z.infer<typeof ManifestShape>;
export type AmbienceBehaviour = SettingManifest["ambience"][number]["behaviour"];

/** A setting's manifest, checked whole: its shape, and that everything it names is there (`settingProblems`). */
export const SettingManifestSchema = ManifestShape.superRefine(function (manifest, context) {
  for (const problem of settingProblems(manifest)) context.addIssue({ code: "custom", message: problem });
});

/** Every sprite a manifest draws, with where it is named, for checking. */
function spritesOf(manifest: SettingManifest): Array<{ where: string; sprite: z.infer<typeof Sprite> }> {
  const out: Array<{ where: string; sprite: z.infer<typeof Sprite> }> = [];
  const add = (where: string, sprite: z.infer<typeof Sprite>) => out.push({ where, sprite });
  const { stage } = manifest;
  add("stage.backdrop", stage.backdrop.sprite);
  for (const part of stage.parts) {
    add(`part ${part.id}`, part.sprite);
    if (part.replacesPiece !== undefined) add(`part ${part.id}`, part.replacesPiece.sprite);
    if (part.behaviour?.kind === "cycle") for (const sprite of part.behaviour.frames.sprites) add(`part ${part.id}`, sprite);
  }
  for (const piece of stage.pieces) add(`piece ${piece.id}`, piece.sprite);
  for (const prop of stage.props) add(`prop ${prop.id}`, prop.sprite);
  for (const zone of manifest.zones.zones) if (zone.appearance !== undefined) add(`zone ${zone.id}`, zone.appearance.sprite);
  for (const [id, effect] of Object.entries(manifest.effects)) for (const sprite of Object.values(effect.frames)) add(`effect ${id}`, sprite);
  for (const element of manifest.ambience) {
    const where = `ambience ${element.id}`;
    for (const sprite of ambienceSprites(element.behaviour)) add(where, sprite);
  }
  return out;
}

function ambienceSprites(behaviour: AmbienceBehaviour): Array<z.infer<typeof Sprite>> {
  const variants = (list: z.infer<typeof Variants>) => (list ?? []).flatMap((variant) => variant.frames);
  switch (behaviour.kind) {
    case "backdrop-cycle":
      return Object.values(behaviour.phases).map((image) => ({ image }));
    case "overlay":
      return [{ image: behaviour.image }];
    case "flash":
      return behaviour.frames.map((frame) => frame.sprite);
    case "phase-frames":
      return behaviour.frames;
    case "drifters":
      return behaviour.sprites.flatMap((sprite) => [{ image: sprite.image }, ...variants(sprite.variants)]);
    case "flyby":
      return Object.values(behaviour.poses);
    case "tile":
    case "strip":
    case "cycle":
      return [...behaviour.frames.sprites, ...variants(behaviour.variants)];
  }
}

/** Every image id a manifest draws with, once each, in the order first named. */
export function settingImageIds(manifest: SettingManifest): string[] {
  const ids = [
    ...spritesOf(manifest).map((entry) => entry.sprite.image),
    ...manifest.cast.looks.map((look) => look.image),
    ...(manifest.preview === undefined ? [] : [manifest.preview]),
  ];
  return [...new Set(ids)];
}

/** The capabilities a manifest uses: what its `requires` must say. */
export function capabilitiesUsed(manifest: SettingManifest): string[] {
  const used = new Set<string>(["stage@1", "floor@1", "zones@1", "cast@1"]);
  if (manifest.zones.zones.some((zone) => zone.appearance !== undefined)) used.add("zone-appearance@1");
  if (manifest.zones.zones.some((zone) => zone.assign === "stable")) used.add("stable-posts@1");
  if (Object.values(manifest.cast.fidgets).some((fidget) => fidget?.keys.some((key) => key.pose !== undefined))) used.add("pose-fidgets@1");
  used.add(`${manifest.portals.entry.kind}@1`);
  for (const exit of Object.values(manifest.portals.exits)) used.add(`${exit.kind}@1`);
  if (manifest.stage.motion !== undefined) used.add("bob@1");
  if (manifest.stage.tintByPhase !== undefined) used.add("phase-tint@1");
  for (const part of manifest.stage.parts) if (part.behaviour !== undefined) used.add(`${part.behaviour.kind}@1`);
  if (manifest.stage.lights.length > 0) used.add("flicker@1");
  for (const element of manifest.ambience) used.add(`${element.behaviour.kind}@1`);
  const hasVariants = [
    ...manifest.stage.parts.map((part) => (part.behaviour?.kind === "cycle" ? part.behaviour.variants : undefined)),
    ...manifest.ambience.flatMap((element) => {
      const behaviour = element.behaviour;
      if (behaviour.kind === "drifters") return behaviour.sprites.map((sprite) => sprite.variants);
      return "variants" in behaviour ? [behaviour.variants] : [];
    }),
  ].some((variants) => variants !== undefined && variants.length > 0);
  if (hasVariants) used.add("variants@1");
  if (manifest.dayCycle !== undefined) used.add("day-cycle@1");
  if (manifest.atmosphere !== undefined) used.add("atmosphere@1");
  return ENGINE_CAPABILITIES.filter((capability) => used.has(capability));
}

/** Why this engine cannot draw a manifest, or null when it can: a newer format, or a capability it lacks. */
export function incompatibility(manifest: Pick<SettingManifest, "formatVersion" | "requires">): string | null {
  if (manifest.formatVersion > ENGINE_FORMAT_VERSION) return `it is format ${manifest.formatVersion}; this FirstMate draws format ${ENGINE_FORMAT_VERSION}`;
  const known = new Set<string>(ENGINE_CAPABILITIES);
  const missing = manifest.requires.filter((capability) => !known.has(capability));
  return missing.length === 0 ? null : `it needs ${missing.join(", ")}, which this FirstMate does not have`;
}

/**
 * Everything a manifest names that is not there: images, poses, zones, exits, effects, marks, clocks, channels, day
 * phases and elements; ids that repeat; `requires` that does not match what it uses. Empty when it is whole.
 */
export function settingProblems(manifest: SettingManifest): string[] {
  const problems: string[] = [];
  // One emitter keeps the engine's interval cap global. More need a shared scheduler capability first.
  if (manifest.ambience.filter((element) => element.behaviour.kind === "flash").length > 1) problems.push("a setting supports at most one flash element");
  const missing = (what: string, id: string, where: string) => problems.push(`${where} names ${what} "${id}", which the setting does not have`);
  const unique = (what: string, ids: readonly string[]) => {
    const seen = new Set<string>();
    for (const id of ids) {
      if (seen.has(id)) problems.push(`two ${what} are called "${id}"`);
      seen.add(id);
    }
  };

  for (const { where, sprite } of spritesOf(manifest)) if (manifest.images[sprite.image] === undefined) missing("image", sprite.image, where);
  for (const look of manifest.cast.looks) {
    if (manifest.images[look.image] === undefined) missing("image", look.image, `look ${look.id}`);
    if (manifest.cast.lanes[look.lane] === undefined) missing("lane", look.lane, `look ${look.id}`);
  }
  if (manifest.preview !== undefined && manifest.images[manifest.preview] === undefined) missing("image", manifest.preview, "preview");

  // Poses: every lane has every pose a role or a choreography names.
  const { roles } = manifest.cast;
  const poses = new Set<string>([roles.stand, ...roles.walkFront, ...roles.walkSide, ...Object.values(roles.settled).map((settled) => settled.pose)]);
  for (const fidget of Object.values(manifest.cast.fidgets)) for (const key of fidget?.keys ?? []) if (key.pose !== undefined) poses.add(key.pose);
  for (const exit of Object.values(manifest.portals.exits)) {
    if (exit.kind === "choreography") for (const segment of exit.actor) if (typeof segment.pose === "string") poses.add(segment.pose);
  }
  for (const [lane, frames] of Object.entries(manifest.cast.lanes)) for (const pose of poses) if (frames[pose] === undefined) missing("pose", pose, `lane ${lane}`);

  // Zones, exits, effects and marks.
  const zones = new Set(manifest.zones.zones.map((zone) => zone.id));
  unique("zones", manifest.zones.zones.map((zone) => zone.id));
  unique("posts", manifest.zones.zones.flatMap((zone) => zone.posts.map((post) => post.id)));
  for (const [state, zone] of Object.entries(manifest.zones.byState)) if (!zones.has(zone)) missing("zone", zone, `zones.byState.${state}`);
  for (const zone of zones) if (manifest.copy.zones[zone] === undefined) problems.push(`copy.zones has no words for zone "${zone}"`);
  for (const zone of manifest.zones.zones) {
    const appearance = zone.appearance;
    if (appearance === undefined) continue;
    if (!manifest.stage.pieces.some((piece) => piece.id === appearance.front)) missing("piece", appearance.front, `zone ${zone.id}`);
    const size = appearance.sprite.rect?.slice(2) ?? manifest.images[appearance.sprite.image]?.size;
    if (size !== undefined && appearance.feet.some((value, index) => value < 0 || value > size[index]!)) problems.push(`zone ${zone.id} has feet outside its appearance`);
  }
  for (const [why, exit] of Object.entries(manifest.portals.byDeparture)) if (manifest.portals.exits[exit] === undefined) missing("exit", exit, `portals.byDeparture.${why}`);
  const timelines = Object.entries(manifest.portals.exits);
  if (manifest.portals.entry.kind === "walk-in") timelines.push(["(entry)", walkInChoreography(manifest.portals.entry)]);
  for (const [id, exit] of timelines) {
    if (exit.kind !== "choreography") continue;
    const marks = new Set(Object.keys(exit.marks));
    const names = ["start", ...exit.actor.flatMap((segment) => segment.event === undefined ? [] : [segment.event])];
    unique(`events in exit ${id}`, names);
    const events = new Set(names);
    const prior = new Set(["start"]);
    for (const mark of [exit.queue.at, ...exit.actor.flatMap((segment) => (segment.to === undefined ? [] : [segment.to.mark]))]) if (!marks.has(mark)) missing("mark", mark, `exit ${id}`);
    if (!events.has(exit.queue.release)) missing("event", exit.queue.release, `exit ${id}'s queue`);
    for (const segment of exit.actor) {
      if (segment.bob !== undefined && !prior.has(segment.bob.since)) missing("earlier event", segment.bob.since, `exit ${id}`);
      if (segment.event !== undefined) prior.add(segment.event);
      if (typeof segment.layer === "object" && !manifest.stage.pieces.some((piece) => piece.id === (segment.layer as { front: string }).front)) missing("piece", segment.layer.front, `exit ${id}`);
    }
    // Resolve the finite timelines for validation: zero-length walks and overlapping effect keys are ambiguous.
    for (const drift of new Set(exit.alternate.drift)) {
      const times = new Map<string, number>([["start", 0]]);
      let from: readonly [number, number] | undefined = exit.marks[exit.queue.at];
      let time = 0;
      for (const segment of exit.actor) {
        const mark = segment.to === undefined ? from : exit.marks[segment.to.mark];
        if (mark === undefined || from === undefined) continue; // missing references already reported above
        const to = [mark[0] + (segment.to?.drift === true ? drift : 0), mark[1]] as const;
        const ms = segment.ms === "walk" ? Math.round(Math.hypot(to[0] - from[0], to[1] - from[1]) / manifest.floor.walkSpeed * 1000) : segment.ms;
        if (ms <= 0) problems.push(`exit ${id} has a zero-length walk for drift ${drift}`);
        time += ms;
        if (segment.event !== undefined) times.set(segment.event, time);
        from = to;
      }
      for (const effect of exit.effects) {
        const keys = effect.keys.map((key) => ({ start: (times.get(key.at.event) ?? 0) + key.at.plusMs, ms: key.ms })).sort((a, b) => a.start - b.start);
        for (let index = 1; index < keys.length; index++) if (keys[index]!.start < keys[index - 1]!.start + keys[index - 1]!.ms)
          problems.push(`exit ${id} has overlapping keys for effect ${effect.effect}`);
      }
    }
    for (const effect of exit.effects) {
      const def = manifest.effects[effect.effect];
      if (def === undefined) {
        missing("effect", effect.effect, `exit ${id}`);
        continue;
      }
      for (const key of effect.keys) {
        if (def.frames[key.frame] === undefined) missing("frame", key.frame, `effect ${effect.effect}`);
        if (!events.has(key.at.event)) missing("event", key.at.event, `exit ${id}`);
        if (!marks.has(key.place.mark)) missing("mark", key.place.mark, `exit ${id}`);
        if (key.place.alignX !== undefined && def.points[key.place.alignX] === undefined) missing("point", key.place.alignX, `effect ${effect.effect}`);
      }
    }
  }

  // Pieces, parts and elements by id.
  const pieces = manifest.stage.pieces.map((piece) => piece.id);
  unique("pieces", pieces);
  for (const piece of manifest.stage.pieces) {
    if (piece.baseline !== null && typeof piece.baseline === "object" && !pieces.includes(piece.baseline.over)) missing("piece", piece.baseline.over, `piece ${piece.id}`);
  }
  for (const piece of manifest.stage.pieces) {
    const seen = new Set<string>();
    let current: typeof piece | undefined = piece;
    while (current !== undefined && current.baseline !== null && typeof current.baseline === "object") {
      if (seen.has(current.id)) { problems.push(`cyclic piece depth at ${current.id}`); break; }
      seen.add(current.id);
      const over: string = current.baseline.over;
      current = manifest.stage.pieces.find((other) => other.id === over);
    }
  }
  for (const part of manifest.stage.parts) if (part.replacesPiece !== undefined && !pieces.includes(part.replacesPiece.piece)) missing("piece", part.replacesPiece.piece, `part ${part.id}`);
  for (const light of manifest.stage.lights) if (manifest.stage.lightStyles[light.style] === undefined) missing("light style", light.style, `light ${light.id}`);
  const parts = manifest.stage.parts.map((part) => part.id);
  const ambience = manifest.ambience.map((element) => element.id);
  unique("parts", parts);
  unique("ambience elements", ambience);
  for (const [list, ids] of [
    [manifest.stage.parts, parts],
    [manifest.ambience, ambience],
  ] as const) {
    for (const element of list) {
      for (const other of [...(element.needs ?? []), ...(element.fallback === undefined ? [] : [element.fallback])]) if (!ids.includes(other)) missing("element", other, element.id);
    }
  }
  const elementOf = (id: string) => manifest.ambience.find((element) => element.id === id)?.behaviour;
  for (const element of manifest.ambience) {
    const behaviour = element.behaviour;
    if ((behaviour.kind === "overlay" || behaviour.kind === "drifters") && elementOf(behaviour.space)?.kind !== "backdrop-cycle") missing("backdrop", behaviour.space, element.id);
    if (behaviour.kind === "flash" && elementOf(behaviour.under)?.kind !== "drifters") missing("drifting field", behaviour.under, element.id);
    if (behaviour.kind === "overlay") for (const other of behaviour.hiddenBy ?? []) if (elementOf(other)?.kind !== "overlay") missing("overlay", other, element.id);
    if (behaviour.kind === "flyby") for (const pose of [...behaviour.sequence, behaviour.glide]) if (behaviour.poses[pose] === undefined) missing("pose", pose, element.id);
  }

  // Day phases, clocks and channels.
  const phases = new Set((manifest.dayCycle?.phases ?? []).map((phase) => phase.id));
  if (manifest.dayCycle !== undefined) {
    for (const phase of [manifest.dayCycle.night, manifest.dayCycle.fallback]) if (!phases.has(phase)) missing("day phase", phase, "dayCycle");
  }
  const phaseRefs: Array<[string, string]> = [];
  for (const phase of Object.keys(manifest.stage.tintByPhase ?? {})) phaseRefs.push([phase, "stage.tintByPhase"]);
  for (const element of manifest.ambience) {
    const behaviour = element.behaviour;
    if (behaviour.kind === "backdrop-cycle") for (const phase of Object.keys(behaviour.phases)) phaseRefs.push([phase, element.id]);
    if (behaviour.kind === "drifters") {
      for (const phase of Object.keys(behaviour.byPhase)) phaseRefs.push([phase, element.id]);
      for (const sprite of behaviour.sprites) for (const variant of sprite.variants ?? []) for (const phase of Object.keys(variant.byPhase ?? {})) phaseRefs.push([phase, element.id]);
    }
  }
  for (const [phase, where] of phaseRefs) if (!phases.has(phase)) missing("day phase", phase, where);

  const clocks = new Set(Object.keys(manifest.atmosphere?.clocks ?? {}));
  const channels = new Set(Object.keys(manifest.atmosphere?.table[0] ?? {}).filter((key) => key !== "at"));
  for (const row of manifest.atmosphere?.table ?? []) {
    const keys = Object.keys(row).filter((key) => key !== "at");
    if (keys.length !== channels.size || keys.some((key) => !channels.has(key))) problems.push(`atmosphere row at ${row.at} does not have every channel`);
  }
  for (const channel of channels) {
    if (!Id.safeParse(channel).success) problems.push(`atmosphere channel "${channel}" is not an id`);
    if (typeof manifest.atmosphere?.delivered[channel] !== "number") problems.push(`atmosphere.delivered has no value for channel "${channel}"`);
  }
  for (const [clock, channel] of Object.entries(manifest.atmosphere?.clocks ?? {})) if (!channels.has(channel)) missing("channel", channel, `clock ${clock}`);
  for (const channel of Object.keys(manifest.atmosphere?.delivered ?? {})) if (!channels.has(channel)) missing("channel", channel, "atmosphere.delivered");
  const clockRefs: Array<[string | undefined, string]> = [];
  const levelRefs: Array<[z.infer<typeof Level> | undefined, string]> = [];
  if (manifest.stage.motion !== undefined) {
    clockRefs.push([manifest.stage.motion.bob.clock, "stage.motion"]);
    levelRefs.push([manifest.stage.motion.bob.amplitude, "stage.motion"]);
  }
  for (const part of manifest.stage.parts) {
    const behaviour = part.behaviour;
    if (behaviour?.kind === "sway") {
      clockRefs.push([behaviour.clock, part.id]);
      levelRefs.push([behaviour.amplitude, part.id]);
    }
    if (behaviour?.kind === "cycle") {
      clockRefs.push([behaviour.frames.clock, part.id]);
      levelRefs.push([behaviour.duty, part.id], [behaviour.opacity, part.id]);
    }
  }
  for (const element of manifest.ambience) {
    const behaviour = element.behaviour;
    if ("frames" in behaviour && !Array.isArray(behaviour.frames)) clockRefs.push([behaviour.frames.clock, element.id]);
    if ("drift" in behaviour) clockRefs.push([behaviour.drift.clock, element.id]);
    if (behaviour.kind === "drifters") clockRefs.push([behaviour.clock, element.id]);
    if (behaviour.kind === "cycle") levelRefs.push([behaviour.opacity, element.id], [behaviour.duty, element.id]);
    if (behaviour.kind === "backdrop-cycle") levelRefs.push([behaviour.tint?.amount, element.id]);
  }
  for (const [clock, where] of clockRefs) if (clock !== undefined && !clocks.has(clock)) missing("clock", clock, where);
  for (const [level, where] of levelRefs) if (level !== undefined && typeof level === "object" && "channel" in level && !channels.has(level.channel)) missing("channel", level.channel, where);

  // What it says it needs is what it uses.
  const used = capabilitiesUsed(manifest);
  const said = new Set(manifest.requires);
  if (used.length !== said.size || used.some((capability) => !said.has(capability))) {
    problems.push(`requires says ${[...said].sort().join(", ")}; the setting uses ${[...used].sort().join(", ")}`);
  }
  return problems;
}
