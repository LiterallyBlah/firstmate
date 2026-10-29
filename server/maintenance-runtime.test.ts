import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { PluginServerContext } from "@getpaseo/plugin/server";
import { FirstmateConfigSchema } from "../shared/fleet";
import type { MaintenanceCommand } from "../shared/maintenance-runtime";
import { MaintenanceCommandSchema } from "../shared/maintenance-runtime";
import { MaintenanceRuntime, registerMaintenanceRuntime } from "./maintenance-runtime";
import { SupervisionRuntime } from "./supervision-runtime";
import { SupervisionStore } from "./supervision-store";
import { SupervisionCommands } from "./supervision-commands";
import { SupervisionGateway } from "./supervision-effects";
import { SupervisorSessions, activationEffects } from "./supervisor-sessions";
import { SupervisionJobs } from "./supervision-jobs";
import { expected, hash } from "../test/supervision-fixture";
import { SyntheticReceiver } from "../test/synthetic-receiver";
import { WatchConfigStore } from "./watch-config";
import { readTimerInventory } from "./watch-service";
import type { PaseoApi } from "./host-types";
import type { NativeTimerInventory } from "./archive-inventory";
import type { SupervisionEffect } from "../shared/supervision";
import { digest } from "./submissions";
import { withScopedNeedsYou } from "./needs-you-service";
import { attentionSnapshot } from "../test/attention-deck-fixture";
import { withScopeInboxContext } from "./scope-inbox";
import { filterScopeInbox } from "../shared/scope-inbox";
import { NeedsYouSnapshotSchema } from "../shared/needs-you";
import { registerScopeRpcs } from "./scope-rpc";

vi.setConfig({ testTimeout: 30000 });
const SCOPE = "00000000-0000-4000-8000-000000000001", JOB = "00000000-0000-4000-8000-000000000002";
const api = {} as PaseoApi;
const profile = { provider: "codex/test", modeId: "full-access", thinkingOptionId: "xhigh" };
const captain = { kind: "captain-ui" as const, id: "fixture", source: "fixture" };
let home: string, root: string, runtime: SupervisionRuntime, service: MaintenanceRuntime, receiver: SyntheticReceiver,
  clock: string, watchConfig: WatchConfigStore, config: ReturnType<typeof FirstmateConfigSchema.parse>, native: NativeTimerInventory;
const make = (enabled = true, observationTimeoutMs = 5000, headroom = { slots: 4, reserved: 1 }) => new MaintenanceRuntime(runtime, { enabled, config: async () => config, now: () => clock, receiver: () => receiver, observationTimeoutMs, headroom,
  inventory: (home, config, jobs) => readTimerInventory(home, config, watchConfig, native, jobs) });
beforeEach(async () => {
  root = join(process.env.PASEO_HOME!, randomUUID()); home = join(root, "home");
  await mkdir(join(home, "data"), { recursive: true }); await mkdir(join(home, "watches"));
  await writeFile(join(home, "watches", "storage-probe"), "#!/usr/bin/env node\n// schedule: 15 3 * * *\n");
  config = FirstmateConfigSchema.parse({ home, mateAgentId: "general", disabledWatches: ["board-review", "launch-metrics.mjs", "metis-pentest", "workspace-review"] });
  watchConfig = new WatchConfigStore(join(root, "watch-config.json"));
  await watchConfig.create({ name: "Take-the-Initiative", schedule: "*/30 * * * *", prompt: "Synthetic initiative", enabled: true,
    executionSession: "current", newSessionReasoning: "inherit", notificationPolicy: "never" });
  native = { complete: true, schedules: [] }; receiver = new SyntheticReceiver(); clock = "2026-10-26T12:00:00Z";
  runtime = new SupervisionRuntime(root, (data, home) => new SupervisionStore(data, home, { writable: true,
    processIdentity: async () => ({ state: "alive", start: "fixture" }) }));
  service = make();
});
afterEach(async () => { service.stop(); await runtime.stop(); vi.restoreAllMocks(); });
const admin = async (command: MaintenanceCommand, requestId = randomUUID(), actorId = "general") =>
  service.admin({ homeId: (await service.read()).homeId, requestId, actorId, command });
async function scope(bound = true, scopeId = SCOPE) {
  if (bound) {
    await service.admit({ homeId: (await service.read()).homeId, requestId: randomUUID(), scopeId, name: "Storage maintenance", profile,
      limits: { supervisorSessions: 1, supervisorTurns: 20 } }, api);
    receiver.finish((await service.read()).owners.find(o => o.scopeId === scopeId)!.agentId!); return;
  }
  await runtime.mutate(home, async store => {
    const mutation = { kind: "scope" as const, value: { id: scopeId, homeId: store.homeId, kind: "maintenance" as const, mode: "scoped" as const,
      state: "dormant" as const, version: 1, projectIds: [], sponsorId: null } };
    await store.transact(expected([mutation]), randomUUID(), [mutation]);
  });
}
const definition = (): Extract<MaintenanceCommand, { op: "job" }> => ({ op: "job", input: { jobId: JOB, expectedVersion: 0, scopeId: SCOPE,
  name: "Storage observation", domain: "host-storage", mode: "observe", schedule: { kind: "daily", at: "03:15", zone: "Europe/London" },
  hosts: ["ariadne", "dgx", "light"], resource: { class: "cleanup", keys: ["host:{host}:cache"] }, selectors: [{ kind: "path-prefix", value: "/cache" }],
  retained: [], legacyTimer: { kind: "script-watch", id: "storage-probe", disposition: "retained", evidence: [] }, budget: { turns: 4 }, maxPasses: 2 } });
