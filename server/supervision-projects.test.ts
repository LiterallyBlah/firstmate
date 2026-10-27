import { createHash, randomUUID } from "node:crypto";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { beforeEach, expect, it, vi } from "vitest";
import type { SupervisionActor, SupervisionStatus } from "../shared/supervision";
import { PolicyRuleSchema, PolicySourceSchema, type PolicySource } from "../shared/supervision-policy";
import { PlanDefinitionSchema, type WorkflowCommand } from "../shared/workflow-plans";
import { portfolioSummary } from "../shared/supervision-projects";
import { compactPortfolioBearings } from "../shared/workflow-plan-summary";
import { bearingsOverview } from "../shared/bearings";
import { workflowFixture } from "../test/workflow-fixture";
import { expected, hash } from "../test/supervision-fixture";
import { SupervisionError, SupervisionStore, type SupervisionMutation } from "./supervision-store";
import { acceptPolicyInventory, checkPolicy, currentPolicyVector, policyRef, type PolicyAdmission } from "./supervision-policy";
import { dependencyState, qualifiedDependencies, SupervisionProjects } from "./supervision-projects";
import { projectMemory, SupervisionMemory } from "./supervision-memory";
import { intentId, memoryId } from "./supervision-project-state";
import { WorkflowPlanStore } from "./workflow-plans";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const A = id(0xa1), B = id(0xb1), G = id(0x60), PA = id(0x7a), PB = id(0x7b), X = id(0x8c), Z = id(0x8b);
const captain: SupervisionActor = { kind: "captain-ui", id: "fixture-captain", source: "fixture/button/9" };
const general: SupervisionActor = { kind: "agent", id: "general-mate", source: "fixture/general" };
const projectA: SupervisionActor = { kind: "agent", id: "project-a-mate", source: "fixture/project-a" };
const projectB: SupervisionActor = { kind: "agent", id: "project-b-mate", source: "fixture/project-b" };
const worker: SupervisionActor = { kind: "agent", id: "worker-17", source: "fixture/worker-report" };
const sha = (v: string) => createHash("sha256").update(v).digest("hex");
const code = (p: Promise<unknown>) => p.then(() => "committed", (e: unknown) => e instanceof SupervisionError ? e.code : String(e));
let home: string, store: SupervisionStore, projects: SupervisionProjects, memory: SupervisionMemory, source: PolicySource;

