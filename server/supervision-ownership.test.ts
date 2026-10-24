/** R01 retained counterexamples, rebound only into fresh isolated homes. */
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { SupervisionStore, type SupervisionMutation } from "./supervision-store";
import { expected } from "../test/supervision-fixture";

type Rows = SupervisionMutation[];
const retained = JSON.parse(readFileSync(join(process.cwd(), "test/fixtures/supervision-r01/counterexamples.json"), "utf8")) as {
  duplicateWorker: { first: Rows; second: Rows }; foreignAttempt: { first: Rows; second: Rows; effect: Rows };
  distinctHosts: { first: Rows; second: Rows };
};
let home: string, dataRoot: string, store: SupervisionStore;
beforeEach(async () => {
  const base = join(process.env.PASEO_HOME!, randomUUID()); home = join(base, "home"); dataRoot = join(base, "data");
  store = new SupervisionStore(dataRoot, home, { writable: true,
    processIdentity: async () => ({ state: "alive", start: "isolated-r01-ownership-fixture" }) });
  await store.initialize(); await store.acquireCoordinator();
});
function rows(input: Rows): Rows {
  return structuredClone(input).map(m => m.kind === "scope" ? { ...m, value: { ...m.value, homeId: store.homeId } } : m);
}
function row<K extends SupervisionMutation["kind"]>(input: Rows, kind: K): Extract<SupervisionMutation, { kind: K }> {
  const match = input.find(m => m.kind === kind);
  if (!match) throw new Error(`Missing retained fixture row ${kind}`);
  return match as Extract<SupervisionMutation, { kind: K }>;
}
async function commit(input: Rows) {
  const status = await store.read();
  const refs = expected(input).map(ref => ({ ...ref, version: status.versions.find(v => v.kind === ref.kind && v.id === ref.id)?.version ?? 0 }));
  return store.transact(refs, randomUUID(), input);
}
async function tree(directory: string): Promise<unknown> {
  const entries = await readdir(directory, { withFileTypes: true });
  return Promise.all(entries.sort((a, b) => a.name.localeCompare(b.name)).map(async e => [e.name,
    e.isDirectory() ? await tree(join(directory, e.name)) : (await readFile(join(directory, e.name))).toString("base64")]));
}
async function refusedWithoutCommit(input: Rows) {
  const before = await store.read(), bytes = await tree(store.root);
  await expect(commit(input)).rejects.toMatchObject({ code: "CONFLICT" });
  expect(await store.read()).toEqual(before);
  expect(await new SupervisionStore(dataRoot, home).read()).toEqual(before);
  expect(await tree(store.root)).toEqual(bytes); // No tip/event/publication/temp or companion row committed.
}

