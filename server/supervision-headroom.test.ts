import { expect, it, vi } from "vitest";
import { s04Fixture, type ScopeHandle } from "../test/supervision-s04-fixture";
import { SupervisionCommands } from "./supervision-commands";
import { checkGeneralHeadroom, pluginOccupancy } from "./supervision-headroom";
import { SupervisionGateway } from "./supervision-effects";
import { SyntheticReceiver } from "../test/synthetic-receiver";

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

it("remote worker attempts take no local General slot, while the local Supervisor's binding still counts", async () => {
  const f = await s04Fixture();
  const local = await f.addScope(1, "capacity-local", ["build-l"]);
  const remote = await f.addScope(2, "capacity-remote", ["build-r"], true, "srv_remote");
  for (const scope of [local, remote]) {
    await f.draft(scope, [{ id: scope.nodes[0]! }], true);
    f.receiver.agents.set(scope.owner.id, { id: scope.owner.id, workspaceId: "supervisor-ws", cwd: f.home, labels: {},
      provider: "codex/gpt-6.1-sol", modeId: "full-access", thinkingOptionId: "high", status: "running", pendingPermissions: 0, archivedAt: null });
  }
  await f.start(local, local.nodes[0]!);
  const remoteReceiver = new SyntheticReceiver({ selectedAgentIds: false, createReceiptLookup: false, labelBoundIdentity: true,
    remoteVersions: { cliVersion: "0.14.0", daemonVersion: "0.14.0" } });
  const gateway = new SupervisionGateway(f.store, f.commands, f.home, f.receiver,
    { enabled: true, receiverFor: (host) => host === "srv_remote" ? remoteReceiver : undefined,
      // Fixture pair only; the production qualified table is empty and fails closed.
      remotePairs: [{ cliVersion: "0.14.0", daemonVersion: "0.14.0" }] });
  const started = await gateway.startWorker(await f.input(remote, { op: "start", plan: remote.planId, node: remote.nodes[0]! }), await f.actorFor(remote));
  const status = await f.store.read();
  // Two running Supervisor bindings + one reserved local worker = 3; the reserved remote worker adds none.
  expect(await pluginOccupancy(status, f.receiver)).toBe(3);
  await expect(checkGeneralHeadroom(status, f.receiver, 4, 1)).rejects.toThrow("capacity");
  await expect(checkGeneralHeadroom(status, f.receiver, 5, 1, started.effects!.create)).resolves.toBeUndefined();
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