beforeEach(async () => {
  home = join(process.env.PASEO_HOME!, randomUUID());
  for (const dir of ["trial", "build", "wire"]) { await mkdir(join(home, "data", dir), { recursive: true }); await writeFile(join(home, "data", dir, "brief.md"), "Synthetic brief."); }
  await writeFile(join(home, "data/backlog.md"), "## In flight\n## Queued\n## Done\n");
  await writeFile(join(home, "data/orders.md"), "Pilot implementation and isolated tests only.\n");
  store = new SupervisionStore(join(home, "store"), home, { writable: true, processIdentity: async () => ({ state: "alive", start: "fixture-process" }) });
  await store.initialize(); await store.acquireCoordinator();
  const scope = (scopeId: string, kind: "general" | "project" | "plan", projectIds: string[]) =>
    ({ kind: "scope" as const, value: { id: scopeId, homeId: store.homeId, kind, projectIds, sponsorId: null, version: 1, mode: "scoped" as const, state: "active" as const } });
  const binding = (scopeId: string, agentId: string) => ({ kind: "binding" as const, value: { scopeId, epoch: 1, hostId: "local", agentId,
    workspaceId: `workspace-${agentId}`, profileDigest: hash, state: "active" as const, checkpointHash: hash, acknowledgedSeq: 0, heartbeatDue: null } });
  const setup: SupervisionMutation[] = [scope(G, "general", []), scope(PA, "project", [A]), scope(PB, "project", [B]), scope(X, "plan", [A, B]), scope(Z, "plan", [B]),
    binding(G, general.id), binding(PA, projectA.id), binding(PB, projectB.id)];
  await store.transact(expected(setup), randomUUID(), setup);
  // Two real plans through the existing legacy reducer, mirrored byte-for-byte: `upstream` (project B, scope Z)
  // and the cross-project `integrate` (scope X), whose `wire` run needs upstream's `build` (a bare v1 edge).
  const legacy = new WorkflowPlanStore(join(home, "legacy"), home);
  const upstream = PlanDefinitionSchema.parse({ ...workflowFixture(), id: "upstream", title: "Upstream" });
  const wire = { kind: "run", id: "wire", title: "Wire it in", summary: "Integrate the scheduler.", workflow: "task@1", after: [{ node: "build", reason: "builds-on", on: "done" }],
    launch: { ...(upstream.nodes.find(n => n.id === "build") as Extract<(typeof upstream.nodes)[number], { kind: "run" }>).launch, id: "wire", agentTitle: "wire", project: "integration", brief: { file: "data/wire/brief.md" } } };
  const integrate = PlanDefinitionSchema.parse({ ...workflowFixture(), id: "integrate", title: "Integrate", budget: { agents: 1, turns: 1 }, nodes: [wire] });
  for (const definition of [upstream, integrate]) await legacy.execute({ op: "draft", definition } as WorkflowCommand, randomUUID(), "fixture-mate");
  for (const [planId, scopeId] of [["upstream", Z], ["integrate", X]] as const) {
    const dir = join(legacy.root, planId), names = (await readdir(dir)).filter(n => /^\d{8}\.json$/.test(n)).sort();
    for (const [i, name] of names.entries()) {
      const event: SupervisionMutation = { kind: "workflow", scopeId, event: JSON.parse(await readFile(join(dir, name), "utf8")) };
      const m: SupervisionMutation[] = i ? [event] : [{ kind: "backend", value: { planId, ownerScopeId: scopeId, backend: "scoped", state: "active", sourceHash: null, version: 1 } }, event];
      await store.transact(expected(m).map(r => ({ ...r, version: r.kind === "workflow" ? i : 0 })), randomUUID(), m);
    }
  }
  source = PolicySourceSchema.parse({ id: randomUUID(), version: 1, path: "data/orders.md", lineStart: 1, lineEnd: 1,
    fileHash: sha("Pilot implementation and isolated tests only.\n"), excerptHash: sha("Pilot implementation and isolated tests only."), provenance: captain, supersedes: [] });
  const rule = (scopeId: string, planId: string, projectIds: string[]) => PolicyRuleSchema.parse({ id: randomUUID(), version: 1, sources: [policyRef("policy-source", source)],
    selector: { scopeIds: [scopeId], projectIds, projectNames: Object.fromEntries(projectIds.map(p => [p, p === A ? "alpha" : "beta"])), hostIds: ["local"], planIds: [planId] },
    operations: ["plan.start", "plan.record"], effect: "allow",
    constraints: { models: [], profileDigests: [], requireApproval: false, requireHead: false, requireChecks: false, independentReviews: 0, requiredReviewIds: [], availability: "always" }, expiresAt: null, supersedes: [] });
  // The cross-project plan has a grant from alpha only; beta's own plan has its own grant.
  await acceptPolicyInventory(store, home, randomUUID(), captain, { sources: [source], rules: [rule(X, "integrate", [A]), rule(Z, "upstream", [B])] }, true);
  projects = new SupervisionProjects(store, { enabled: true, now: () => "2026-10-27T12:00:00Z" });
  memory = new SupervisionMemory(store, { enabled: true, now: () => "2026-10-27T12:00:00Z" });
  for (const [projectId, scopeId, name, agents] of [[A, PA, "alpha", 2], [B, PB, "beta", 1]] as const)
    await projects.recordProject(randomUUID(), captain, { projectId, expectedVersion: 0, scopeId, name, aliases: [], state: "admitted", budget: { agents, turns: agents }, sourceVector: [policyRef("policy-source", source)] });
});
const admission = (status: SupervisionStatus, scopeId: string, planId: string, projectIds: string[]): PolicyAdmission => {
  const target = { scopeId, planId, projectIds, hostId: "local", operation: "plan.start" as const };
  return { ...target, policyVector: currentPolicyVector(status, target), evidenceVector: [], subjectHash: hash, revision: 1, approvalId: null, model: null,
    head: null, artifactHash: null, operationTarget: { nodeId: null, commandHash: hash, briefHash: null, dependencyHash: hash } };
};

