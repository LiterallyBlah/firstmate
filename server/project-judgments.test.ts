import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { s04Fixture, captain } from "../test/supervision-s04-fixture";
import { ProjectJudgments } from "./project-judgments";
import { expectedFor } from "./supervision-effects";
import { policyRef } from "./supervision-policy";
import { digest } from "./submissions";
import type { SupervisionMutation } from "./supervision-store";
async function fixture() {
  const f = await s04Fixture(), plan = await f.addScope(1, "ordinary", ["build"]); await f.draft(plan, [{ id: "build" }], true);
  const scopeId = randomUUID(), id = randomUUID(), s = await f.store.read(), projectId = plan.projectId;
  const conflict = { id, version: 1, ownerScopeId: scopeId, kind: "scope" as const, projectIds: [projectId], subjects: [{ kind: "project" as const, id: projectId }],
    detail: "Choose the bounded project convention", detailDigest: digest("Choose the bounded project convention"), state: "open" as const, resolution: null };
  const mutations: SupervisionMutation[] = [{ kind: "scope", value: { id: scopeId, version: 1, homeId: s.homeId, kind: "project", projectIds: [projectId], sponsorId: null, mode: "scoped", state: "active" } },
    { kind: "binding", value: { scopeId, epoch: 1, hostId: "local", agentId: "project-owner", workspaceId: "project-workspace", profileDigest: "a".repeat(64), state: "active", checkpointHash: "a".repeat(64), acknowledgedSeq: 0, heartbeatDue: null } },
    { kind: "project", value: { id: projectId, version: 1, scopeId, name: plan.project, aliases: [], state: "admitted", budget: { agents: 6, turns: 6 }, sourceVector: [policyRef("policy-source", s.policySources[0]!)], provenance: captain } },
    { kind: "portfolio-conflict", value: conflict }]; await f.store.transact(expectedFor(s, mutations), randomUUID(), mutations);
  const blob = await f.store.putBlob(Buffer.from("Inspected exact project input and retained an evidenced judgment."));
  await f.store.transact(expectedFor(await f.store.read(), [{ kind: "blob", value: blob }]), randomUUID(), [{ kind: "blob", value: blob }]);
  return { ...f, scopeId, conflict, blob, judgments: new ProjectJudgments(f.store), owner: { kind: "agent" as const, id: "project-owner", source: "scope-helper/request-file" } };
}
it("relevant project input produces one exact logical-owner outbox; ordinary plan progress produces no summary cascade", async () => {
  const f = await fixture(); expect(await f.judgments.observe()).toEqual([f.scopeId]); expect(await f.judgments.observe()).toEqual([]);
  const s = await f.store.read(), outbox = s.outbox.find(o => o.ownerScopeId === f.scopeId)!;
  const request = { scopeId: f.scopeId, scopeVersion: 1, epoch: 1, outboxId: outbox.id, subjectHash: outbox.subjectHash, evidenceDigest: f.blob.id, summary: "Recorded project convention judgment" }, id = randomUUID();
  const receipt = await f.judgments.handle(id, request, f.owner); expect(await f.judgments.handle(id, request, f.owner)).toEqual(receipt);
  expect((await f.store.read()).outbox.find(o => o.id === outbox.id)?.state).toBe("handled"); expect(f.receiver.sends).toHaveLength(0);
  expect(await f.judgments.observe()).toEqual([]);
});
it("a source changed before judgment needs an explicit evidenced disposition and cannot strand the old input", async () => {
  const f = await fixture(); await f.judgments.observe(); const s = await f.store.read(), outbox = s.outbox.find(o => o.ownerScopeId === f.scopeId)!;
  const mutation = { kind: "portfolio-conflict" as const, value: { ...f.conflict, version: 2, state: "resolved" as const, resolution: { actor: captain, choice: "Resolved independently", at: new Date().toISOString() } } };
  await f.store.transact(expectedFor(s, [mutation]), randomUUID(), [mutation]);
  const input = { scopeId: f.scopeId, scopeVersion: 1, epoch: 1, outboxId: outbox.id, subjectHash: outbox.subjectHash, evidenceDigest: f.blob.id, summary: "Original input resolved; no current action" };
  await expect(f.judgments.handle(randomUUID(), input, f.owner)).rejects.toThrow("changed source");
  await f.judgments.handle(randomUUID(), { ...input, disposition: "source-changed" }, f.owner);
  expect((await f.store.read()).outbox.find(o => o.id === outbox.id)?.state).toBe("handled"); expect(await f.judgments.observe()).toEqual([]);
});

