/** S07 qualification: history import and single-writer cutover against the installed-shaped legacy
 * adapters (config.mateNotes, queuePlanNotes, flushMateNotes, burst notes, WatchRunner, Needs-you
 * answers). Temporary homes, a controlled transport and synthetic agents only: no provider, model,
 * daemon or live resource is touched. Each test records chronology so the order claims are checked.
 */
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { workflowFixture } from "../test/workflow-fixture";
import { PlanDefinitionSchema, type PlanCaptainCommand, type WorkflowCommand } from "../shared/workflow-plans";
import { PolicyRuleSchema, PolicySourceSchema } from "../shared/supervision-policy";
import type { SupervisionActor } from "../shared/supervision";
import { readFirstmateConfig, updateFirstmateConfig } from "./config";
import { pluginDir } from "./data-dir";
import { answerDecision } from "./decision-answer";
import type { PaseoApi } from "./host-types";
import { extendBurstNote, flushMateNotes, queueBurstNote, queueMateNote } from "./mate";
import { NeedsYouService, readConfiguredDecisionHome } from "./needs-you-service";
import { digest } from "./submissions";
import { SupervisionCommands } from "./supervision-commands";
import { cutoverGate, liveClaims } from "./supervision-gate";
import { exportScopedProjection, legacyAdapters, migrationUuid, SupervisionMigrator, type MigrationInput } from "./supervision-migrate";
import { writeTextFile } from "./files";
import { acceptPolicyInventory, currentPolicyVector, policyRef } from "./supervision-policy";
import { SupervisionStore } from "./supervision-store";
import { watchItem, WatchRunner, type QueuedNote } from "./watches";
import { LegacyCutoverError, planSubjectHash, type WorkflowPlanStore } from "./workflow-plans";
import { planOwnership } from "./workflow-ownership";
import { queuePlanNotes, workflowStore } from "./workflow-service";

const daemonRoot = process.env.PASEO_HOME!;
const OWNER = "plan-owner", GENERAL = "general-mate";
const owner: SupervisionActor = { kind: "agent", id: OWNER, source: "fixture/scoped-owner" };
const captainUi: SupervisionActor = { kind: "captain-ui", id: "fixture-captain", source: "fixture/accept" };
const sha = (v: string) => createHash("sha256").update(v).digest("hex");
type Sent = { recipient: string; messageId: string | undefined; text: string };

let home: string, legacy: WorkflowPlanStore, store: SupervisionStore, migrator: SupervisionMigrator, runner: WatchRunner;
let sent: Sent[], busy: boolean, chronology: string[], blockSend: Promise<void> | null, failSend: "after" | null;
let service: NeedsYouService | null, clock: number;
let input: MigrationInput;

const api = {
  agents: {
    ref: (id: string) => ({
      refresh: async () => ({ agent: { id, status: busy ? "running" : "idle", archivedAt: null } }),
      send: async (text: string, options: { messageId?: string } = {}) => {
        if (blockSend) await blockSend;
        sent.push({ recipient: id, messageId: options.messageId, text });
        chronology.push(`send:${options.messageId ?? "?"}`);
        if (failSend === "after") throw new Error("response lost after acceptance");
      },
    }),
  },
} as unknown as PaseoApi;