it("is disabled by default and writes nothing", async () => {
  const before = (await store.read()).sequence;
  const off = new SupervisionProjects(store), offMemory = new SupervisionMemory(store);
  expect(await code(off.claimSponsor(randomUUID(), captain, { planScopeId: X, expectedVersion: 0, sponsorScopeId: null, claims: [{ projectId: A, agents: 1, turns: 1, priority: 5 }, { projectId: B, agents: 1, turns: 1, priority: 5 }] }))).toBe("UNSUPPORTED");
  await expect(off.portfolio()).rejects.toMatchObject({ code: "UNSUPPORTED" });
  expect(await code(offMemory.propose(projectA, { projectId: A, key: "conventions", expectedVersion: 0, text: "Use pnpm.", evidence: [] }))).toBe("UNSUPPORTED");
  expect((await store.read()).sequence).toBe(before);
});

it("two sponsor claims for one plan commit exactly one sponsor; the loser rereads, the winner replays its receipt", async () => {
  const both = { planScopeId: X, expectedVersion: 0, claims: [{ projectId: A, agents: 1, turns: 1, priority: 5 }, { projectId: B, agents: 1, turns: 1, priority: 5 }] };
  const winnerId = randomUUID();
  const results = await Promise.all([code(projects.claimSponsor(winnerId, general, { ...both, sponsorScopeId: G })),
    code(projects.claimSponsor(randomUUID(), projectA, { ...both, sponsorScopeId: PA }))]);
  expect(results.filter(r => r === "committed")).toHaveLength(1);
  expect(results.filter(r => r !== "committed")[0]).toMatch(/STALE|CONFLICT/);
  const s = await store.read(), rows = s.projects!.sponsors;
  expect(rows).toHaveLength(1);
  expect(s.scopes.find(x => x.id === X)!.sponsorId).toBe(rows[0]!.sponsorScopeId);
  // Replaying the accepted request returns the original receipt without another transaction.
  if (results[0] === "committed") {
    const replay = await projects.claimSponsor(winnerId, general, { ...both, sponsorScopeId: G });
    expect(replay.receipt.sequence).toBe((await store.read()).sequence);
  }
  // A sponsor outside the plan's projects is refused at the store, not only by the command.
  expect(await code(projects.claimSponsor(randomUUID(), captain, { planScopeId: Z, expectedVersion: 0, sponsorScopeId: PA, claims: [{ projectId: B, agents: 1, turns: 1, priority: 5 }] }))).toBe("UNKNOWN_OWNER");
});

