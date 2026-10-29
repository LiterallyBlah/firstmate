import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { s04Fixture } from "../test/supervision-s04-fixture";
import { SupervisionCommands } from "./supervision-commands";
import { SupervisionGateway } from "./supervision-effects";
async function fixture() {
  const f = await s04Fixture(), scope = await f.addScope(1, "recover", ["build"]); await f.draft(scope, [{ id: "build" }], true);
  const commands = new SupervisionCommands(f.store, f.home, { enabled: true, recovery: true });
  const gateway = new SupervisionGateway(f.store, commands, f.home, f.receiver, { enabled: true, recovery: true });
  return { ...f, scope, commands, gateway };
}
it("explicit release cancels only definitely uncreated reservations and retains cumulative spend and replay", async () => {
  const f = await fixture(), start = await f.gateway.startWorker(await f.input(f.scope, { op: "start", plan: "recover", node: "build" }), f.scope.owner);
  const input = await f.input(f.scope, { op: "release", plan: "recover", node: "build", attempt: start.attemptId!, evidence: "All native creation effects remain definitely unclaimed." });
  const released = await f.commands.planCommand(input, f.scope.owner); expect(await f.commands.planCommand(input, f.scope.owner)).toEqual(released);
  const s = await f.store.read(); expect(s.effects.every(e => e.state === "cancelled")).toBe(true); expect(s.attempts[0]!.spentAgents).toBe(1);
  expect(s.attempts[0]!.state).toBe("released-uncreated"); expect(f.receiver.calls).toHaveLength(0);
});
it("lost creation remains uncertain and cannot be released or inferred absent", async () => {
  const f = await fixture(), start = await f.gateway.startWorker(await f.input(f.scope, { op: "start", plan: "recover", node: "build" }), f.scope.owner);
  await f.gateway.dispatch(start.effects!.workspace); f.receiver.faults.createAgent = ["hide"]; await f.gateway.dispatch(start.effects!.create);
  await expect(f.commands.planCommand(await f.input(f.scope, { op: "release", plan: "recover", node: "build", attempt: start.attemptId!, evidence: "It is not visible" }), f.scope.owner)).rejects.toMatchObject({ code: "UNCERTAIN" });
  expect(f.receiver.calls.filter(c => c.op === "createAgent")).toHaveLength(1); expect((await f.store.read()).attempts[0]!.spentAgents).toBe(1);
});
it("checked manual replacement retains task/workspace and original spend; retirement keeps history and identities", async () => {
  const f = await fixture(), first = await f.launch(f.scope, "build"), attempt = (await f.store.read()).attempts[0]!, worker = attempt.worker!;
  await f.commands.planCommand(await f.input(f.scope, { op: "record", plan: "recover", node: "build", attempt: first.attemptId!, state: "done", evidence: "Verified review", agentId: worker.agentId, workspaceId: worker.workspaceId }), f.scope.owner);
  const plan = (await f.store.read()).plans[0]!.plan;
  const input = await f.input(f.scope, { op: "replace", plan: "recover", node: "build", attempt: attempt.id, expected: plan.hash, kind: "promote", evidence: "Reviewed scout outcome promoted within existing budget", budget: plan.definition.budget });
  await expect(f.gateway.recoverPlan(input, f.scope.owner)).rejects.toThrow("stopped");
  f.receiver.finish(worker.agentId); const replacement = await f.gateway.recoverPlan(input, f.scope.owner); expect(await f.gateway.recoverPlan(input, f.scope.owner)).toEqual(replacement);
  const second = await f.gateway.startWorker(await f.input(f.scope, { op: "start", plan: "recover", node: "build" }), f.scope.owner);
  await f.gateway.dispatch(second.effects!.workspace); await f.gateway.dispatch(second.effects!.create); await f.gateway.verifyWorker(second.attemptId!); await f.gateway.dispatch(second.effects!.send);
  const s = await f.store.read(), next = s.attempts.find(a => a.id === second.attemptId)!;
  expect(next.taskId).toBe(attempt.taskId); expect(next.worker!.workspaceId).toBe(worker.workspaceId); expect(f.receiver.calls.filter(c => c.op === "openWorkspace")).toHaveLength(1);
  expect(s.attempts.reduce((n, a) => n + a.spentAgents, 0)).toBe(2);
  f.receiver.finish(next.worker!.agentId); const p = s.plans[0]!.plan;
  await f.gateway.recoverPlan(await f.input(f.scope, { op: "retire", plan: "recover", expected: p.hash, evidence: "Inspected original workers stopped; no dependents or unsettled effects." }), f.scope.owner);
  const retired = await f.store.read(); expect(retired.backends[0]!.state).toBe("retired"); expect(retired.attempts).toHaveLength(2); expect(retired.retirements).toHaveLength(1);
});
