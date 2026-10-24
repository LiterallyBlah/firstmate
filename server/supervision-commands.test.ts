import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { beforeEach, expect, it } from "vitest";
import type { SupervisionActor } from "../shared/supervision";
import { PolicyRuleSchema, PolicySourceSchema, type PolicyRule } from "../shared/supervision-policy";
import { type WorkflowCommand } from "../shared/workflow-plans";
import { ids, expected, hash } from "../test/supervision-fixture";
import { workflowFixture } from "../test/workflow-fixture";
import { SupervisionStore, type SupervisionMutation } from "./supervision-store";
import { SupervisionCommands, scopedDecisionId, type ScopedPlanCommand, type ScopedAnswer } from "./supervision-commands";
import { acceptPolicyInventory, currentPolicyVector, policyRef } from "./supervision-policy";
import { planSubjectHash } from "./workflow-plans";
import { digest } from "./submissions";
import { answerScopedDecision } from "./decision-answer";
import { withScopedNeedsYou } from "./needs-you-service";
import { needsYouSnapshot } from "./needs-you-ledger";
import { NeedsYouSnapshotSchema } from "../shared/needs-you";

const captain: SupervisionActor = { kind: "captain-ui", id: "fixture-captain", source: "fixture/button/17" };
const mate: SupervisionActor = { kind: "agent", id: "fixture-owner", source: "fixture/scope-command" };
let home: string, store: SupervisionStore, commands: SupervisionCommands, sourceId: string, rule: PolicyRule;
const sha = (v: string) => createHash("sha256").update(v).digest("hex");
beforeEach(async () => {
  home = join(process.env.PASEO_HOME!, randomUUID());
  await mkdir(join(home, "data"), { recursive: true });
  for (const id of ["trial", "build", "scheduler"]) { await mkdir(join(home, "data", id)); await writeFile(join(home, "data", id, "brief.md"), "Synthetic checked brief."); }
  await writeFile(join(home, "data/orders.md"), "Pilot implementation and isolated tests only.\n");
  store = new SupervisionStore(join(home, "store"), home, { writable: true, processIdentity: async () => ({ state: "alive", start: "fixture-process" }) });
  await store.initialize(); await store.acquireCoordinator();
  const mutations: SupervisionMutation[] = [
    { kind: "scope", value: { id: ids.scope, homeId: store.homeId, kind: "plan", projectIds: [ids.project], sponsorId: null, version: 1, mode: "scoped", state: "active" } },
    { kind: "binding", value: { scopeId: ids.scope, epoch: 1, hostId: "local", agentId: mate.id, workspaceId: "independent-fixture-workspace", profileDigest: hash, state: "active", checkpointHash: hash, acknowledgedSeq: 0, heartbeatDue: null } },
    { kind: "backend", value: { planId: "scheduler", ownerScopeId: ids.scope, backend: "scoped", state: "active", sourceHash: null, version: 1 } },
    ...["trial", "build", "scheduler"].map(nodeId => ({ kind: "task" as const, value: { id: randomUUID(), ownerScopeId: ids.scope, planId: "scheduler", nodeId, projectId: ids.project, hostId: "local", version: 1, currentAttempt: null } })),
  ];
  await store.transact(expected(mutations), randomUUID(), mutations);
  sourceId = randomUUID();
  const source = PolicySourceSchema.parse({ id: sourceId, version: 1, path: "data/orders.md", lineStart: 1, lineEnd: 1,
    fileHash: sha("Pilot implementation and isolated tests only.\n"), excerptHash: sha("Pilot implementation and isolated tests only."), provenance: captain, supersedes: [] });
  rule = PolicyRuleSchema.parse({ id: randomUUID(), version: 1, sources: [policyRef("policy-source", source)],
    selector: { scopeIds: [ids.scope], projectIds: [ids.project], projectNames: { [ids.project]: "scheduler" }, hostIds: ["local"], planIds: ["scheduler"] },
    operations: ["plan.start", "plan.review", "plan.stop", "plan.record", "decision.answer", "model.use"], effect: "allow",
    constraints: { models: ["codex/gpt-6.1-sol"], profileDigests: [], requireApproval: false, requireHead: false, requireChecks: false, independentReviews: 0, requiredReviewIds: [], availability: "always" }, expiresAt: null, supersedes: [] });
  await acceptPolicyInventory(store, home, randomUUID(), captain, { sources: [source], rules: [rule] }, true);
  commands = new SupervisionCommands(store, home, { enabled: true });
});
async function input(command: WorkflowCommand): Promise<ScopedPlanCommand> {
  const s = await store.read(), p = s.plans.find(p => p.plan.definition.id === "scheduler")?.plan;
  const operation = command.op === "captain" ? command.action === "answer" ? "decision.answer" : ["hold", "decline"].includes(command.action) ? "plan.stop" : "plan.review" :
    ["start", "claim", "implicit"].includes(command.op) ? "plan.start" : ["record", "invalidate", "validate", "close", "ack"].includes(command.op) ? "plan.record" : "plan.review";
  const target = { scopeId: ids.scope, planId: "scheduler", projectIds: [ids.project], hostId: "local", operation } as const;
  const node = "node" in command ? p?.definition.nodes.find(n => n.id === command.node) : undefined;
  return { requestId: randomUUID(), homeId: store.homeId, scopeId: ids.scope, epoch: s.bindings[0]!.epoch, scopeVersion: s.scopes[0]!.version,
    expectedPlanHash: p?.hash ?? null, revision: p?.revision ?? 0, subjectHash: p ? planSubjectHash(p) : null, command,
    policyVector: currentPolicyVector(s, target), modelPolicyVector: currentPolicyVector(s, { ...target, operation: "model.use" }), evidenceVector: [],
    approvalId: null, head: null, artifactHash: null, briefHash: ["start", "claim", "implicit"].includes(command.op) ? sha("Synthetic checked brief.") : null,
    dependencyBindings: node?.after.map(e => { const owner = s.plans.find(p => p.plan.nodes[e.node])!.plan;
      return { homeId: s.homeId, planId: owner.definition.id, nodeId: e.node, outcome: e.on, planHash: owner.hash, revision: owner.revision, attemptId: owner.nodes[e.node]?.attempt ?? null }; }) ?? [] };
}
async function run(c: WorkflowCommand, actor = mate) { return commands.planCommand(await input(c), actor); }
async function draft(approve = true) {
  await run({ op: "draft", definition: workflowFixture() });
  if (approve) { const p = (await store.read()).plans[0]!.plan; await run({ op: "captain", plan: "scheduler", revision: p.revision, subjectHash: planSubjectHash(p), action: "approve", text: "Approve the bounded fixture plan." }, captain); }
}
async function decisionReady() {
  await draft();
  await run({ op: "start", plan: "scheduler", node: "trial" });
  const p = (await store.read()).plans[0]!.plan;
  await run({ op: "record", plan: "scheduler", node: "trial", attempt: p.nodes.trial!.attempt!, state: "done", evidence: "Verified synthetic report at fixture/report/17." });
}
async function answerInput(): Promise<ScopedAnswer> {
  const d = (await store.read()).decisions[0]!;
  const i = await input({ op: "captain", plan: "scheduler", revision: d.revision, subjectHash: d.subjectHash, action: "answer", node: d.nodeId, option: "sqlite", text: "Choose SQLite." });
  const { command: _c, requestId, ...base } = i;
  return { ...base, submissionId: requestId, decisionId: d.id, option: "sqlite", text: "Choose SQLite." };
}
async function ownerResult(outboxId: string, actor = mate) {
  const before = (await store.read()).outbox.length;
  const i = await input({ op: "ack", plan: "scheduler", kind: "handled", ids: [outboxId] });
  await commands.planCommand(i, actor); expect((await store.read()).outbox).toHaveLength(before); return `command:${i.requestId}`;
}
async function files() {
  const names = (await readdir(join(store.root, "transactions"))).sort();
  return Promise.all(names.map(async n => [n, await readFile(join(store.root, "transactions", n), "utf8")]));
}
async function changeRule(change: Partial<PolicyRule>) {
  const s = await store.read(), old = s.policyRules.find(r => r.id === rule.id)!;
  rule = { ...old, ...change, version: old.version + 1 };
  await acceptPolicyInventory(store, home, randomUUID(), captain, { sources: [], rules: [rule] }, true);
}
async function reviewHolds() {
  const s = await store.read();
  await acceptPolicyInventory(store, home, randomUUID(), captain, { sources: [], rules: [], reviewedHolds: s.operationHolds.filter(h => h.state === "held").map(({ id, version }) => ({ id, version })) }, true);
}
async function evidence(i: ScopedPlanCommand, changes: Record<string, unknown> = {}) {
  const value = { id: randomUUID(), version: 1, scopeId: ids.scope, subjectHash: i.subjectHash!, head: i.head, artifactHash: i.artifactHash,
    checks: "passed" as const, reviews: [], availability: "unknown" as const, sourceDigest: hash, ...changes };
  const mutations: SupervisionMutation[] = [{ kind: "policy-evidence", value } as SupervisionMutation];
  await store.transact(expected(mutations), randomUUID(), mutations);
  i.evidenceVector = [policyRef("policy-evidence", value)]; return value;
}
it("is unwired by default and source acceptance rejects model/worker provenance", async () => {
  const i = await input({ op: "draft", definition: workflowFixture() }), before = await files();
  await expect(new SupervisionCommands(store, home).planCommand(i, mate)).rejects.toMatchObject({ code: "UNSUPPORTED" });
  await expect(acceptPolicyInventory(store, home, randomUUID(), mate, { sources: [], rules: [rule] }, true)).rejects.toMatchObject({ code: "UNSUPPORTED" });
  expect(await files()).toEqual(before);
});
it("reuses workflow review, dependency readiness and cumulative start budget", async () => {
  await draft(false);
  await expect(run({ op: "start", plan: "scheduler", node: "trial" })).rejects.toThrow(/held/);
  const p = (await store.read()).plans[0]!.plan;
  await expect(run({ op: "captain", plan: "scheduler", revision: p.revision, subjectHash: planSubjectHash(p), action: "answer", node: "database", option: "sqlite", text: "Too soon" }, captain)).rejects.toThrow(/not ready/);
  await run({ op: "captain", plan: "scheduler", revision: p.revision, subjectHash: planSubjectHash(p), action: "approve", text: "Approve." }, captain);
  await run({ op: "start", plan: "scheduler", node: "trial" });
  await expect(run({ op: "start", plan: "scheduler", node: "trial" })).rejects.toThrow(/already started/);
  expect((await store.read()).plans[0]!.plan.nodes.trial?.spent).toBe(1);
});
it.each(["revision", "expectedPlanHash", "subjectHash", "briefHash"] as const)("refuses stale %s without writing", async field => {
  await draft(); const i = await input({ op: "start", plan: "scheduler", node: "trial" });
  if (field === "revision") i.revision++; else i[field] = "0".repeat(64);
  const before = await files(); await expect(commands.planCommand(i, mate)).rejects.toMatchObject({ code: "STALE" }); expect(await files()).toEqual(before);
});
it("accepted replay returns original receipt after source/policy/epoch changes and after disabling writes", async () => {
  await draft(); const i = await input({ op: "start", plan: "scheduler", node: "trial" }), receipt = await commands.planCommand(i, mate);
  await changeRule({ effect: "deny" }); await writeFile(join(home, "data/orders.md"), "Changed policy source.\n");
  expect(await new SupervisionCommands(store, home).planCommand(i, mate)).toEqual(receipt);
  await expect(commands.planCommand({ ...i, head: "b".repeat(40) }, mate)).rejects.toMatchObject({ code: "CONFLICT" });
  expect((await store.read()).plans[0]!.plan.nodes.trial?.spent).toBe(1);
});
it("source drift and conflicting policy hold only new admissions", async () => {
  await draft(); const i = await input({ op: "start", plan: "scheduler", node: "trial" });
  await writeFile(join(home, "data/orders.md"), "Changed source.\n");
  await expect(commands.planCommand(i, mate)).rejects.toMatchObject({ code: "STALE" });
  expect((await store.read()).plans[0]!.plan.nodes.trial?.state).toBe("planned");
});
it("two devices commit one revision/subject-bound answer and one durable outbox", async () => {
  await decisionReady(); const a = await answerInput(), b = { ...a, submissionId: randomUUID(), option: "postgres" };
  const results = await Promise.allSettled([answerScopedDecision(commands, a, captain), answerScopedDecision(commands, b, captain)]);
  expect(results.filter(r => r.status === "fulfilled")).toHaveLength(1);
  expect((results.find(r => r.status === "rejected") as PromiseRejectedResult).reason.code).toBe("STALE");
  const s = await new SupervisionStore(join(home, "store"), home).read();
  expect(s.decisions[0]!.answer?.submissionId).toBe(a.submissionId);
  expect(s.outbox.filter(o => o.kind === "decision.answer")).toHaveLength(1);
  expect(await answerScopedDecision(commands, a, captain)).toEqual((results[0] as PromiseFulfilledResult<unknown>).value);
  expect((await commands.pending()).find(o => o.entry.kind === "decision.answer")?.binding?.agentId).toBe(mate.id);
});
it("an answer commits during transfer, survives lost delivery and is consumed only at the new epoch", async () => {
  await decisionReady(); const a = await answerInput(), s = await store.read();
  const hold: SupervisionMutation[] = [{ kind: "scope", value: { ...s.scopes[0]!, state: "transferring", version: 2 } },
    { kind: "binding", value: { ...s.bindings[0]!, state: "suspect" } }];
  await store.transact(expected(hold, 1), randomUUID(), hold);
  const receipt = await commands.answer(a, captain);
  expect((await commands.pending()).find(o => o.entry.id === a.submissionId)?.binding).toBeNull();
  const prepared: SupervisionMutation[] = [{ kind: "binding", value: { ...s.bindings[0]!, epoch: 2, state: "prepared", agentId: "replacement" } }];
  await store.transact(expected(prepared, 2), randomUUID(), prepared);
  const active: SupervisionMutation[] = [{ kind: "scope", value: { ...s.scopes[0]!, state: "active", version: 3 } }, { kind: "binding", value: { ...s.bindings[0]!, epoch: 2, state: "active", agentId: "replacement" } }];
  await store.transact(expected(active).map(r => ({ ...r, version: r.kind === "scope" ? 2 : 3 })), randomUUID(), active);
  expect(await commands.answer(a, captain)).toEqual(receipt);
  const ack = { requestId: randomUUID(), scopeId: ids.scope, scopeVersion: 3, epoch: 1, outboxId: a.submissionId, resultRef: "fixture/consequence/1" };
  await expect(commands.acknowledge(ack, mate)).rejects.toMatchObject({ code: "STALE" });
  expect((await commands.pending()).find(o => o.entry.id === a.submissionId)?.binding?.agentId).toBe("replacement");
  await expect(commands.acknowledge({ ...ack, requestId: randomUUID(), epoch: 2 }, { ...mate, id: "replacement" })).rejects.toMatchObject({ code: "HELD" });
  const resultRef = await ownerResult(a.submissionId, { ...mate, id: "replacement" });
  await commands.acknowledge({ ...ack, requestId: randomUUID(), epoch: 2, resultRef }, { ...mate, id: "replacement" });
  expect((await store.read()).outbox.find(o => o.id === a.submissionId)).toMatchObject({ state: "handled", handledEpoch: 2, resultRef });
});
it("changed question refuses an old draft and UI/chat provenance cannot share a replay identity", async () => {
  await decisionReady(); const a = await answerInput();
  const p = (await store.read()).plans[0]!.plan;
  await run({ op: "revise", definition: { ...p.definition, title: "New subject" }, expected: p.hash, reason: "Captain changed the question." });
  await expect(commands.answer(a, captain)).rejects.toMatchObject({ code: "STALE" });
  const current = await answerInput();
  // Revision returns to review; approve before answering.
  const changed = (await store.read()).plans[0]!.plan;
  await run({ op: "captain", plan: "scheduler", revision: changed.revision, subjectHash: planSubjectHash(changed), action: "approve", text: "Approve changed scope." }, captain);
  const ready = await answerInput(); await commands.answer(ready, captain);
  await expect(commands.answer(ready, { kind: "mate-chat", id: mate.id, source: "fixture/chat/quote" })).rejects.toMatchObject({ code: "CONFLICT" });
  expect(a.text).toBe(current.text);
});
it("stop races admission atomically and preserves already dispatching effects", async () => {
  await draft(); const s = await store.read();
  const effects: SupervisionMutation[] = ["reserved", "dispatching"].map((state, n) => ({ kind: "effect", value: { id: randomUUID(), logicalKey: `fixture/effect/${n}`, requestId: randomUUID(), requestHash: hash,
    scopeId: ids.scope, epoch: 1, attemptId: null, operation: "fixture.create", planRevision: 1, subjectHash: hash, policyVector: [], evidenceVector: [], approvalId: null,
    resourceIds: [`fixture/resource/${n}`], state: state as "reserved" | "dispatching", receiverKey: null, receiptRef: null, version: 1 } }));
  await store.transact(expected(effects), randomUUID(), effects);
  const p = s.plans[0]!.plan, stop = await input({ op: "captain", plan: "scheduler", revision: p.revision, subjectHash: planSubjectHash(p), action: "hold", text: "Stop now." }), start = await input({ op: "start", plan: "scheduler", node: "trial" });
  const results = await Promise.allSettled([commands.planCommand(stop, captain), commands.planCommand(start, mate)]);
  expect(results[0]!.status).toBe("fulfilled"); expect(results[1]!.status).toBe("rejected");
  const after = await store.read(); expect(after.effects.map(e => e.state)).toEqual(["cancelled", "dispatching"]);
  expect(after.effects[1]!.resourceIds).toEqual(["fixture/resource/1"]); expect(after.operationHolds).toHaveLength(1);
});
it("exact task host/project and active epoch cannot be borrowed", async () => {
  await draft(); const i = await input({ op: "start", plan: "scheduler", node: "trial" });
  await expect(commands.planCommand({ ...i, scopeId: randomUUID() }, mate)).rejects.toMatchObject({ code: "UNKNOWN_OWNER" });
  await expect(commands.planCommand({ ...i, epoch: 2 }, mate)).rejects.toMatchObject({ code: "STALE" });
  await expect(commands.planCommand(i, { ...mate, id: "neighbor" })).rejects.toMatchObject({ code: "UNKNOWN_OWNER" });
  expect(scopedDecisionId(ids.scope, "scheduler", "database")).not.toBe(scopedDecisionId(ids.scope, "other", "database"));
});
it("Needs-you composition is read-only and Coming up contributes no action", async () => {
  await draft(); const before = await files();
  const base = { ...needsYouSnapshot(null, { status: "fresh", checkedAt: Date.now(), asOf: Date.now(), problems: [] }), homeId: store.homeId, actionCount: 0, pendingAnswerCount: 0 };
  const future = withScopedNeedsYou(base, await store.read());
  expect(future.actionCount).toBe(0); expect(future.scopedDecisions?.[0]?.ready).toBe(false);
  expect(NeedsYouSnapshotSchema.parse(future)).toEqual(future); expect(await files()).toEqual(before);
});
it("approval binds exact head/check/review versions; accepted history survives later red CI", async () => {
  await draft();
  await changeRule({ constraints: { ...rule.constraints, requireApproval: true, requireHead: true, requireChecks: true, independentReviews: 1, requiredReviewIds: ["independent-1"] } });
  await reviewHolds();
  const i = await input({ op: "start", plan: "scheduler", node: "trial" }); i.head = "a".repeat(40); i.artifactHash = hash;
  const e = await evidence(i, { reviews: [{ id: "independent-1", reviewerId: "reviewer", authorId: "builder", head: i.head, outcome: "accepted", sourceDigest: hash }] });
  const approval = { ...i, requestId: randomUUID() }; await commands.approve(approval, captain); i.approvalId = approval.requestId;
  const changed: SupervisionMutation[] = [{ kind: "policy-evidence", value: { ...e, head: "b".repeat(40), version: 2 } as any }];
  await store.transact(expected(changed, 1), randomUUID(), changed);
  await expect(commands.planCommand(i, mate)).rejects.toMatchObject({ code: "STALE" });
  const current = await input({ op: "start", plan: "scheduler", node: "trial" }); current.head = "b".repeat(40); current.artifactHash = hash;
  const s = await store.read(), e2 = s.policyEvidence[0]!;
  current.evidenceVector = [policyRef("policy-evidence", e2)]; current.approvalId = approval.requestId;
  await expect(commands.planCommand(current, mate)).rejects.toThrow(/review evidence/);
  const verified: SupervisionMutation[] = [{ kind: "policy-evidence", value: { ...e2, version: 3, reviews: e2.reviews.map(r => ({ ...r, head: current.head! })) } }];
  await store.transact(expected(verified, 2), randomUUID(), verified);
  current.evidenceVector = [policyRef("policy-evidence", (await store.read()).policyEvidence[0]!)];
  await expect(commands.planCommand(current, mate)).rejects.toMatchObject({ code: "STALE" }); // Old approval cannot authorize the new head.
  const nextApproval = { ...current, requestId: randomUUID() }; await commands.approve(nextApproval, captain); current.approvalId = nextApproval.requestId;
  const accepted = await commands.planCommand(current, mate);
  const e3 = (await store.read()).policyEvidence[0]!, red: SupervisionMutation[] = [{ kind: "policy-evidence", value: { ...e3, version: 4, checks: "failed" } }];
  await store.transact(expected(red, 3), randomUUID(), red);
  expect(await commands.planCommand(current, mate)).toEqual(accepted);
  expect((await store.read()).plans[0]!.plan.nodes.trial?.state).toBe("starting");
});
it("duplicate reviewer observations are not independent reviews and red/unknown checks refuse", async () => {
  await draft(); await changeRule({ constraints: { ...rule.constraints, requireChecks: true, independentReviews: 2 } }); await reviewHolds();
  const i = await input({ op: "start", plan: "scheduler", node: "trial" }); i.head = "a".repeat(40);
  const review = { id: "review-1", reviewerId: "same-reviewer", authorId: "builder", head: i.head, outcome: "accepted", sourceDigest: hash };
  const e = await evidence(i, { reviews: [review, { ...review, id: "duplicate-source-observation" }] });
  await expect(commands.planCommand(i, mate)).rejects.toThrow(/Independent review/);
  const red: SupervisionMutation[] = [{ kind: "policy-evidence", value: { ...e, version: 2, checks: "failed" } as any }];
  await store.transact(expected(red, 1), randomUUID(), red); i.evidenceVector = [policyRef("policy-evidence", (await store.read()).policyEvidence[0]!)];
  await expect(commands.planCommand(i, mate)).rejects.toThrow(/checks are failing/);
});
it("source updates publish operation holds, require deliberate review, and never widen model fallback", async () => {
  await draft(); const old = (await store.read()).policySources[0]!;
  const text = "Captain changed the bounded fixture policy."; await writeFile(join(home, "data/orders.md"), text + "\n");
  const source = { ...old, version: 2, fileHash: sha(text + "\n"), excerptHash: sha(text) };
  const modelProfile = workflowFixture().nodes.find(n => n.kind === "run")!;
  if (modelProfile.kind !== "run") throw new Error("fixture");
  const revised = { ...rule, version: 2, sources: [policyRef("policy-source", source)], constraints: { ...rule.constraints,
    availability: "opus-quota" as const, profileDigests: [digest(modelProfile.launch.agent)] } };
  await acceptPolicyInventory(store, home, randomUUID(), captain, { sources: [source], rules: [revised] }, true); rule = revised;
  const s = await store.read(); expect(s.operationHolds.filter(h => h.state === "held")).toHaveLength(1);
  const i = await input({ op: "start", plan: "scheduler", node: "trial" });
  await expect(commands.planCommand(i, mate)).rejects.toMatchObject({ code: "HELD" });
  await reviewHolds(); await expect(commands.planCommand(i, mate)).rejects.toThrow(/unavailability evidence/);
  await evidence(i, { availability: "opus-quota" });
  await commands.planCommand(i, mate);
  expect((await store.read()).approvals).toHaveLength(0); // Valid existing grant requires no repeated question.
});
it("release operations are outside the pilot command and approval vocabulary", async () => {
  await draft(); const i = await input({ op: "start", plan: "scheduler", node: "trial" });
  await expect(commands.planCommand({ ...i, command: { op: "deploy" } as any }, mate)).rejects.toThrow();
  await expect(commands.planCommand({ ...i, command: { op: "release", plan: "scheduler", node: "trial", attempt: randomUUID(), evidence: "No lifecycle adapter qualified." } }, mate)).rejects.toMatchObject({ code: "UNSUPPORTED" });
  await expect(commands.approve({ ...i, command: { op: "release", plan: "scheduler", node: "trial", attempt: randomUUID(), evidence: "No lifecycle adapter qualified." } }, captain)).rejects.toMatchObject({ code: "UNSUPPORTED" });
});
it("a publication interruption exposes neither half of an answer and exact recovery spends nothing twice", async () => {
  await decisionReady(); const a = await answerInput(); await store.releaseCoordinator();
  let armed = true;
  const recovered = new SupervisionStore(join(home, "store"), home, { writable: true,
    processIdentity: async () => ({ state: "alive", start: "fixture-process" }),
    boundary: async name => { if (armed && name === "event:linked") { armed = false; throw new Error("Synthetic crash after answer event link."); } } });
  await recovered.acquireCoordinator(); const adapter = new SupervisionCommands(recovered, home, { enabled: true });
  await expect(adapter.answer(a, captain)).rejects.toMatchObject({ code: "HELD" });
  const held = await recovered.read(); expect(held.freshness).toBe("held"); expect(held.decisions[0]!.answer).toBeNull();
  expect(held.outbox.filter(o => o.kind === "decision.answer")).toHaveLength(0);
  const receipt = await recovered.recoverPublication(); const reply = await adapter.answer(a, captain);
  expect(reply.receipt).toEqual(receipt); expect((await recovered.read()).outbox.filter(o => o.kind === "decision.answer")).toHaveLength(1);
  expect((await recovered.read()).plans[0]!.plan.nodes.trial?.spent).toBe(1);
});
it("shared Needs-you counts holds once and composition remains stable through answer handling", async () => {
  await decisionReady(); const a = await answerInput();
  const base = { ...needsYouSnapshot(null, { status: "fresh", checkedAt: Date.now(), asOf: Date.now(), problems: [] }), homeId: store.homeId, actionCount: 0, pendingAnswerCount: 0 };
  const due = withScopedNeedsYou(base, await store.read()); expect(due.actionCount).toBe(1);
  expect(withScopedNeedsYou(due, await store.read()).actionCount).toBe(1);
  await commands.answer(a, captain); const answered = withScopedNeedsYou(due, await store.read());
  expect(answered.actionCount).toBe(0); expect(answered.pendingAnswerCount).toBe(1);
  const resultRef = await ownerResult(a.submissionId);
  await commands.acknowledge({ requestId: randomUUID(), scopeId: ids.scope, scopeVersion: 1, epoch: 1, outboxId: a.submissionId, resultRef }, mate);
  const handled = withScopedNeedsYou(answered, await store.read()); expect(handled.pendingAnswerCount).toBe(0);
  await changeRule({ effect: "deny" }); const hold = withScopedNeedsYou(handled, await store.read());
  expect(hold.actionCount).toBe(1); expect(hold.scopedHolds).toHaveLength(1);
});
it("captain UI and mate-recorded chat preserve different author sources", async () => {
  await draft(false); const p = (await store.read()).plans[0]!.plan;
  const chat: SupervisionActor = { kind: "mate-chat", id: mate.id, source: "captain/message/quoted-42" };
  await run({ op: "captain", plan: "scheduler", revision: p.revision, subjectHash: planSubjectHash(p), action: "approve", text: "Captain said: approve this fixture." }, chat);
  const s = await store.read(); expect(s.commands.at(-1)!.actor).toEqual(chat);
  expect(s.plans[0]!.plan.captainEvents?.[0]?.by).toContain("mate-chat:fixture-owner:captain/message/quoted-42");
  expect(s.commands.find(c => c.actor.kind === "captain-ui")?.actor).toEqual(captain); // Policy acceptance is separately identified.
});
it("automatic one-run commands use the existing reducer and replay the same pinned attempt", async () => {
  const n = workflowFixture().nodes[0]!; if (n.kind !== "run") throw new Error("fixture");
  const launch = { ...n.launch, id: "scheduler", brief: { file: "data/scheduler/brief.md" }, kind: "scout" as const };
  const i = await input({ op: "implicit", launch }), accepted = await commands.planCommand(i, mate);
  expect(await commands.planCommand(i, mate)).toEqual(accepted);
  const p = (await store.read()).plans[0]!.plan;
  expect(p.definition.implicit).toBe(true); expect(p.definition.nodes).toHaveLength(1);
  expect(p.nodes.scheduler).toMatchObject({ state: "starting", claimed: true, spent: 1, briefHash: sha("Synthetic checked brief.") });
  await expect(run({ op: "implicit", launch })).rejects.toThrow(/Duplicate plan creation/);
  expect((await store.read()).plans[0]!.plan.nodes.scheduler?.spent).toBe(1);
});
it("a stop ordered after admission retains the admitted attempt and requires a fresh review", async () => {
  await draft(); const p = (await store.read()).plans[0]!.plan;
  const start = await input({ op: "start", plan: "scheduler", node: "trial" }), stop = await input({ op: "captain", plan: "scheduler", revision: p.revision, subjectHash: planSubjectHash(p), action: "hold", text: "Stop after admission." });
  const results = await Promise.allSettled([commands.planCommand(start, mate), commands.planCommand(stop, captain)]);
  expect(results[0]!.status).toBe("fulfilled"); expect(results[1]!.status).toBe("rejected");
  const admitted = (await store.read()).plans[0]!.plan;
  await run({ op: "captain", plan: "scheduler", revision: admitted.revision, subjectHash: planSubjectHash(admitted), action: "hold", text: "Stop new admissions; retain current work." }, captain);
  const held = (await store.read()).plans[0]!.plan;
  expect(held.status).toBe("held"); expect(held.nodes.trial).toMatchObject({ state: "starting", spent: 1, attempt: admitted.nodes.trial!.attempt });
});
it("the policy's project alias and host selectors refuse borrowed task names", async () => {
  const definition = workflowFixture(), n = definition.nodes[0]!; if (n.kind !== "run") throw new Error("fixture");
  n.launch.project = "neighbor-project";
  await expect(run({ op: "draft", definition })).rejects.toMatchObject({ code: "UNKNOWN_OWNER" });
  n.launch.project = "scheduler"; n.launch.host = "other-host";
  await expect(run({ op: "draft", definition })).rejects.toMatchObject({ code: "UNKNOWN_OWNER" });
});
it("stale policy in one project does not hold an unrelated scoped project", async () => {
  await draft(); const s = await store.read(), otherScope = randomUUID(), otherProject = randomUUID(), task = randomUUID();
  const seed: SupervisionMutation[] = [
    { kind: "scope", value: { ...s.scopes[0]!, id: otherScope, projectIds: [otherProject], version: 1 } },
    { kind: "binding", value: { ...s.bindings[0]!, scopeId: otherScope, agentId: "other-owner" } },
    { kind: "backend", value: { ...s.backends[0]!, planId: "other-plan", ownerScopeId: otherScope } },
    { kind: "task", value: { id: task, ownerScopeId: otherScope, planId: "other-plan", nodeId: "other-task", projectId: otherProject, hostId: "local", version: 1, currentAttempt: null } },
  ];
  await store.transact(expected(seed), randomUUID(), seed);
  await writeFile(join(home, "data/other-orders.md"), "Other project's independent test grant.\n");
  const source = { ...s.policySources[0]!, id: randomUUID(), path: "data/other-orders.md", fileHash: sha("Other project's independent test grant.\n"), excerptHash: sha("Other project's independent test grant.") };
  const grant = { ...rule, id: randomUUID(), sources: [policyRef("policy-source", source)], selector: { scopeIds: [otherScope], projectIds: [otherProject], projectNames: { [otherProject]: "other" }, hostIds: ["local"], planIds: ["other-plan"] } };
  await acceptPolicyInventory(store, home, randomUUID(), captain, { sources: [source], rules: [grant] }, true);
  await writeFile(join(home, "data/orders.md"), "Changed the first project's policy.\n");
  await expect(run({ op: "start", plan: "scheduler", node: "trial" })).rejects.toMatchObject({ code: "STALE" });
  const n = workflowFixture().nodes[0]!; if (n.kind !== "run") throw new Error("fixture");
  const definition = { ...workflowFixture(), id: "other-plan", nodes: [{ ...n, id: "other-task", launch: { ...n.launch, id: "other-task", project: "other", brief: { file: "data/other-task/brief.md" } } }] };
  const i = await input({ op: "draft", definition }), target = { scopeId: otherScope, planId: "other-plan", projectIds: [otherProject], hostId: "local", operation: "plan.review" as const };
  const current = await store.read();
  const response = await commands.planCommand({ ...i, scopeId: otherScope, expectedPlanHash: null, revision: 0, subjectHash: null,
    policyVector: currentPolicyVector(current, target), modelPolicyVector: currentPolicyVector(current, { ...target, operation: "model.use" }) }, { ...mate, id: "other-owner" });
  expect(response.result.planId).toBe("other-plan"); expect((await store.read()).plans).toHaveLength(2);
});