function otherPlan() {
  const base = workflowFixture();
  return PlanDefinitionSchema.parse({ ...base, id: "harbor", title: "Harbor",
    nodes: base.nodes.map(n => ({ ...n, id: `h-${n.id}`, ...(n.kind === "run" ? { launch: { ...n.launch, id: `h-${n.id}`, brief: { file: `data/h-${n.id}/brief.md` } } } : {}),
      after: n.after.map(e => ({ ...e, node: `h-${e.node}` })) })) });
}
async function captain(plan: string, action: PlanCaptainCommand["action"], extra: Partial<PlanCaptainCommand> = {}, id = randomUUID()) {
  const p = (await legacy.get(plan))!;
  await legacy.execute({ op: "captain", plan, revision: p.revision, subjectHash: planSubjectHash(p), action, text: "", ...extra } as PlanCaptainCommand, id, "board:captain");
  return id;
}
beforeEach(async () => {
  process.env.PASEO_HOME = join(daemonRoot, randomUUID()); home = join(process.env.PASEO_HOME, "home");
  for (const id of ["trial", "build", "h-trial", "h-build"]) { await mkdir(join(home, `data/${id}`), { recursive: true }); await writeFile(join(home, `data/${id}/brief.md`), `Instructions for ${id}.`); }
  await writeFile(join(home, "data/backlog.md"), "# Backlog\n## In flight\n- [ ] build - Build the scheduler (hold: Which storage?) (agent: worker-build)\n## Queued\n## Done\n");
  await writeFile(join(home, "data/orders.md"), "Pilot implementation and isolated tests only.\n");
  await updateFirstmateConfig({ home, mateAgentId: "", migration: null, mateLaunch: null }); await updateFirstmateConfig({ mateAgentId: GENERAL });
  sent = []; busy = false; chronology = []; blockSend = null; failSend = null; service = null; clock = 1000;
  legacy = workflowStore(home);
  await legacy.execute({ op: "draft", definition: workflowFixture() }, randomUUID(), GENERAL);
  await legacy.execute({ op: "draft", definition: otherPlan() }, randomUUID(), GENERAL);
  store = new SupervisionStore(pluginDir(), home, { writable: true, processIdentity: async () => ({ state: "alive", start: "fixture-process" }) });
  await store.initialize(); await store.acquireCoordinator();
  runner = new WatchRunner({ home: async () => home, disabled: async () => [],
    deliver: async text => { if (busy) return "wait"; const messageId = `firstmate-watch-${randomUUID()}`; sent.push({ recipient: GENERAL, messageId, text }); chronology.push(`send:${messageId}`); return "sent"; },
    gate: async () => ({ gate: cutoverGate(home), recipient: GENERAL }), stateFile: join(pluginDir(), "watches.json"), scriptStateRoot: join(pluginDir(), "watch-state"), now: () => new Date("2026-10-27T10:00:00Z") });
  migrator = makeMigrator();
  input = { plan: "scheduler", scopeId: randomUUID(), projectId: randomUUID(), migrationId: randomUUID(),
    prerequisites: { inventory: "fixture inventory accepted", rollbackBuild: "fixture compatible build", policy: "fixture policy import accepted" } };
});
afterEach(async () => { runner.stop(); await service?.stop(); });
function makeMigrator(boundary?: (name: string) => Promise<void>) {
  return new SupervisionMigrator({ home, store, legacy, enabled: true, adapters: legacyAdapters(runner, service ? () => service!.read() : null),
    boundary: async name => { chronology.push(`boundary:${name}`); await boundary?.(name); } });
}
async function notes() { return (await readFirstmateConfig()).mateNotes; }
async function legacyBytes(plan = "scheduler") {
  const out: Record<string, string> = {};
  for (const dir of [plan, `.tips/${plan}`, `.published/${plan}`]) for (const name of (await readdir(join(legacy.root, dir))).sort()) out[`${dir}/${name}`] = sha(await readFile(join(legacy.root, dir, name), "utf8"));
  return out;
}
async function cutover(m = migrator) {
  await m.prepare(input); await m.reconcile(input.migrationId); await m.barrier(input.migrationId); return m.commit(input.migrationId);
}
/** Bind the scoped owner and let it acknowledge one consequence through the existing typed command path. */
async function ownerAcknowledges(outboxId: string, extraIds: string[] = []) {
  const s0 = await store.read(), binding = { scopeId: input.scopeId, epoch: 1, hostId: "local", agentId: OWNER, workspaceId: "independent-owner-workspace",
    profileDigest: "b".repeat(64), state: "active" as const, checkpointHash: "c".repeat(64), acknowledgedSeq: 0, heartbeatDue: null };
  if (!s0.bindings.some(b => b.scopeId === input.scopeId)) await store.transact([{ kind: "binding", id: input.scopeId, version: 0 }], randomUUID(), [{ kind: "binding", value: binding }]);
  const source = PolicySourceSchema.parse({ id: randomUUID(), version: 1, path: "data/orders.md", lineStart: 1, lineEnd: 1,
    fileHash: sha("Pilot implementation and isolated tests only.\n"), excerptHash: sha("Pilot implementation and isolated tests only."), provenance: captainUi, supersedes: [] });
  const rule = PolicyRuleSchema.parse({ id: randomUUID(), version: 1, sources: [policyRef("policy-source", source)],
    selector: { scopeIds: [input.scopeId], projectIds: [input.projectId], projectNames: { [input.projectId]: "scheduler" }, hostIds: ["local"], planIds: ["scheduler"] },
    operations: ["plan.record"], effect: "allow", constraints: { models: [], profileDigests: [], requireApproval: false, requireHead: false, requireChecks: false,
      independentReviews: 0, requiredReviewIds: [], availability: "always" }, expiresAt: null, supersedes: [] });
  if (!(await store.read()).policyRules.length) await acceptPolicyInventory(store, home, randomUUID(), captainUi, { sources: [source], rules: [rule] }, true);
  const commands = new SupervisionCommands(store, home, { enabled: true }), s = await store.read(), p = s.plans.find(x => x.plan.definition.id === "scheduler")!.plan;
  const command: WorkflowCommand = { op: "ack", plan: "scheduler", ids: [outboxId, ...extraIds], kind: "handled" };
  const target = { scopeId: input.scopeId, planId: "scheduler", projectIds: [input.projectId], hostId: "local", operation: "plan.record" as const };
  const ack = await commands.planCommand({ requestId: randomUUID(), homeId: s.homeId, scopeId: input.scopeId, epoch: 1, scopeVersion: s.scopes.find(x => x.id === input.scopeId)!.version,
    expectedPlanHash: p.hash, revision: p.revision, subjectHash: planSubjectHash(p), command, policyVector: currentPolicyVector(s, target),
    modelPolicyVector: currentPolicyVector(s, { ...target, operation: "model.use" }), evidenceVector: [], approvalId: null, head: null, artifactHash: null, briefHash: null, dependencyBindings: [] }, owner);
  const s2 = await store.read();
  await commands.acknowledge({ requestId: randomUUID(), scopeId: input.scopeId, epoch: 1, scopeVersion: s2.scopes.find(x => x.id === input.scopeId)!.version, outboxId, resultRef: `command:${ack.receipt.requestId}` }, owner);
}