async function job() { return (await service.read()).jobs[0]!; }
async function activate(bound = true) {
  await scope(bound); await admin(definition());
  await admin({ op: "state", jobId: JOB, expectedVersion: (await job()).version, state: "active" });
  service.remember(api); clock = "2026-10-27T03:15:00Z"; await service.tick();
}
async function observe(outcome: "completed" | "offline" | "failed", hostId = "light", detail = "Fixture result") {
  return admin({ op: "observe", input: { occurrenceId: (await service.read()).occurrences.filter(o => o.jobId === JOB).sort((a, b) => a.dueAt.localeCompare(b.dueAt)).at(-1)!.id, hostId, outcome, detail, resultDigest: hash } });
}
function nextMinute() { clock = new Date(Date.parse(clock) + 60000).toISOString().replace(/\.\d{3}Z$/, "Z"); }

it("F1/A04 fresh-home registered app admission creates the first verified owner and admits its first job", async () => {
  const handlers = new Map<string, (input: unknown, context: { paseo: PaseoApi }) => Promise<unknown>>();
  registerMaintenanceRuntime({ handle: (rpc: { name: string }, handler: (input: unknown, context: { paseo: PaseoApi }) => Promise<unknown>) => handlers.set(rpc.name, handler),
    on: () => () => {} } as unknown as PluginServerContext, service);
  const read = await service.read(), input = { homeId: read.homeId, requestId: randomUUID(), scopeId: SCOPE, name: "Storage maintenance", profile,
    limits: { supervisorSessions: 1, supervisorTurns: 20 } };
  expect(handlers.has("firstmate.maintenance.admit-ui")).toBe(true);
  await handlers.get("firstmate.maintenance.admit-ui")!(input, { paseo: api });
  const owner = (await service.read()).owners[0]!;
  expect(owner).toMatchObject({ scopeId: SCOPE, state: "active", sessions: 1, turns: 1 });
  expect(owner.agentId).not.toBe("general"); expect(receiver.sends).toHaveLength(1);
  await handlers.get("firstmate.maintenance.admin")!({ homeId: read.homeId, requestId: randomUUID(), actorId: "general", command: definition() }, { paseo: api });
  expect((await service.read()).jobs).toHaveLength(1);
  const before = (await service.read()).sequence;
  await handlers.get("firstmate.maintenance.admit-ui")!(input, { paseo: api });
  expect((await service.read()).sequence).toBe(before); expect(receiver.sends).toHaveLength(1);
});

it.each(["createAgent", "send"] as const)("F1/A10 fresh-client resume retains the original owner/spend after lost %s reply", async operation => {
  receiver.faults[operation] = ["lose"];
  const input = { homeId: (await service.read()).homeId, requestId: randomUUID(), scopeId: SCOPE, name: "Storage maintenance", profile,
    limits: { supervisorSessions: 1 as const, supervisorTurns: 20 } };
  await service.admit(input, api);
  const first = (await service.read()).owners[0]!, calls = receiver.calls.filter(c => c.op === operation).length;
  expect(first).toMatchObject({ sessions: 1, turns: 1, uncertain: 1, admission: input });
  service.stop(); await runtime.stop(); runtime = new SupervisionRuntime(root, (data, home) => new SupervisionStore(data, home, { writable: true,
    processIdentity: async () => ({ state: "alive", start: "fixture" }) })); service = make();
  await service.admit({ homeId: input.homeId, requestId: input.requestId, resume: true }, api);
  const resumed = (await service.read()).owners[0]!;
  expect(resumed.agentId).toBe(first.agentId); expect(resumed).toMatchObject({ sessions: 1, turns: 1 });
  expect(receiver.calls.filter(c => c.op === operation)).toHaveLength(calls);
  expect(resumed.opening).toBe(operation === "send" ? "uncertain" : "succeeded");
  await expect(service.admit({ ...input, name: "Changed input" }, api)).rejects.toMatchObject({ code: "CONFLICT" });
  await expect(service.admit({ ...input, requestId: randomUUID() }, api)).rejects.toMatchObject({ code: "CONFLICT" });
});

it("F1/A21 app admission is default-off, rejects changed homes and refuses an unverified receiver profile before opening", async () => {
  const off = make(false), input = { homeId: (await service.read()).homeId, requestId: randomUUID(), scopeId: SCOPE, name: "Storage maintenance", profile,
    limits: { supervisorSessions: 1 as const, supervisorTurns: 20 } }, files = await readdir(root);
  await expect(off.admit(input, api)).rejects.toMatchObject({ code: "UNSUPPORTED" });
  await expect(service.admit({ ...input, homeId: "changed" }, api)).rejects.toMatchObject({ code: "STALE" });
  expect(await readdir(root)).toEqual(files); expect(receiver.calls).toEqual([]);
  receiver.tamper = agent => { agent.provider = "different/model"; };
  await expect(service.admit(input, api)).rejects.toMatchObject({ code: "HELD" });
  expect(receiver.sends).toEqual([]); expect((await service.read()).owners[0]).toMatchObject({ sessions: 1, turns: 1, state: "transferring" });
});

it("F1/A20 maintenance admission retains configured General headroom and resumes only after capacity is free", async () => {
  service.stop(); service = make(true, 5000, { slots: 3, reserved: 2 });
  const first = { homeId: (await service.read()).homeId, requestId: randomUUID(), scopeId: SCOPE, name: "First owner", profile,
    limits: { supervisorSessions: 1 as const, supervisorTurns: 20 } };
  await service.admit(first, api); const calls = receiver.calls.length;
  const second = { ...first, requestId: randomUUID(), scopeId: randomUUID(), name: "Second owner" };
  await expect(service.admit(second, api)).rejects.toMatchObject({ code: "HELD", message: expect.stringContaining("General headroom") });
  expect(receiver.calls).toHaveLength(calls); expect((await service.read()).owners.find(o => o.scopeId === second.scopeId)).toMatchObject({ sessions: 0, turns: 0 });
  receiver.finish((await service.read()).owners.find(o => o.scopeId === SCOPE)!.agentId!);
  await service.admit({ homeId: first.homeId, requestId: second.requestId, resume: true }, api);
  expect((await service.read()).owners.find(o => o.scopeId === second.scopeId)).toMatchObject({ state: "active", sessions: 1, turns: 1 });
});

