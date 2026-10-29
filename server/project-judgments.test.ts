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