it("is inert until armed: no claim, sidecar or refusal file is written by ordinary delivery", async () => {
  await captain("harbor", "changes", { text: "Keep it small." });
  await queuePlanNotes(home); await flushMateNotes(api);
  expect(sent).toHaveLength(1);
  await expect(readdir(join(legacy.root, ".scoped"))).rejects.toMatchObject({ code: "ENOENT" });
});

it("A12: imports byte-exact history, original request receipts, attempts, budget and holds; legacy bytes never change", async () => {
  const approve = await captain("scheduler", "approve");
  await legacy.execute({ op: "start", plan: "scheduler", node: "trial" }, randomUUID(), GENERAL);
  const before = (await legacy.get("scheduler"))!, bytes = await legacyBytes();
  await migrator.arm();
  const dry = await migrator.dryRun(input);
  expect(dry.parity).toBe(true);
  expect(await readdir(join(legacy.root, ".scoped"))).toEqual(["armed.json"]); // A dry run writes nothing.
  const committed = await cutover();
  const status = await store.read(), scoped = status.plans.find(p => p.plan.definition.id === "scheduler")!;
  expect(scoped.plan.hash).toBe(before.hash);
  expect(scoped.plan.nodes).toEqual(before.nodes);
  expect(committed.imported.budget).toEqual(planOwnership(before).budget);
  expect(committed.imported.attempts).toEqual(planOwnership(before).attempts);
  expect(committed.imported.requests.map(r => r.requestId)).toContain(approve);
  expect(await legacyBytes()).toEqual(bytes);
  // Original request replay returns the original identity; it is never reauthorized or re-run.
  const original = (await readdir(join(legacy.root, "scheduler"))).sort()[1]!;
  const event = JSON.parse(await readFile(join(legacy.root, "scheduler", original), "utf8"));
  expect(await store.workflowRequest("scheduler", approve)).toMatchObject({ requestHash: event.requestHash, eventHash: event.hash });
  await expect(store.transact([{ kind: "workflow", id: "scheduler", version: 1 }], randomUUID(), [{ kind: "workflow", scopeId: input.scopeId, event }]))
    .rejects.toThrow(/already committed|replay/);
  expect(status.backends).toEqual([expect.objectContaining({ planId: "scheduler", backend: "scoped", state: "active", sourceHash: committed.source.sourceHash })]);
});

it("refuses corrupt, quarantined and retired history without freezing anything", async () => {
  await migrator.arm();
  const first = (await readdir(join(legacy.root, "scheduler"))).sort()[0]!;
  const path = join(legacy.root, "scheduler", first), original = await readFile(path, "utf8");
  await writeFile(path, original.replace("Scheduler", "Schedulex"));
  await expect(migrator.prepare(input)).rejects.toMatchObject({ code: "HELD" });
  expect(await cutoverGate(home).sidecar("scheduler", "freeze")).toBeNull();
  await writeFile(path, original);
  await mkdir(join(legacy.root, ".retired", "scheduler"), { recursive: true });
  await writeFile(join(legacy.root, ".retired", "scheduler", "x.json"), "{}");
  await expect(migrator.prepare(input)).rejects.toMatchObject({ code: "HELD" });
  expect(await cutoverGate(home).sidecar("scheduler", "freeze")).toBeNull();
  expect((await store.read()).sequence).toBe(0);
});