it("F2/A20 a real zero-budget incident creates one scoped captain decision without waking General or the owner", async () => {
  await scope(); const input = definition(); input.input.budget = { turns: 0 }; await admin(input);
  await admin({ op: "state", jobId: JOB, expectedVersion: 1, state: "active" });
  service.remember(api); clock = "2026-10-27T03:15:00Z"; await service.tick(); await observe("failed"); nextMinute(); await service.tick();
  const state = await runtime.read(home);
  expect(state.decisions.filter(d => d.state === "pending")).toHaveLength(1);
  const inbox = withScopedNeedsYou({ ...attentionSnapshot([]), homeId: state.homeId }, state);
  expect(inbox.scopedDecisions).toMatchObject([{ captain: { scope: { kind: "maintenance" } }, ready: true }]);
  expect(inbox.actionCount).toBe(1); expect(inbox.scopedPendingAnswerCount).toBe(0);
  expect(inbox.scopedDecisions![0]!.answerContext).toBeUndefined();
  expect(state.outbox).toEqual([]); expect(receiver.sends).toHaveLength(1);
  nextMinute(); await service.tick(); expect((await runtime.read(home)).decisions).toEqual(state.decisions);
});

it.each([false, true])("F2/A10/A20 checked app answers retain context/outbox across restart and uncertain delivery=%s", async lost => {
  await scope(); const input = definition(); input.input.budget = { turns: 0 }; await admin(input);
  await admin({ op: "state", jobId: JOB, expectedVersion: 1, state: "active" });
  service.remember(api); clock = "2026-10-27T03:15:00Z"; await service.tick(); await observe("failed"); nextMinute(); await service.tick();
  const snapshot = await service.read(), choice = snapshot.captainDecisions[0]!, owner = snapshot.owners[0]!;
  expect(choice).toMatchObject({ format: "firstmate.scoped-captain-decision/1", scope: { kind: "maintenance", id: SCOPE }, origin: { kind: "maintenance" }, permittedActions: ["answer"], recommendation: "keep-held" });
  expect(choice.options.map(o => o.number)).toEqual([1, 2]);
  const answer = { homeId: snapshot.homeId, submissionId: randomUUID(), decisionId: choice.decisionId, revision: choice.revision,
    subjectHash: choice.subjectHash, evidence: snapshot.decisions[0]!.maintenance!.evidence, option: "review-budget", text: "Review the allocation before any new work." };
  await expect(service.answer({ ...answer, revision: choice.revision + 1 }, api)).rejects.toMatchObject({ code: "STALE" });
  await expect(service.answer({ ...answer, evidence: [{ ref: "changed", digest: hash }] }, api)).rejects.toMatchObject({ code: "STALE" });
  await expect(service.answer({ ...answer, option: "invented" }, api)).rejects.toMatchObject({ code: "STALE" });
  await service.answer(answer, api); const accepted = await service.read();
  expect(accepted.captainDecisions).toEqual([]); expect(accepted.outbox).toMatchObject([{ id: answer.submissionId, ownerScopeId: SCOPE, state: "pending", maintenance: true }]);
  expect(accepted.decisions[0]!.answer).toMatchObject({ provenance: { kind: "plugin-ui-unverified" }, outboxId: answer.submissionId });
  const inbox = withScopedNeedsYou({ ...attentionSnapshot([]), homeId: accepted.homeId }, await runtime.read(home));
  expect(inbox.scopedDecisions).toMatchObject([{ decision: { state: "answered" }, ready: false }]);
  expect(inbox.actionCount).toBe(0); expect(inbox.scopedPendingAnswerCount).toBe(1); expect(inbox.pendingAnswerCount).toBe(1);
  expect((await job()).budget).toEqual({ turns: 0 }); expect(receiver.sends).toHaveLength(1);
  await service.answer(answer, api); expect((await service.read()).sequence).toBe(accepted.sequence);
  await expect(service.answer({ ...answer, text: "Different answer" }, api)).rejects.toMatchObject({ code: "CONFLICT" });
  if (lost) receiver.faults.send = ["lose"];
  nextMinute(); await service.tick();
  expect(receiver.sends).toHaveLength(2); expect(receiver.sends.at(-1)!.agentId).toBe(owner.agentId); expect(receiver.sends.at(-1)!.text).toContain(answer.submissionId);
  service.stop(); service = make(); service.remember(api); nextMinute(); await service.tick(); expect(receiver.sends).toHaveLength(2);
  const handling = { op: "answer-handled" as const, outboxId: answer.submissionId, epoch: owner.epoch, evidence: [{ ref: "checked/owner-result", digest: hash }] };
  await expect(admin(handling, randomUUID(), "general")).rejects.toMatchObject({ code: "HELD" });
  if (lost) {
    await expect(admin(handling, randomUUID(), owner.agentId!)).rejects.toMatchObject({ code: "HELD" });
    expect((await service.read()).outbox[0]!.state).toBe("pending"); expect((await service.read()).owners[0]).toMatchObject({ turns: 2, uncertain: 1 });
  } else {
    const id = randomUUID(); await admin(handling, id, owner.agentId!); const handled = await admin(handling, id, owner.agentId!);
    expect(handled.outbox[0]).toMatchObject({ state: "handled", handledEpoch: owner.epoch });
  }
});

