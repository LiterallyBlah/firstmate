import { randomUUID } from "node:crypto";
import { expect, it, vi } from "vitest";
import { s04Fixture } from "../test/supervision-s04-fixture";
import { scopeSnapshot } from "./scope-projection";
import { expectedFor } from "./supervision-effects";

it("shows intermediate success as an unfinished zero-worker goal, including its project owner and evidence age", async () => {
  const f = await s04Fixture(), scope = await f.addScope(1, "reader", ["trial"]);
  await f.draft(scope, [{ id: "trial" }], true); await f.launch(scope, "trial"); await f.record(scope, "trial", "done");
  const s = await f.store.read(), before = f.receiver.calls.length, lookup = vi.spyOn(f.receiver, "findAgent");
  const snapshot = scopeSnapshot(s, "busy-general"), row = snapshot.scopes.find(r => r.id === scope.id)!;
  expect(row.goals[0]).toMatchObject({ state: "needs-planning", activeWorkers: 0, owner: scope.owner.id, due: true });
  expect(row.goals[0]?.evidenceAt).not.toBeNull(); expect(row.goals[0]?.evidenceAgeMs).toBeTypeOf("number");
  expect(snapshot.scopes[0]?.goals[0]?.state).toBe("needs-planning"); expect(f.receiver.calls).toHaveLength(before); expect(lookup).not.toHaveBeenCalled();
}, 60000);

it("counts nested workers once at project/goal level and preserves both independent ready tasks", async () => {
  const f = await s04Fixture(), scope = await f.addScope(1, "reader", ["a", "b"]), project = randomUUID();
  const mutations = [{ kind: "scope" as const, value: { id: project, homeId: f.store.homeId, kind: "project" as const, projectIds: [scope.projectId], sponsorId: null,
    version: 1, mode: "scoped" as const, state: "dormant" as const } }];
  await f.store.transact(expectedFor(await f.store.read(), mutations), randomUUID(), mutations);
  await f.draft(scope, [{ id: "a" }, { id: "b" }], true);
  expect(scopeSnapshot(await f.store.read(), "busy-general").scopes.find(s => s.id === project)?.goals[0]?.next).toContain("a, b");
  await f.launch(scope, "a"); await f.launch(scope, "b");
  const s = await f.store.read(), before = f.receiver.calls.length, snapshot = scopeSnapshot(s, "busy-general");
  expect(snapshot.scopes.find(r => r.id === project)?.activeWorkers).toBe(2); expect(snapshot.scopes.find(r => r.id === scope.id)?.activeWorkers).toBe(2);
  expect(snapshot.scopes[0]?.activeWorkers).toBe(2); expect(f.receiver.calls).toHaveLength(before);
  expect(f.receiver.sends.some(send => send.agentId === "busy-general")).toBe(false);
}, 60000);

it("shows a capacity failure and retained effects without creating a fresh attempt or claiming the held inventory is fresh", async () => {
  const f = await s04Fixture(), scope = await f.addScope(1, "reader", ["trial"]);
  await f.draft(scope, [{ id: "trial" }], true); const started = await f.start(scope, "trial");
  await f.gateway.dispatch(started.effects!.workspace); f.receiver.faults.createAgent = ["capacity"];
  expect((await f.gateway.dispatch(started.effects!.create)).state).toBe("failed");
  const s = await f.store.read(), before = f.receiver.calls.length;
  const projection = scopeSnapshot({ ...s, freshness: "held", problems: ["Retained ownership; repair the journal."] }, null);
  expect(projection.freshness).toBe("held"); expect(projection.problems).toContain("Retained ownership; repair the journal.");
  expect(projection.scopes.find(r => r.id === scope.id)?.lastEffectFailure?.reason).toContain("capacity");
  expect(projection.scopes.find(r => r.id === scope.id)?.goals[0]?.state).not.toBe("completed");
  expect((await f.store.read()).attempts).toHaveLength(1); expect(f.receiver.calls).toHaveLength(before);
}, 60000);
