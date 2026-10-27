/** M1 qualification only: real reducers/journal/mailboxes/gateway, synthetic receiver and temporary homes.
 * Virtual ten-minute General turn. No daemon, provider, plugin install, timer change or release call.
 */
import { randomUUID } from "node:crypto";
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { captain, planDefinition, s04Fixture, type NodeSpec, type S04Fixture, type ScopeHandle } from "./supervision-s04-fixture";
import { observation } from "./supervision-inbox-fixture";
import { SupervisionEvents } from "../server/supervision-events";
import { SupervisionInbox } from "../server/supervision-inbox";
import { SupervisionLifecycle } from "../server/supervision-lifecycle";
import { activationEffects, supervisorSpend } from "../server/supervisor-sessions";
import { expectedFor } from "../server/supervision-effects";
import { SupervisionStore } from "../server/supervision-store";
import { acceptPolicyInventory, policyRef } from "../server/supervision-policy";
import { planSubjectHash } from "../server/workflow-plans";
import { scopeSnapshot } from "../server/scope-projection";
import { needsYouSnapshot } from "../server/needs-you-ledger";
import { withScopedNeedsYou } from "../server/needs-you-service";
import { digest } from "../server/submissions";
import { PilotMetricsSchema, summarizePilotMetrics, type PilotMetrics } from "../server/supervision-metrics";
import { queueMateNote, flushMateNotes } from "../server/mate";
import { updateFirstmateConfig, readFirstmateConfig } from "../server/config";
import { CREW_LABELS } from "../shared/fleet";
import type { PaseoApi } from "../server/host-types";
import { WatchRunner } from "../server/watches";

const HEAD = "a".repeat(40), OLD_HEAD = "b".repeat(40);
const profile = { provider: "codex/gpt-6.1-sol", modeId: "full-access", thinkingOptionId: "high" };
const startAt = Date.parse("2026-10-26T12:00:00.000Z"), BUSY_MS = 600_000;
const fixtureHash = digest({ version: 1, plans: 2, builders: 2, reviewers: 2, busyMs: BUSY_MS });
afterEach(() => vi.useRealTimers());
const receipts: unknown[] = [];
afterAll(() => exportEvidence("qualification-receipts", { format: "firstmate.s06-receipts/1",
  sourceHead: process.env.FIRSTMATE_PILOT_SOURCE_HEAD, fixtureHash, runtime: { node: process.version, platform: process.platform }, receipts }));