it("F3/A20/A21 a real owner authority choice enters the shared inbox and its app answer retains global pending totals under every filter", async () => {
  const handlers = new Map<string, (input: any, context: { paseo: PaseoApi }) => Promise<any>>();
  const server = { handle: (rpc: { name: string }, handler: any) => handlers.set(rpc.name, handler), on: () => () => {} } as unknown as PluginServerContext;
  registerMaintenanceRuntime(server, service);
  const readNeeds = async () => {
    const state = await runtime.read(home);
    return { ...withScopeInboxContext(withScopedNeedsYou({ ...attentionSnapshot([]), homeId: state.homeId }, state), state), maintenanceAnswersEnabled: true };
  };
  registerScopeRpcs(server, { readNeeds, read: async () => ({ home, generalId: "general", status: await runtime.read(home) }) });
  const sharedRead = async () => NeedsYouSnapshotSchema.parse(await handlers.get("firstmate.scope.needs")!({}, { paseo: api }));
  await activate(); await observe("failed"); nextMinute(); await service.tick();
  expect(await sharedRead()).toMatchObject({ actionCount: 0, pendingAnswerCount: 0, scopedDecisions: [] });
  const snapshot = await service.read(), incident = snapshot.incidents.find(i => i.kind === "failure")!, owner = snapshot.owners[0]!;
  await handlers.get("firstmate.maintenance.admin")!({ homeId: snapshot.homeId, requestId: randomUUID(), actorId: owner.agentId!, command: {
    op: "escalate", input: { incidentId: incident.id, generation: incident.generation, epoch: owner.epoch, kind: "authority",
      question: "Keep held pending a separately reviewed plan?", options: [{ id: "hold", label: "Keep held" }, { id: "plan", label: "Request a reviewed plan" }],
      recommendation: "hold", evidence: [{ ref: "verified/authority-report", digest: hash }] } } }, { paseo: api });
  const before = await sharedRead(), row = before.scopedDecisions![0]!;
  expect(before).toMatchObject({ actionCount: 1, scopedPendingAnswerCount: 0, pendingAnswerCount: 0, maintenanceAnswersEnabled: true });
  expect(row).toMatchObject({ ready: true, captain: { scope: { kind: "maintenance", id: SCOPE }, origin: { kind: "maintenance", id: incident.id }, permittedActions: ["answer"] },
    maintenanceAnswerContext: { homeId: snapshot.homeId, decisionId: row.decision.id, revision: row.decision.revision, subjectHash: row.decision.subjectHash, evidence: [{ ref: "verified/authority-report", digest: hash }] } });
  expect(row.answerContext).toBeUndefined();
  const answer = { ...row.maintenanceAnswerContext!, submissionId: randomUUID(), option: "hold", text: "Retain the hold; no work authority." };
  await handlers.get("firstmate.maintenance.answer-ui")!(answer, { paseo: api });
  const after = await sharedRead();
  expect(after).toMatchObject({ actionCount: 0, scopedPendingAnswerCount: 1, pendingAnswerCount: 1 });
  expect(after.scopedDecisions).toMatchObject([{ ready: false, decision: { state: "answered", answer: { submissionId: answer.submissionId, outboxId: answer.submissionId } }, captain: { permittedActions: [] } }]);
  expect(after.scopedDecisions![0]!.maintenanceAnswerContext).toBeUndefined();
  expect((await service.read()).outbox).toMatchObject([{ maintenance: true, ownerScopeId: SCOPE, state: "pending" }]);
  for (const snapshot of [before, after]) {
    for (const kind of ["all", "general", "project", "plan", "maintenance"] as const) {
      const view = filterScopeInbox(snapshot, { kind });
      expect([view.actionCount, view.pendingAnswerCount, view.scopedPendingAnswerCount]).toEqual([snapshot.actionCount, snapshot.pendingAnswerCount, snapshot.scopedPendingAnswerCount]);
      expect(view.scopedDecisions).toHaveLength(kind === "all" || kind === "maintenance" ? 1 : 0);
    }
  }
  const latest = await runtime.read(home);
  expect(withScopedNeedsYou(after, latest)).toEqual(after);
  const incomplete = withScopedNeedsYou(after, { ...latest, freshness: "held" });
  expect(incomplete).toMatchObject({ scopedComplete: false, pendingAnswerCount: 1, scopedPendingAnswerCount: 1 });
});

it("F2/A20 only the exact maintenance owner escalates genuine authority choices; routine incidents stay out of captain counts", async () => {
  await activate(); await observe("failed"); nextMinute(); await service.tick();
  const snapshot = await service.read(), incident = snapshot.incidents.find(i => i.kind === "failure")!, owner = snapshot.owners[0]!;
  expect(snapshot.captainDecisions).toEqual([]);
  const escalation: MaintenanceCommand = { op: "escalate", input: { incidentId: incident.id, generation: incident.generation, epoch: owner.epoch, kind: "authority",
    question: "The existing probe needs an authority decision. Keep the hold or request a separately reviewed corrective plan?", options: [{ id: "hold", label: "Keep held" }, { id: "plan", label: "Request a reviewed plan" }],
    recommendation: "hold", evidence: [{ ref: "verified/probe-report", digest: hash }] } };
  await expect(admin(escalation, randomUUID(), "general")).rejects.toMatchObject({ code: "UNKNOWN_OWNER" });
  await expect(admin(escalation, randomUUID(), "other-owner")).rejects.toMatchObject({ code: "UNKNOWN_OWNER" });
  const id = randomUUID(); await admin(escalation, id, owner.agentId!); const accepted = await admin(escalation, id, owner.agentId!);
  expect(accepted.captainDecisions).toHaveLength(1); expect(accepted.outbox).toEqual([]);
  const choice = accepted.captainDecisions[0]!; const edit = definition(); edit.input.expectedVersion = (await job()).version; edit.input.budget = { turns: 5 }; await admin(edit);
  await expect(service.answer({ homeId: accepted.homeId, submissionId: randomUUID(), decisionId: choice.decisionId, revision: choice.revision, subjectHash: choice.subjectHash,
    evidence: accepted.decisions[0]!.maintenance!.evidence, option: "hold", text: "" }, api)).rejects.toMatchObject({ code: "STALE" });
  expect((await service.read()).captainDecisions[0]!.permittedActions).toEqual([]);
});