it("L1: a notified-but-unhandled action with General busy transfers once; the old entry goes only after its mapping", async () => {
  await migrator.arm();
  const action = await captain("scheduler", "changes", { text: "Keep the trial read-only." });
  await queuePlanNotes(home);
  busy = true; await flushMateNotes(api);
  expect((await legacy.get("scheduler"))!.captainEvents![0]!.notified).toBe(true);
  expect(sent).toHaveLength(0);
  const observed: string[] = [];
  migrator = makeMigrator(async name => {
    const present = (await notes()).some(n => n.id === `firstmate-plan-${action}`), outbox = (await store.read()).outbox.length;
    observed.push(`${name}:note=${present}:outbox=${outbox}`);
  });
  await migrator.prepare(input);
  const [d] = (await store.read()).dispositions!.filter(x => x.source === "plan-action");
  expect(d).toMatchObject({ route: "transfer-fact", delivery: "queued", original: { actionId: action, noteId: `firstmate-plan-${action}` },
    observed: { notified: true, handledKeys: [], pendingKeys: [`scheduler:captain:${action}`, `scheduler:changes:${action}`] }, removal: { state: "pending" } });
  await migrator.reconcile(input.migrationId);
  // Durable mapping first (note still queued), then compare-by-ID/payload removal.
  expect(observed).toEqual(expect.arrayContaining([`transferred:${d!.id}:note=true:outbox=1`, `removed:${d!.id}:note=false:outbox=1`]));
  await migrator.barrier(input.migrationId); await migrator.commit(input.migrationId);
  busy = false; await flushMateNotes(api); await queuePlanNotes(home);
  expect(sent).toHaveLength(0); // General's idle flush cannot send the transferred entry.
  expect(await notes()).toEqual([]);
  const outbox = (await store.read()).outbox.filter(o => o.causationId === action);
  expect(outbox).toHaveLength(1);
  expect((await migrator.report("scheduler")).complete).toBe(false); // Commit alone is not a handled transfer.
  await ownerAcknowledges(outbox[0]!.id, [`scheduler:captain:${action}`, `scheduler:changes:${action}`]);
  expect(await migrator.recordAcknowledgements(input.migrationId)).toBe(1);
  const report = await migrator.report("scheduler");
  expect(report.complete).toBe(true);
  expect(report.dispositions.find(x => x.id === d!.id)!.receipts).toMatchObject({ transfer: `outbox:${outbox[0]!.id}`, ack: expect.stringMatching(/^command:.*@epoch:1$/) });
  expect((await store.read()).outbox.filter(o => o.causationId === action)).toHaveLength(1);
});

it("L2: enqueue-before-notified crash joins one pending event, and the enqueuer checks the gate before insertion", async () => {
  await migrator.arm();
  const action = await captain("scheduler", "approve");
  const execute = legacy.execute.bind(legacy), spy = vi.spyOn(Object.getPrototypeOf(legacy), "execute").mockImplementation(async function (this: WorkflowPlanStore, ...args: unknown[]) {
    if ((args[0] as WorkflowCommand).op === "notified") throw new Error("crash after insertion, before notified");
    return execute(...(args as Parameters<typeof execute>));
  });
  await expect(queuePlanNotes(home)).rejects.toThrow("crash after insertion");
  spy.mockRestore();
  expect((await legacy.get("scheduler"))!.captainEvents![0]!.notified).toBeUndefined();
  expect((await notes()).map(n => n.id)).toEqual([`firstmate-plan-${action}`]);
  await migrator.prepare(input);
  // The enqueuer sees the freeze BEFORE inserting; the reducer's later notified append is not the guard.
  // Race it: the producer's own stage check passes (stale), then the gate refuses the insertion.
  await updateFirstmateConfig({ mateNotes: [] });
  const stale = vi.spyOn(Object.getPrototypeOf(legacy), "cutover").mockResolvedValue(null);
  await queuePlanNotes(home);
  stale.mockRestore();
  expect(await notes()).toEqual([]);
  expect((await readdir(join(legacy.root, ".scoped", "refusals"))).length).toBe(1);
  await queuePlanNotes(home); // Afterwards the producer skips the plan quietly: no refusal per tick.
  expect((await readdir(join(legacy.root, ".scoped", "refusals"))).length).toBe(1);
  const d = (await store.read()).dispositions!.find(x => x.original.actionId === action)!;
  expect(d).toMatchObject({ route: "transfer-fact", delivery: "queued", observed: { notified: false }, removal: { state: "pending" } });
  await migrator.reconcile(input.migrationId);
  expect((await store.read()).dispositions!.find(x => x.id === d.id)!.removal.state).toBe("absent");
  await migrator.barrier(input.migrationId); await migrator.commit(input.migrationId);
  expect((await store.read()).outbox.filter(o => o.causationId === action)).toHaveLength(1);
  expect(sent).toHaveLength(0);
});