function clock() {
  vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(startAt);
  return { at: (ms: number) => vi.setSystemTime(startAt + ms), now: () => Date.now() - startAt };
}
function metrics(route: PilotMetrics["route"]): PilotMetrics {
  return { format: "firstmate.supervision-pilot-metrics/1", runId: randomUUID(),
    // Populated with exact tested source by the evidence export command. HEAD here is a synthetic subject.
    sourceHead: process.env.FIRSTMATE_PILOT_SOURCE_HEAD ?? HEAD, fixtureHash, mode: "synthetic", route, clock: "virtual",
    runtime: { node: process.version, platform: process.platform as "win32" | "linux" | "darwin" }, windowMs: BUSY_MS, generalBusyMs: BUSY_MS,
    samples: [], captain: [], census: { coverage: "checked-route", generalRoutinePayloads: 0, projectRoutinePayloads: 0, accidentalCallbacks: 0 },
    spend: { workerSessions: 0, workerTurns: 0, supervisorSessions: 0, supervisorTurns: 0, generalTurns: 0, uncertainEffects: 0, providerTokens: null, billedMicros: null } };
}
async function pilot(limits?: { supervisorSessions: number; supervisorTurns: number }) {
  const f = await s04Fixture(limits ? { limits } : {}), ingress = new SupervisionEvents(f.store), inbox = new SupervisionInbox(f.store, { offers: true });
  const lifecycle = new SupervisionLifecycle(f.store, ingress, inbox, f.sessions, f.gateway, { enabled: true });
  const startWorker = f.gateway.startWorker.bind(f.gateway);
  f.gateway.startWorker = async (input, actor) => {
    try { return await startWorker(input, actor); }
    catch (error) {
      if (error instanceof Error && input.command.op === "start") error.message += ` (fixture ${input.command.plan}/${input.command.node})`;
      throw error;
    }
  };
  // A real synthetic receiver observation stays running for the whole virtual trial. It is never
  // created/prompted by the fixture and no lifecycle wake is allowed to end it to make progress.
  f.receiver.agents.set(f.state.globalMate!, { id: f.state.globalMate!, workspaceId: "general-workspace", cwd: f.home,
    provider: profile.provider, modeId: profile.modeId, thinkingOptionId: profile.thinkingOptionId, labels: {}, status: "running", pendingPermissions: 0, archivedAt: null });
  async function owner(n: number, nodes: NodeSpec[], project?: { id: string; name: string }, budget = 6) {
    const scope = await f.addScope(n, `pilot-${n}`, nodes.map(n => n.id), false, "local", project);
    await f.sessions.prepare({ requestId: randomUUID(), scopeId: scope.id, scopeVersion: 1, profile, opening: "Read only this synthetic scope checkpoint.", purpose: "work" }, captain);
    const e = activationEffects(await f.store.read(), scope.id, 1);
    await f.gateway.dispatch(e.workspace!.id); await f.gateway.dispatch(e.create!.id);
    const binding = await f.sessions.verify(scope.id, 1); await f.gateway.dispatch(e.send!.id); f.receiver.finish(binding.agentId);
    await f.run(scope, { op: "draft", definition: planDefinition(scope.planId, scope.project, nodes, budget, true) });
    const p = (await f.store.read()).plans.find(p => p.scopeId === scope.id)!.plan;
    if (p.status === "review") await f.run(scope, { op: "captain", plan: scope.planId, revision: p.revision, subjectHash: planSubjectHash(p), action: "approve", text: "Approve isolated fixture only." }, captain);
    return { scope, binding };
  }
  async function finished(scope: ScopeHandle, node: string, existing?: Awaited<ReturnType<S04Fixture["launch"]>>) {
    const launched = existing ?? await f.launch(scope, node), worker = (await f.store.read()).attempts.find(a => a.id === launched.attemptId)!.worker!;
    f.receiver.finish(worker.agentId);
    const input = observation({ agentId: worker.agentId, turnId: `turn-${node}`, sourceKey: `finish-${node}`, payload: { reportHash: digest(node), head: HEAD } });
    const admitted = await ingress.admit(input);
    // Observing a worker finish has not verified or advanced its workflow outcome.
    expect((await f.store.read()).plans.find(p => p.scopeId === scope.id)!.plan.nodes[node]!.state).toBe("starting");
    return { launched, worker, input, eventId: admitted.resultIds[0]!, receipt: admitted.receipt };
  }
  async function handle(scope: ScopeHandle, wake: { offerId: string | null }, node?: string, evidence?: string) {
    const s = await f.store.read(), offer = s.inbox.offers.find(o => o.id === wake.offerId)!;
    const actor = await f.actorFor(scope), epoch = s.bindings.find(b => b.scopeId === scope.id)!.epoch;
    await inbox.acknowledge(scope.id, epoch, offer.id, offer.eventIds, randomUUID(), actor.id);
    if (node) await f.run(scope, { op: "record", plan: scope.planId, node, attempt: s.plans.find(p => p.scopeId === scope.id)!.plan.nodes[node]!.attempt!,
      state: "done", evidence: evidence ?? `Owner verified synthetic report ${digest(node)} at exact head ${HEAD}.` });
    // An explicit no-action mailbox disposition is separate from the verified workflow outcome.
    await inbox.handle(scope.id, epoch, offer.id, offer.eventIds.map(eventId => ({ eventId, result: { kind: "no-action" as const,
      reason: "Owner inspected evidence and recorded its workflow judgment separately; no imperative replay.",
      evidenceIds: [s.inbox.events.find(e => e.id === eventId)!.envelope.evidence[0]!.digest] } })), randomUUID(), actor.id);
    f.receiver.finish(actor.id);
  }
  return { ...f, ingress, inbox, lifecycle, owner, finished, handle };
}
type Pilot = Awaited<ReturnType<typeof pilot>>;
const chain = (prefix: string): NodeSpec[] => [{ id: `${prefix}-build`, kind: "ship" }, { id: `${prefix}-review`, after: [{ node: `${prefix}-build`, on: "done" }] }];
async function captureReceipt(caseId: string, f: Pilot) {
  const s = await f.store.read();
  receipts.push({ caseId, sequence: s.sequence, hash: s.hash, freshness: s.freshness,
    sources: s.inbox.sources.map(x => ({ id: x.id, maxSeq: x.maxSeq, coverage: x.coverage, gaps: x.gaps })),
    assignments: s.inbox.assignments.map(x => ({ id: x.id, primary: x.primaryEventId, scopeId: x.scopeId, state: x.state })),
    offers: s.inbox.offers.map(x => ({ id: x.id, scopeId: x.scopeId, epoch: x.epoch, state: x.state, sends: x.sends })),
    watermarks: s.inbox.mailboxes.map(x => ({ scopeId: x.id, watermark: x.watermark })),
    effects: s.effects.map(x => ({ id: x.id, logicalKey: x.logicalKey, attemptId: x.attemptId, epoch: x.epoch, state: x.state })),
    attempts: s.attempts.map(x => ({ id: x.id, spentAgents: x.spentAgents, spentTurns: x.spentTurns })),
    outboxes: s.outbox.map(x => ({ id: x.id, ownerScopeId: x.ownerScopeId, state: x.state, handledEpoch: x.handledEpoch })),
    receiverCalls: f.receiver.calls.map(x => ({ op: x.op, targetHash: digest(x.target) })) });
}

async function census(f: Pilot, m: PilotMetrics) {
  const s = await f.store.read(), owners = s.bindings.filter(b => s.scopes.find(x => x.id === b.scopeId)?.kind === "plan").map(b => b.agentId);
  m.census.generalRoutinePayloads = f.receiver.sends.filter(x => x.agentId === f.state.globalMate).length;
  const projectOwners = s.bindings.filter(b => s.scopes.find(x => x.id === b.scopeId)?.kind === "project").map(b => b.agentId);
  m.census.projectRoutinePayloads = f.receiver.sends.filter(x => projectOwners.includes(x.agentId)).length;
  expect(f.receiver.sends.every(x => owners.includes(x.agentId) || s.attempts.some(a => a.worker?.agentId === x.agentId))).toBe(true);
  m.spend = { workerSessions: s.attempts.reduce((n, a) => n + a.spentAgents, 0), workerTurns: s.attempts.reduce((n, a) => n + a.spentTurns, 0),
    supervisorSessions: s.scopes.reduce((n, scope) => n + supervisorSpend(s, scope.id).sessions, 0),
    supervisorTurns: s.scopes.reduce((n, scope) => n + supervisorSpend(s, scope.id).turns, 0),
    generalTurns: m.census.generalRoutinePayloads,
    uncertainEffects: s.effects.filter(e => ["uncertain", "dispatching", "accepted"].includes(e.state)).length, providerTokens: null, billedMicros: null };
}
async function exportEvidence(name: string, data: unknown) {
  if (process.env.FIRSTMATE_PILOT_EVIDENCE !== "1") return;
  if (!/^[0-9a-f]{40}$/.test(process.env.FIRSTMATE_PILOT_SOURCE_HEAD ?? "")) throw Error("Evidence export requires the exact tested source head.");
  await mkdir(".local/s06", { recursive: true }); await writeFile(`.local/s06/${name}.json`, JSON.stringify(data, null, 2) + "\n");
}