it("F2/A20 exhausted captain-approved owner caps emit one budget choice and never borrow a turn for its answer", async () => {
  await service.admit({ homeId: (await service.read()).homeId, requestId: randomUUID(), scopeId: SCOPE, name: "Storage", profile,
    limits: { supervisorSessions: 1, supervisorTurns: 1 } }, api);
  receiver.finish((await service.read()).owners[0]!.agentId!); await admin(definition());
  await admin({ op: "state", jobId: JOB, expectedVersion: 1, state: "active" }); clock = "2026-10-27T03:15:00Z"; await service.tick();
  await observe("failed"); nextMinute(); await service.tick();
  const snapshot = await service.read(), choice = snapshot.captainDecisions[0]!;
  expect(snapshot.captainDecisions).toHaveLength(1); expect(choice.question).toContain("owner turn limit is spent");
  const answer = { homeId: snapshot.homeId, submissionId: randomUUID(), decisionId: choice.decisionId, revision: choice.revision, subjectHash: choice.subjectHash,
    evidence: snapshot.decisions[0]!.maintenance!.evidence, option: "keep-held", text: "No additional turns authorized." };
  await service.answer(answer, api); nextMinute(); await service.tick(); nextMinute(); await service.tick();
  expect(receiver.sends).toHaveLength(1); expect((await service.read()).owners[0]!.turns).toBe(1);
  expect((await service.read()).outbox[0]!.state).toBe("pending"); expect((await service.read()).decisions).toHaveLength(1);
});

it("F2/A20 checked answer outboxes remain deliverable to the logical owner after the last job stops", async () => {
  await activate(); await observe("failed"); nextMinute(); await service.tick();
  const initial = await service.read(), incident = initial.incidents.find(i => i.kind === "failure")!, owner = initial.owners[0]!;
  await admin({ op: "escalate", input: { incidentId: incident.id, generation: incident.generation, epoch: owner.epoch, kind: "authority", question: "Keep the job stopped pending a reviewed plan?",
    options: [{ id: "stop", label: "Keep stopped" }, { id: "plan", label: "Request a plan" }], recommendation: "stop", evidence: [{ ref: "report", digest: hash }] } }, randomUUID(), owner.agentId!);
  const snapshot = await service.read(), choice = snapshot.captainDecisions[0]!;
  await service.answer({ homeId: snapshot.homeId, submissionId: randomUUID(), decisionId: choice.decisionId, revision: choice.revision, subjectHash: choice.subjectHash,
    evidence: snapshot.decisions[0]!.maintenance!.evidence, option: "stop", text: "Stop pending review." }, api);
  await admin({ op: "state", jobId: JOB, expectedVersion: (await job()).version, state: "stopped" }); receiver.finish(owner.agentId!);
  const baseline = receiver.sends.length; nextMinute(); await service.tick();
  expect(receiver.sends).toHaveLength(baseline + 1); expect((await service.read()).outbox[0]!.state).toBe("pending");
});

it("P3/A06 a successfully delivered unacknowledged incident does not starve another host, but uncertainty still holds", async () => {
  await activate(); await observe("offline", "light", "Light outage"); nextMinute(); await service.tick();
  receiver.finish((await service.read()).owners[0]!.agentId!);
  await observe("failed", "dgx", "Separate DGX failure"); nextMinute(); await service.tick();
  expect(receiver.sends).toHaveLength(3);
  expect((await service.read()).deliveries.filter(d => d.state === "succeeded")).toHaveLength(2);
});

it("A13/A21 production registration, reads and default-off clock create no store, session, timer or approval", async () => {
  const handlers = new Map<string, (...args: never[]) => unknown>(), off = make(false);
  const dispose = registerMaintenanceRuntime({ handle: (rpc: { name: string }, handler: (...args: never[]) => unknown) => handlers.set(rpc.name, handler),
    on: () => () => {} } as unknown as PluginServerContext, off);
  expect([...handlers.keys()]).toEqual(["firstmate.maintenance.read", "firstmate.maintenance.timers", "firstmate.maintenance.summary", "firstmate.maintenance.admin", "firstmate.maintenance.admit-ui", "firstmate.maintenance.answer-ui"]);
  const files = await readdir(root), fingerprint = await watchConfig.fingerprint();
  expect(await off.read()).toMatchObject({ enabled: false, cleanup: { state: "held" }, jobs: [], owners: [] });
  expect(await off.census()).toMatchObject({ initiative: { managed: ["managed:Take-the-Initiative"], disposition: "managed-owner-retained" } });
  await off.tick(); await expect(off.admin({ homeId: (await off.read()).homeId, requestId: randomUUID(), actorId: "general", command: definition() })).rejects.toMatchObject({ code: "UNSUPPORTED" });
  expect(await readdir(root)).toEqual(files); expect(await watchConfig.fingerprint()).toBe(fingerprint); expect(receiver.calls).toEqual([]); dispose();
});

