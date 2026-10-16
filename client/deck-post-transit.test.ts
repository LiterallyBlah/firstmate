import { describe, expect, it } from "vitest";
import { SettingManifestSchema, capabilitiesUsed } from "../shared/deck-setting";
import { shipManifest } from "../test/ship-pack";
import { compileCast } from "./deck-cast";
import { compileStage } from "./deck-stage";
import { applyCrew, createCrew, crewFigures, stepCrew } from "./deck-crew";
import { postTransitAt } from "./deck-post-transit";
import { sailorAt } from "./deck-hover";
import type { DeckSailor, DeckState } from "./deck-scene";

function fixture() {
  const m = structuredClone(shipManifest());
  m.id = "unrelated-workshop";
  for (const zone of m.zones.zones) for (const post of zone.posts) delete post.transit;
  const zone = m.zones.zones.find(z => z.id === m.zones.byState.working)!;
  zone.posts = [zone.posts[0]!];
  const post = zone.posts[0]!;
  post.transit = { path: [[post.at[0], 20], [post.at[0] + 10, 20]], speed: 20, poses: [m.cast.roles.walkFront[0]!, m.cast.roles.walkFront[1]!], stepMs: 200, settled: m.cast.roles.stand, front: "mast" };
  m.requires = capabilitiesUsed(m);
  return m;
}
const sailor = (state: DeckState, key = "worker"): DeckSailor => ({ key, identity: key, label: key, state, stale: false,
  caption: { title: key, status: state, project: null, host: "local", line: null, stale: null } });
function setup() {
  const m = fixture();
  const stage = compileStage(m), cast = compileCast(m), crew = createCrew(stage, cast);
  const route = [...stage.transits.values()][0]!;
  const figure = () => crewFigures(crew, 0, { still: false })[0]!;
  return { m, stage, cast, crew, route, figure };
}

describe("post-transit@1", () => {
  it("is a strict, generic capability with validated poses, pieces, segments and fit", () => {
    expect(SettingManifestSchema.safeParse(fixture()).success).toBe(true);
    type Manifest = ReturnType<typeof fixture>;
    type Post = Manifest["zones"]["zones"][number]["posts"][number];
    const edits: Array<(m: Manifest, post: Post) => void> = [
      (m) => { m.requires = m.requires.filter(x => x !== "post-transit@1"); },
      (_, post) => { post.transit!.poses = ["missing"]; },
      (_, post) => { post.transit!.settled = "missing"; },
      (_, post) => { post.transit!.front = "missing"; },
      (_, post) => { post.transit!.needs = ["missing"]; },
      (_, post) => { post.transit!.speed = 0; },
      (_, post) => { post.transit!.stepMs = 0; },
      (_, post) => { post.transit!.path = [post.at]; },
      (_, post) => { post.transit!.path = [[20, -200]]; },
      (_, post) => { Object.assign(post.transit!, { script: "climb()" }); },
    ];
    for (const edit of edits) {
      const m = fixture();
      edit(m, m.zones.zones.find(z => z.id === m.zones.byState.working)!.posts[0]!);
      expect(SettingManifestSchema.safeParse(m).success).toBe(false);
    }
  });

  it("carries elapsed time through the floor/access boundary at full and lite frame rates", () => {
    const fine = setup(), coarse = setup();
    for (const { crew } of [fine, coarse]) {
      applyCrew(crew, [sailor("blocked")], { snap: true });
      applyCrew(crew, [sailor("working")], { snap: false });
    }
    const advance = (total: number) => {
      for (let ms = 0; ms < total; ms += 20) stepCrew(fine.crew, 20);
      for (let ms = 0; ms < total; ms += 100) stepCrew(coarse.crew, 100);
      expect(coarse.figure()).toMatchObject({ x: fine.figure().x, y: fine.figure().y, pose: fine.figure().pose });
      const a = fine.crew.walkers.get("worker")!, b = coarse.crew.walkers.get("worker")!;
      expect(b.x).toBeCloseTo(a.x); expect(b.y).toBeCloseTo(a.y);
      if (a.transit !== null) expect(b.transit!.ms).toBeCloseTo(a.transit.ms);
    };
    advance(6000);
    for (const { crew } of [fine, coarse]) applyCrew(crew, [sailor("blocked")], { snap: false });
    advance(6000);
  });

  it("snaps first mount/reduced motion to the station and keeps it clickable at the drawn coordinates", () => {
    const { crew, route, figure, cast } = setup();
    applyCrew(crew, [sailor("working")], { snap: true });
    expect(figure()).toMatchObject({ ...route.points.at(-1), pose: route.settled, moving: false, layer: { front: route.front }, depth: route.depth });
    expect(sailorAt([figure()], cast, { x: figure().x, y: figure().y - 10 })?.key).toBe("worker");
  });

  it("descends before walking away and reverses continuously when reassigned mid-climb", () => {
    const { crew, route, figure } = setup();
    applyCrew(crew, [sailor("working")], { snap: true });
    applyCrew(crew, [sailor("blocked")], { snap: false });
    stepCrew(crew, 1000);
    const down = figure();
    expect(down.state).toBe("blocked");
    expect(down.moving).toBe(true);
    expect(crew.walkers.get("worker")!.x).toBe(route.points[0]!.x);
    applyCrew(crew, [sailor("working")], { snap: false });
    expect(figure()).toMatchObject({ x: down.x, y: down.y });
    stepCrew(crew, 500);
    expect(crew.walkers.get("worker")!.transit!.ms).toBeCloseTo(route.durationMs - 500);
    applyCrew(crew, [sailor("idle")], { snap: true });
    expect(crew.walkers.get("worker")!.transit).toBeNull();
    expect(figure().appearance).toBeDefined();
  });

  it("walks to the base before ascending, never puts overflow in the same station, and uses bounded continuous progress", () => {
    const { crew, route } = setup();
    applyCrew(crew, [sailor("blocked")], { snap: true });
    applyCrew(crew, [sailor("working"), sailor("working", "z-overflow")], { snap: false });
    const seen = new Set<string>();
    for (let ms = 0; ms < 20000; ms += 50) {
      stepCrew(crew, 50);
      const walker = crew.walkers.get("worker")!;
      if (walker.transit !== null) {
        expect({ x: walker.x, y: walker.y }).toEqual(route.points[0]);
        seen.add(postTransitAt(route, walker.transit.ms, false).pose);
      }
    }
    expect(seen.size).toBe(2);
    expect(crew.walkers.get("worker")!.transit!.ms).toBe(route.durationMs);
    expect(crew.walkers.get("z-overflow")!.transit).toBeNull();
  });

  it("removal descends to its normal exit; reduced-motion removal fades where it was shown", () => {
    const { crew, route, figure } = setup();
    applyCrew(crew, [sailor("working")], { snap: true });
    applyCrew(crew, [], { snap: false });
    stepCrew(crew, route.durationMs / 2);
    expect(figure().departing).toBe(true);
    expect(crew.walkers.get("worker")!.transit!.ms).toBeCloseTo(route.durationMs / 2);
    const shown = figure();
    applyCrew(crew, [], { snap: true });
    expect(crew.walkers.size).toBe(0);
    expect(crewFigures(crew, 0, { still: true })[0]).toMatchObject({ x: shown.x, y: shown.y, pose: shown.pose, layer: shown.layer });
  });
});