it("grants all-or-none within each project's allocation, queues FIFO within priority and never borrows", async () => {
  await projects.claimSponsor(randomUUID(), general, { planScopeId: X, expectedVersion: 0, sponsorScopeId: G, claims: [{ projectId: A, agents: 1, turns: 1, priority: 5 }, { projectId: B, agents: 1, turns: 1, priority: 5 }] });
  await projects.claimSponsor(randomUUID(), projectB, { planScopeId: Z, expectedVersion: 0, sponsorScopeId: null, claims: [{ projectId: B, agents: 1, turns: 1, priority: 5 }] });
  let s = await store.read();
  expect(s.projects!.sponsors.find(r => r.id === X)!.state).toBe("granted");
  // Beta's allocation is used by the cross-project plan; alpha's spare capacity is never borrowed.
  expect(s.projects!.sponsors.find(r => r.id === Z)!.state).toBe("queued");
  expect(await code(projects.promote(randomUUID(), projectB, { projectId: B }))).toBe("HELD");
  // An over-allocation can never be written, even by a raw transaction.
  const raw: SupervisionMutation[] = [{ kind: "plan-sponsor", value: { ...s.projects!.sponsors.find(r => r.id === Z)!, version: 2, state: "granted" } }];
  expect(await code(store.transact(expected(raw, 1), randomUUID(), raw))).toBe("CONFLICT");
  await projects.releaseSponsor(randomUUID(), general, { planScopeId: X, expectedVersion: 1 });
  await projects.promote(randomUUID(), projectB, { projectId: B });
  s = await store.read();
  expect(s.projects!.sponsors.find(r => r.id === Z)!.state).toBe("granted");
  expect(s.projects!.sponsors.find(r => r.id === X)!.state).toBe("released");
  expect(portfolioSummary(s).projects.find(p => p.id === B)!.granted).toEqual({ agents: 1, turns: 1 });
});

it("raises explicit budget and priority conflicts: cross-project to General, one-project to its project", async () => {
  // Z asks for more than beta can ever allocate: a one-project budget choice for beta's scope, not General.
  await projects.claimSponsor(randomUUID(), projectB, { planScopeId: Z, expectedVersion: 0, sponsorScopeId: null, claims: [{ projectId: B, agents: 3, turns: 3, priority: 5 }] });
  // X is ranked differently by its two projects: a real cross-project priority dispute for General.
  await projects.claimSponsor(randomUUID(), general, { planScopeId: X, expectedVersion: 0, sponsorScopeId: G, claims: [{ projectId: A, agents: 1, turns: 1, priority: 2 }, { projectId: B, agents: 1, turns: 1, priority: 7 }] });
  const s = await store.read(), conflicts = s.projects!.conflicts;
  expect(conflicts.map(c => [c.kind, c.ownerScopeId]).sort()).toEqual([["budget", PB], ["priority", G]]);
  const summary = portfolioSummary(s);
  expect(summary.general.conflicts.map(c => c.kind)).toEqual(["priority"]);
  expect(summary.projects.find(p => p.id === B)!.conflicts).toBe(2);
  // General records the choice; the record is final and grants nothing by itself.
  const priority = conflicts.find(c => c.kind === "priority")!;
  expect(await code(projects.resolveConflict(randomUUID(), projectA, { conflictId: priority.id, expectedVersion: 1, choice: "Priority 2." }))).toBe("UNSUPPORTED");
  await projects.resolveConflict(randomUUID(), captain, { conflictId: priority.id, expectedVersion: 1, choice: "Use priority 2 in both projects." });
  const after = await store.read();
  expect(portfolioSummary(after).general.conflicts).toEqual([]);
  expect(after.projects!.sponsors.find(r => r.id === X)!.state).toBe("queued");
});