it("A06/A17 healthy/all configured hosts and unchanged outages write no model wake; changed incidents go only to their maintenance owner", async () => {
  await activate(); const baseline = receiver.sends.length, timers = await watchConfig.fingerprint();
  expect((await service.read()).hosts.map(h => h.hostId).sort()).toEqual(["ariadne", "dgx", "light"]);
  await observe("completed", "ariadne"); nextMinute(); await service.tick(); expect(receiver.sends).toHaveLength(baseline);
  await observe("offline", "light", "Light unavailable"); nextMinute(); await service.tick();
  let read = await service.read(); expect(receiver.sends).toHaveLength(baseline + 1);
  const owner = read.owners[0]!; expect(receiver.sends.at(-1)!.agentId).toBe(owner.agentId); expect(owner.agentId).not.toBe("general");
  expect(receiver.sends.at(-1)!.text).toContain("Light unavailable"); expect(read.deliveries[0]!.state).toBe("succeeded");
  const sequence = read.sequence; await observe("offline", "light", "Light unavailable"); nextMinute(); await service.tick();
  expect((await service.read()).sequence).toBe(sequence); expect(receiver.sends).toHaveLength(baseline + 1);
  const i = read.incidents[0]!; const ack = { op: "ack" as const, incidentId: i.id, generation: i.generation, epoch: owner.epoch }, ackId = randomUUID();
  await expect(admin(ack, randomUUID(), "general")).rejects.toMatchObject({ code: "HELD" });
  await admin(ack, ackId, owner.agentId!); read = await admin(ack, ackId, owner.agentId!);
  expect(read.incidents[0]!.notify.state).toBe("handled");
  // D5 restart/catch-up: unchanged offline signature across a new day remains silent.
  service.stop(); service = make(); service.remember(api); clock = "2026-10-30T03:16:00Z"; await service.tick();
  await observe("offline", "light", "Light unavailable"); nextMinute(); await service.tick();
  expect(receiver.sends).toHaveLength(baseline + 1); expect((await service.read()).occurrences.at(-1)!.missed.count).toBe(2);
  expect(await watchConfig.fingerprint()).toBe(timers);
});

it("A10/A20 unknown incident delivery survives restart with the original identity/spend and no retry or false acknowledgement", async () => {
  await activate(); await observe("failed", "dgx", "Exact failed probe"); receiver.faults.send = ["lose"];
  nextMinute(); await service.tick(); const read = await service.read(), sent = receiver.calls.filter(c => c.op === "send").length;
  expect(read.deliveries[0]!.state).toBe("uncertain"); expect(read.owners[0]).toMatchObject({ sessions: 1, turns: 2, uncertain: 1 });
  service.stop(); service = make(); service.remember(api); nextMinute(); await service.tick();
  expect(receiver.calls.filter(c => c.op === "send")).toHaveLength(sent);
  await expect(admin({ op: "ack", incidentId: read.incidents[0]!.id, generation: 1, epoch: 1 }, randomUUID(), read.owners[0]!.agentId!)).rejects.toMatchObject({ code: "HELD" });
  expect((await service.read()).owners[0]).toMatchObject({ sessions: 1, turns: 2, uncertain: 1 });
});

it("A20 an unknown job budget or missing binding holds incidents without General fallback", async () => {
  await scope(false); const input = definition(); input.input.budget = null; await admin(input);
  await admin({ op: "state", jobId: JOB, expectedVersion: 1, state: "active" }); clock = "2026-10-27T03:15:00Z"; service.remember(api); await service.tick();
  await observe("offline"); nextMinute(); await service.tick(); const read = await service.read();
  expect(read.incidents.filter(i => i.kind === "budget")).toHaveLength(1); expect(read.deliveries.every(d => d.state === "held-budget")).toBe(true); expect(receiver.sends).toEqual([]);
});

it("A17/A21 retirement requires a fresh exact disabled known timer and evidence; stale replay never changes history", async () => {
  await activate(); let census = await service.census(); const original = await watchConfig.fingerprint();
  const retire = (fingerprint: string): Extract<MaintenanceCommand, { op: "retired" }> => ({ op: "retired", jobId: JOB, expectedVersion: (2), timerId: "script:storage-probe", inventoryHash: fingerprint,
    evidence: [{ ref: "fixture/owner-disabled", digest: hash }] });
  await expect(admin(retire(census.fingerprint))).rejects.toMatchObject({ code: "HELD" });
  config = { ...config, disabledWatches: [...config.disabledWatches, "storage-probe"] };
  await expect(admin(retire(census.fingerprint))).rejects.toMatchObject({ code: "STALE" });
  census = await service.census(); const input = retire(census.fingerprint), requestId = randomUUID();
  await admin(input, requestId); const sequence = (await service.read()).sequence;
  await admin(input, requestId); expect((await service.read()).sequence).toBe(sequence);
  await expect(admin({ ...input, timerId: "managed:Take-the-Initiative" }, requestId)).rejects.toMatchObject({ code: "CONFLICT" });
  expect((await job()).legacyTimer).toMatchObject({ disposition: "retired", evidence: expect.arrayContaining([{ ref: "timer-census:script:storage-probe", digest: census.fingerprint }]) });
  expect(await watchConfig.fingerprint()).toBe(original); // this records known-owner retirement, never mutates a timer itself
});

it("A17 census detects same-schedule script and native target edits; missing native inventory never certifies retirement", async () => {
  const before = await service.census(); await writeFile(join(home, "watches", "storage-probe"), "#!/usr/bin/env node\n// schedule: 15 3 * * *\n// changed host coverage\n");
  const after = await service.census(); expect(after.fingerprint).not.toBe(before.fingerprint);
  native = { complete: false, reason: "No native listing" }; expect((await service.census()).complete).toBe(false);
  expect((await service.census()).problems).toContain("No native listing");
  native = { complete: true, schedules: [{ id: "old-fleet", name: "Fleet reminder", status: "active", cadence: { type: "cron", expression: "*/30 * * * *" },
    target: { type: "agent", agentId: "old-mate" } }] };
  expect(await service.census()).toMatchObject({ initiative: { nativeReminders: ["native:old-fleet"], disposition: "held-reconciliation" } });
  const withTarget = await service.census(); native.schedules[0]!.target = { type: "agent", agentId: "general" };
  expect((await service.census()).fingerprint).not.toBe(withTarget.fingerprint);
});

