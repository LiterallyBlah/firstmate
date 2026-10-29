import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import { s04Fixture, captain } from "../test/supervision-s04-fixture";
import { FirstmateConfigSchema } from "../shared/fleet";
import type { PaseoApi } from "./host-types";
import { SupervisionRuntime } from "./supervision-runtime";
import { ScopeRuntime } from "./scope-runtime";
import { registerScopeRpcs } from "./scope-rpc";
import { readScopes, readScopeNeeds, readScopeConversation, discussScope, answerScopeDecision } from "../shared/supervision-rpc";
import { resolveDiscussion } from "../shared/scope-discussion";
import { needsYouSnapshot } from "./needs-you-ledger";
import { expectedFor } from "./supervision-effects";
import { policyRef } from "./supervision-policy";
import { SupervisionCommands } from "./supervision-commands";
import { scopedBearings } from "./scope-bearings";
import { withScopeInboxContext } from "./scope-inbox";
import { updateFirstmateConfig } from "./config";

const base = () => needsYouSnapshot(null, { status: "fresh", checkedAt: Date.now(), asOf: Date.now(), problems: [] });
async function fixture() {
  const f = await s04Fixture();
  const runtime = new SupervisionRuntime(join(f.home, "store"), () => f.store);
  const current = { config: FirstmateConfigSchema.parse({ home: f.home, mateAgentId: f.state.globalMate }) };
  const service = new ScopeRuntime(runtime, { enabled: true, uiEnabled: true, config: async () => current.config, receiver: () => f.receiver });
  const handlers = new Map<string, (input: unknown, context?: unknown) => Promise<unknown>>();
  const server = { handle: (contract: { name: string }, handler: never) => handlers.set(contract.name, handler) };
  registerScopeRpcs(server as never, { uiEnabled: true, executionEnabled: true, admittedProjectsOnly: true, execute: service.execute.bind(service),
    read: async () => ({ home: f.home, generalId: f.state.globalMate, status: await f.store.read() }), readNeeds: async () => base() });
  const call = async <T extends { name: string; output: { parse(v: unknown): unknown } }>(rpc: T, input = {}) => rpc.output.parse(await handlers.get(rpc.name)!(input, { paseo: {} }));
  return { f, runtime, current, service, call };
}
async function address(discussions: Parameters<Parameters<ScopeRuntime["execute"]>[3]>[0]["discussions"], text: string, defaultScope: string) {
  const snapshot = await discussions.read(), resolved = resolveDiscussion(text, snapshot.scopes, snapshot.projects, defaultScope);
  return { id: randomUUID(), text: resolved.text, addressedText: text, defaultScope,
    route: { target: resolved.scope.target, recipient: resolved.scope.title, projectIds: resolved.projectIds, conversationId: "main", replyTo: null } };
}
it("A09/A16: registered reads, status, filters and restore create zero resources or journal writes; execution defaults off", async () => {
  const { f, runtime, call } = await fixture(), before = await f.files();
  for (let i = 0; i < 3; i++) {
    const snapshot = readScopes.output.parse(await call(readScopes));
    await call(readScopeNeeds); await call(readScopeConversation, { homeId: snapshot.homeId, scopeId: "general", conversationId: "main" });
    const status = await f.store.read(); scopedBearings(status); withScopeInboxContext(base(), status);
  }
  expect(await f.files()).toEqual(before); expect(f.receiver.calls).toEqual([]);
  const disabled = new ScopeRuntime(runtime);
  await expect(disabled.execute(f.store.homeId, "general", {} as PaseoApi, async () => {})).rejects.toMatchObject({ code: "UNSUPPORTED" });
  expect(await f.files()).toEqual(before); await runtime.stop();
});
it("A07/A11: production composition answers once through logical outbox with honest unverified app provenance and no legacy send", async () => {
  const { f, runtime, call } = await fixture(), scope = await f.addScope(1, "choice", ["choose", "build"]);
  await f.draft(scope, [{ id: "choose", decision: "captain" }, { id: "build", after: [{ node: "choose", on: "answered" }] }]);
  const row = readScopeNeeds.output.parse(await call(readScopeNeeds)).scopedDecisions![0]!;
  expect(row.captain).toMatchObject({ origin: { kind: "plan", id: "choice" }, recommendation: "yes", options: [{ number: 1, id: "yes", label: "Yes" }, { number: 2, id: "no", label: "No" }] });
  const input = { ...row.answerContext!, submissionId: randomUUID(), option: "yes", text: "Proceed within the existing scope." };
  const first = answerScopeDecision.output.parse(await call(answerScopeDecision, input));
  expect("outcome" in first).toBe(false);
  await call(answerScopeDecision, input);
  const after = await f.store.read();
  expect(after.outbox.filter(o => o.kind === "decision.answer")).toHaveLength(1);
  expect(after.decisions[0]?.answer?.provenance.kind).toBe("plugin-ui-unverified");
  expect(f.receiver.calls).toEqual([]);
  await expect(new SupervisionCommands(f.store, f.home, { enabled: true }).answerFromUnverifiedUi(input)).rejects.toMatchObject({ code: "UNSUPPORTED" });
  await expect(f.commands.answer({ ...input, submissionId: randomUUID() }, { kind: "plugin-ui-unverified", id: "claimed-captain", source: "forged" })).rejects.toThrow();
  await runtime.stop();
});
it.each([false, true])("A11/A16/A21: admitted aliases and first Send retain identity/caps, changed-source=%s", async changedSource => {
  const { f, runtime, service } = await fixture(), plan = await f.addScope(1, "context", ["probe"], false), projectScope = randomUUID();
  const initial = await f.store.read(), source = initial.policySources[0]!;
  const changes = [{ kind: "scope" as const, value: { id: projectScope, homeId: initial.homeId, kind: "project" as const, projectIds: [plan.projectId], sponsorId: null, version: 1, mode: "scoped" as const, state: "dormant" as const } },
    { kind: "project" as const, value: { id: plan.projectId, version: 1, scopeId: projectScope, name: "Reader", aliases: ["read"], state: "admitted" as const, budget: { agents: 4, turns: 4 },
      sourceVector: [policyRef("policy-source", source)], provenance: captain, owner: { directory: join(f.home, "project"), hostId: "local", registryDigest: "a".repeat(64), generalAgentId: f.state.globalMate!,
        profile: { provider: "codex/gpt-6.1-sol", modeId: "full-access" }, limits: { supervisorSessions: 1, supervisorTurns: 1 } } } }];
  await mkdir(join(f.home, "project")); await writeFile(join(f.home, "project", "README.md"), "Project context is not authority.");
  await f.store.transact(expectedFor(initial, changes), randomUUID(), changes);
  if (changedSource) f.receiver.afterAdmission = () => { writeFileSync(join(f.home, "data/orders.md"), "Changed admission after workspace opening.\n"); };
  // This fixture's other dormant plan has no binding, so headroom has no unknown native owner.
  const lookup = vi.spyOn(f.receiver, "findAgent"), before = await f.files();
  const result = await service.execute(initial.homeId, projectScope, {} as PaseoApi, async ({ discussions }) => {
    const snapshot = await discussions.read();
    expect(resolveDiscussion("#read Explain", snapshot.scopes, snapshot.projects).scope.id).toBe("general");
    expect(resolveDiscussion("@mate #read Explain", snapshot.scopes, snapshot.projects).scope.id).toBe("general");
    expect(resolveDiscussion("@read Explain", snapshot.scopes, snapshot.projects).scope.id).toBe(projectScope);
    expect(await f.files()).toEqual(before); expect(lookup).not.toHaveBeenCalled();
    const input = await address(discussions, "#read Explain without implementing", projectScope);
    const first = await discussions.result(input); await discussions.result(input);
    if (!changedSource) {
      const second = await discussions.result(await address(discussions, "Another turn", projectScope));
      expect(second.outcome).toBe("refused");
    }
    return first;
  });
  if (changedSource) {
    expect(f.receiver.calls.map(c => c.op)).toEqual(["openWorkspace"]);
    expect((await f.store.read()).bindings.find(b => b.scopeId === projectScope)?.purpose).toBe("discussion");
    await runtime.stop(); return;
  }
  expect(result.outcome).toBe("recorded");
  const status = await f.store.read(), binding = status.bindings.find(b => b.scopeId === projectScope)!;
  expect(binding.purpose).toBe("discussion"); expect(status.effects.filter(e => e.scopeId === projectScope && e.operation === "agent.create")).toHaveLength(1);
  expect(f.receiver.sends).toHaveLength(1); expect(f.receiver.sends[0]?.text).toContain("Project context is not authority.");
  expect(f.receiver.sends[0]?.text).toContain('"authority":"none"');
  await runtime.stop();
});
it("A16: stale home refuses before writer/resource acquisition", async () => {
  const { f, runtime, current, service } = await fixture(), before = await f.files();
  current.config = { ...current.config, home: join(f.home, "changed") };
  await expect(service.execute(f.store.homeId, "general", {} as PaseoApi, async () => {})).rejects.toMatchObject({ code: "STALE" });
  expect(await f.files()).toEqual(before); expect(f.receiver.calls).toEqual([]); await runtime.stop();
});
it("A16: untagged and @mate use the existing checked General sender, never a scoped receiver or substitute identity", async () => {
  const { f, runtime, current, service } = await fixture(), send = vi.fn(async (_text: string, _options: unknown) => {});
  const mutate = vi.spyOn(runtime, "mutate");
  await updateFirstmateConfig({ home: f.home, mateAgentId: "", migration: null, mateLaunch: null });
  await updateFirstmateConfig({ mateAgentId: f.state.globalMate! });
  const api = { agents: { ref: (id: string) => ({ send,
    refresh: async () => ({ agent: { id, archivedAt: null, status: "idle" } }),
  }) } } as unknown as PaseoApi;
  await service.execute(f.store.homeId, "general", api, async ({ discussions }) => {
    for (const text of ["Explain the current portfolio", "@mate Explain again"]) {
      const input = await address(discussions, text, "general");
      expect((await discussions.result(input)).outcome).toBe("recorded");
    }
  });
  expect(send).toHaveBeenCalledTimes(2); expect(send.mock.calls[0]?.[0]).toBeTruthy(); expect(f.receiver.calls).toEqual([]);
  const changedApi = { agents: { ref: (id: string) => ({ send, refresh: async () => {
    current.config = { ...current.config, home: join(f.home, "moved") };
    return { agent: { id, archivedAt: null, status: "idle" } };
  } }) } } as unknown as PaseoApi;
  await service.execute(f.store.homeId, "general", changedApi, async ({ discussions }) => {
    const input = await address(discussions, "Keep the captured home", "general");
    await discussions.result(input);
  });
  expect(send).toHaveBeenCalledTimes(2);
  expect(mutate).not.toHaveBeenCalled();
  await runtime.stop();
});