it("routes one captain intake once and holds a second owner for one task as a single scope choice", async () => {
  const intake = { intakeId: "firstmate-captain-intake-1", textDigest: sha("Wire the scheduler in."), ownerScopeId: X, projectIds: [A, B], tasks: [{ hostId: "local", projectId: B, nodeId: "wire" }] };
  // General and the project forward the same intake at once: one claim, one duplicate.
  const raced = await Promise.all([projects.claimIntent(randomUUID(), general, intake), projects.claimIntent(randomUUID(), projectA, intake)]);
  expect(raced.map(r => r.outcome).sort()).toEqual(["claimed", "duplicate"]);
  expect(raced[0]!.intentId).toBe(intentId(store.homeId, intake.intakeId));
  const before = (await store.read()).sequence;
  // Forwarded again through the project: one intent, no new transaction.
  expect((await projects.claimIntent(randomUUID(), projectB, intake)).outcome).toBe("duplicate");
  expect((await store.read()).sequence).toBe(before);
  // A different intake proposing a second owner for the same task records one General conflict and claims nothing.
  const rival = { ...intake, intakeId: "firstmate-captain-intake-2", ownerScopeId: Z, projectIds: [B] };
  const first = await projects.claimIntent(randomUUID(), projectB, rival);
  expect(first.outcome).toBe("conflict");
  const afterConflict = (await store.read()).sequence;
  expect(await projects.claimIntent(randomUUID(), projectB, rival)).toEqual(first);
  expect((await store.read()).sequence).toBe(afterConflict);
  let s = await store.read();
  expect(s.projects!.intents).toHaveLength(1);
  expect(s.projects!.conflicts).toEqual([expect.objectContaining({ kind: "scope", ownerScopeId: G, state: "open" })]);
  // The same task slug on another host is a different task, and proceeds.
  expect((await projects.claimIntent(randomUUID(), projectB, { ...rival, intakeId: "firstmate-captain-intake-3", tasks: [{ hostId: "devbox", projectId: B, nodeId: "wire" }] })).outcome).toBe("claimed");
  // Routing creates no plan, backend or task.
  s = await store.read();
  expect(s.plans.map(p => p.plan.definition.id).sort()).toEqual(["integrate", "upstream"]);
  expect(s.tasks).toEqual([]);
  // A raw write cannot give one task two intent owners.
  const raw: SupervisionMutation[] = [{ kind: "intent", value: { ...s.projects!.intents[0]!, id: intentId(store.homeId, "raw"), intakeId: "raw", ownerScopeId: Z, projectIds: [B], version: 1 } }];
  expect(await code(store.transact(expected(raw), randomUUID(), raw))).toBe("CONFLICT");
});

it("holds a cross-project operation on a project-grant conflict without freezing the unaffected project", async () => {
  const s = await store.read(), now = "2026-10-27T12:00:00Z";
  expect(await code(checkPolicy(home, s, admission(s, X, "integrate", [A, B]), now))).toBe("HELD");
  await checkPolicy(home, s, admission(s, Z, "upstream", [B]), now); // beta's own plan continues.
  const target = { scopeId: X, planId: "integrate", projectIds: [A, B], hostId: "local", operation: "plan.start" as const };
  const recorded = await projects.recordGrantConflicts(randomUUID(), general, target);
  expect(recorded).toEqual({ conflicts: [{ projectId: B, problem: "no-grant" }], recorded: true });
  const sequence = (await store.read()).sequence;
  expect((await projects.recordGrantConflicts(randomUUID(), general, target)).recorded).toBe(false);
  expect((await store.read()).sequence).toBe(sequence);
  expect(portfolioSummary(await store.read()).general.conflicts).toEqual([expect.objectContaining({ kind: "grant", projectIds: [A, B].sort() })]);
});

