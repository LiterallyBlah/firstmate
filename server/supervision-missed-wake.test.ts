/** Regressions for a plan Supervisor left idle after an event it was owed a wake for (2026-11-05/06). */
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { s04Fixture, captain, type ScopeHandle } from "../test/supervision-s04-fixture";
import { activationEffects } from "./supervisor-sessions";
import { continuationInputVersion, recordContinuation } from "./supervision-continuation";
import { SupervisionEvents } from "./supervision-events";
import { SupervisionInbox } from "./supervision-inbox";
import { SupervisionLifecycle } from "./supervision-lifecycle";
import { handleScopeRequest } from "./scope-requests";
import { WorkflowPlanStore } from "./workflow-plans";
import { INBOX_LIMITS } from "../shared/supervision-inbox";

async function fixture(context?: (scopeId: string) => unknown) {
  const fx = await s04Fixture(), ingress = new SupervisionEvents(fx.store), inbox = new SupervisionInbox(fx.store, { offers: true });
  const options = { enabled: true, ...(context ? { context: (_s: unknown, scopeId: string) => context(scopeId) } : {}) };
  const lifecycle = new SupervisionLifecycle(fx.store, ingress, inbox, fx.sessions, fx.gateway, options);
  async function owner(nodes: string[]) {
    const scope = await fx.addScope(1, "missed-wake", nodes, false);
    await fx.sessions.prepare({ requestId: randomUUID(), scopeId: scope.id, scopeVersion: 1,
      profile: { provider: "codex/gpt-6.1-sol", modeId: "full-access", thinkingOptionId: "high" }, opening: "Read the scoped checkpoint; no global mate role." }, captain);
    const effects = activationEffects(await fx.store.read(), scope.id, 1);
    await fx.gateway.dispatch(effects.workspace!.id); await fx.gateway.dispatch(effects.create!.id);
    const binding = await fx.sessions.verify(scope.id, 1); await fx.gateway.dispatch(effects.send!.id);
    fx.receiver.finish(binding.agentId);
    await fx.draft(scope, nodes.map(id => ({ id })), true);
    return { scope, binding };
  }
  const handlers = () => ({ ...fx, ingress, inbox, legacy: new WorkflowPlanStore(join(fx.home, "legacy"), fx.home), globalMateId: async () => fx.state.globalMate });
  return { ...fx, ingress, inbox, lifecycle, owner, handlers };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;

/** A worker that finished and then asked for `requests` permissions: each is a critical fact owed to the owner. */
async function finishedWithFacts(f: Fixture, scope: ScopeHandle, node: string, requests: number) {
  const started = await f.launch(scope, node), worker = (await f.store.read()).attempts.find(a => a.id === started.attemptId)!.worker!;
  f.receiver.finish(worker.agentId);
  for (let n = 0; n < requests; n++) await f.ingress.permission(worker.agentId, `request-${node}-${n}`);
  return worker;
}

describe("a wake owed to a bound Supervisor is delivered", { timeout: 120000 }, () => {
  it("a page whose wake would exceed the bounded page is still delivered, without the optional owner context, and after a restart", async () => {
    // Live: a 19-event page plus the owner context came to more than 24 KiB; every wake from then on,
    // including after the plugin restarted, refused with "Owner context exceeds its bounded page".
    const big = { note: "x".repeat(INBOX_LIMITS.pageBytes) };
    const f = await fixture(() => big), { scope, binding } = await f.owner(["work"]);
    await finishedWithFacts(f, scope, "work", 1);
    const sends = f.receiver.sends.length;
    const wake = await f.lifecycle.wake(scope.id, "event");
    expect(wake.state).toBe("accepted");
    const sent = f.receiver.sends.slice(sends);
    expect(sent).toHaveLength(1); expect(sent[0]!.agentId).toBe(binding.agentId);
    expect(Buffer.byteLength(sent[0]!.text)).toBeLessThanOrEqual(INBOX_LIMITS.pageBytes);
    expect(sent[0]!.text).toContain(wake.offerId!); expect(sent[0]!.text).toContain("ownerContextOmitted");

    // The same page, prepared before a restart and never sent, is delivered once by the restarted runtime.
    const g = await fixture(() => big), second = await g.owner(["work"]);
    await finishedWithFacts(g, second.scope, "work", 1);
    const prepared = await g.inbox.prepare(second.scope.id, 1, true);
    const restarted = new SupervisionLifecycle(g.store, g.ingress, g.inbox, g.sessions, g.gateway, { enabled: true, context: () => big });
    const before = g.receiver.sends.length;
    const recovered = await restarted.wake(second.scope.id, "restart");
    expect(recovered).toMatchObject({ state: "accepted", offerId: prepared.resultIds[0] });
    expect(g.receiver.sends.slice(before)).toHaveLength(1);
    expect((await restarted.wake(second.scope.id, "heartbeat")).state).toBe("awaiting-owner");
    expect(g.receiver.sends.slice(before)).toHaveLength(1); // No duplicate turn for the same page.
  });

  it("a full page leaves room for the wake's own wording and owner context", async () => {
    const context = { note: "y".repeat(3000) };
    const f = await fixture(() => context), { scope } = await f.owner(["busy"]);
    await finishedWithFacts(f, scope, "busy", 30);
    const s = await f.store.read(), assigned = s.inbox.assignments.filter(a => a.scopeId === scope.id && a.state === "assigned");
    // The facts alone would fill the old page budget, which ignored the wake's wrapper.
    expect(Buffer.byteLength(JSON.stringify(assigned.slice(0, INBOX_LIMITS.pageItems).map(a => s.inbox.events.find(e => e.id === a.id)))))
      .toBeGreaterThan(INBOX_LIMITS.pageBytes - 2048);
    const sends = f.receiver.sends.length, wake = await f.lifecycle.wake(scope.id, "event");
    expect(wake.state).toBe("accepted");
    const text = f.receiver.sends.slice(sends)[0]!.text;
    expect(Buffer.byteLength(text)).toBeLessThanOrEqual(INBOX_LIMITS.pageBytes);
    expect(text).toContain(context.note); expect(text).not.toContain("ownerContextOmitted");
  });

  it("the owner's state page shows a settled launch, though its attempt row is unchanged", async () => {
    // Live: reconcile settled workspace.open as failed and cancelled its siblings; the attempt row stays
    // reserved, the state page had no effects, and the owner recorded a day's wait for someone to settle it.
    const f = await fixture(), { scope, binding } = await f.owner(["build"]);
    const started = await f.start(scope, "build");
    f.receiver.faults.openWorkspace = ["reject"];
    await f.gateway.dispatch(started.effects!.workspace);
    const read = await handleScopeRequest({ id: randomUUID(), actor: binding.agentId, kind: "read",
      input: { scopeId: scope.id, epoch: 1, page: "state", after: 0 } }, f.handlers()) as { attempts: { id: string; state: string }[]; effects?: { id: string; operation: string; state: string }[] };
    expect(read.attempts.find(a => a.id === started.attemptId)!.state).toBe("reserved");
    expect(read.effects?.find(e => e.id === started.effects!.workspace)).toMatchObject({ operation: "workspace.open", state: "failed" });
    expect(read.effects?.filter(e => e.id !== started.effects!.workspace).map(e => e.state)).toEqual(["cancelled", "cancelled"]);
  });

  it("a wait for someone to settle a launch that has already ended is refused, so the owner rereads", async () => {
    const f = await fixture(), { scope, binding } = await f.owner(["build"]);
    const started = await f.start(scope, "build");
    f.receiver.faults.openWorkspace = ["reject"];
    await f.gateway.dispatch(started.effects!.workspace);
    const status = await f.store.read();
    await expect(recordContinuation(f.store, { requestId: randomUUID(), scopeId: scope.id, planId: scope.planId, epoch: 1,
      inputVersion: continuationInputVersion(status, scope.id, scope.planId), disposition: "waiting", reason: "Waiting for the launch to be settled.",
      waits: [{ kind: "prerequisite", id: started.attemptId!, detail: "Someone settles the launch.", until: new Date(Date.now() + 86400000).toISOString() }],
      completion: null }, { kind: "agent", id: binding.agentId, source: "scope-helper/request-file" }, true))
      .rejects.toMatchObject({ code: "HELD", message: expect.stringContaining("already ended") });
  });
});