it("L3: an accepted send that crashed before removal is accepted, never handled or unsent, and is never resent", async () => {
  await migrator.arm();
  const action = await captain("scheduler", "changes", { text: "Stop after the trial." });
  await queuePlanNotes(home);
  const update = vi.spyOn(await import("./config"), "updateFirstmateConfig");
  update.mockImplementationOnce(async () => { throw new Error("crash after accepted send, before removal"); });
  await expect(flushMateNotes(api)).rejects.toThrow("before removal");
  update.mockRestore();
  expect(sent.map(s => [s.recipient, s.messageId])).toEqual([[GENERAL, `firstmate-plan-${action}`]]);
  expect((await notes()).map(n => n.id)).toEqual([`firstmate-plan-${action}`]);
  await migrator.prepare(input);
  const d = (await store.read()).dispositions!.find(x => x.original.actionId === action)!;
  expect(d).toMatchObject({ delivery: "accepted", recipient: GENERAL, route: "transfer-fact", observed: { handledKeys: [] } });
  expect(d.claimId).not.toBeNull();
  await migrator.reconcile(input.migrationId); await migrator.barrier(input.migrationId); await migrator.commit(input.migrationId);
  await flushMateNotes(api); await queuePlanNotes(home);
  expect(sent).toHaveLength(1); // Exactly the original old-owner send, accounted against its recipient.
  expect((await store.read()).outbox.filter(o => o.causationId === action)).toHaveLength(1);
});

it("L3: a claim left without a result by a stopped process is uncertain, not unsent", async () => {
  await migrator.arm();
  const action = await captain("scheduler", "approve");
  await queuePlanNotes(home);
  const note = (await notes())[0]!, gate = cutoverGate(home);
  const { claim } = await gate.claim([{ source: "plan-note", id: note.id, payloadHash: digest(note), actionId: action }], GENERAL);
  (liveClaims() as Set<string>).delete(claim!); // The claiming process died between claim and result.
  await migrator.prepare(input);
  expect((await store.read()).dispositions!.find(x => x.original.actionId === action)).toMatchObject({ delivery: "uncertain", claimId: claim, route: "transfer-fact" });
});

it("L4: an accepted decision answer is imported with its identities and held; a frozen task refuses new answers", async () => {
  service = new NeedsYouService({ root: join(process.env.PASEO_HOME!, "ledger"), home: readConfiguredDecisionHome, catalog: async () => null, enabled: () => true, now: () => clock });
  await service.read(); clock += 2000;
  const snapshot = await service.read(), request = snapshot.requests.find(r => r.source.taskId === "build")!;
  migrator = makeMigrator();
  await migrator.arm();
  const answer = (submissionId: string, text: string) => ({ homeId: snapshot.homeId!, requestId: request.id, recordRevision: request.revision, submissionId, text });
  expect((await answerDecision(api, service, answer("accepted-1", "Use SQLite."))).outcome).toBe("accepted");
  const s1 = await service.read(), r1 = s1.requests.find(r => r.id === request.id)!;
  expect(r1.submissions.map(s => [s.submissionId, s.outcome])).toEqual([["accepted-1", "accepted"]]);
  await migrator.prepare(input);
  const held = (await store.read()).dispositions!.filter(d => d.source === "decision-submission");
  expect(held).toEqual([expect.objectContaining({ route: "hold", imperative: true, delivery: "accepted", recipient: GENERAL,
    original: { requestId: request.id, submissionId: "accepted-1", messageId: "firstmate-answer-accepted-1", revision: request.revision } })]);
  // A new answer for the frozen task is refused before any reservation or send.
  const before = sent.length;
  await expect(answerDecision(api, service, answer("during-freeze", "Postgres instead."))).rejects.toThrow(/cutover|scoped/);
  expect(sent).toHaveLength(before);
  expect((await service.read()).requests.find(r => r.id === request.id)!.submissions.map(s => s.submissionId)).toEqual(["accepted-1"]);
  const reanswer = vi.spyOn(await import("./decision-answer"), "answerDecision");
  await migrator.reconcile(input.migrationId);
  await expect(migrator.barrier(input.migrationId)).rejects.toMatchObject({ code: "HELD" });
  await migrator.resolveHold(input.migrationId, held[0]!.id, "already-handled", { ref: "data/build/report.md#answer", digest: "d".repeat(64) }, "captain-review");
  await migrator.barrier(input.migrationId); await migrator.commit(input.migrationId);
  expect(reanswer).not.toHaveBeenCalled(); // The migrator reconciles the original answer; it never answers again.
  expect(sent).toHaveLength(before);
});