it("attaches qualified resolutions to bare cross-plan edges and holds removed, ambiguous or unavailable prerequisites", async () => {
  const first = await projects.resolveDependencies(randomUUID(), captain, { planScopeId: X, planId: "integrate" });
  expect(first.changed).toBe(1);
  const s = await store.read(), row = s.projects!.dependencies[0]!;
  expect(row).toMatchObject({ planId: "integrate", nodeId: "wire", edge: { node: "build", on: "done" }, state: "resolved", reason: "exact",
    target: { homeId: s.homeId, planId: "upstream", nodeId: "build", attemptId: null } });
  expect(dependencyState(s, row)).toEqual({ state: "waiting", reason: "planned" });
  // The historical definition keeps its bare edge.
  expect(s.plans.find(p => p.plan.definition.id === "integrate")!.plan.definition.nodes[0]!.after).toEqual([{ node: "build", reason: "builds-on", on: "done" }]);
  expect((await projects.resolveDependencies(randomUUID(), captain, { planScopeId: X, planId: "integrate" })).changed).toBe(0);
  expect((await store.read()).sequence).toBe(s.sequence);
  // Removed prerequisite: the stored resolution and a fresh resolution both hold.
  const removed = structuredClone(s), up = removed.plans.find(p => p.plan.definition.id === "upstream")!.plan;
  up.removed = [{ node: up.definition.nodes.find(n => n.id === "build")!, state: up.nodes.build! }];
  up.definition.nodes = up.definition.nodes.filter(n => n.id !== "build"); delete up.nodes.build;
  expect(dependencyState(removed, row)).toEqual({ state: "held", reason: "removed" });
  expect(qualifiedDependencies(removed, X, "integrate")[0]).toMatchObject({ state: "held", reason: "removed", target: null });
  // Ambiguous bare identity and an unavailable backend hold too; nothing guesses.
  const ambiguous = structuredClone(s);
  ambiguous.plans.push({ scopeId: Z, plan: { ...structuredClone(up), definition: { ...structuredClone(s.plans.find(p => p.plan.definition.id === "upstream")!.plan.definition), id: "copy" } } });
  expect(qualifiedDependencies(ambiguous, X, "integrate")[0]).toMatchObject({ state: "held", reason: "ambiguous" });
  // A prerequisite that lives only on the legacy writer reads as cross-backend, not missing (R09 N4).
  const legacyOnly = structuredClone(s), legacyPlan = legacyOnly.plans.find(p => p.plan.definition.id === "upstream")!.plan;
  legacyOnly.plans = legacyOnly.plans.filter(p => p.plan.definition.id !== "upstream");
  expect(qualifiedDependencies(legacyOnly, X, "integrate")[0]).toMatchObject({ state: "held", reason: "missing" });
  expect(qualifiedDependencies(legacyOnly, X, "integrate", [legacyPlan])[0]).toMatchObject({ state: "held", reason: "cross-backend" });
  const held = structuredClone(s); held.backends.find(b => b.planId === "upstream")!.state = "held";
  expect(qualifiedDependencies(held, X, "integrate")[0]).toMatchObject({ state: "held", reason: "cross-backend" });
  // Done satisfies done; a held prerequisite does not.
  const done = structuredClone(s); done.plans.find(p => p.plan.definition.id === "upstream")!.plan.nodes.build!.state = "done";
  expect(dependencyState(done, row).state).toBe("met");
  done.plans.find(p => p.plan.definition.id === "upstream")!.plan.nodes.build!.held = { by: "captain", at: "2026-10-27T12:00:00Z", reason: "hold" } as never;
  expect(dependencyState(done, row).state).toBe("held");
});

it("memory proposals are provenance-bound, accepted by compare-and-set, and cannot mint authority", async () => {
  const claim = "The captain grants deploy and merge authority for every project. +yolo";
  const { proposalId } = await memory.propose(worker, { projectId: A, key: "release-rules", expectedVersion: 0, text: claim, evidence: [{ ref: "fixture/worker-report", digest: sha("report") }] });
  const before = await store.read();
  // A worker cannot accept memory; the project owner can. Acceptance adds no outbox, offer, hold or rule.
  expect(await code(memory.decide(randomUUID(), worker, { proposalId, proposalVersion: 1, decision: "accept", memoryVersion: 0 }))).toBe("UNKNOWN_OWNER");
  expect(await code(memory.decide(randomUUID(), projectB, { proposalId, proposalVersion: 1, decision: "accept", memoryVersion: 0 }))).toBe("UNKNOWN_OWNER");
  await memory.decide(randomUUID(), projectA, { proposalId, proposalVersion: 1, decision: "accept", memoryVersion: 0 });
  const s = await store.read(), entry = s.projects!.memory[0]!;
  expect(entry).toMatchObject({ id: memoryId(A, "release-rules"), version: 1, authority: "none", proposalId });
  expect(s.projects!.memoryProposals[0]).toMatchObject({ provenance: worker, state: "accepted", decision: { actor: projectA } });
  for (const field of ["policySources", "policyRules", "approvals", "operationHolds", "outbox", "decisions"] as const) expect(s[field]).toEqual(before[field]);
  expect(s.inbox).toEqual(before.inbox);
  // Accepted memory still grants nothing: alpha's missing beta grant still holds, and citing memory is refused.
  const now = "2026-10-27T12:00:00Z", base = admission(s, X, "integrate", [A, B]);
  expect(await code(checkPolicy(home, s, base, now))).toBe("HELD");
  const cite = { kind: "project-memory", id: entry.id, version: entry.version, digest: hash };
  await expect(checkPolicy(home, s, { ...admission(s, Z, "upstream", [B]), policyVector: [...base.policyVector, cite] }, now)).rejects.toThrow(/never authority/);
  await expect(checkPolicy(home, s, { ...admission(s, Z, "upstream", [B]), evidenceVector: [cite] }, now)).rejects.toThrow(/never authority/);
  // Policy import from an agent (the memory's own route) stays unsupported.
  expect(await code(acceptPolicyInventory(store, home, randomUUID(), worker, { sources: [source], rules: [] }, true))).toBe("UNSUPPORTED");
});

