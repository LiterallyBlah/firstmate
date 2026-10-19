import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { URL } from "node:url";
import { attentionCard, attentionCards, attentionRequest, attentionSnapshot, attentionTheme } from "../test/attention-deck-fixture";
import { deckScene } from "./deck-scene";
import { crewIntensity } from "./deck-atmosphere";
import { compileStage } from "./deck-stage";
import { compileCast, availableLooks } from "./deck-cast";
import { applyCrew, createCrew, crewFigures } from "./deck-crew";
import { firstMateFigure } from "./deck-first-mate";
import { SettingManifestSchema } from "../shared/deck-setting";

describe("the Deck's daemon-owned decisions", () => {
  it("puts an actionable running worker at the bow, failures/permissions/review at the wheel, and leaves work and parked crew in their places", () => {
    const scene = deckScene(attentionCards, attentionTheme, { needsYou: attentionSnapshot() });
    expect(scene.sailors.map(s => [s.key, s.state])).toEqual([
      ["Build the feature", "working"], ["Run checks", "working"],
      ["Answer a permission", "waiting"], ["Handle a failure", "waiting"], ["Review the patch", "waiting"],
      ["Choose the release", "blocked"], ["Paused work", "idle"],
    ]);
    expect(scene.decisions?.workerlessCount).toBe(1);
    expect(scene.decisions?.snapshot.actionCount).toBe(2);
    expect(scene.sailors.find(s => s.state === "blocked")?.caption.line).toBe("Your call: Which option should we take?");
    expect(scene.palette.states.blocked).toBe(attentionTheme.colors.statusWarning);
  });
  it.each(["seen", "snoozed", "answer-sent", "delivery-uncertain", "resolved"] as const)("obeys the %s gate without interpreting worker prose", state => {
    const card = attentionCard("task", "working"), snapshot = attentionSnapshot([attentionRequest("task", state)]);
    const scene = deckScene([card], attentionTheme, { needsYou: snapshot });
    expect(scene.sailors[0]!.state).toBe(state === "seen" ? "blocked" : state === "snoozed" ? "idle" : state === "resolved" ? "working" : "waiting");
    expect(scene.decisions?.snapshot.actionCount).toBe(state === "seen" ? 1 : 0);
  });
  it("does not change weather for new, seen, snoozed, answered, unavailable or stale decisions", () => {
    const before = crewIntensity(deckScene(attentionCards, attentionTheme).sailors);
    for (const state of ["new", "seen", "snoozed", "answer-sent"] as const) for (const freshness of ["fresh", "stale", "unknown", "disabled"] as const) {
      const snapshot = attentionSnapshot([attentionRequest("Choose the release", state)]);
      snapshot.freshness.status = freshness;
      if (freshness === "disabled" || freshness === "unknown") snapshot.actionCount = null;
      expect(crewIntensity(deckScene(attentionCards, attentionTheme, { needsYou: snapshot }).sailors)).toBe(before);
    }
  });
  it("preserves a last-good stale count and distinguishes unavailable from clear", () => {
    const snapshot = attentionSnapshot(); snapshot.freshness.status = "stale";
    const scene = deckScene(attentionCards, attentionTheme, { needsYou: snapshot });
    expect(scene.counts.blocked).toBe(1);
    expect(scene.decisions?.snapshot.actionCount).toBe(2);
    expect(scene.sailors.every(s => s.stale)).toBe(true);
    snapshot.actionCount = null; snapshot.freshness.status = "unknown";
    const unknown = deckScene(attentionCards, attentionTheme, { needsYou: snapshot });
    expect(unknown.counts.blocked).toBe(0);
    expect(unknown.decisions?.workerlessCount).toBeNull();
  });
  it("keeps an unmatched host, absent worker, closed worker and ambiguous task with the first mate", () => {
    const cards = [attentionCard("same", "working"), attentionCard("same", "failed"), attentionCard("closed", "ready"), attentionCard("no-worker", "queued", false)];
    cards[2]!.agent!.status = "closed";
    const snapshot = attentionSnapshot([attentionRequest("same"), attentionRequest("same", "new", "other-host"), attentionRequest("closed"), attentionRequest("no-worker")]);
    const scene = deckScene(cards, attentionTheme, { needsYou: snapshot });
    expect(scene.counts.blocked).toBe(0);
    expect(scene.decisions?.workerlessCount).toBe(4);
    expect(scene.decisions?.workerless).toHaveLength(4);
  });
  it.each(["ship", "japanese-ship", "ghost-ship", "sky-airship"])("places ledger fixtures at the authored bow and wheel of %s", id => {
    const manifest = SettingManifestSchema.parse(JSON.parse(readFileSync(new URL(`../art/settings/${id}/setting.json`, import.meta.url), "utf8")));
    const stage = compileStage(manifest), cast = compileCast(manifest);
    const scene = deckScene(attentionCards, attentionTheme, { needsYou: attentionSnapshot() });
    const crew = createCrew(stage, cast); applyCrew(crew, scene.sailors, { snap: true });
    const bow = crew.walkers.get("Choose the release")!;
    expect(stage.zoneOf("blocked").posts.some(p => p.id === bow.anchor)).toBe(true);
    for (const key of ["Review the patch", "Handle a failure", "Answer a permission"]) expect(stage.zoneOf("waiting").posts.some(p => p.id === crew.walkers.get(key)?.anchor)).toBe(true);
    const mate = firstMateFigure(stage, cast, scene)!;
    expect([mate.x, mate.row]).toEqual(manifest.firstMate!.at);
    expect(mate.state).toBe("blocked");
    expect(mate.decisionNew).toBe(false); // workerless decision is Seen
    expect(availableLooks(cast, () => true)).not.toContain(mate.look);
    expect(crewFigures(crew, 0, { still: true })).toEqual(crewFigures(crew, 10000, { still: true }));
  });
});