it("L4: an uncertain answer whose accepted append was lost carries the claim's accepted receipt and stays held", async () => {
  service = new NeedsYouService({ root: join(process.env.PASEO_HOME!, "ledger"), home: readConfiguredDecisionHome, catalog: async () => null, enabled: () => true, now: () => clock });
  await service.read(); clock += 2000;
  const snapshot = await service.read(), request = snapshot.requests.find(r => r.source.taskId === "build")!;
  migrator = makeMigrator(); await migrator.arm();
  const mutate = service.mutate.bind(service);
  vi.spyOn(service, "mutate").mockImplementation(async (target, change) => {
    if (change.kind === "answer" && change.outcome === "accepted") throw new Error("lost accepted append");
    return mutate(target, change);
  });
  const result = await answerDecision(api, service, { homeId: snapshot.homeId!, requestId: request.id, recordRevision: request.revision, submissionId: "lost-append", text: "Use SQLite." });
  expect(result.outcome).toBe("accepted");
  expect((await service.read()).requests.find(r => r.id === request.id)!.submissions[0]!.outcome).toBe("uncertain");
  await migrator.prepare(input);
  expect((await store.read()).dispositions!.find(d => d.original.submissionId === "lost-append")).toMatchObject({
    route: "hold", delivery: "accepted", observed: { outcome: "uncertain" }, recipient: GENERAL });
  expect(sent).toHaveLength(1);
});

it("L5: a send in flight blocks the freeze; once accounted, the cutover records it accepted", async () => {
  await migrator.arm();
  const action = await captain("scheduler", "approve");
  await queuePlanNotes(home);
  let release!: () => void; blockSend = new Promise<void>(r => { release = r; });
  const flushing = flushMateNotes(api);
  await vi.waitFor(async () => expect((await cutoverGate(home).claims()).length).toBe(1));
  await expect(migrator.prepare(input)).rejects.toThrow(/in flight/);
  expect(await cutoverGate(home).sidecar("scheduler", "freeze")).toBeNull();
  release(); blockSend = null; await flushing;
  await migrator.prepare(input);
  expect((await store.read()).dispositions!.find(x => x.original.actionId === action)).toMatchObject({ delivery: "accepted", removal: { state: "not-queued" }, recipient: GENERAL });
});

it("L5: when the cutover wins, legacy flush and enqueue refuse the target while an unrelated scope keeps flowing", async () => {
  await migrator.arm();
  const target = await captain("scheduler", "approve");
  await queuePlanNotes(home);
  busy = true;
  await migrator.prepare(input);
  const unrelated = await captain("harbor", "changes", { text: "Harbor keeps working." });
  await queuePlanNotes(home);
  await expect(legacy.execute({ op: "notified", plan: "scheduler", eventId: target }, randomUUID(), "plugin:outbox")).rejects.toBeInstanceOf(LegacyCutoverError);
  busy = false; await flushMateNotes(api); await flushMateNotes(api);
  expect(sent.map(s => s.messageId)).toEqual([`firstmate-plan-${unrelated}`]);
  expect((await notes()).map(n => n.id)).toEqual([`firstmate-plan-${target}`]);
  // Unrelated legacy plans still mutate.
  await legacy.execute({ op: "ack", plan: "harbor", ids: ["harbor:told:fixture"], kind: "told" }, randomUUID(), GENERAL);
  expect((await legacy.get("harbor"))!.told).toContain("harbor:told:fixture");
});

it("L5: a burst for the target's worker is refused, an extension cannot change it, and a payload change holds removal", async () => {
  await captain("scheduler", "approve");
  await legacy.execute({ op: "start", plan: "scheduler", node: "trial" }, randomUUID(), GENERAL);
  const attempt = (await legacy.get("scheduler"))!.nodes.trial!.attempt!;
  await legacy.execute({ op: "record", plan: "scheduler", node: "trial", state: "running", attempt, evidence: "Worker created.", agentId: "worker-trial", workspaceId: "ws-trial" }, randomUUID(), GENERAL);
  await migrator.arm();
  const render = async (parts: readonly string[]) => `<firstmate-board>${parts.join("|")}</firstmate-board>`;
  busy = true;
  await queueBurstNote(api, { key: "worker-trial", part: "steer 1", render }, { source: "steer-relay", relates: [] });
  const captured = (await notes())[0]!;
  await migrator.prepare(input);
  await expect(queueBurstNote(api, { key: "worker-trial", part: "steer 2", render }, { source: "steer-relay", relates: [] })).rejects.toThrow(/cutover/);
  await extendBurstNote("worker-trial", () => Date.now() + 1000);
  expect((await notes())[0]).toEqual(captured);
  // A non-compliant writer changes the queued payload after its disposition was published.
  await updateFirstmateConfig({ mateNotes: [{ ...captured, text: `${captured.text} (edited)` }] });
  await migrator.reconcile(input.migrationId);
  const d = (await store.read()).dispositions!.find(x => x.source === "burst")!;
  expect(d).toMatchObject({ route: "hold", removal: { state: "mismatch" } });
  expect((await notes()).length).toBe(1); // Nothing removed on a mismatch.
  await expect(migrator.barrier(input.migrationId)).rejects.toMatchObject({ code: "HELD" });
});

