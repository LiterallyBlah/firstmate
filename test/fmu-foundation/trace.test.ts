import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { expect, it } from "vitest";
import { s04Fixture, captain } from "../supervision-s04-fixture";
import { activationEffects, supervisorSpend } from "../../server/supervisor-sessions";
import { supervisorView } from "../../server/supervisor-configuration";
it("A10: identical necessary-work schedule adds zero paid status turns over the direct scoped baseline", async () => {
  async function trace(controls: boolean) {
    const fx = await s04Fixture(), scope = await fx.addScope(1, "trial", ["build"], false);
    await fx.sessions.prepare({ requestId: randomUUID(), scopeId: scope.id, scopeVersion: 1,
      profile: { provider: "codex/gpt-6.1-sol", modeId: "full-access", thinkingOptionId: "high" }, opening: "One necessary opening" }, captain);
    let e = activationEffects(await fx.store.read(), scope.id, 1);
    await fx.gateway.dispatch(e.workspace!.id); await fx.gateway.dispatch(e.create!.id); await fx.sessions.verify(scope.id, 1); await fx.gateway.dispatch(e.send!.id);
    fx.receiver.finish((await fx.store.read()).bindings[0]!.agentId);
    const before = await fx.store.read();
    if (controls) for (let n = 0; n < 100; n++) supervisorView(before, scope.id);
    expect((await fx.store.read()).sequence).toBe(before.sequence);
    const turn = await fx.sessions.reserveTurn({ requestId: randomUUID(), scopeId: scope.id, epoch: 1, causation: "necessary-event", text: "One necessary owner input" }, captain);
    await fx.gateway.dispatch(turn);
    const s = await fx.store.read();
    return { operations: s.effects.map(e => e.operation), uniqueEffects: new Set(s.effects.map(e => e.logicalKey)).size,
      ...supervisorSpend(s, scope.id), inspectorTurns: 0, workerTurns: 0, generalTurns: 0, paidStatusTurns: 0,
      tokens: null, billing: null, liveQueueWait: null };
  }
  const baseline = await trace(false), proposed = await trace(true);
  expect(proposed).toEqual(baseline); expect(proposed).toMatchObject({ sessions: 1, turns: 2, uniqueEffects: 4, paidStatusTurns: 0 });
  if (process.env.FIRSTMATE_PILOT_EVIDENCE === "1") {
    const out = resolve(".local/fmu-foundation"); await mkdir(out, { recursive: true });
    await writeFile(resolve(out, "same-input-trace.json"), JSON.stringify({ source: "synthetic existing direct runtime vs read-only controls", baseline, proposed,
      sourceHead: process.env.FIRSTMATE_PILOT_SOURCE_HEAD ?? null, measuredLiveSavings: null, boundary: "No watch suppression/delivery claim. No live host, provider, billing or captain-wait sample." }, null, 2));
  }
});
