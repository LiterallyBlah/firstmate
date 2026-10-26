import { randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { s04Fixture, captain, type S04Fixture } from "../test/supervision-s04-fixture";
import { ScopeDiscussions } from "./scope-discussion";
import { resolveDiscussion, scopeConversationKey } from "../shared/scope-discussion";
import { expectedFor } from "./supervision-effects";
import { threadReplyPath } from "./item-threads";
import { withScopedNeedsYou } from "./needs-you-service";
import { needsYouSnapshot } from "./needs-you-ledger";
import { registerScopeRpcs } from "./scope-rpc";
import { readScopes, readScopeConversation, discussScope, readScopeNeeds, answerScopeDecision, activateScope } from "../shared/supervision-rpc";
import { continuationInputVersion } from "./supervision-continuation";
import { SupervisionLifecycle } from "./supervision-lifecycle";
import { SupervisionEvents } from "./supervision-events";
import { SupervisionInbox } from "./supervision-inbox";

const profile = { provider: "codex/gpt-6.1-sol", modeId: "full-access", thinkingOptionId: "high" };
function service(f: S04Fixture, enabled = true) {
  const generalSend = vi.fn(async (_text: string, _id: string, reserve: (id: string) => Promise<void>) => { await reserve(f.state.globalMate!); });
  const discussions = new ScopeDiscussions(f.home, f.store, f.sessions, { enabled, uiEnabled: true, generalId: async () => f.state.globalMate,
    profile: async () => profile, generalSend });
  return { discussions, generalSend };
}
async function address(d: ScopeDiscussions, text: string, defaultScope = "general") {
  const snapshot = await d.read(), resolved = resolveDiscussion(text, snapshot.scopes, snapshot.projects, defaultScope);
  return { id: randomUUID(), text: resolved.text, addressedText: text, defaultScope,
    route: { target: resolved.scope.target, recipient: resolved.scope.title, projectIds: resolved.projectIds, conversationId: "main", replyTo: null } };
}
async function project(f: S04Fixture, projectId: string) {
  const id = randomUUID(), changes = [{ kind: "scope" as const, value: { id, homeId: f.store.homeId, kind: "project" as const,
    projectIds: [projectId], sponsorId: null, version: 1, mode: "scoped" as const, state: "dormant" as const } }];
  await f.store.transact(expectedFor(await f.store.read(), changes), randomUUID(), changes); return id;
}
function base(f: S04Fixture) {
  return { ...needsYouSnapshot(null, { status: "fresh", checkedAt: Date.now(), asOf: Date.now(), problems: [] }), homeId: f.store.homeId,
    actionCount: 0, pendingAnswerCount: 0 };
}
describe("S05 actual S01/S03/S04 composition, isolated receivers", { timeout: 60000 }, () => {
  it("reads every absent/dormant owner and missing conversation without writes, native lookups or activation", async () => {
    const f = await s04Fixture(), scope = await f.addScope(1, "goal-1", [], false), p = await project(f, scope.projectId), { discussions } = service(f, false);
    const before = await f.files(), lookup = vi.spyOn(f.receiver, "findAgent");
    const snapshot = await discussions.read();
    expect(snapshot.scopes.find(s => s.id === scope.id)?.session).toBe("not-created"); expect(snapshot.scopes.find(s => s.id === p)?.session).toBe("not-created");
    for (const s of snapshot.scopes) expect((await discussions.conversation(snapshot.homeId, s.id, "main")).messages).toEqual([]);
    expect(await f.files()).toEqual(before); expect(f.receiver.calls).toEqual([]); expect(lookup).not.toHaveBeenCalled();
    expect((await discussions.result(await address(discussions, "Hello"))).outcome).toBe("refused"); expect(f.receiver.calls).toEqual([]);
  });
  it("creates plan/project discussion sessions only on Send, reuses dormant context and correlates only the explicit reply file", async () => {
    const f = await s04Fixture(), scope = await f.addScope(1, "goal-1", [], false), p = await project(f, scope.projectId), { discussions, generalSend } = service(f);
    const a = await address(discussions, "Explain this plan", scope.id), b = await address(discussions, "#project-1 Explain this project", p);
    const first = await discussions.discuss(a), second = await discussions.discuss(b);
    expect(first.messages[0]?.delivery).toBe("sent"); expect(second.messages[0]?.delivery).toBe("sent");
    expect(f.receiver.calls.filter(c => c.op === "createAgent")).toHaveLength(2); expect(generalSend).not.toHaveBeenCalled();
    const owner = (await f.store.read()).bindings.find(v => v.scopeId === scope.id)!; f.receiver.finish(owner.agentId);
    const follow = await address(discussions, "Follow up", scope.id); follow.route.replyTo = a.id as never;
    await discussions.discuss(follow); expect(f.receiver.sends.filter(s => s.agentId === owner.agentId)).toHaveLength(2);
    expect(f.receiver.calls.filter(c => c.op === "createAgent")).toHaveLength(2);
    expect(f.receiver.sends[0]?.text).toContain(f.home); expect(f.receiver.sends[0]?.text).not.toContain("Explain this project");
    expect((await f.store.read()).attempts).toHaveLength(0); // discussion minted no work attempt/approval
    const key = scopeConversationKey(f.store.homeId, scope.id);
    await writeFile(join(f.home, threadReplyPath(key, a.id)), "Only the requested plan reply.");
    const restored = await discussions.conversation(f.store.homeId, scope.id, "main");
    expect(restored.messages[0]).toMatchObject({ id: a.id, agentId: owner.agentId, reply: "Only the requested plan reply." });
    expect(restored.messages[1]?.reply).toBeNull();
  });
  it("routes untagged and project context to General; unknown recipients and stale bindings never substitute General", async () => {
    const f = await s04Fixture(), scope = await f.addScope(1, "goal-1", [], false), { discussions, generalSend } = service(f);
    await discussions.discuss(await address(discussions, "#project-1 Hello  \n")); expect(generalSend).toHaveBeenCalledOnce();
    expect(generalSend.mock.calls[0]?.[0]).toContain('"projectContext":[{"id":');
    const stale = await address(discussions, "Hello plan", scope.id), s = await f.store.read(), current = s.scopes.find(v => v.id === scope.id)!;
    const changes = [{ kind: "scope" as const, value: { ...current, state: "held" as const, version: current.version + 1 } }];
    await f.store.transact(expectedFor(s, changes), randomUUID(), changes);
    expect(await discussions.result(stale)).toMatchObject({ outcome: "refused", code: "STALE" });
    const unknown = { ...stale, id: randomUUID(), addressedText: "@unknown Hello" };
    expect(await discussions.result(unknown)).toMatchObject({ outcome: "refused", code: "UNKNOWN_OWNER" });
    expect(f.receiver.calls).toEqual([]); expect(generalSend).toHaveBeenCalledOnce();
  });
  it("retains lost send responses, exact request bytes and spent effects across replay/restart with no resend", async () => {
    const f = await s04Fixture(), scope = await f.addScope(1, "goal-1", ["next"], false), { discussions } = service(f);
    f.receiver.faults.send = ["lose"];
    const request = await address(discussions, "Explain", scope.id), first = await discussions.discuss(request), before = await f.store.read();
    expect(first.messages[0]?.delivery).toBe("uncertain"); expect(before.effects.filter(e => e.state === "uncertain")).toHaveLength(1);
    const restarted = service(f).discussions;
    expect(await restarted.discuss(request)).toEqual(first); expect(f.receiver.sends).toHaveLength(1);
    await expect(restarted.discuss({ ...request, addressedText: `${request.addressedText} ` })).rejects.toMatchObject({ code: "CONFLICT" });
    expect((await f.store.read()).effects).toEqual(before.effects); expect(f.receiver.sends).toHaveLength(1);
    expect((await restarted.result(await address(restarted, "Another message", scope.id))).outcome).toBe("uncertain");
    expect(f.receiver.sends).toHaveLength(1);
  });
  it("keeps status and another scope independent of a slow scope send", async () => {
    const f = await s04Fixture(), a = await f.addScope(1, "goal-1", [], false), b = await f.addScope(2, "goal-2", [], false), { discussions } = service(f);
    await discussions.discuss(await address(discussions, "Open A", a.id)); await discussions.discuss(await address(discussions, "Open B", b.id));
    const bindings = (await f.store.read()).bindings, aId = bindings.find(v => v.scopeId === a.id)!.agentId; bindings.forEach(v => f.receiver.finish(v.agentId));
    let release!: () => void, entered!: () => void;
    const barrier = new Promise<void>(r => { release = r; }), admission = new Promise<void>(r => { entered = r; }), send = f.receiver.send.bind(f.receiver);
    f.receiver.send = async (id, text, messageId) => { await send(id, text, messageId); if (id === aId) { entered(); await barrier; } };
    const aSend = discussions.discuss(await address(discussions, "Slow A", a.id));
    try {
      await admission;
      const read = await discussions.read(); expect(read.scopes.some(s => s.id === b.id)).toBe(true);
      const bSend = await discussions.discuss(await address(discussions, "Independent B", b.id)); expect(bSend.messages.at(-1)?.delivery).toBe("sent");
      expect((await discussions.conversation(f.store.homeId, a.id, "main")).messages.at(-1)?.delivery).toBe("uncertain");
    } finally { release(); await aSend; }
  });
  it("projects dormant/awake observations honestly without making its own writes semantic inputs", async () => {
    const f = await s04Fixture(), scope = await f.addScope(1, "goal-1", ["next"], false), { discussions } = service(f);
    await discussions.discuss(await address(discussions, "Open", scope.id));
    const binding = (await f.store.read()).bindings[0]!, lifecycle = new SupervisionLifecycle(f.store, new SupervisionEvents(f.store), new SupervisionInbox(f.store, { offers: true }), f.sessions, f.gateway, { enabled: true });
    await f.draft(scope, [{ id: "next" }], true);
    const version = continuationInputVersion(await f.store.read(), scope.id, scope.planId);
    await lifecycle.wake(scope.id, "event"); expect((await discussions.read()).scopes.find(s => s.id === scope.id)?.session).toBe("awake");
    f.receiver.finish(binding.agentId);
    await lifecycle.wake(scope.id, "heartbeat");
    expect(continuationInputVersion(await f.store.read(), scope.id, scope.planId)).toBe(version);
    expect((await discussions.read()).scopes.find(s => s.id === scope.id)?.session).toBe("dormant");
    expect(f.receiver.sends).toHaveLength(1); // no work pass from a discussion-created session
    await expect(f.start(scope, "next")).rejects.toMatchObject({ code: "HELD" });
  });
  it("commits the displayed scoped answer once across transfer and rejects changed authority sources", async () => {
    const f = await s04Fixture(), scope = await f.addScope(1, "goal-1", ["choose", "build"]);
    await f.draft(scope, [{ id: "choose", decision: "captain" }, { id: "build", after: [{ node: "choose", on: "answered" }] }]);
    const snapshot = withScopedNeedsYou(base(f), await f.store.read()), row = snapshot.scopedDecisions![0]!;
    expect(row.ready).toBe(true); expect(row.answerContext).toBeDefined();
    const request = { ...row.answerContext!, submissionId: randomUUID(), option: "yes", text: "Proceed within the existing grant." };
    await f.sessions.hold({ requestId: randomUUID(), scopeId: scope.id, expectedEpoch: 1, reason: "Manual transfer." }, captain);
    const first = await f.commands.answer(request, captain), second = await f.commands.answer(request, captain);
    expect(second).toEqual(first);
    const after = await f.store.read(); expect(after.outbox.filter(o => o.kind === "decision.answer")).toHaveLength(1);
    expect(after.decisions[0]?.answer?.submissionId).toBe(request.submissionId); expect(f.receiver.calls).toEqual([]);
    await expect(f.commands.answer({ ...request, submissionId: randomUUID(), subjectHash: "f".repeat(64) }, captain)).rejects.toMatchObject({ code: "STALE" });
  });
  it("registers the actual RPC contracts with separate disabled UI/execution gates and resource-free views", async () => {
    const f = await s04Fixture(), handlers = new Map<string, (input: never) => Promise<unknown>>();
    const server = { handle(contract: { name: string }, handler: (input: never) => Promise<unknown>) { handlers.set(contract.name, handler); } };
    registerScopeRpcs(server as never, { read: async () => ({ home: f.home, generalId: f.state.globalMate, status: await f.store.read() }), readNeeds: async () => base(f), uiEnabled: true });
    const before = await f.files();
    const snapshot = readScopes.output.parse(await handlers.get(readScopes.name)!({} as never)); expect(snapshot.uiEnabled).toBe(true); expect(snapshot.executionEnabled).toBe(false);
    await handlers.get(readScopeConversation.name)!({ homeId: f.store.homeId, scopeId: "general", conversationId: "main" } as never);
    expect(await handlers.get(activateScope.name)!({} as never)).toMatchObject({ state: "unsupported" });
    expect(await handlers.get(discussScope.name)!({} as never)).toMatchObject({ outcome: "refused", code: "UNSUPPORTED" });
    await handlers.get(readScopeNeeds.name)!({} as never);
    await expect(handlers.get(answerScopeDecision.name)!({} as never)).rejects.toMatchObject({ code: "UNSUPPORTED" });
    expect(await f.files()).toEqual(before); expect(f.receiver.calls).toEqual([]);
  });
  it("the enabled fixture RPC commits exactly the displayed answer and rereads the combined snapshot; tags and caller text mint no authority", async () => {
    const f = await s04Fixture(), scope = await f.addScope(1, "goal-1", ["choose", "build"]);
    await f.draft(scope, [{ id: "choose", decision: "captain" }, { id: "build", after: [{ node: "choose", on: "answered" }] }]);
    const handlers = new Map<string, (input: never) => Promise<unknown>>(), { discussions, generalSend } = service(f);
    registerScopeRpcs({ handle(contract: { name: string }, handler: (input: never) => Promise<unknown>) { handlers.set(contract.name, handler); } } as never,
      { read: async () => ({ home: f.home, generalId: f.state.globalMate, status: await f.store.read() }), readNeeds: async () => base(f),
        uiEnabled: true, executionEnabled: true, discussions, commands: f.commands });
    const first = readScopeNeeds.output.parse(await handlers.get(readScopeNeeds.name)!({} as never)), row = first.scopedDecisions![0]!;
    const request = { ...row.answerContext!, submissionId: randomUUID(), option: "yes", text: "Within the existing grant." };
    expect(() => answerScopeDecision.input.parse({ ...request, actor: { kind: "system" } })).toThrow();
    const answer = answerScopeDecision.output.parse(await handlers.get(answerScopeDecision.name)!(request as never));
    expect(answer.scopedDecisions?.[0]?.decision.answer?.submissionId).toBe(request.submissionId); expect(answer.scopedPendingAnswerCount).toBe(1);
    await handlers.get(answerScopeDecision.name)!(request as never);
    expect((await f.store.read()).outbox.filter(o => o.kind === "decision.answer")).toHaveLength(1);
    expect(f.receiver.calls).toEqual([]); expect(generalSend).not.toHaveBeenCalled();
  });
  it("offers a committed answer to a discussion-only plan session once without granting a worker start", async () => {
    const f = await s04Fixture(), scope = await f.addScope(1, "goal-1", ["choose", "build"], false), { discussions } = service(f);
    await discussions.discuss(await address(discussions, "Discuss only", scope.id));
    await f.draft(scope, [{ id: "choose", decision: "captain" }, { id: "build", after: [{ node: "choose", on: "answered" }] }]);
    const row = withScopedNeedsYou(base(f), await f.store.read()).scopedDecisions![0]!;
    await f.commands.answer({ ...row.answerContext!, submissionId: randomUUID(), option: "yes", text: "Record my answer; work activation is separate." }, captain);
    const owner = (await f.store.read()).bindings[0]!; f.receiver.finish(owner.agentId);
    const lifecycle = new SupervisionLifecycle(f.store, new SupervisionEvents(f.store), new SupervisionInbox(f.store, { offers: true }), f.sessions, f.gateway, { enabled: true });
    expect((await lifecycle.wake(scope.id, "event")).state).toBe("accepted");
    f.receiver.finish(owner.agentId); expect((await lifecycle.wake(scope.id, "heartbeat")).state).toBe("awaiting-owner");
    expect(f.receiver.sends).toHaveLength(2); expect((await f.store.read()).attempts).toHaveLength(0);
    await expect(f.start(scope, "build")).rejects.toMatchObject({ code: "HELD" });
  });
  it("refuses an unqualified remote binding before a local lookup, reservation or General send", async () => {
    const f = await s04Fixture(), original = await f.addScope(1, "goal-1", []), s = await f.store.read(), id = randomUUID();
    const changes = [{ kind: "scope" as const, value: { ...s.scopes[0]!, id } },
      { kind: "binding" as const, value: { ...s.bindings[0]!, scopeId: id, agentId: "remote-owner", hostId: "offline-host", workspaceId: "remote-workspace" } }];
    await f.store.transact(expectedFor(s, changes), randomUUID(), changes);
    const { discussions, generalSend } = service(f), before = await f.files(), lookup = vi.spyOn(f.receiver, "findAgent");
    expect(await discussions.result(await address(discussions, "Explain", id))).toMatchObject({ outcome: "refused", code: "UNSUPPORTED" });
    expect(await f.files()).toEqual(before); expect(lookup).not.toHaveBeenCalled(); expect(generalSend).not.toHaveBeenCalled(); expect(f.receiver.calls).toEqual([]);
  });
});
