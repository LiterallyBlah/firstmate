/**
 * A setting's stage, compiled once from its pack (`shared/deck-setting.ts`) for the engine to run on: the stage's
 * size and fit, the floor (`client/deck-geometry.ts`), the zones each activity state sends a worker to, the props, and
 * the portals' marks. Pure, and per pack: nothing here is a module-level "the setting", so a deck can be any setting
 * and two decks two settings.
 */
import type { ActivityState, SettingManifest } from "../shared/deck-setting";
import { walkInChoreography } from "../shared/deck-portals";
import { compileChoreography, type Choreography, type DeckDeparture } from "./deck-choreography";
import { createFloor, type Anchor, type Floor, type Point } from "./deck-geometry";
import { compilePhaseTint, type PhaseTint } from "./deck-phase-tint";
import { pieceDepths } from "./deck-parts";
import { compilePostTransit, type PostTransit } from "./deck-post-transit";

type Rect = readonly [number, number, number, number];

/** A worker's stationary representation at a zone post; independent of its cast, identity and state. */
export interface ZoneAppearance {
  image: string;
  frame: Rect;
  feet: readonly [number, number];
  front: string;
  depth: number;
}

/** A zone: its posts in order of preference, how one is chosen, and where a worker stands once they are all held. */
export interface Zone {
  id: string;
  posts: readonly Anchor[];
  /** `nearest`: nearest the worker; `ordered`: first free; `stable`: identity-hashed preference, nearest free on collision. */
  assign: "nearest" | "ordered" | "stable";
  overflow:
    | { kind: "beside"; spacing: readonly [number, number] }
    | { kind: "pack"; areas: readonly Rect[]; spacing: readonly [number, number]; fallback: readonly [number, number] };
  /** The row hover labels of workers here hang from, or null: over their heads. */
  labelFloor: number | null;
  appearance: ZoneAppearance | null;
}

/** A way off the stage: back down where it came up (`sink`), or a choreography from its queue's mark. */
export type Exit = { kind: "sink"; at: Point; ms: number } | Choreography;

export interface DeckStage {
  /** The stage's logical pixels: the backdrop's size. */
  width: number;
  height: number;
  /** The rows the exact fit takes in when a part reaches above the stage, and its margin. */
  fit: { top: number; bottom: number; margin: number };
  /** A worker's height with its badge, for the focus shot. */
  actorHeight: number;
  /** Colour multiplication for stage art and actor bodies, independent of intensity and motion. */
  phaseTint: PhaseTint | null;
  floor: Floor;
  zones: ReadonlyMap<string, Zone>;
  transits: ReadonlyMap<string, PostTransit>;
  /** Where each activity state sends its worker. */
  zoneOf(state: ActivityState): Zone;
  /** Where an arrival joins the navigable floor. */
  entry: Point;
  /** The off-floor corridor, or null for a cropped rise. Effects finish before floor navigation starts. */
  walkIn: { from: Point; walkMs: number; choreography: Choreography } | null;
  entryMs: number;
  fadeMs: number;
  byDeparture: Readonly<Record<DeckDeparture, string>>;
  exits: ReadonlyMap<string, Exit>;
  /** Props, where each stands — their feet — and the sprite each is drawn with, registered at `feet`. */
  props: ReadonlyArray<{ id: string; x: number; y: number; image: string; rect: readonly [number, number, number, number] | null; feet: readonly [number, number] }>;
  /** The pieces that stand on a row, or in front of everything (`null`), where each is: the depth order's (`deckLayers`). */
  pieces: ReadonlyArray<{ id: string; x: number; y: number; baseline: number | null }>;
  /** The veil behind a focused worker, and how a worker whose feed is lost is greyed: tint and alpha. */
  palette: { veil: number; staleTint: number; staleAlpha: number };
}

/** `#RRGGBB` as a number. */
const colour = (hex: string) => Number.parseInt(hex.slice(1), 16);

const point = ([x, y]: readonly [number, number]): Point => ({ x, y });

export function compileStage(manifest: SettingManifest, hasImage: (id: string) => boolean = () => true): DeckStage {
  const { stage, floor, zones, portals } = manifest;
  const depths = pieceDepths(stage.pieces);
  const compiledZones = new Map<string, Zone>(
    zones.zones.map((zone) => [
      zone.id,
      {
        id: zone.id,
        posts: zone.posts.map((post) => ({ id: post.id, place: zone.id, x: post.at[0], y: post.at[1], facing: post.facing })),
        assign: zone.assign,
        overflow: zone.overflow,
        labelFloor: zone.labelFloor ?? null,
        appearance: zone.appearance === undefined ? null : {
          image: zone.appearance.sprite.image,
          frame: zone.appearance.sprite.rect ?? [0, 0, ...manifest.images[zone.appearance.sprite.image]!.size],
          feet: zone.appearance.feet,
          front: zone.appearance.front,
          depth: depths.get(zone.appearance.front)! + 1,
        },
      },
    ]),
  );
  const exits = new Map<string, Exit>(
    Object.entries(portals.exits).map(([id, exit]): [string, Exit] => [
      id,
      exit.kind === "sink"
        ? { kind: "sink", at: point(exit.at), ms: exit.ms }
        : compileChoreography(exit, floor.walkSpeed, manifest.effects),
    ]),
  );
  const arrival = portals.entry.kind === "walk-in" ? compileChoreography(walkInChoreography(portals.entry), floor.walkSpeed, manifest.effects) : null;
  const timeline = arrival?.timelines.get(0);
  return {
    width: stage.size[0],
    height: stage.size[1],
    fit: stage.fit,
    actorHeight: stage.actorHeight,
    phaseTint: compilePhaseTint(manifest),
    floor: createFloor({
      areas: floor.areas,
      obstacles: [...floor.obstacles, ...stage.props.map((prop) => ({ id: prop.id, rect: prop.obstacle }))],
      grid: floor.grid,
      walkSpeed: floor.walkSpeed,
    }),
    zones: compiledZones,
    transits: new Map(zones.zones.flatMap((zone) => zone.posts.flatMap((post) => {
      if (post.transit?.needs?.some((id) => !hasImage(id))) return [];
      const route = compilePostTransit(post, depths);
      return route === null ? [] : [[post.id, route] as const];
    }))),
    zoneOf: (state) => compiledZones.get(zones.byState[state])!,
    entry: point(portals.entry.at),
    walkIn: arrival === null ? null : { from: arrival.queue.at, walkMs: timeline!.releaseMs, choreography: arrival },
    entryMs: portals.entry.kind === "rise" ? portals.entry.ms : timeline!.durationMs,
    fadeMs: portals.still.fadeMs,
    byDeparture: portals.byDeparture,
    exits,
    props: stage.props.map((prop) => ({ id: prop.id, x: prop.at[0], y: prop.at[1], image: prop.sprite.image, rect: prop.sprite.rect ?? null, feet: prop.feet })),
    pieces: stage.pieces.flatMap((piece) =>
      piece.baseline === null || typeof piece.baseline === "number" ? [{ id: piece.id, x: piece.at[0], y: piece.at[1], baseline: piece.baseline }] : [],
    ),
    palette: { veil: colour(manifest.palette.veil), staleTint: colour(manifest.palette.staleTint), staleAlpha: manifest.palette.staleAlpha },
  };
}

/** Look up a compiled choreography by its pack-defined id. */
export function choreography(stage: DeckStage, id: string): Extract<Exit, { kind: "choreography" }> {
  const exit = stage.exits.get(id);
  if (exit?.kind !== "choreography") throw new Error(`the setting has no choreography called ${id}`);
  return exit;
}
