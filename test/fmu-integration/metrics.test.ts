import { randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, it } from "vitest";
import { ChatQueue } from "../../server/chat-queue";
import { summarizeCaptainQueue, summarizeSupervisorCost } from "../../server/supervision-metrics";
import { s04Fixture, captain } from "../supervision-s04-fixture";
import type { ChatQueuePayload } from "../../shared/chat-queue";

it("A9/A10/A12: queue causal timing survives replay/reload, retains unknown sends and never invents model start", async () => {
  let clock = 10, busy = true, lose = false;
  const path = join(process.env.PASEO_HOME!, randomUUID(), "queue.json"), sends: string[] = [];
  const options = { now: () => clock, enabled: async () => true, activity: async () => { clock += 2; return busy ? "busy" as const : "ready" as const; },
    deliver: async (_p: ChatQueuePayload, id: string) => { sends.push(id); clock += 3; busy = true; if (lose) throw Error("lost accepted reply"); } };
  const payload: ChatQueuePayload = { kind: "mate", agentId: "general", message: { text: "One captain instruction" } };
  let q = new ChatQueue(path, options); const one = randomUUID(), two = randomUUID();
  await q.submit(one, payload); clock = 20; await q.submit(two, payload);
  q = new ChatQueue(path, options); busy = false; clock = 30; await q.ended("general", "old", true);
  const accepted = JSON.parse(await readFile(path, "utf8")).items[0];
  expect(accepted.timing).toEqual({ enqueuedAt: 10, attemptedAt: 32, acceptedAt: 35, busyCause: "receiver-busy" });
  clock = 40; await q.submit(one, payload); await q.ended("general", "old", true); expect(sends).toEqual([one]);
  busy = false; lose = true; clock = 50; await q.ended("general", "next", true);
  const saved = JSON.parse(await readFile(path, "utf8"));
  expect(saved.items[1]).toMatchObject({ state: "held", timing: { acceptedAt: null } });
  const summary = summarizeCaptainQueue(saved.items);
  expect(summary.transportAcceptance).toMatchObject({ denominator: 2, measured: 1, missing: 1, p95Ms: 25 });
  expect(summary.modelStart).toMatchObject({ denominator: 2, measured: 0, missing: 2, p95Ms: null });
  // Old rows stay byte-shaped: reading/replaying them never fabricates historical timings.
  delete saved.items[0].timing; await writeFile(path, JSON.stringify(saved));
  q = new ChatQueue(path, options); await q.submit(one, payload);
  expect(JSON.parse(await readFile(path, "utf8")).items[0].timing).toBeUndefined();
  expect(summarizeCaptainQueue(saved.items).transportAcceptance.measured).toBe(0);
  expect(sends).toEqual([one, two]);
});

it("A10/A12: total cost counts retained reservations at every layer without recounting worker effects or inspection notifications", async () => {
  const f = await s04Fixture(), scope = await f.addScope(1, "cost", ["build"], false);
  await f.sessions.prepare({ requestId: randomUUID(), scopeId: scope.id, scopeVersion: 1,
    profile: { provider: "codex/gpt-6.1-sol", modeId: "full-access", thinkingOptionId: "high" }, opening: "Count this reserved opening" }, captain);
  const s = await f.store.read(), cost = summarizeSupervisorCost(s, [{ runId: "old-inspector" }, { runId: "uncertain-inspector", operations: [
    { key: "create", operation: "agent.create", state: "uncertain" }, { key: "workspace", operation: "workspace.open", state: "accepted" },
  ] }], { sessions: 0, turns: 0 });
  expect(cost).toMatchObject({ supervisor: { sessions: 1, turns: 1 }, inspector: { sessions: 2, turns: 2 },
    totalSessions: 3, totalTurns: 3, uniqueOperations: 5, uncertainOperations: 1, missingInspectorOperationHistory: 1, providerTokens: null, billedMicros: null, contextTokens: null });
  const historical = { ...s, effects: [], attempts: [{ spentAgents: 2, spentTurns: 3 }] } as unknown as typeof s;
  expect(summarizeSupervisorCost(historical, [], { turns: null, sessions: null })).toMatchObject({
    worker: { sessions: 2, turns: 3 }, unrepresentedOwners: 1, complete: false, totalTurns: null, totalSessions: null });
});