it("A04/A21 rejects cleanup/provision/Attach commands and arbitrary or stale owner requests", async () => {
  await activate(); const before = await service.read();
  for (const op of ["attach", "provision", "cleanup", "dispatch", "timer-create"]) expect(MaintenanceCommandSchema.safeParse({ op }).success).toBe(false);
  const input = definition(); expect(MaintenanceCommandSchema.safeParse({ ...input, input: { ...input.input, mode: "advisory" } }).success).toBe(false);
  await expect(admin({ op: "state", jobId: JOB, expectedVersion: (await job()).version, state: "stopped" }, randomUUID(), "guest")).rejects.toMatchObject({ code: "UNKNOWN_OWNER" });
  await expect(service.admin({ homeId: "wrong-home", requestId: randomUUID(), actorId: "general", command: definition() })).rejects.toMatchObject({ code: "STALE" });
  expect((await service.read()).sequence).toBe(before.sequence); expect(before.cleanup.conditions.filter(c => !c.satisfied).map(c => c.id)).toEqual(expect.arrayContaining(["no-follow-delete", "live-readers", "N7", "receiver"]));
});

it("A13 production request queue records verified host results and rejects changed request identities", async () => {
  await activate(); const directory = join(home, "data/maintenance-requests"); await mkdir(directory);
  const id = randomUUID(), command: MaintenanceCommand = { op: "observe", input: { occurrenceId: (await service.read()).occurrences[0]!.id,
    hostId: "ariadne", outcome: "completed", detail: "Verified existing probe", resultDigest: digest("probe evidence") } };
  await writeFile(join(directory, `${id}.json`), JSON.stringify({ id, actor: "general", command }));
  await service.tick(); expect(JSON.parse(await readFile(join(directory, `${id}.reply.json`), "utf8")).ok).toBe(true);
  expect((await service.read()).hosts.find(h => h.hostId === "ariadne")!.state).toBe("completed");
});

it("A06 changed incident generations get one new owner turn while unchanged signatures remain silent", async () => {
  await activate(); await observe("offline", "light", "First outage"); nextMinute(); await service.tick();
  let read = await service.read(); const first = read.incidents[0]!, owner = read.owners[0]!;
  await admin({ op: "ack", incidentId: first.id, generation: 1, epoch: 1 }, randomUUID(), owner.agentId!); receiver.finish(owner.agentId!);
  clock = "2026-10-28T03:16:00Z"; await service.tick(); await observe("offline", "light", "Changed outage evidence"); nextMinute(); await service.tick();
  read = await service.read(); expect(read.incidents.find(i => i.id === first.id)!.generation).toBe(2);
  expect(receiver.sends).toHaveLength(3); // one opening plus exactly one turn per changed incident generation
  const count = read.sequence; nextMinute(); await service.tick(); expect((await service.read()).sequence).toBe(count); expect(receiver.sends).toHaveLength(3);
});

it("A06 a changed incident withdraws only its obsolete never-sent reservation, retaining spend", async () => {
  await activate(); const owner = (await service.read()).owners[0]!.agentId!; receiver.agents.get(owner)!.status = "running";
  await observe("offline", "light", "Original outage"); nextMinute(); await service.tick();
  expect((await service.read()).deliveries[0]!.state).toBe("reserved"); expect(receiver.sends).toHaveLength(1);
  clock = "2026-10-28T03:16:00Z"; await service.tick(); await observe("offline", "light", "Changed outage while owner busy"); receiver.finish(owner);
  nextMinute(); await service.tick();
  expect(receiver.sends).toHaveLength(2); expect(receiver.sends.at(-1)!.text).toContain("Changed outage while owner busy");
  expect((await service.read()).owners[0]!.turns).toBe(3); // old never-sent turn still counts
  const state = await runtime.read(home); expect(state.effects.filter(e => e.operation === "agent.send" && e.state === "cancelled")).toHaveLength(1);
});

it("A20/A21 final admission rechecks stop after native lookup; late replies admit no effect", async () => {
  await activate(); await observe("failed", "dgx", "Probe failure"); nextMinute();
  let enter!: () => void, release!: () => void;
  const ready = new Promise<void>(done => { enter = done; }), gate = new Promise<void>(done => { release = done; });
  const original = receiver.findAgent.bind(receiver), count = receiver.sends.length;
  vi.spyOn(receiver, "findAgent").mockImplementationOnce(async id => { enter(); await gate; return original(id); });
  const ticking = service.tick(); await ready;
  await admin({ op: "state", jobId: JOB, expectedVersion: (await job()).version, state: "stopped" });
  release(); await ticking; expect(receiver.sends).toHaveLength(count);
  expect((await service.read()).owners[0]!.turns).toBe(2); // the reserved turn remains spent, even though the stop refused its send
});