it("A05/A07/A11: only an explicit evidenced project exception enters C's shared inbox and checked answer outbox", async () => {
  const f = await fixture(); await f.judgments.observe();
  const before = await f.store.read(), input = before.outbox.find(o => o.ownerScopeId === f.scopeId)!;
  const { acceptPolicyInventory } = await import("./supervision-policy");
  const originalRule = before.policyRules[0]!;
  const policy = { ...originalRule, id: randomUUID(), selector: { ...originalRule.selector, scopeIds: [f.scopeId], planIds: [input.planId] }, operations: ["decision.answer" as const] };
  await expect(acceptPolicyInventory(f.store, f.home, randomUUID(), captain, { sources: [], rules: [{ ...policy, operations: ["model.use"] }] }, true)).rejects.toThrow("registered scoped ownership");
  await expect(acceptPolicyInventory(f.store, f.home, randomUUID(), captain, { sources: [], rules: [{ ...policy, selector: { ...policy.selector, planIds: ["project-neighbor"] } }] }, true)).rejects.toThrow("registered scoped ownership");
  await acceptPolicyInventory(f.store, f.home, randomUUID(), captain, { sources: [], rules: [policy] }, true);
  const question = { scopeId: f.scopeId, scopeVersion: 1, epoch: 1, outboxId: input.id, subjectHash: input.subjectHash, evidenceDigest: f.blob.id,
    summary: "Inspected the conflict; the proposed exception exceeds the existing project delegation.", captain: {
      title: "Project delegation exception", question: "Keep the current scope or review a new delegation?", reason: "The project owner cannot raise its delegated allocation.",
      options: [{ id: "keep-scope", label: "Keep the current delegation" }, { id: "review", label: "Review a separate delegation change" }], recommendation: "keep-scope" } };
  const id = randomUUID(); await expect(f.judgments.handle(id, question, { ...f.owner, id: "other-owner" })).rejects.toThrow("bound project owner");
  await f.judgments.handle(id, question, f.owner); await f.judgments.handle(id, question, f.owner);
  const { withScopedNeedsYou } = await import("./needs-you-service"), { needsYouSnapshot } = await import("./needs-you-ledger");
  const snapshot = () => needsYouSnapshot(null, { status: "fresh", checkedAt: Date.now(), asOf: Date.now(), problems: [] });
  const asked = await f.store.read(), row = withScopedNeedsYou(snapshot(), asked).scopedDecisions![0]!;
  expect(row.ready).toBe(true); expect(row.captain).toMatchObject({ format: "firstmate.scoped-captain-decision/1", scope: { kind: "project", id: f.scopeId }, origin: { kind: "project", id: f.conflict.projectIds[0] } });
  expect(row.captain!.options.map(o => o.number)).toEqual([1, 2]); expect(asked.backends).toHaveLength(before.backends.length);
  const { SupervisionCommands } = await import("./supervision-commands"), commands = new SupervisionCommands(f.store, f.home, { enabled: true, unverifiedUiAnswers: true });
  const { SupervisionStore } = await import("./supervision-store"), { join } = await import("node:path");
  const reread = await new SupervisionStore(join(f.home, "store"), f.home).read();
  expect(withScopedNeedsYou(snapshot(), reread).scopedDecisions![0]!.captain).toEqual(row.captain);
  const answer = { ...row.answerContext!, submissionId: randomUUID(), option: "keep-scope", text: "Retain the current delegation." };
  await expect(commands.answer(answer, f.owner)).rejects.toThrow("explicit captain");
  await commands.answerFromUnverifiedUi(answer); await commands.answerFromUnverifiedUi(answer);
  const answered = await f.store.read(), outbox = answered.outbox.find(o => o.kind === "decision.answer")!;
  expect(answered.decisions[0]!.answer!.provenance.kind).toBe("plugin-ui-unverified"); expect(answered.effects).toEqual(before.effects);
  await f.judgments.handle(randomUUID(), { scopeId: f.scopeId, scopeVersion: 1, epoch: 1, outboxId: outbox.id, subjectHash: outbox.subjectHash,
    evidenceDigest: f.blob.id, summary: "Retained the current project delegation as answered." }, f.owner);
  expect((await f.store.read()).outbox.find(o => o.id === outbox.id)!.state).toBe("handled"); expect(f.receiver.sends).toHaveLength(0);
  // Current source checks do not hide retained questions after a source change.
  const changed = { kind: "portfolio-conflict" as const, value: { ...f.conflict, version: 2, detail: "Changed delegation conflict", detailDigest: digest("Changed delegation conflict") } };
  await f.store.transact(expectedFor(await f.store.read(), [changed]), randomUUID(), [changed]);
  const stale = withScopedNeedsYou(snapshot(), await f.store.read()).scopedDecisions![0]!; expect(stale.ready).toBe(false); expect(stale.captain!.permittedActions).toEqual([]);
});

it("A05/A11: a pending project exception refuses a changed source and retains the original question", async () => {
  const f = await fixture(); await f.judgments.observe(); const s = await f.store.read(), outbox = s.outbox.find(o => o.ownerScopeId === f.scopeId)!;
  await f.judgments.handle(randomUUID(), { scopeId: f.scopeId, scopeVersion: 1, epoch: 1, outboxId: outbox.id, subjectHash: outbox.subjectHash,
    evidenceDigest: f.blob.id, summary: "Inspected a genuine delegation exception", captain: { title: "Delegation", question: "Keep scope or review delegation?", reason: "Outside the existing delegation",
      options: [{ id: "keep", label: "Keep" }, { id: "review", label: "Review" }], recommendation: "keep" } }, f.owner);
  const { scopeAnswerContext } = await import("./scope-answer-context"), { SupervisionCommands } = await import("./supervision-commands");
  const asked = await f.store.read(), decision = asked.decisions[0]!, answer = { ...scopeAnswerContext(asked, decision)!, submissionId: randomUUID(), option: "keep", text: "Keep" };
  const changed = { kind: "portfolio-conflict" as const, value: { ...f.conflict, version: 2, detail: "Changed scope", detailDigest: digest("Changed scope") } };
  await f.store.transact(expectedFor(asked, [changed]), randomUUID(), [changed]);
  await expect(new SupervisionCommands(f.store, f.home, { enabled: true }).answer(answer, captain)).rejects.toThrow("source or answer context changed");
  const after = await f.store.read(); expect(after.decisions[0]!.state).toBe("pending"); expect(after.outbox.filter(o => o.kind === "decision.answer")).toEqual([]);
});