it("L5: mixed/opaque watch output stays with its legacy owner and holds only this transfer until explicitly drained", async () => {
  await migrator.arm();
  const enqueue = (runner as unknown as { gated: (w: () => Promise<void>) => Promise<void>; load: () => Promise<{ queue: QueuedNote[] }>; persist: () => Promise<void> });
  const add = (note: QueuedNote) => enqueue.gated(async () => { (await enqueue.load()).queue.push(note); await enqueue.persist(); });
  await add({ name: "pr-watch", ran: "2026-10-27T09:00:00Z", kind: "output", text: "PR 12 for scheduler: checks red; build is blocked." });
  await add({ name: "storage", ran: "2026-10-27T09:00:00Z", kind: "output", text: "Disk healthy." });
  await migrator.prepare(input);
  const held = (await store.read()).dispositions!.filter(d => d.source === "watch-queue");
  expect(held).toEqual([expect.objectContaining({ route: "hold", resolution: expect.objectContaining({ by: "mention" }), original: { watch: { name: "pr-watch", ran: "2026-10-27T09:00:00Z", kind: "output" } } })]);
  await runner.flush();
  expect(sent).toHaveLength(1);
  expect(sent[0]!.text).toContain("Disk healthy."); expect(sent[0]!.text).not.toContain("PR 12");
  expect((await runner.queued()).map(q => q.name)).toEqual(["pr-watch"]);
  await expect(migrator.barrier(input.migrationId)).rejects.toMatchObject({ code: "HELD" });
  await migrator.resolveHold(input.migrationId, held[0]!.id, "drain-legacy", { ref: "captain: let General see it", digest: "e".repeat(64) }, "captain-review");
  await runner.flush();
  expect(sent[1]!.recipient).toBe(GENERAL); expect(sent[1]!.text).toContain("PR 12");
  await migrator.reconcile(input.migrationId);
  expect((await store.read()).dispositions!.find(d => d.id === held[0]!.id)).toMatchObject({ route: "drain-legacy", removal: { state: "drained" }, recipient: GENERAL });
  await migrator.barrier(input.migrationId); await migrator.commit(input.migrationId);
  expect((await migrator.report("scheduler")).migration!.state).toBe("committed");
});

it.each(["frozen", "prepared", "prepared-sidecar", "barrier", "committed-sidecar"])("A13.store: a crash at %s holds both writers and resumes the same migration", async point => {
  await migrator.arm();
  await captain("scheduler", "approve"); await queuePlanNotes(home);
  migrator = makeMigrator(async name => { if (name === point) throw new Error(`crash at ${name}`); });
  await expect(cutover()).rejects.toThrow(`crash at ${point}`);
  // Partial cutover: the legacy writer refuses and no scoped backend is active.
  await expect(legacy.execute({ op: "captain", plan: "scheduler", revision: 1, subjectHash: "f".repeat(64), action: "hold", text: "" }, randomUUID(), "board:captain")).rejects.toThrow();
  expect((await store.read()).backends.filter(b => b.planId === "scheduler" && b.state === "active")).toEqual([]);
  migrator = makeMigrator();
  let m = await migrator.resume(input);
  if (m.state === "prepared") { await migrator.reconcile(input.migrationId); await migrator.barrier(input.migrationId); }
  m = await migrator.commit(input.migrationId);
  const status = await store.read();
  expect(m.state).toBe("committed");
  expect(status.migrations!.map(x => x.id)).toEqual([input.migrationId]);
  expect(status.backends.filter(b => b.planId === "scheduler")).toEqual([expect.objectContaining({ state: "active", backend: "scoped" })]);
  expect(await store.requestReceipt(input.migrationId)).not.toBeNull();
});