it("A20 one stalled maintenance owner cannot prevent another owner from receiving its incident", async () => {
  await activate(); const otherScope = randomUUID(), otherJob = randomUUID();
  clock = "2026-10-26T12:00:00Z"; await scope(true, otherScope);
  const input = definition(); input.input = { ...input.input, jobId: otherJob, scopeId: otherScope, name: "Other job", hosts: ["other"] };
  await admin(input); await admin({ op: "state", jobId: otherJob, expectedVersion: 1, state: "active" });
  clock = "2026-10-27T03:16:00Z"; await service.tick();
  await observe("failed", "dgx", "First owner failure");
  const read = await service.read(), otherOccurrence = read.occurrences.find(o => o.jobId === otherJob)!;
  await admin({ op: "observe", input: { occurrenceId: otherOccurrence.id, hostId: "other", outcome: "failed", detail: "Second owner failure", resultDigest: hash } });
  const firstId = read.owners.find(o => o.scopeId === SCOPE)!.agentId!, secondId = read.owners.find(o => o.scopeId === otherScope)!.agentId!;
  const original = receiver.findAgent.bind(receiver);
  let entered!: () => void, release!: () => void, firstLookupPending = false;
  const ready = new Promise<void>(done => { entered = done; }), gate = new Promise<void>(done => { release = done; });
  vi.spyOn(receiver, "findAgent").mockImplementation(async id => {
    if (id === firstId) {
      firstLookupPending = true; entered();
      try { await gate; } finally { firstLookupPending = false; }
      return original(id);
    }
    await new Promise(done => setTimeout(done, 250)); return original(id);
  });
  service.stop(); service = make(true, 30000); service.remember(api);
  nextMinute(); const ticking = service.tick();
  try {
    await ready;
    await vi.waitFor(() => expect(receiver.sends.filter(s => s.agentId === secondId)).toHaveLength(2), { timeout: 20000 });
    expect(firstLookupPending).toBe(true);
    expect(receiver.sends.filter(s => s.agentId === firstId)).toHaveLength(1);
  } finally { release(); await ticking; }
}, 60000);

it("A17 approved host coverage cannot shrink when a host goes offline", async () => {
  await activate(); const current = await job(), input = definition(); input.input.expectedVersion = current.version; input.input.hosts = ["ariadne"];
  await expect(admin(input)).rejects.toMatchObject({ code: "HELD", message: expect.stringMatching(/every approved host/) });
  expect((await job()).hosts).toEqual(["ariadne", "dgx", "light"]);
});

it("A04/A10 production resource commands retain all conflicting keys and require matching terminal release", async () => {
  await scope(); const a = randomUUID(), b = randomUUID(), baseline = receiver.calls.length;
  const effect = (id: string): SupervisionEffect => ({ id, logicalKey: `fixture/${id}`, requestId: randomUUID(), requestHash: hash, scopeId: SCOPE,
    epoch: 1, attemptId: null, operation: "fixture.op", planRevision: null, subjectHash: hash, policyVector: [], evidenceVector: [], approvalId: null,
    resourceIds: ["host:light:cache", "host:ariadne:cache"], state: "dispatching", receiverKey: null, receiptRef: null, version: 1 });
  await runtime.mutate(home, async store => { const rows = [a, b].map(id => ({ kind: "effect" as const, value: effect(id) })); await store.transact(expected(rows), randomUUID(), rows); });
  const claim: MaintenanceCommand = { op: "resource-reserve", effectId: a, class: "cleanup", keys: ["host:light:cache", "host:ariadne:cache"], priority: 5, leaseMs: 1000 };
  const requestId = randomUUID(); await admin(claim, requestId); const after = (await service.read()).sequence;
  await admin(claim, requestId); expect((await service.read()).sequence).toBe(after);
  await admin({ ...claim, effectId: b }); let read = await service.read(), held = read.reservations.find(r => r.holder.id === a)!;
  expect(held).toMatchObject({ state: "granted", keys: ["host:ariadne:cache", "host:light:cache"] }); expect(read.reservations.find(r => r.holder.id === b)).toMatchObject({ state: "queued", fences: [] });
  clock = "2026-10-26T12:01:00Z"; await admin({ op: "resource-expire" }); held = (await service.read()).reservations.find(r => r.holder.id === a)!; expect(held.state).toBe("suspect");
  await expect(admin({ op: "resource-release", reservationId: held.id, expectedVersion: held.version, kind: "succeeded", evidence: [{ ref: "fixture", digest: hash }] })).rejects.toMatchObject({ code: "HELD" });
  await runtime.mutate(home, async store => {
    const s = await store.read(), row = s.effects.find(e => e.id === a)!;
    await store.transact([{ kind: "effect", id: a, version: row.version }], randomUUID(), [{ kind: "effect", value: { ...row, state: "succeeded", version: row.version + 1 } }]);
  });
  await admin({ op: "resource-release", reservationId: held.id, expectedVersion: held.version, kind: "succeeded", evidence: [{ ref: "fixture/terminal", digest: hash }] });
  read = await service.read(); await admin({ op: "resource-promote", reservationId: read.reservations.find(r => r.holder.id === b)!.id, leaseMs: null });
  expect((await service.summary()).resources).toMatchObject({ held: 1, queued: 0, suspect: 0 }); expect(receiver.calls).toHaveLength(baseline);
});

it("A13 upgraded storage continues maintenance and summaries past every pilot band without resetting sequence or spend", async () => {
  await activate(); const before = await service.read();
  await runtime.mutate(home, async store => {
    await store.enableLongLived();
    for (let i = 0; i < 260; i++) await store.transactCommand(randomUUID(), hash, captain, async () => ({ expectedVersions: [], mutations: [],
      result: { planId: null, planHash: null, decisionId: null, outboxId: null } }));
  });
  clock = "2026-10-28T03:16:00Z"; await service.tick(); const after = await service.read();
  expect(after.sequence).toBeGreaterThan(256); expect(after.occurrences).toHaveLength(2); expect(after.owners).toEqual(before.owners);
  expect((await service.summary()).lowerBound).toBe(false); expect(after.lowerBound).toBe(false);
}, 60000);