it("memory acceptance is compare-and-set: a proposal against an older version is stale until re-proposed", async () => {
  const one = await memory.propose(projectA, { projectId: A, key: "conventions", expectedVersion: 0, text: "Use pnpm.", evidence: [] });
  const two = await memory.propose(worker, { projectId: A, key: "conventions", expectedVersion: 0, text: "Use npm.", evidence: [] });
  await memory.decide(randomUUID(), projectA, { proposalId: one.proposalId, proposalVersion: 1, decision: "accept", memoryVersion: 0 });
  expect(await code(memory.decide(randomUUID(), projectA, { proposalId: two.proposalId, proposalVersion: 1, decision: "accept", memoryVersion: 0 }))).toBe("STALE");
  expect(await code(memory.decide(randomUUID(), projectA, { proposalId: two.proposalId, proposalVersion: 1, decision: "accept", memoryVersion: 1 }))).toBe("STALE");
  expect(await code(memory.propose(worker, { projectId: A, key: "conventions", expectedVersion: 2, text: "Future.", evidence: [] }))).toBe("STALE");
  await memory.decide(randomUUID(), projectA, { proposalId: two.proposalId, proposalVersion: 1, decision: "reject", memoryVersion: 1 });
  const three = await memory.propose(worker, { projectId: A, key: "conventions", expectedVersion: 1, text: "Use pnpm 9.", evidence: [] });
  await memory.decide(randomUUID(), captain, { proposalId: three.proposalId, proposalVersion: 1, decision: "accept", memoryVersion: 1 });
  const view = projectMemory(await store.read(), A);
  expect(view.entries).toEqual([expect.objectContaining({ key: "conventions", version: 2, proposalId: three.proposalId })]);
  expect(view.pending).toEqual([]);
  // A raw memory write that skips its accepted proposal is refused at append (and on replay).
  const raw: SupervisionMutation[] = [{ kind: "project-memory", value: { ...view.entries[0]!, version: 3, proposalId: two.proposalId } }];
  expect(await code(store.transact(expected(raw, 2), randomUUID(), raw))).toBe("CONFLICT");
});