it("A13.store: a source change during the freeze refuses the barrier and the commit", async () => {
  await migrator.arm();
  await migrator.prepare(input); await migrator.reconcile(input.migrationId);
  const first = (await readdir(join(legacy.root, "scheduler"))).sort()[0]!;
  await writeFile(join(legacy.root, "scheduler", first), `${await readFile(join(legacy.root, "scheduler", first), "utf8")} `);
  await expect(migrator.barrier(input.migrationId)).rejects.toThrow(/source changed/);
  expect((await store.read()).migrations![0]!.state).toBe("prepared");
});

it("A13.store: after commit the legacy writer stays refused, even without its sidecar, and nothing rolls back", async () => {
  await migrator.arm();
  await cutover();
  await expect(captain("scheduler", "hold")).rejects.toBeInstanceOf(LegacyCutoverError);
  await rm(join(legacy.root, ".scoped", "scheduler"), { recursive: true });
  await expect(captain("scheduler", "hold")).rejects.toThrow(/scoped supervisor/);
  const s = await store.read(), backend = s.backends.find(b => b.planId === "scheduler")!, m = s.migrations![0]!;
  await expect(store.transact([{ kind: "backend", id: "scheduler", version: backend.version }], randomUUID(),
    [{ kind: "backend", value: { ...backend, version: backend.version + 1, state: "prepared" } }])).rejects.toMatchObject({ code: "HELD" });
  await expect(store.transact([{ kind: "migration", id: m.id, version: m.version }], randomUUID(),
    [{ kind: "migration", value: { ...m, version: m.version + 1, state: "barrier" } }])).rejects.toMatchObject({ code: "HELD" });
});

it("A13.store: neither backend writes while prepared; the scoped plan cannot be advanced before commit", async () => {
  await migrator.arm();
  await migrator.prepare(input);
  const s = await store.read(), p = s.plans[0]!.plan, backend = s.backends[0]!;
  const event = { version: 1, home: (await readFile(join(legacy.root, "scheduler", "00000000.json"), "utf8")) && JSON.parse(await readFile(join(legacy.root, "scheduler", "00000000.json"), "utf8")).home,
    plan: "scheduler", sequence: p.sequence + 1, previous: p.hash, requestId: randomUUID(), requestHash: digest({ op: "ack", plan: "scheduler", ids: ["x"], kind: "told" }),
    at: new Date().toISOString(), by: OWNER, command: { op: "ack", plan: "scheduler", ids: ["x"], kind: "told" } };
  await expect(store.transact([{ kind: "workflow", id: "scheduler", version: 1 }], randomUUID(), [{ kind: "workflow", scopeId: input.scopeId, event: { ...event, hash: digest(event) } as never }]))
    .rejects.toMatchObject({ code: "HELD" });
  await expect(store.transact([{ kind: "backend", id: "scheduler", version: 1 }], randomUUID(), [{ kind: "backend", value: { ...backend, version: 2, state: "active" } }]))
    .rejects.toMatchObject({ code: "HELD" });
  await expect(captain("scheduler", "hold")).rejects.toBeInstanceOf(LegacyCutoverError);
  expect(migrationUuid(input.migrationId, "barrier")).toMatch(/^[0-9a-f-]{36}$/);
});

it("queueMateNote and watch-runtime traffic keep their legacy route through the gate during a freeze", async () => {
  await migrator.arm(); await migrator.prepare(input);
  await queueMateNote(api, "A general crew note about scheduler.");
  expect(sent.map(s => s.text)).toEqual(["A general crew note about scheduler."]);
  expect(watchItem({ name: "w", ran: "r", kind: "output", text: "t" }).id).toBe("w@r#output");
});

it("exports a separate scoped projection bound to its preimage; backlog bytes and direct edits stay out of authority", async () => {
  const backlog = await readFile(join(home, "data/backlog.md"), "utf8");
  await migrator.arm();
  const receipt = await cutover();
  expect(receipt.projectionPreimage.backlog).toBe(sha(backlog));
  const first = await exportScopedProjection(home, receipt, await store.read(), null);
  expect(first.preimage).toBeNull();
  await expect(exportScopedProjection(home, receipt, await store.read(), null)).rejects.toMatchObject({ code: "STALE" });
  expect((await exportScopedProjection(home, receipt, await store.read(), first.text)).preimage).toBe(sha(first.text));
  expect(await readFile(join(home, "data/backlog.md"), "utf8")).toBe(backlog);
  await expect(writeTextFile(home, { path: first.path, content: "edited", expectedModifiedMs: null, force: true })).rejects.toThrow(/projection/);
  await writeTextFile(home, { path: "data/scoped/proposals/scheduler.md", content: "Proposal", expectedModifiedMs: null, force: true });
});
