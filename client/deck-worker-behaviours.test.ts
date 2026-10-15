import { describe, expect, it } from "vitest";
import { SettingManifestSchema, capabilitiesUsed, type SettingManifest } from "../shared/deck-setting";
import { shipManifest } from "../test/ship-pack";
import { compileCast, fidgetAt } from "./deck-cast";
import { applyCrew, createCrew, crewFigures, stepCrew } from "./deck-crew";
import { compileStage } from "./deck-stage";
import type { DeckSailor } from "./deck-scene";

const worker = (key: string, identity = key, state: DeckSailor["state"] = "working"): DeckSailor => ({ key, identity, state, label: key, stale: false, caption: { title: key, status: state, project: null, host: "local", line: null, stale: null } });
function fixture() {
  const manifest = structuredClone(shipManifest());
  manifest.zones.zones.find((zone) => zone.id === manifest.zones.byState.working)!.assign = "stable";
  manifest.cast.fidgets.working = { periodMs: 500, seedMs: 0, keys: [
    { fromMs: 0, dx: 0, dy: 0, pose: manifest.cast.roles.stand },
    { fromMs: 250, dx: 1, dy: -1, towardFacing: true, pose: manifest.cast.roles.walkFront[0]! },
  ] };
  manifest.requires = capabilitiesUsed(manifest);
  return SettingManifestSchema.parse(manifest);
}
const crewFor = (manifest: SettingManifest = fixture()) => createCrew(compileStage(manifest), compileCast(manifest));
const home = (identity: string) => {
  const crew = crewFor();
  applyCrew(crew, [worker("card", identity)], { snap: true });
  return crew.walkers.get("card")!.anchor;
};

describe("stable-posts@1", () => {
  it("returns an identity to its post across state changes, card keys and fresh mounts", () => {
    const crew = crewFor();
    applyCrew(crew, [worker("first", "person-a")], { snap: true });
    const original = crew.walkers.get("first")!.anchor;
    applyCrew(crew, [worker("first", "person-a", "waiting")], { snap: true });
    expect(crew.walkers.get("first")!.anchor).not.toBe(original);
    applyCrew(crew, [worker("first", "person-a")], { snap: true });
    expect(crew.walkers.get("first")!.anchor).toBe(original);
    const fresh = crewFor();
    applyCrew(fresh, [worker("different-card", "person-a")], { snap: true });
    expect(fresh.walkers.get("different-card")!.anchor).toBe(original);
  });

  it("uses the nearest free post to the preferred post on a collision, without moving its holder", () => {
    const identity = "person-a";
    const collision = Array.from({ length: 100 }, (_, i) => `person-${i}`).find((id) => home(id) === home(identity))!;
    const crew = crewFor();
    applyCrew(crew, [worker("a", identity)], { snap: true });
    const held = crew.walkers.get("a")!.anchor;
    const posts = crew.stage.zoneOf("working").posts;
    const preferred = posts.find((post) => post.id === held)!;
    applyCrew(crew, [worker("a", identity), worker("b", collision)], { snap: true });
    const second = posts.find((post) => post.id === crew.walkers.get("b")!.anchor)!;
    expect(crew.walkers.get("a")!.anchor).toBe(held);
    expect(second.id).not.toBe(held);
    expect(Math.hypot(second.x - preferred.x, second.y - preferred.y)).toBe(Math.min(...posts.filter((post) => post.id !== held).map((post) => Math.hypot(post.x - preferred.x, post.y - preferred.y))));
    // A full zone still uses its declared overflow, with distinct targets.
    const crowd = Array.from({ length: posts.length + 4 }, (_, i) => worker(`c${i}`, collision));
    applyCrew(crew, [worker("a", identity), worker("b", collision), ...crowd], { snap: true });
    expect(new Set([...crew.walkers.values()].map((walker) => `${walker.target.x},${walker.target.y}`)).size).toBe(posts.length + 6);
  });

  it("reassigns a relaunched identity even when the card and state stay the same", () => {
    const first = "person-a";
    const next = Array.from({ length: 100 }, (_, i) => `other-${i}`).find((id) => home(id) !== home(first))!;
    const crew = crewFor();
    applyCrew(crew, [worker("card", first)], { snap: true });
    applyCrew(crew, [worker("card", next)], { snap: false });
    expect(crew.walkers.get("card")!.anchor).toBe(home(next));
    for (let i = 0; i < 300; i++) stepCrew(crew, 50);
    expect(crew.walkers.get("card")!.phase).toBe("settled");
  });
});

describe("pose-fidgets@1", () => {
  it("switches pose at key boundaries, loops, mirrors offsets and retains settled facing", () => {
    const manifest = fixture();
    const cast = compileCast(manifest);
    expect(fidgetAt(cast, "working", "left", 0, 249)).toEqual({ dx: 0, dy: 0, pose: cast.stand });
    expect(fidgetAt(cast, "working", "left", 0, 250)).toEqual({ dx: -1, dy: -1, pose: cast.walkFront[0] });
    expect(fidgetAt(cast, "working", "left", 0, 500).pose).toBe(cast.stand);
    const crew = crewFor(manifest);
    applyCrew(crew, [worker("one")], { snap: true });
    const figure = crewFigures(crew, 250, { still: false })[0]!;
    expect(figure.pose).toBe(cast.walkFront[0]);
    expect(figure.flip).toBe(crew.walkers.get("one")!.facing === "left");
    expect(crewFigures(crew, 250, { still: true })[0]!.pose).toBe(cast.settled.working.pose);
    crew.walkers.get("one")!.stale = true;
    expect(crewFigures(crew, 250, { still: false })[0]!.pose).toBe(cast.settled.working.pose);
    delete manifest.cast.fidgets.working!.keys[1]!.pose;
    const noPose = crewFor(manifest);
    applyCrew(noPose, [worker("one")], { snap: true });
    expect(crewFigures(noPose, 250, { still: false })[0]!.pose).toBe(cast.settled.working.pose);
  });

  it("requires the capabilities and checks each named pose in every lane", () => {
    const manifest = fixture();
    expect(manifest.requires).toContain("stable-posts@1");
    expect(manifest.requires).toContain("pose-fidgets@1");
    manifest.requires = manifest.requires.filter((id) => id !== "pose-fidgets@1");
    expect(SettingManifestSchema.safeParse(manifest).success).toBe(false);
    manifest.requires = capabilitiesUsed(manifest);
    manifest.cast.fidgets.working!.keys[0]!.pose = "unknown-pose";
    expect(SettingManifestSchema.safeParse(manifest).success).toBe(false);
    manifest.cast.fidgets.working!.keys[0]!.pose = "new-pose";
    Object.values(manifest.cast.lanes)[0]!["new-pose"] = Object.values(Object.values(manifest.cast.lanes)[0]!)[0]!;
    // Only one lane defines it: all looks must be able to draw it.
    expect(SettingManifestSchema.safeParse(manifest).success).toBe(false);
  });
});
