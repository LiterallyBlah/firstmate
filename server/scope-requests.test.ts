import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { describe, expect, it, vi } from "vitest";
import { handleScopeRequest, legacyRoute, processScopeRequests, scopeRoute } from "./scope-requests";
import { SupervisionStore } from "./supervision-store";
import { processWorkflowRequests } from "./workflow-service";
import { WorkflowPlanStore } from "./workflow-plans";
import { planDefinition, s04Fixture } from "../test/supervision-s04-fixture";
import { SupervisionGateway } from "./supervision-effects";
import { SupervisionRemoteReceiver } from "./supervision-remote-receiver";
import { FakeCliBridge, REMOTE_CWD, REMOTE_HOST } from "../test/fake-remote-bridge";

const run = promisify(execFile);
async function legacyStore(home: string) { return new WorkflowPlanStore(join(home, "legacy-plans"), home); }
async function request(home: string, actor: string, command: unknown) {
  const id = randomUUID(); await mkdir(join(home, "data/workflow-requests"), { recursive: true });
  await writeFile(join(home, "data/workflow-requests", `${id}.json`), JSON.stringify({ id, actor, command }));
  return async () => JSON.parse(await readFile(join(home, "data/workflow-requests", `${id}.reply.json`), "utf8"));
}

describe("S04 legacy/scoped dispatch partition", { timeout: 60000 }, () => {
  it("the explicit read audit command checks historical bytes without a receiver effect", async () => {
    const fx = await s04Fixture(), scope = await fx.addScope(1, "audit-scope", ["audit-build"]);
    const handlers = { commands: fx.commands, gateway: fx.gateway, store: fx.store, legacy: await legacyStore(fx.home), globalMateId: async () => "general-first-mate" };
    const audit = vi.spyOn(fx.store, "audit");
    await writeFile(join(fx.store.root, "transactions/000000000001.event.json"), "{old-corruption");
    const calls = fx.receiver.calls.length;
    const result = await handleScopeRequest({ id: randomUUID(), actor: scope.owner.id, kind: "read",
      input: { scopeId: scope.id, epoch: 1, page: "audit" } }, handlers);
    expect(result).toMatchObject({ freshness: "held" }); expect(audit).toHaveBeenCalledOnce();
    expect(fx.receiver.calls).toHaveLength(calls);
  });
  it("legacy writes refuse scoped targets only when the guard is supplied; reads and unrelated plans pass", async () => {
    const fx = await s04Fixture(), scope = await fx.addScope(1, "scoped-goal", ["sg-trial"]);
    const legacy = await legacyStore(fx.home), allow = async () => {};
    const draft = { op: "draft", definition: planDefinition("scoped-goal", "project-1", [{ id: "sg-trial" }]) } as const;
    await expect(legacyRoute(fx.store, draft)).rejects.toThrow(/scoped supervisor/);
    await expect(legacyRoute(fx.store, { op: "agenda" })).resolves.toBeUndefined();
    await expect(legacyRoute(fx.store, { op: "draft", definition: planDefinition("legacy-goal", "p", [{ id: "lg-trial" }]) })).resolves.toBeUndefined();
    const guarded = await request(fx.home, "mate", draft);
    await processWorkflowRequests(fx.home, legacy, allow, command => legacyRoute(fx.store, command));
    expect(await guarded()).toMatchObject({ ok: false, error: expect.stringMatching(/scoped supervisor/) });
    expect(await legacy.get("scoped-goal")).toBeNull();
    const fresh = new SupervisionStore(join(fx.home, "unused-store"), fx.home);
    await expect(legacyRoute(fresh, draft)).resolves.toBeUndefined(); // No scoped store: legacy behaviour is unchanged.
    expect(scope.planId).toBe("scoped-goal");
  });

  it("the scope path refuses legacy targets, the global mate, and routes starts through the gateway", async () => {
    const fx = await s04Fixture(), scope = await fx.addScope(1, "scoped-goal", ["sg-trial"]);
    const legacy = await legacyStore(fx.home);
    await legacy.execute({ op: "draft", definition: planDefinition("legacy-goal", "project-x", [{ id: "lg-trial" }]) }, randomUUID(), "mate");
    await expect(scopeRoute(legacy, "legacy-goal")).rejects.toThrow(/legacy first mate/);
    await expect(scopeRoute(legacy, "scoped-goal")).resolves.toBeUndefined();
    await fx.draft(scope, [{ id: "sg-trial" }]);
    const handlers = { commands: fx.commands, gateway: fx.gateway, store: fx.store, legacy, globalMateId: async () => "general-first-mate" };
    const start = await fx.input(scope, { op: "start", plan: scope.planId, node: "sg-trial" });
    await expect(handleScopeRequest({ id: randomUUID(), actor: "general-first-mate", kind: "plan", input: start }, handlers)).rejects.toThrow(/not a scope principal/);
    const legacyStart = { ...start, command: { op: "start" as const, plan: "legacy-goal", node: "lg-trial" } };
    await expect(handleScopeRequest({ id: randomUUID(), actor: scope.owner.id, kind: "plan", input: legacyStart }, handlers)).rejects.toThrow(/legacy first mate/);
    const started = await handleScopeRequest({ id: randomUUID(), actor: scope.owner.id, kind: "plan", input: start }, handlers) as { attemptId: string };
    expect((await fx.store.read()).effects.filter(e => e.attemptId === started.attemptId)).toHaveLength(3);
    // The file transport replies with the refusal code; the request file is never treated as authentication.
    const id = randomUUID(); await mkdir(join(fx.home, "data/scope-requests"), { recursive: true });
    await writeFile(join(fx.home, "data/scope-requests", `${id}.json`), JSON.stringify({ id, actor: "neighbour", kind: "plan", input: { ...start, requestId: randomUUID() } }));
    await processScopeRequests(fx.home, handlers);
    expect(JSON.parse(await readFile(join(fx.home, "data/scope-requests", `${id}.reply.json`), "utf8"))).toMatchObject({ ok: false, code: "UNKNOWN_OWNER" });
  });

  it("permit-worker answers one exact remote permission through the gateway; the global mate cannot use it", async () => {
    const fx = await s04Fixture(), bridge = new FakeCliBridge();
    const scope = await fx.addScope(3, "permit-plan", ["p-trial"], true, REMOTE_HOST);
    await fx.draft(scope, [{ id: "p-trial" }], true); // firstmate mode: the Supervisor answers directly
    const receiver = new SupervisionRemoteReceiver(bridge, REMOTE_HOST, async () => REMOTE_CWD, { cliVersion: async () => "0.14.0" });
    const gateway = new SupervisionGateway(fx.store, fx.commands, fx.home, fx.receiver,
      { enabled: true, receiverFor: host => host === REMOTE_HOST ? receiver : undefined, remotePairs: [{ cliVersion: "0.14.0", daemonVersion: "0.14.0" }] });
    const started = await gateway.startWorker(await fx.input(scope, { op: "start", plan: scope.planId, node: "p-trial" }), scope.owner);
    await gateway.dispatch(started.effects!.workspace); await gateway.dispatch(started.effects!.create);
    await gateway.verifyWorker(started.attemptId!); await gateway.dispatch(started.effects!.send);
    const agentId = [...bridge.agents.keys()][0]!;
    bridge.addPermission(agentId, "permission-1", "Bash");
    const handlers = { commands: fx.commands, gateway, store: fx.store, legacy: await legacyStore(fx.home), globalMateId: async () => "general-first-mate" };
    const input = { scopeId: scope.id, epoch: 1, attemptId: started.attemptId!, causation: "permit:permission-1",
      answer: { requestId: "permission-1", action: "deny" as const, message: "Stay in the worktree." } };
    await expect(handleScopeRequest({ id: randomUUID(), actor: "general-first-mate", kind: "permit-worker", input }, handlers)).rejects.toThrow(/not a scope principal/);
    const result = await handleScopeRequest({ id: randomUUID(), actor: scope.owner.id, kind: "permit-worker", input }, handlers) as { state: string; receiptRef: string };
    expect(result).toMatchObject({ state: "succeeded", receiptRef: "permitted:deny:permission-1" });
    expect(bridge.calls.filter(args => args[0] === "permit" && args[1] === "deny")).toEqual([["permit", "deny", agentId, "permission-1", "--message", "Stay in the worktree.", "--json"]]);
    // The state read carries source coverage (gaps and observedAt), never a completeness claim.
    const state = await handleScopeRequest({ id: randomUUID(), actor: scope.owner.id, kind: "read", input: { scopeId: scope.id, epoch: 1, page: "state" } }, handlers) as { sources: unknown[] };
    expect(Array.isArray(state.sources)).toBe(true);
  });

  it("the scope helper refuses the global first mate before writing anything", async () => {
    const fx = await s04Fixture();
    await mkdir(join(fx.home, "tools"), { recursive: true });
    await copyFile(join(import.meta.dirname, "../templates/tools/scope.mjs"), join(fx.home, "tools/scope.mjs"));
    await writeFile(join(fx.home, "data/input.json"), "{}");
    const helper = (role: string, extra: string[] = []) => writeFile(join(fx.home, "tools/role.mjs"), `console.log(${JSON.stringify(role)});`)
      .then(() => run(process.execPath, [join(fx.home, "tools/scope.mjs"), "plan", "--file", "data/input.json", ...extra], { cwd: fx.home, env: { ...process.env, PASEO_AGENT_ID: "agent-x" } }).catch(e => e));
    const refused = await helper("first-mate");
    expect(JSON.parse(refused.stdout)).toMatchObject({ ok: false, error: expect.stringMatching(/global first mate/) });
    const id = randomUUID(); await mkdir(join(fx.home, "data/scope-requests"), { recursive: true });
    await writeFile(join(fx.home, "data/scope-requests", `${id}.reply.json`), JSON.stringify({ ok: true, result: "queued" }));
    const guest = await helper("guest", ["--request-id", id]);
    expect(JSON.parse(guest.stdout)).toMatchObject({ ok: true, result: "queued" });
    expect(JSON.parse(await readFile(join(fx.home, "data/scope-requests", `${id}.json`), "utf8"))).toEqual({ id, actor: "agent-x", kind: "plan", input: {} });
  });
});