describe("R01-1 current task worker ownership", () => {
  for (const state of ["running", "done", "unresolved"]) it(`refuses the retained duplicate worker between current tasks (${state})`, async () => {
    const a = rows(retained.duplicateWorker.first), b = rows(retained.duplicateWorker.second);
    row(b, "attempt").value.state = state;
    await commit(a); await refusedWithoutCommit(b);
    expect((await store.read()).tasks).toHaveLength(1);
  });
  it("normalizes the host and refuses a changed workspace as a duplicate-worker bypass", async () => {
    const a = rows(retained.duplicateWorker.first), b = rows(retained.duplicateWorker.second);
    const worker = row(b, "attempt").value.worker!;
    worker.hostId = " LOCAL "; worker.workspaceId = "different-workspace";
    row(b, "task").value.hostId = "LoCaL";
    await commit(a); await refusedWithoutCommit(b);
  });
  it("refuses two current tasks in the same scope claiming one worker", async () => {
    const a = rows(retained.duplicateWorker.first), b = rows(retained.duplicateWorker.second);
    const task = row(b, "task"), attempt = row(b, "attempt"), effect = row(b, "effect");
    task.value.ownerScopeId = row(a, "scope").value.id; task.value.planId = row(a, "backend").value.planId;
    effect.value.scopeId = task.value.ownerScopeId;
    await commit(a); await refusedWithoutCommit([task, attempt, effect]);
  });
  for (const reverse of [false, true]) it(`refuses later worker assignment atomically with its companion scope change (reverse=${reverse})`, async () => {
    const a = rows(retained.duplicateWorker.first), b = rows(retained.duplicateWorker.second);
    const worker = structuredClone(row(b, "attempt").value.worker);
    row(b, "attempt").value.worker = null;
    await commit(a); await commit(b);
    const assignment: Rows = [{ kind: "scope", value: { ...row(b, "scope").value, state: "held", version: 2 } },
      { kind: "attempt", value: { ...row(b, "attempt").value, worker, version: 2 } }];
    await refusedWithoutCommit(reverse ? assignment.reverse() : assignment);
    expect((await store.read()).attempts.find(v => v.id === row(b, "attempt").value.id)?.worker).toBeNull();
  });
  it("refuses assigning the same worker to two initially unassigned current attempts in one transaction", async () => {
    const a = rows(retained.duplicateWorker.first), b = rows(retained.duplicateWorker.second);
    const worker = structuredClone(row(a, "attempt").value.worker);
    row(a, "attempt").value.worker = null; row(b, "attempt").value.worker = null;
    await commit(a); await commit(b);
    await refusedWithoutCommit([a, b].map(input => ({ kind: "attempt", value: { ...row(input, "attempt").value, worker, version: 2 } })));
  });
  it("preserves the retained control using the same opaque agent ID on distinct hosts", async () => {
    await commit(rows(retained.distinctHosts.first)); await commit(rows(retained.distinctHosts.second));
    const status = await store.read();
    expect(status.freshness).toBe("current"); expect(status.attempts).toHaveLength(2);
    expect(status.attempts[0]!.worker!.agentId).toBe(status.attempts[1]!.worker!.agentId);
    expect(status.attempts[0]!.worker!.hostId).not.toBe(status.attempts[1]!.worker!.hostId);
    expect(await new SupervisionStore(dataRoot, home).read()).toEqual(status);
  });
  it("preserves same-task promotion history, spend and reservations while changing the current attempt", async () => {
    const a = rows(retained.duplicateWorker.first); await commit(a);
    const task = row(a, "task").value, prior = row(a, "attempt").value, launch = row(a, "effect").value;
    const nextAttemptId = randomUUID(), nextEffectId = randomUUID();
    await commit([{ kind: "task", value: { ...task, currentAttempt: nextAttemptId, version: 2 } },
      { kind: "attempt", value: { ...prior, id: nextAttemptId, ordinal: 2, launchEffectId: nextEffectId } },
      { kind: "effect", value: { ...launch, id: nextEffectId, requestId: randomUUID(), attemptId: nextAttemptId, logicalKey: "promotion/create" } }]);
    // Non-launch evidence/effects may still name the retained historical attempt of this same task/owner.
    await commit([{ kind: "effect", value: { ...launch, id: randomUUID(), requestId: randomUUID(), logicalKey: "promotion/prior-evidence", operation: "attempt.inspect", state: "reserved" } }]);
    const status = await store.read();
    expect(status.attempts.find(v => v.id === prior.id)).toEqual(prior);
    expect(status.attempts).toHaveLength(2); expect(status.attempts.reduce((n, a) => n + a.spentAgents, 0)).toBe(2);
    expect(status.effects.find(v => v.id === launch.id)).toEqual(launch);
    expect(status.retainedOwnership.some(o => o.attempts.some(v => v.id === prior.id))).toBe(true);
    expect(status.tasks[0]!.currentAttempt).toBe(nextAttemptId);
    expect(await new SupervisionStore(dataRoot, home).read()).toEqual(status);
  });
});

describe("R01-2 effect/attempt/task/scope ownership", () => {
  for (const operation of ["agent.interrupt", "agent.send", "agent.archive"]) it(`refuses the retained foreign attempt for ${operation} without any reservation or companion change`, async () => {
    await commit(rows(retained.foreignAttempt.first)); const b = rows(retained.foreignAttempt.second); await commit(b);
    const foreign = rows(retained.foreignAttempt.effect); row(foreign, "effect").value.operation = operation;
    await refusedWithoutCommit([{ kind: "scope", value: { ...row(b, "scope").value, state: "held", version: 2 } }, ...foreign]);
  });
  it("enforces scope ownership even before the referenced attempt has a worker", async () => {
    const a = rows(retained.foreignAttempt.first); row(a, "attempt").value.worker = null;
    await commit(a); await commit(rows(retained.foreignAttempt.second));
    await refusedWithoutCommit(rows(retained.foreignAttempt.effect));
  });
  it("preserves the same-scope non-launch effect control and its restart projection", async () => {
    const a = rows(retained.foreignAttempt.first); await commit(a);
    const launch = row(a, "effect").value;
    await commit([{ kind: "effect", value: { ...launch, id: randomUUID(), requestId: randomUUID(), logicalKey: "own/interrupt", operation: "agent.interrupt", state: "reserved" } }]);
    const status = await store.read(); expect(status.freshness).toBe("current"); expect(status.effects).toHaveLength(2);
    expect(await new SupervisionStore(dataRoot, home).read()).toEqual(status);
  });
});
