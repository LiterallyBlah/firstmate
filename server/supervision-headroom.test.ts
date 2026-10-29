import { expect, it, vi } from "vitest";
import { s04Fixture, type ScopeHandle } from "../test/supervision-s04-fixture";
import { SupervisionCommands } from "./supervision-commands";
import { checkGeneralHeadroom } from "./supervision-headroom";

async function fixture() {
  const f = await s04Fixture(), scopes: ScopeHandle[] = [];
  for (let n = 1; n <= 2; n++) {
    const scope = await f.addScope(n, `capacity-${n}`, [`build-${n}`]); scopes.push(scope);
    await f.draft(scope, [{ id: scope.nodes[0]! }], true);
    f.receiver.agents.set(scope.owner.id, { id: scope.owner.id, workspaceId: `supervisor-ws-${n}`, cwd: f.home, labels: {},
      provider: "codex/gpt-6.1-sol", modeId: "full-access", thinkingOptionId: "high", status: "idle", pendingPermissions: 0, archivedAt: null });
  }
  const commands = new SupervisionCommands(f.store, f.home, { enabled: true, recovery: true });
  const a = await f.start(scopes[0]!, scopes[0]!.nodes[0]!);
  const release = () => f.input(scopes[0]!, { op: "release", plan: scopes[0]!.planId, node: scopes[0]!.nodes[0]!, attempt: a.attemptId!,
    evidence: "Inspect the exact original create and its admission receipts; missing lookup alone proves nothing." });
  return { ...f, scopes, commands, a, release };
}

it("F5: checked uncreated release frees headroom for independent B without removing identity or cumulative spend", async () => {
  const f = await fixture(), initial = await f.store.read();
  await expect(checkGeneralHeadroom(initial, f.receiver, 2, 1)).rejects.toThrow("capacity");
  await f.commands.planCommand(await f.release(), f.scopes[0]!.owner);
  const released = await f.store.audit(), attempt = released.attempts.find(a => a.id === f.a.attemptId)!;
  expect(attempt).toMatchObject({ state: "released-uncreated", worker: null, spentAgents: 1, spentTurns: 1 });
  expect(released.effects.filter(e => e.attemptId === attempt.id).every(e => e.state === "cancelled")).toBe(true);
  const selected = released.effects.find(e => e.id === f.a.effects!.create)!.receiverKey!;
  expect(selected).toBe(initial.effects.find(e => e.id === f.a.effects!.create)!.receiverKey);
  const lookup = vi.spyOn(f.receiver, "findAgent");
  await expect(checkGeneralHeadroom(released, f.receiver, 2, 1)).resolves.toBeUndefined();
  expect(lookup).not.toHaveBeenCalledWith(selected);
  const b = await f.start(f.scopes[1]!, f.scopes[1]!.nodes[0]!);
  expect(b.attemptId).not.toBe(f.a.attemptId);
  const after = await f.store.read();
  expect(after.attempts.find(a => a.id === attempt.id)).toEqual(attempt);
  expect(after.attempts.reduce((sum, a) => sum + a.spentAgents, 0)).toBe(2);
  expect(f.receiver.calls).toEqual([]);
});

it.each(["reserved", "uncertain", "created", "running"])("F5: %s work keeps its physical slot and cannot be inferred released", async state => {
  const f = await fixture();
  if (state !== "reserved") {
    await f.gateway.dispatch(f.a.effects!.workspace);
    if (state === "uncertain") f.receiver.faults.createAgent = ["hide"];
    await f.gateway.dispatch(f.a.effects!.create);
    if (state === "running") { await f.gateway.verifyWorker(f.a.attemptId!); await f.gateway.dispatch(f.a.effects!.send); }
    await expect(f.commands.planCommand(await f.release(), f.scopes[0]!.owner)).rejects.toMatchObject({ code: "UNCERTAIN" });
  }
  const s = await f.store.read();
  expect(s.attempts[0]!.state).not.toBe("released-uncreated");
  expect(s.attempts[0]!.spentAgents).toBe(1);
  await expect(checkGeneralHeadroom(s, f.receiver, 2, 1)).rejects.toThrow("capacity");
});