describe("S06 new-plan cooperative M1 qualification", { timeout: 60000 }, () => {
  it("A08/A09/A19: both builder/reviewer chains advance in one project during a ten-minute General turn", async () => {
    const time = clock(), f = await pilot(), m = metrics("scoped");
    const a = await f.owner(1, chain("a")), b = await f.owner(2, chain("b"), { id: a.scope.projectId, name: a.scope.project });
    expect(b.scope.projectId).toBe(a.scope.projectId);
    // A dormant logical project exists but receives no routine summary/session.
    const projectId = randomUUID(), change = [{ kind: "scope" as const, value: { id: projectId, homeId: f.store.homeId, kind: "project" as const,
      projectIds: [a.scope.projectId], sponsorId: null, version: 1, mode: "scoped" as const, state: "dormant" as const } }];
    await f.store.transact(expectedFor(await f.store.read(), change), randomUUID(), change);
    const general = f.receiver.agents.get(f.state.globalMate!)!;
    for (const [stage, at] of [["build", 1000], ["review", 301_000]] as const) {
      time.at(at);
      const done = await Promise.all([f.finished(a.scope, `a-${stage}`), f.finished(b.scope, `b-${stage}`)]);
      const before = await f.store.read();
      // Reconstruct adapters from persisted state. Actual process-kill publication coverage is in supervision-crash.test.ts.
      expect((await new SupervisionStore(join(f.home, "store"), f.home).read()).hash).toBe(before.hash);
      const restarted = new SupervisionLifecycle(f.store, new SupervisionEvents(f.store), new SupervisionInbox(f.store, { offers: true }), f.sessions, f.gateway, { enabled: true });
      for (const d of [...done].reverse()) {
        expect((await f.ingress.admit(d.input)).resultIds).toEqual([d.eventId]);
        // Accidental second native observation retains provenance without another semantic consequence.
        await f.ingress.admit({ ...d.input, sourceKind: "timeline", sourceKey: `native-callback-${stage}`, gaps: [], coverage: "bounded" });
        m.census.accidentalCallbacks++;
      }
      time.at(at + 10);
      const wakes = await Promise.all([restarted.wake(a.scope.id, "restart"), restarted.wake(b.scope.id, "event")]);
      expect(wakes.map(w => w.state)).toEqual(["accepted", "accepted"]);
      time.at(at + 20);
      for (const [i, owner] of [a, b].entries()) {
        const d = done[i]!;
        m.samples.push({ eventId: d.eventId, scopeId: owner.scope.id, observed: at, committed: at, offered: at + 10, acknowledged: at + 20, handled: at + 20, sourcePolls: 0 });
        await f.handle(owner.scope, wakes[i]!, `${i ? "b" : "a"}-${stage}`);
      }
      expect(general.status).toBe("running");
    }
    const s = await f.store.read();
    expect(s.plans.map(p => p.plan.nodes[`${p.scopeId === a.scope.id ? "a" : "b"}-review`]!.state)).toEqual(["done", "done"]);
    expect(s.attempts).toHaveLength(4); expect(new Set(s.attempts.map(a => a.worker!.agentId)).size).toBe(4);
    expect(s.inbox.assignments.filter(a => a.id === a.primaryEventId)).toHaveLength(4);
    expect(s.inbox.assignments.filter(a => a.state === "superseded")).toHaveLength(4);
    expect(s.inbox.mailboxes.map(b => b.watermark)).toEqual([2, 2]);
    expect(s.bindings.some(b => b.scopeId === projectId)).toBe(false);
    const beforeCalls = f.receiver.calls.length, beforeFiles = await f.files();
    time.at(BUSY_MS);
    for (let i = 0; i < 3; i++) {
      const view = scopeSnapshot(await f.store.read(), f.state.globalMate, { uiEnabled: true });
      expect(view.scopes.find(s => s.id === projectId)!.activeWorkers).toBe(0);
      expect(view.freshness).toBe("current");
    }
    expect(f.receiver.calls).toHaveLength(beforeCalls); expect(await f.files()).toEqual(beforeFiles);
    expect(general.status).toBe("running"); await census(f, m);
    expect(summarizePilotMetrics(m)).toMatchObject({ events: 4, scopes: 2, generalBusyMs: BUSY_MS,
      census: { zeroRoutineOnCheckedRoute: true }, spend: { workerSessions: 4, workerTurns: 4, supervisorSessions: 2, supervisorTurns: 6, providerTokens: null } });
    await exportEvidence("scoped-metrics", { run: m, report: summarizePilotMetrics(m), journal: { sequence: s.sequence, hash: s.hash } });
    await captureReceipt("two-plan", f);
  }, 180000); // Full fsynced two-owner trace; this bound is not a provider latency target.

  it("A19 baseline: actual legacy note delivery waits for General; missing typed ack/cost remain unknown", async () => {
    const time = clock(), m = metrics("legacy"), sends: { id: string; at: number }[] = [];
    const general = { id: "general-baseline", status: "running", archivedAt: null, pendingPermissions: [], labels: { [CREW_LABELS.role]: CREW_LABELS.mateRole } };
    const paseo = { agents: { ref: () => ({ refresh: async () => ({ agent: general }), send: async (_text: string, options: { messageId: string }) => { sends.push({ id: options.messageId, at: time.now() }); } }) } } as unknown as PaseoApi;
    await updateFirstmateConfig({ mateAgentId: general.id });
    try {
    for (const at of [1000, 301_000]) for (const scopeId of ["00000000-0000-4000-8000-000000000101", "00000000-0000-4000-8000-000000000102"]) {
      time.at(at); await queueMateNote(paseo, "Synthetic completion identity only.");
      m.samples.push({ eventId: randomUUID(), scopeId, observed: at, committed: at, offered: null, acknowledged: null, handled: null, sourcePolls: 0 });
    }
    expect((await readFirstmateConfig()).mateNotes).toHaveLength(4); expect(sends).toEqual([]);
    time.at(BUSY_MS); general.status = "idle";
    for (const row of m.samples) { await flushMateNotes(paseo); row.offered = time.now(); }
    expect(sends).toHaveLength(4); expect((await readFirstmateConfig()).mateNotes).toEqual([]);
    m.census.generalRoutinePayloads = sends.length;
    m.spend.generalTurns = sends.length;
    const report = summarizePilotMetrics(m);
    expect(report.offer).toMatchObject({ denominator: 4, measured: 4, minMs: 299_000, maxMs: 599_000 });
    expect(report.ack).toMatchObject({ denominator: 4, measured: 0, missing: 4, p95Ms: null });
    expect(report.spend.providerTokens).toBeNull(); expect(report.census.zeroRoutineOnCheckedRoute).toBe(false);
    await exportEvidence("legacy-metrics", { run: m, report });
    } finally {
      // Release only this synthetic config identity, including after a failed baseline assertion.
      await updateFirstmateConfig({ mateAgentId: "" });
    }
  });

  it("A02/A01: simultaneous builder/review facts retain both owners; old-head review refuses one deduplicated next step", async () => {
    const f = await pilot(), a = await f.owner(1, chain("a"));
    const b = await f.owner(2, [{ id: "b-build", kind: "ship" }, { id: "b-r1", after: [{ node: "b-build", on: "done" }] },
      { id: "b-r2", after: [{ node: "b-build", on: "done" }] }, { id: "b-next", after: [{ node: "b-r1", on: "done" }, { node: "b-r2", on: "done" }] }], { id: a.scope.projectId, name: a.scope.project });
    const buildB = await f.finished(b.scope, "b-build"); await f.handle(b.scope, await f.lifecycle.wake(b.scope.id, "event"), "b-build");
    const r1 = await f.launch(b.scope, "b-r1"), r2 = await f.launch(b.scope, "b-r2");
    const facts = await Promise.all([f.finished(a.scope, "a-build"), f.finished(b.scope, "b-r1", r1), f.finished(b.scope, "b-r2", r2)]);
    for (const fact of facts.reverse()) await f.ingress.admit(fact.input);
    const [wa, wb] = await Promise.all([f.lifecycle.wake(a.scope.id, "event"), f.lifecycle.wake(b.scope.id, "event")]);
    await f.handle(a.scope, wa, "a-build");
    await f.handle(b.scope, wb); await f.record(b.scope, "b-r1", "done"); await f.record(b.scope, "b-r2", "done");
    // Owner attests report inspection; S08's future PR adapter is not mocked into existence.
    const s = await f.store.read(), original = s.policyRules.find(r => r.selector.scopeIds.includes(b.scope.id))!;
    await acceptPolicyInventory(f.store, f.home, randomUUID(), captain, { sources: [], rules: [{ ...original, id: randomUUID(), operations: ["plan.start"],
      constraints: { ...original.constraints, requireHead: true, independentReviews: 2, requiredReviewIds: ["r1", "r2"] } }] }, true);
    let input = await f.input(b.scope, { op: "start", plan: b.scope.planId, node: "b-next" });
    const evidence = { id: randomUUID(), version: 1, scopeId: b.scope.id, subjectHash: input.subjectHash!, head: HEAD, artifactHash: null, checks: "passed" as const,
      reviews: [{ id: "r1", reviewerId: facts.find(d => d.input.turnId === "turn-b-r1")!.worker.agentId, authorId: buildB.worker.agentId, head: HEAD, outcome: "accepted" as const, sourceDigest: digest("r1") },
        { id: "r2", reviewerId: facts.find(d => d.input.turnId === "turn-b-r2")!.worker.agentId, authorId: buildB.worker.agentId, head: OLD_HEAD, outcome: "accepted" as const, sourceDigest: digest("r2-old") }],
      availability: "unknown" as const, sourceDigest: digest("inspected reports") };
    await f.store.transact([{ kind: "policy-evidence", id: evidence.id, version: 0 }], randomUUID(), [{ kind: "policy-evidence", value: evidence }]);
    input = { ...input, head: HEAD, evidenceVector: [policyRef("policy-evidence", evidence)] };
    await expect(f.gateway.startWorker(input, await f.actorFor(b.scope))).rejects.toMatchObject({ code: "HELD" });
    await f.launch(a.scope, "a-review"); // The other scope never waits for B's review correction.
    const corrected = { ...evidence, version: 2, sourceDigest: digest("fresh current-head reports"),
      reviews: evidence.reviews.map(r => ({ ...r, head: HEAD, sourceDigest: digest([r.id, HEAD]) })) };
    await f.store.transact([{ kind: "policy-evidence", id: evidence.id, version: 1 }], randomUUID(), [{ kind: "policy-evidence", value: corrected }]);
    input = { ...input, requestId: randomUUID(), evidenceVector: [policyRef("policy-evidence", corrected)] };
    await expect(f.gateway.startWorker(input, await f.actorFor(a.scope))).rejects.toMatchObject({ code: "UNKNOWN_OWNER" });
    const accepted = await f.gateway.startWorker(input, await f.actorFor(b.scope));
    expect(await f.gateway.startWorker(input, await f.actorFor(b.scope))).toEqual(accepted);
    const fresh = { ...await f.input(b.scope, { op: "start", plan: b.scope.planId, node: "b-next" }), head: HEAD, evidenceVector: [policyRef("policy-evidence", corrected)] };
    await expect(f.gateway.startWorker(fresh, await f.actorFor(b.scope))).rejects.toThrow();
    const after = await f.store.read(); expect(after.attempts.filter(a => after.tasks.find(t => t.id === a.taskId)!.nodeId === "b-next")).toHaveLength(1);
    expect(after.effects.filter(e => e.attemptId === accepted.attemptId && e.operation === "agent.create")).toHaveLength(1);
    expect(f.receiver.sends.some(s => s.agentId === f.state.globalMate)).toBe(false);
    await captureReceipt("simultaneous-old-head", f);
  }, 180000);

  it("A05/rollback: narrow instruction hold stops queued admissions, preserves admitted work and lets another plan drain", async () => {
    const f = await pilot(), a = await f.owner(1, chain("a")), b = await f.owner(2, chain("b"), { id: a.scope.projectId, name: a.scope.project });
    const queued = await f.start(a.scope, "a-build"); await f.gateway.dispatch(queued.effects!.workspace);
    const before = await f.store.read(), rule = before.policyRules.find(r => r.selector.scopeIds.includes(a.scope.id))!;
    await acceptPolicyInventory(f.store, f.home, randomUUID(), captain, { sources: [], rules: [{ ...rule, version: rule.version + 1, effect: "deny" }] }, true);
    const held = await f.store.read(), calls = f.receiver.calls.length;
    expect(held.operationHolds.filter(h => h.state === "held").map(h => h.scopeId)).toEqual([a.scope.id]);
    await expect(f.gateway.dispatch(queued.effects!.create)).rejects.toMatchObject({ code: "HELD" });
    expect(f.receiver.calls).toHaveLength(calls);
    expect(held.effects.find(e => e.id === queued.effects!.workspace)!.state).toBe("succeeded");
    expect(held.attempts.find(x => x.id === queued.attemptId)!.spentAgents).toBe(1);
    await f.finished(b.scope, "b-build"); await f.handle(b.scope, await f.lifecycle.wake(b.scope.id, "event"), "b-build");
    expect((await f.store.read()).plans.find(p => p.scopeId === b.scope.id)!.plan.nodes["b-build"]!.state).toBe("done");
    const files = await f.files(), retained = await f.store.read();
    const disabled = new SupervisionLifecycle(f.store, f.ingress, f.inbox, f.sessions, f.gateway);
    await expect(disabled.wake(b.scope.id, "restart")).rejects.toMatchObject({ code: "UNSUPPORTED" });
    expect(await f.files()).toEqual(files); expect((await f.store.read()).hash).toBe(retained.hash);
    expect(retained.inbox.events.length).toBeGreaterThan(0); expect(retained.effects.find(e => e.id === queued.effects!.create)!.state).toBe("reserved");
    // Forward rollback freezes admissions; it never restores an old executable epoch, refunds spend or deletes evidence.
    await captureReceipt("hold-forward-rollback", f);
  });

  it.each(["event:linked", "publication:synced", "publication:linked"])("A06: interrupted ingress at %s retains cursor/event together before any offer", async point => {
    const f = await pilot(), { scope } = await f.owner(1, chain("crash")), started = await f.launch(scope, "crash-build");
    const worker = (await f.store.read()).attempts.find(a => a.id === started.attemptId)!.worker!;
    f.receiver.finish(worker.agentId);
    // Hook sources deliberately have no durable cursor. Exercise a supported timeline baseline.
    const input = observation({ agentId: worker.agentId, sourceKind: "timeline", gaps: [], coverage: "bounded",
      cursor: { epoch: "boot-1", seq: 17 }, maxSeq: 17 });
    const requestId = randomUUID(), calls = f.receiver.calls.length;
    f.hooks.boundary = async name => { if (name === point) { f.hooks.boundary = null; throw Error(`Injected ${point}`); } };
    await expect(f.ingress.admit(input, requestId)).rejects.toMatchObject({ code: "HELD", message: expect.stringContaining(`Injected ${point}`) });
    const interrupted = await f.store.read();
    if (point !== "publication:linked") {
      expect(interrupted.freshness).toBe("held"); expect(interrupted.inbox.events).toEqual([]); expect(interrupted.inbox.sources).toEqual([]);
      expect((await f.lifecycle.wake(scope.id, "restart")).state).toBe("held");
      await f.store.recoverPublication();
    }
    const replay = await f.ingress.admit(input, requestId); expect(replay.replayed).toBe(true);
    const s = await f.store.read(); expect(s.inbox.events).toHaveLength(1); expect(s.inbox.sources[0]!.maxSeq).toBe(17);
    expect(s.inbox.sources[0]!.cursor?.seq).toBe(17); expect(f.receiver.calls).toHaveLength(calls);
    await f.ingress.boot(scope.id);
    expect(scopeSnapshot(await f.store.read(), f.state.globalMate).scopes.find(x => x.id === scope.id)!.coverage).toBe("gaps");
    expect((await f.lifecycle.wake(scope.id, "restart")).state).toBe("accepted");
    await captureReceipt(`ingress-${point}`, f);
  });

  it.each(["reservation", "send-reply", "ack"])("A06: owner page recovery after %s never loses or duplicates handling", async point => {
    const f = await pilot(), { scope, binding } = await f.owner(1, chain("recover")); await f.finished(scope, "recover-build");
    let wake;
    if (point === "reservation") {
      const dispatch = vi.spyOn(f.gateway, "dispatch").mockRejectedValueOnce(Error("Injected before dispatch"));
      await expect(f.lifecycle.wake(scope.id, "event")).rejects.toThrow("Injected before dispatch"); dispatch.mockRestore();
      expect((await f.store.read()).inbox.offers[0]!.state).toBe("uncertain");
      wake = await f.lifecycle.wake(scope.id, "restart");
    } else {
      if (point === "send-reply") f.receiver.faults.send = ["lose"];
      wake = await f.lifecycle.wake(scope.id, "event");
    }
    const before = await f.store.read(), page = before.inbox.offers[0]!, count = f.receiver.sends.length;
    if (point === "ack") await f.inbox.acknowledge(scope.id, 1, page.id, page.eventIds, randomUUID(), binding.agentId);
    const restarted = new SupervisionLifecycle(f.store, f.ingress, f.inbox, f.sessions, f.gateway, { enabled: true });
    await restarted.wake(scope.id, "restart"); await restarted.wake(scope.id, "heartbeat");
    expect(f.receiver.sends).toHaveLength(count); expect((await f.store.read()).inbox.mailboxes[0]!.watermark).toBe(0);
    expect(supervisorSpend(await f.store.read(), scope.id).turns).toBe(2);
    if (point !== "ack") await f.inbox.acknowledge(scope.id, 1, page.id, page.eventIds, randomUUID(), binding.agentId);
    const evidenceId = before.inbox.events[0]!.envelope.evidence[0]!.digest;
    await f.inbox.handle(scope.id, 1, page.id, [{ eventId: page.eventIds[0]!, result: { kind: "no-action", reason: "Recovered owner disposition; transport alone is not an outcome.", evidenceIds: [evidenceId] } }], randomUUID(), binding.agentId);
    expect((await f.store.read()).inbox.mailboxes[0]!.watermark).toBe(1);
    if (point === "send-reply") {
      expect(wake.state).toBe("uncertain"); expect((await restarted.wake(scope.id, "restart")).state).toBe("uncertain");
    }
    await captureReceipt(`owner-${point}`, f);
  });

  it.each(["workspace", "create", "send"] as const)("A06/A20: lost worker %s reply retains original IDs, cumulative spend and uncertainty", async boundary => {
    const f = await pilot(), { scope } = await f.owner(1, chain("uncertain")), started = await f.start(scope, "uncertain-build");
    const effect = started.effects![boundary];
    if (boundary !== "workspace") await f.gateway.dispatch(started.effects!.workspace);
    if (boundary === "send") { await f.gateway.dispatch(started.effects!.create); await f.gateway.verifyWorker(started.attemptId!); }
    const op = boundary === "workspace" ? "openWorkspace" : boundary === "create" ? "createAgent" : "send";
    f.receiver.faults[op] = [boundary === "create" ? "hide" : "lose"];
    expect((await f.gateway.dispatch(effect)).state).toBe("uncertain");
    const calls = f.receiver.calls.length;
    expect((await f.gateway.reconcile(effect)).state).toBe("uncertain");
    await expect(f.gateway.dispatch(effect)).rejects.toMatchObject({ code: "UNCERTAIN" });
    const s = await new SupervisionStore(join(f.home, "store"), f.home).read();
    expect(s.attempts).toHaveLength(1); expect(s.attempts[0]).toMatchObject({ id: started.attemptId, spentAgents: 1, spentTurns: 1 });
    expect(s.effects.find(e => e.id === effect)!.resourceIds.length).toBeGreaterThan(0);
    expect(f.receiver.calls).toHaveLength(calls);
    await expect(f.start(scope, "uncertain-build")).rejects.toThrow(); expect((await f.store.read()).attempts).toHaveLength(1);
    await captureReceipt(`worker-${boundary}`, f);
  });

  it("A07.scoped/A01: two-device answer during manual transfer reaches only the new epoch and replays its original receipt", async () => {
    const f = await pilot(), { scope, binding } = await f.owner(1, [{ id: "pick", decision: "captain" }, { id: "after-pick", after: [{ node: "pick", on: "answered" }] }]);
    const base = { ...needsYouSnapshot(null, { status: "fresh" as const, checkedAt: Date.now(), asOf: Date.now(), problems: [] }), homeId: f.store.homeId, actionCount: 0, pendingAnswerCount: 0 };
    const row = withScopedNeedsYou(base, await f.store.read()).scopedDecisions![0]!;
    const answer = { ...row.answerContext!, submissionId: randomUUID(), option: "yes", text: "Bounded fixture answer." };
    await f.sessions.hold({ requestId: randomUUID(), scopeId: scope.id, expectedEpoch: 1, reason: "Explicit synthetic manual transfer." }, captain);
    const accepted = await f.commands.answer(answer, captain); // Response deliberately discarded by the first device.
    await expect(f.commands.answer({ ...answer, submissionId: randomUUID() }, captain)).rejects.toMatchObject({ code: "STALE" });
    await expect(f.commands.answer({ ...answer, submissionId: randomUUID(), subjectHash: digest("changed") }, captain)).rejects.toMatchObject({ code: "STALE" });
    expect((await f.commands.pending()).find(o => o.entry.id === answer.submissionId)!.binding).toBeNull();
    const heldScope = (await f.store.read()).scopes.find(s => s.id === scope.id)!;
    await expect(f.sessions.prepareReplacement({ requestId: randomUUID(), scopeId: scope.id, scopeVersion: heldScope.version, expectedEpoch: 1, profile, opening: "New epoch" }, captain)).rejects.toMatchObject({ code: "HELD" });
    // Exact old identity is explicitly stopped in the synthetic receiver. No archive call or TTL inference.
    f.receiver.agents.get(binding.agentId)!.status = "closed";
    await f.sessions.prepareReplacement({ requestId: randomUUID(), scopeId: scope.id, scopeVersion: heldScope.version, expectedEpoch: 1, profile, opening: "New epoch; reconcile accepted answers." }, captain);
    const e = activationEffects(await f.store.read(), scope.id, 2);
    await f.gateway.dispatch(e.workspace!.id); await f.gateway.dispatch(e.create!.id);
    const replacement = await f.sessions.verify(scope.id, 2); await f.gateway.dispatch(e.send!.id); f.receiver.finish(replacement.agentId);
    expect(await f.commands.answer(answer, captain)).toEqual(accepted);
    expect((await f.commands.pending()).find(o => o.entry.id === answer.submissionId)!.binding?.agentId).toBe(replacement.agentId);
    const wake = await f.lifecycle.wake(scope.id, "event"); expect(wake.state).toBe("accepted");
    expect(f.receiver.sends.at(-1)!.agentId).toBe(replacement.agentId);
    const s = await f.store.read(), scopeVersion = s.scopes.find(s => s.id === scope.id)!.version;
    const ack = { requestId: randomUUID(), scopeId: scope.id, epoch: 1, scopeVersion, outboxId: answer.submissionId, resultRef: `command:${answer.submissionId}` };
    await expect(f.commands.acknowledge(ack, { ...scope.owner, id: binding.agentId })).rejects.toMatchObject({ code: "STALE" });
    const handled = await f.run(scope, { op: "ack", plan: scope.planId, kind: "handled", ids: [answer.submissionId] });
    await f.commands.acknowledge({ ...ack, requestId: randomUUID(), epoch: 2, resultRef: `command:${handled.receipt.requestId}` }, { ...scope.owner, id: replacement.agentId });
    const after = await f.store.read(); expect(after.outbox.filter(o => o.kind === "decision.answer")).toHaveLength(1);
    expect(after.outbox.find(o => o.id === answer.submissionId)!.handledEpoch).toBe(2);
    expect(supervisorSpend(after, scope.id)).toMatchObject({ sessions: 2, turns: 3 });
    await captureReceipt("answer-transfer", f);
  });

  it("A20: worker and supervisor exhaustion refuse additional spend; lost sends reserve worst-case turns", async () => {
    const f = await pilot({ supervisorSessions: 1, supervisorTurns: 2 }), { scope } = await f.owner(1, [{ id: "first" }], undefined, 1);
    await f.finished(scope, "first"); f.receiver.faults.send = ["lose"];
    expect((await f.lifecycle.wake(scope.id, "event")).state).toBe("uncertain");
    const current = await f.store.read(), task = current.tasks[0]!;
    const secondTask = { ...task, id: randomUUID(), nodeId: "second", version: 1, currentAttempt: null };
    await f.store.transact([{ kind: "task", id: secondTask.id, version: 0 }], randomUUID(), [{ kind: "task", value: secondTask }]);
    const before = await f.store.read(), calls = f.receiver.calls.length;
    // The existing reducer rejects an over-budget definition before a second start can even exist.
    await expect(f.run(scope, { op: "revise", definition: planDefinition(scope.planId, scope.project, [{ id: "first" }, { id: "second" }], 1, true),
      expected: before.plans[0]!.plan.hash, reason: "Attempt additional work without raising the spent one-run allowance." })).rejects.toThrow(/budget/i);
    await expect(f.sessions.reserveTurn({ requestId: randomUUID(), scopeId: scope.id, epoch: 1, causation: "extra", text: "Extra forbidden turn" }, captain)).rejects.toMatchObject({ code: "HELD" });
    const after = await f.store.read();
    // Payload preparation may leave an inert blob, never a committed command/effect or spend.
    expect(after.storage.bytes).toBe(before.storage.bytes + Buffer.byteLength("Extra forbidden turn"));
    expect({ ...after, storage: { ...after.storage, bytes: before.storage.bytes } }).toEqual(before); expect(f.receiver.calls).toHaveLength(calls);
    expect(supervisorSpend(before, scope.id)).toMatchObject({ sessions: 1, turns: 2, uncertain: 1 });
    expect(before.attempts[0]).toMatchObject({ spentAgents: 1, spentTurns: 1 });
    // Exhaustion refusal is evidence, not an invented auto-generated decision/portfolio quota adapter.
    await captureReceipt("budget", f);
    const capped = await pilot({ supervisorSessions: 1, supervisorTurns: 1 }), owner = await capped.owner(1, [{ id: "cap" }]);
    const cappedBefore = await capped.store.read(), cappedCalls = capped.receiver.calls.length;
    await expect(capped.sessions.reserveTurn({ requestId: randomUUID(), scopeId: owner.scope.id, epoch: 1, causation: "beyond-cap", text: "Forbidden paid work" }, captain)).rejects.toThrow(/budget is exhausted/);
    const cappedAfter = await capped.store.read();
    expect(cappedAfter.storage.bytes).toBe(cappedBefore.storage.bytes + Buffer.byteLength("Forbidden paid work"));
    expect({ ...cappedAfter, storage: { ...cappedAfter.storage, bytes: cappedBefore.storage.bytes } }).toEqual(cappedBefore); expect(capped.receiver.calls).toHaveLength(cappedCalls);
    await captureReceipt("supervisor-cap", capped);
  });

  it("A17.preserve: pilot enable/disable/restart preserves real watch timers, four disabled definitions and offline coverage", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval"] });
    const timer = vi.spyOn(globalThis, "setTimeout"), cleared = vi.spyOn(globalThis, "clearTimeout"), interval = vi.spyOn(globalThis, "setInterval"), f = await pilot();
    const disabled = ["pr-watch", "remote-watch", "storage-sweep", "workspace-retention"];
    await mkdir(join(f.home, "watches"), { recursive: true });
    for (const name of disabled) {
      const path = join(f.home, "watches", name);
      await writeFile(path, "#!/usr/bin/env node\n// schedule: 15 2 * * *\n// retained fixture\n"); await chmod(path, 0o755);
    }
    await updateFirstmateConfig({ home: f.home, disabledWatches: disabled });
    const coverage = { hosts: [{ id: "local", online: true }, { id: "Light", online: false }], existingHeartbeat: { id: "unknown-existing", owner: null } };
    const coveragePath = join(f.home, "data", "coverage-fixture.json"); await writeFile(coveragePath, JSON.stringify(coverage));
    const run = vi.fn(async () => ({ code: 0, stdout: "", stderr: "", truncated: false, timedOut: false, spawnError: null })), deliver = vi.fn(async () => "wait" as const);
    const watches = new WatchRunner({ home: async () => f.home, disabled: async () => (await readFirstmateConfig()).disabledWatches,
      stateFile: join(f.home, "watch-state.json"), scriptStateRoot: join(f.home, "script-state"), run, deliver });
    const stop = watches.start();
    try {
      const handle = timer.mock.results.at(-1)!.value, timers = vi.getTimerCount(), config = digest(await readFirstmateConfig()), coverageHash = digest(await readFile(coveragePath, "utf8"));
      const definitions = await Promise.all(disabled.map(n => readFile(join(f.home, "watches", n), "utf8")));
      const { scope } = await f.owner(1, chain("preserve")); await f.finished(scope, "preserve-build");
      await f.lifecycle.wake(scope.id, "event"); await f.lifecycle.recover("restart");
      const disabledLifecycle = new SupervisionLifecycle(f.store, f.ingress, f.inbox, f.sessions, f.gateway);
      await expect(disabledLifecycle.wake(scope.id, "heartbeat")).rejects.toMatchObject({ code: "UNSUPPORTED" });
      expect(timer.mock.results.filter(r => r.value === handle)).toHaveLength(1); expect(vi.getTimerCount()).toBe(timers);
      expect(cleared.mock.calls.some(([value]) => value === handle)).toBe(false);
      expect(interval).not.toHaveBeenCalled(); expect(digest(await readFirstmateConfig())).toBe(config);
      expect(digest(await readFile(coveragePath, "utf8"))).toBe(coverageHash);
      expect(await Promise.all(disabled.map(n => readFile(join(f.home, "watches", n), "utf8")))).toEqual(definitions);
      await watches.tick(new Date(2026, 9, 26, 2, 15)); expect(run).not.toHaveBeenCalled(); expect(deliver).not.toHaveBeenCalled();
      expect(f.receiver.calls.filter(c => c.op === "createAgent")).toHaveLength(2); // Only the requested owner and worker; no heartbeat/cleaner replacement.
      receipts.push({ caseId: "timer-preservation", configHash: config, coverageHash, definitionHashes: definitions.map(d => digest(d)),
        existingTimerRetained: true, disabledRuns: run.mock.calls.length, legacySends: deliver.mock.calls.length, timers });
    } finally { stop(); timer.mockRestore(); cleared.mockRestore(); interval.mockRestore(); }
  });

  it("A19: metadata rejects prompt fields, duplicate denominators, false timing and synthetic provider-cost claims", () => {
    const m = metrics("scoped"), sample = { eventId: randomUUID(), scopeId: randomUUID(), observed: 10, committed: 11, offered: 20, acknowledged: null, handled: null, sourcePolls: 2 };
    m.samples.push(sample); m.captain.push({ id: randomUUID(), submitted: 1, admitted: 2, firstReply: null });
    expect(summarizePilotMetrics(m)).toMatchObject({ sourcePolls: 2, offer: { denominator: 1, measured: 1, p95Ms: 10 },
      handled: { measured: 0, missing: 1, p95Ms: null }, captainAdmission: { p95Ms: 1 }, captainFirstReply: { missing: 1 } });
    for (const bad of [{ ...m, prompt: "private" }, { ...m, samples: [sample, sample] }, { ...m, generalBusyMs: BUSY_MS + 1 },
      { ...m, samples: [{ ...sample, committed: 9 }] }, { ...m, samples: [{ ...sample, handled: 30 }] },
      { ...m, spend: { ...m.spend, providerTokens: 0 } }, { ...m, mode: "live" }]) expect(PilotMetricsSchema.safeParse(bad).success).toBe(false);
    expect(summarizePilotMetrics({ ...m, census: { ...m.census, coverage: "partial" } }).census.zeroRoutineOnCheckedRoute).toBe(false);
    expect(summarizePilotMetrics(metrics("scoped")).offer).toMatchObject({ denominator: 0, measured: 0, p95Ms: null });
  });
});
