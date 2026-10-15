/**
 * The ship as a setting pack (`art/settings/ship/`), held to what the deck drew it with before packs, while the engine
 * still holds both: read as the old manifests (`legacyViews`) it is those manifests exactly as last served (kept in
 * `docs/ship-deck-art/legacy/`), and every number in it is the constant in the deck's code it replaces. Each step of
 * the move to a scene engine that deletes a constant deletes its check here; the pack is the source from then on.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath, URL } from "node:url";
import { describe, expect, it } from "vitest";

import { BREATH_MS, BREATH_ROWS, FADE_MS, HATCH_MS, PLACES, SHARK_MOUTH, STATE_POSES, STEP_MS, WALK_SPEED, breathSink, idleMotion } from "./deck-crew";
import { HEAVE, LANTERNS, MASTHEAD, GULL_LOWEST, GULL_SLOT_SECONDS, HORIZON, SEA_FALLBACK, WATERLINE, lanternFlicker, mastSway, shipBob } from "./deck-ambient";
import { ATMOSPHERE, STORM_SHADE } from "./deck-atmosphere";
import { FOCUS_FIGURE_HEIGHT } from "./deck-camera";
import { CLOUD_LANES, CLOUD_MARGIN, CLOUD_TOP_MIN } from "./deck-clouds";
import { FOAM_SPAN, FOAM_TOP } from "./deck-environment";
import { ANCHORS, HATCH, OBSTACLES, REST_AREAS, REST_SPACING, WALKABLE } from "./deck-geometry";
import { REST_LABEL_ROW } from "./deck-hover";
import { environmentImagePaths, extrasImagePaths } from "./deck-legacy";
import { DeckArtManifestSchema, DeckEnvironmentManifestSchema, DeckExtrasManifestSchema } from "./deck-legacy-schema";
import { deckBox } from "./deck-pixi";
import {
  BOB_UP_MS,
  CHOMP_AT,
  CHOMP_MS,
  FIN_AT,
  FIN_MS,
  FIN_RUN,
  HOP_MS,
  IMPACT_AT,
  JUMP_MS,
  PLANK,
  PLANK_DEPARTURES,
  PLANK_EXIT_MS,
  PLANK_SEA_BOTTOM,
  PLANK_WALK_MS,
  PLUNGE_MS,
  SPLASH_FRAMES,
  SUBMERGE_MS,
  SURFACE_MS,
  SWIM_ROWS,
  TEETER_MS,
} from "./deck-plank";
import { DECK_HEIGHT, DECK_PROPS, DECK_WIDTH, DECK_STATES } from "./deck-scene";
import { SKY_FADE_MINUTES, skyHorizonRow } from "./deck-sky";
import { mastLayout } from "./deck-extras";
import { shipManifest, shipViews } from "../test/ship-pack";

const legacy = (name: string): unknown => JSON.parse(readFileSync(fileURLToPath(new URL(`../docs/ship-deck-art/legacy/${name}`, import.meta.url)), "utf8"));
const ship = shipManifest();
const hex = (value: number) => `#${value.toString(16).toUpperCase().padStart(6, "0")}`;
const xy = (point: { x: number; y: number }) => [point.x, point.y];

describe("the ship's pack, read as the manifests the deck drew from", () => {
  it("is the atlas's manifest as last served, but for its generation notes", () => {
    expect(shipViews().art).toEqual(DeckArtManifestSchema.parse(legacy("deck.json")));
  });

  it("is the environment's manifest as last served", () => {
    expect(shipViews().environment).toEqual(DeckEnvironmentManifestSchema.parse(legacy("environment.json")));
  });

  it("is the extras' manifest as last served, weather and all", () => {
    expect(shipViews().extras).toEqual(DeckExtrasManifestSchema.parse(legacy("extras.json")));
  });

  it("names every image at the path it was served at", () => {
    const { environment, extras } = shipViews();
    const served = new Set(["deck.png", ...environmentImagePaths(environment), ...extrasImagePaths(extras)]);
    expect(new Set(Object.values(ship.images).map((image) => image.path))).toEqual(served);
  });
});

describe("the ship's pack, against the deck's constants", () => {
  it("has the hull's size, the fit's reach, the focus shot's figure and the props where they stand", () => {
    expect(ship.stage.size).toEqual([DECK_WIDTH, DECK_HEIGHT]);
    const tall = deckBox({ width: DECK_WIDTH, height: DECK_HEIGHT }, shipViews().extras.mast!.position[1]);
    expect([ship.stage.fit.top, ship.stage.fit.bottom]).toEqual([tall.top, tall.height]);
    expect(ship.stage.fit.bottom).toBe(PLANK_SEA_BOTTOM);
    expect(ship.stage.actorHeight).toBe(FOCUS_FIGURE_HEIGHT);
    expect(ship.stage.props.map((prop) => ({ name: prop.id, x: prop.at[0], y: prop.at[1] }))).toEqual(DECK_PROPS);
    for (const prop of ship.stage.props) expect(prop.obstacle, prop.id).toEqual(OBSTACLES.find((obstacle) => obstacle.name === prop.id)!.rect);
  });

  it("has the tall mast cut as the deck cuts it, and the hull's own masthead to fall back on", () => {
    const { art, extras } = shipViews();
    const layout = mastLayout(extras.mast!, art.pieces.mast!, extras.sail);
    const [tall, topmast, masthead] = ship.stage.parts;
    expect(tall).toMatchObject({ id: "tall-mast", at: [layout.shaft.x, layout.shaft.y], sprite: { rect: layout.shaft.frame } });
    expect(tall!.replacesPiece).toMatchObject({ piece: "mast", at: [layout.depth.x, layout.depth.y], sprite: { rect: layout.depth.frame } });
    expect(topmast).toMatchObject({ id: "topmast", at: [layout.head.x, layout.head.y], sprite: { rect: layout.head.frame } });
    expect(masthead).toMatchObject({ id: "masthead", at: [MASTHEAD.x, MASTHEAD.y], cutout: [MASTHEAD.x, MASTHEAD.y, MASTHEAD.width, MASTHEAD.height] });
    // Its foot on the mast piece's last row, as wide as the piece.
    const piece = art.pieces.mast!;
    expect(extras.mast!.position[1] + extras.mast!.size[1]).toBe(piece.y + piece.frame[3]);
    expect(extras.mast!.position[0]).toBeLessThanOrEqual(piece.x);
    expect(extras.mast!.position[0] + extras.mast!.size[0]).toBeGreaterThanOrEqual(piece.x + piece.frame[2]);
  });

  it("bobs and sways as the deck does, at every heave the weather gives", () => {
    const bob = ship.stage.motion!.bob;
    const sway = ship.stage.parts.find((part) => part.id === "topmast")!.behaviour!;
    expect(sway.kind).toBe("sway");
    if (sway.kind !== "sway" || typeof sway.amplitude !== "object" || !("channel" in sway.amplitude) || typeof bob.amplitude !== "object" || !("channel" in bob.amplitude)) {
      throw new Error("the bob and the sway follow the heave");
    }
    const scale = sway.amplitude.scale ?? 1;
    const heaves = [HEAVE, ...ATMOSPHERE.map((row) => row.heave), 1.05, 1.37, 1.6];
    for (const heave of heaves) {
      for (let seconds = 0; seconds < 13; seconds += 0.01) {
        expect(Math.round(Math.sin((seconds * Math.PI * 2) / bob.periodS) * heave), `bob ${heave} ${seconds}`).toBe(shipBob(seconds, heave).y);
        const swayed = Math.round(Math.sin((seconds * Math.PI * 2) / sway.periodS + sway.phase) * heave * scale);
        expect(Math.max(-sway.limit, Math.min(sway.limit, swayed)), `sway ${heave} ${seconds}`).toBe(mastSway(seconds, heave));
      }
    }
  });

  it("has the lanterns where they hang, flickering as they do", () => {
    expect(ship.stage.lights.map((light) => ({ x: light.at[0], y: light.at[1], row: light.row, seed: light.seed }))).toEqual(LANTERNS);
    const style = ship.stage.lightStyles.lantern!;
    for (const lantern of LANTERNS) {
      for (let seconds = 0; seconds < 10; seconds += 0.013) {
        // Summed from the base, wave by wave: the deck's own order, so the level is the same to the last bit.
        const level = style.flicker.waves.reduce((sum, [amplitude, rate, offset]) => sum + amplitude * Math.sin(seconds * rate + lantern.seed * offset), style.flicker.base);
        expect(Math.max(0, Math.min(1, level))).toBe(lanternFlicker(seconds, lantern.seed));
      }
    }
  });

  it("has the walkable deck, its obstacles, the stations, helm, bow and rest, and the hatch", () => {
    expect(ship.floor.areas.map((area) => area.polygon)).toEqual(WALKABLE.map((area) => area.polygon));
    expect(ship.floor.areas.map((area) => area.id)).toEqual(WALKABLE.map((area) => area.name.replaceAll(" ", "-")));
    const props = new Set<string>(DECK_PROPS.map((prop) => prop.name));
    expect(ship.floor.obstacles.map((obstacle) => ({ name: obstacle.id, rect: obstacle.rect }))).toEqual(OBSTACLES.filter((obstacle) => !props.has(obstacle.name)));
    expect(ship.floor.walkSpeed).toBe(WALK_SPEED);
    expect(ship.zones.byState).toEqual(PLACES);
    const posts = ship.zones.zones.flatMap((zone) => zone.posts.map((post) => ({ id: post.id, place: zone.id, x: post.at[0], y: post.at[1], facing: post.facing })));
    expect([...posts].sort((a, b) => ANCHORS.findIndex((anchor) => anchor.id === a.id) - ANCHORS.findIndex((anchor) => anchor.id === b.id))).toEqual(ANCHORS);
    const rest = ship.zones.zones.find((zone) => zone.id === "rest")!;
    expect(rest.overflow).toEqual({ kind: "pack", areas: REST_AREAS, spacing: [REST_SPACING.x, REST_SPACING.y], fallback: [6, 3] });
    expect(rest.labelFloor).toBe(REST_LABEL_ROW);
    expect(ship.portals.entry).toEqual({ kind: "rise", at: xy(HATCH), ms: HATCH_MS });
    expect(ship.portals.exits.hatch).toEqual({ kind: "sink", at: xy(HATCH), ms: HATCH_MS });
    expect(ship.portals.still.fadeMs).toBe(FADE_MS);
  });

  it("stands, walks and settles the crew as the deck does, its fidgets and its breath the deck's own", () => {
    const { roles, fidgets, breath } = ship.cast;
    expect(roles.stepMs).toBe(STEP_MS);
    for (const state of DECK_STATES) expect(roles.settled[state].pose, state).toBe(STATE_POSES[state]);
    expect(breath).toMatchObject({ state: "idle", rows: BREATH_ROWS, periodMs: BREATH_MS });
    for (let seed = 0; seed < 200; seed += 7) {
      for (let now = 0; now < 9000; now += 13) {
        for (const state of DECK_STATES) {
          for (const facing of ["left", "right", "front"] as const) {
            const fidget = fidgets[state];
            let dx = 0;
            let dy = 0;
            if (fidget !== null) {
              const t = (now + seed * fidget.seedMs) % fidget.periodMs;
              const key = [...fidget.keys].reverse().find((each) => each.fromMs <= t)!;
              dx = key.towardFacing === true && facing === "left" ? -key.dx : key.dx;
              dy = key.dy;
            }
            expect({ dx, dy }, `${state} ${facing} ${seed} ${now}`).toEqual(idleMotion(state, facing, seed, now));
          }
        }
        const t = (now + seed * breath!.seedMs) % breath!.periodMs;
        expect(t >= breath!.inMs ? 1 : 0).toBe(breathSink(seed, now));
      }
    }
  });

  it("walks the plank on the deck's own timeline, to the shark at its mouth", () => {
    const plank = ship.portals.exits.plank!;
    if (plank.kind !== "choreography") throw new Error("the plank is a choreography");
    expect(plank.marks).toEqual({ foot: xy(PLANK.foot), rail: xy(PLANK.rail), tip: xy(PLANK.tip), water: [PLANK.tip.x, PLANK.water] });
    expect(Math.round(((PLANK.tip.y - PLANK.rail.y) / ship.floor.walkSpeed) * 1000)).toBe(PLANK_WALK_MS);
    const lengths = plank.actor.map((segment) => (segment.ms === "walk" ? PLANK_WALK_MS : segment.ms));
    const ends = (event: string) => lengths.slice(0, plank.actor.findIndex((segment) => segment.event === event) + 1).reduce((sum, ms) => sum + ms, 0);
    expect(lengths.slice(0, 4)).toEqual([HOP_MS, PLANK_WALK_MS, TEETER_MS, JUMP_MS]);
    expect(lengths.slice(4, 6)).toEqual([PLUNGE_MS, BOB_UP_MS]);
    expect(ends("impact")).toBe(IMPACT_AT);
    expect(ends("chomp")).toBe(CHOMP_AT);
    expect(lengths.reduce((sum, ms) => sum + ms, 0)).toBe(PLANK_EXIT_MS);
    expect(plank.actor[5]!.reveal).toEqual([0, { rows: SWIM_ROWS }]);
    const keys = Object.fromEntries(plank.effects.flatMap((effect) => effect.keys.map((key) => [`${effect.effect}:${key.frame}:${key.at.event}`, key])));
    const at = (key: { at: { event: string; plusMs: number } }) => (key.at.event === "impact" ? IMPACT_AT : CHOMP_AT) + key.at.plusMs;
    expect(at(keys["shark:fin:impact"]!)).toBe(FIN_AT);
    expect(keys["shark:fin:impact"]).toMatchObject({ ms: FIN_MS, approach: { px: FIN_RUN } });
    expect(at(keys["shark:surface:impact"]!)).toBe(FIN_AT + FIN_MS);
    expect(keys["shark:surface:impact"]!.ms).toBe(SURFACE_MS);
    expect(keys["shark:chomp:chomp"]!.ms).toBe(CHOMP_MS);
    expect(at(keys["shark:submerge:chomp"]!) + keys["shark:submerge:chomp"]!.ms).toBe(PLANK_EXIT_MS);
    expect(keys["shark:submerge:chomp"]!.ms).toBe(SUBMERGE_MS);
    expect([keys["splash:impact:impact"]!.ms, keys["splash:burst:impact"]!.ms]).toEqual(SPLASH_FRAMES.map((frame) => frame.ms));
    const shark = ship.effects.shark!;
    expect([shark.points.mouth![0] - shark.points.anchor![0], shark.points.mouth![1] - shark.points.anchor![1]]).toEqual(SHARK_MOUTH);
    for (const why of ["done", "failed", "closed", "removed"] as const) expect(ship.portals.byDeparture[why] === "plank", why).toBe(PLANK_DEPARTURES.has(why));
  });

  it("has the sky, sea, foam, clouds, gull and weather of the deck's code", () => {
    const element = (id: string) => ship.ambience.find((each) => each.id === id)!.behaviour;
    const sky = element("sky");
    if (sky.kind !== "backdrop-cycle") throw new Error("the sky is a backdrop cycle");
    expect(sky.placement).toEqual({ horizonRow: skyHorizonRow(sky.size), stageRow: HORIZON });
    expect(sky.tint?.to).toBe(hex(STORM_SHADE));
    expect(ship.dayCycle?.fadeMinutes).toBe(SKY_FADE_MINUTES);
    for (const id of ["sea", "sea-still"]) {
      const sea = element(id);
      if (sea.kind !== "tile") throw new Error(`${id} is a tile`);
      expect(sea.origin).toBe(HORIZON);
      expect(sea.bands).toEqual([
        { slot: "back", fromRow: HORIZON },
        { slot: "front", fromRow: WATERLINE },
      ]);
    }
    const foam = element("foam-still");
    if (foam.kind !== "strip") throw new Error("the still foam is a strip");
    expect([foam.top, foam.span]).toEqual([FOAM_TOP, [FOAM_SPAN.left, FOAM_SPAN.right]]);
    const clouds = element("clouds");
    if (clouds.kind !== "drifters") throw new Error("the clouds drift");
    expect([clouds.lanes, clouds.margin, clouds.topMin]).toEqual([CLOUD_LANES, CLOUD_MARGIN, CLOUD_TOP_MIN]);
    const gull = element("gull");
    if (gull.kind !== "flyby") throw new Error("the gull flies by");
    expect([gull.slotS, gull.rows[1]]).toEqual([GULL_SLOT_SECONDS, GULL_LOWEST]);
    expect(ship.atmosphere!.table).toEqual(
      ATMOSPHERE.map((row) => ({ at: row.at, pace: row.water.pace, drift: row.water.drift, wind: row.wind, sail: row.sail, billow: row.billow, swell: row.swell, heave: row.heave, wake: row.wake, mood: row.mood })),
    );
    expect(ship.atmosphere!.delivered.heave).toBe(HEAVE);
    expect(ship.palette.fallbackFill).toBe(hex(SEA_FALLBACK));
  });
});