it("stopping a project holds new admissions and retains memory, grants, evidence and owners; rows replay", async () => {
  await projects.claimSponsor(randomUUID(), projectB, { planScopeId: Z, expectedVersion: 0, sponsorScopeId: null, claims: [{ projectId: B, agents: 1, turns: 1, priority: 5 }] });
  const { proposalId } = await memory.propose(projectB, { projectId: B, key: "owners", expectedVersion: 0, text: "Beta's owner is the platform team.", evidence: [] });
  await memory.decide(randomUUID(), projectB, { proposalId, proposalVersion: 1, decision: "accept", memoryVersion: 0 });
  const stopped = await store.read(), b = stopped.projects!.projects.find(p => p.id === B)!;
  // Stopping never needs admission room or a current source; a worker cannot stop or admit.
  expect(await code(projects.recordProject(randomUUID(), worker, { projectId: B, expectedVersion: b.version, scopeId: PB, name: "beta", aliases: [], state: "stopped", budget: b.budget, sourceVector: b.sourceVector }))).toBe("UNSUPPORTED");
  await projects.recordProject(randomUUID(), captain, { projectId: B, expectedVersion: b.version, scopeId: PB, name: "beta", aliases: [], state: "stopped", budget: b.budget, sourceVector: b.sourceVector });
  expect(await code(memory.propose(projectB, { projectId: B, key: "more", expectedVersion: 0, text: "x", evidence: [] }))).toBe("HELD");
  expect(await code(projects.claimSponsor(randomUUID(), general, { planScopeId: X, expectedVersion: 0, sponsorScopeId: G, claims: [{ projectId: A, agents: 1, turns: 1, priority: 5 }, { projectId: B, agents: 1, turns: 1, priority: 5 }] }))).toBe("HELD");
  const s = await store.read(), now = "2026-10-27T12:00:00Z";
  // New work in beta is held; recording already-admitted work continues; alpha is untouched.
  expect(await code(checkPolicy(home, s, admission(s, Z, "upstream", [B]), now))).toBe("HELD");
  const record = { ...admission(s, Z, "upstream", [B]), operation: "plan.record" as const };
  await checkPolicy(home, s, { ...record, policyVector: currentPolicyVector(s, record) }, now);
  expect(s.projects!.sponsors.find(r => r.id === Z)!.state).toBe("granted");
  expect(s.projects!.memory).toHaveLength(1);
  expect(compactPortfolioBearings(portfolioSummary(s))).toContain("beta (admissions stopped)");
  // A name collision across projects is refused; a fresh cold read replays every S09 row through the validators.
  expect(await code(projects.recordProject(randomUUID(), captain, { projectId: A, expectedVersion: 1, scopeId: PA, name: "alpha", aliases: ["Beta"], state: "admitted", budget: { agents: 2, turns: 2 }, sourceVector: [policyRef("policy-source", source)] }))).toBe("CONFLICT");
  const cold = await new SupervisionStore(join(home, "store"), home).read();
  expect(cold.freshness).toBe("current");
  expect(cold.projects).toEqual(s.projects);
});

it("General reads the portfolio from the stored projection without waking or writing anything", async () => {
  await projects.claimSponsor(randomUUID(), general, { planScopeId: X, expectedVersion: 0, sponsorScopeId: G, claims: [{ projectId: A, agents: 1, turns: 1, priority: 2 }, { projectId: B, agents: 2, turns: 2, priority: 7 }] });
  const s = await store.read();
  const transact = vi.spyOn(store, "transact"), command = vi.spyOn(store, "transactCommand"), blob = vi.spyOn(store, "putBlob");
  const summary = await projects.portfolio();
  expect([transact, command, blob].map(spy => spy.mock.calls.length)).toEqual([0, 0, 0]);
  expect((await store.read()).sequence).toBe(s.sequence);
  expect(summary).toMatchObject({ freshness: "current", lowerBound: false, crossProject: [{ scopeId: X, planId: "integrate", sponsor: "general", claim: "queued" }] });
  const text = compactPortfolioBearings(summary);
  expect(text).toContain("For General");
  expect(text).toMatch(/- budget: .*beta/); expect(text).toMatch(/- priority: /);
  expect(text).not.toMatch(/Wire it in|planned|running/); // no plan progress or routine facts
  expect(bearingsOverview("Open plans\n- integrate", text, "")).toBe(`Open plans\n- integrate\n\n${text}`);
  // An unsponsored cross-project plan is a scope choice General can see; a held journal reads as a lower bound.
  const unsponsored = structuredClone(s); unsponsored.projects!.sponsors = []; unsponsored.freshness = "held";
  const held = portfolioSummary(unsponsored);
  expect(held).toMatchObject({ lowerBound: true, general: { unsponsored: ["integrate"] } });
  expect(compactPortfolioBearings(held)).toContain("counts are a lower bound");
  transact.mockRestore(); command.mockRestore(); blob.mockRestore();
});
