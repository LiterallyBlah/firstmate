/** S11 conservative D6: each explicit dependency of a cooperative scope is checked separately against a real
 * store's projection, and the read writes nothing. The S07 cutover cases run on actual legacy adapters in
 * `supervision-migrate.test.ts` (L1, L5, B5/M1, release). Temporary homes only. */
import { randomUUID } from "node:crypto";
import { mkdir, readdir } from "node:fs/promises";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import type { SupervisionStatus } from "../shared/supervision";
import { pluginDir } from "./data-dir";
import { COOPERATIVE_LIMITS } from "./supervision-capabilities";
import { cooperativeReadiness, cooperativeRollout, JOURNAL_BANDS } from "./supervision-cooperative";
import { SupervisionStore } from "./supervision-store";
import { effectLogicalKey } from "./supervision-effects";

const SCOPE = randomUUID(), OTHER = randomUUID(), TASK = randomUUID(), ATTEMPT = randomUUID();
let base: SupervisionStatus, store: SupervisionStore;
beforeAll(async () => {
  const home = join(process.env.PASEO_HOME!, "home");
  await mkdir(home, { recursive: true });
  store = new SupervisionStore(pluginDir(), home, { writable: true, processIdentity: async () => ({ state: "alive", start: "fixture" }) });
  await store.initialize();
  base = await store.read();
});
const scope = (id: string, extra: object = {}) => ({ id, homeId: base.homeId, kind: "plan", projectIds: [], sponsorId: null, version: 1, mode: "scoped", state: "active", ...extra });
/** An active, verified supervisor binding: the scope's one current owner. */
const bound = (scopeId: string, extra: object = {}) => ({ scopeId, epoch: 1, hostId: "local", agentId: `sup-${scopeId.slice(0, 4)}`, workspaceId: "ws-sup",
  profileDigest: "b".repeat(64), state: "active", checkpointHash: "c".repeat(64), acknowledgedSeq: 0, heartbeatDue: null, ...extra });
/** A drained scope with one finished scoped attempt, and an unrelated scope. Extra rows are synthetic projection rows. */
/** The activation opening (S04's epoch send) of a scope, as `activationEffects` finds it. */
const opening = (scopeId: string, epoch: number, state = "succeeded") => ({ id: randomUUID(), scopeId, epoch, attemptId: null, operation: "agent.send", state,
  logicalKey: effectLogicalKey({ scopeId, subject: `epoch:${epoch}`, operation: "agent.send", causation: "scope.activate", objectiveRevision: 0 }) });
/** Each test's status gets succeeded openings for both scopes' first two epochs unless `openings` says otherwise. */
function status(patch: (s: SupervisionStatus) => void = () => {}, openings: object[] = [1, 2].flatMap(e => [opening(SCOPE, e), opening(OTHER, e)])): SupervisionStatus {
  const s = structuredClone(base) as SupervisionStatus;
  s.scopes = [scope(SCOPE), scope(OTHER)] as never;
  s.bindings = [bound(SCOPE), bound(OTHER)] as never;
  s.tasks = [{ id: TASK, ownerScopeId: SCOPE, planId: "scheduler", nodeId: "build", projectId: randomUUID(), hostId: "local", version: 1, currentAttempt: ATTEMPT }];
  s.attempts = [{ id: ATTEMPT, taskId: TASK, ordinal: 1, briefHash: "a".repeat(64), launchEffectId: randomUUID(), worker: { hostId: "local", agentId: "w1", workspaceId: "ws1" },
    originalNotificationOwner: null, notificationStatus: "known", spentAgents: 1, spentTurns: 1, state: "prompted", evidenceIds: [], version: 2 }];
  patch(s);
  s.effects = [...openings, ...s.effects] as never;
  return s;
}
const unmet = (s: SupervisionStatus, id = SCOPE) => cooperativeReadiness(s, id).dependencies.filter(d => !d.satisfied).map(d => d.id);

describe("cooperativeReadiness: explicit dependencies of a drained cooperative scope", () => {
  it("a reconciled scope is ready, cooperative only, with its limits; it never claims fleet-wide relief", () => {
    const r = cooperativeReadiness(status(), SCOPE);
    expect(r).toMatchObject({ ready: true, lowerBound: false, mode: "cooperative" });
    expect(r.limits).toBe(COOPERATIVE_LIMITS);
    expect(r.dependencies.map(d => d.id)).toEqual(["journal", "scope", "binding", "cutover", "deliveries", "effects", "workers", "reservations", "dependencies", "board-sends", "holds"]);
    const rollout = cooperativeRollout(status());
    expect(rollout).toMatchObject({ ready: [SCOPE, OTHER], held: [], fleetWideRelief: false });
  });
  it("A10/A05: an uncertain or dispatching effect holds only its own scope, and keeps its reservation", () => {
    for (const state of ["dispatching", "accepted", "uncertain"]) {
      const s = status(x => { x.effects = [{ id: randomUUID(), scopeId: SCOPE, state, operation: "agent.create" } as never]; });
      expect(unmet(s)).toEqual(["effects"]);
      expect(unmet(s, OTHER)).toEqual([]);
    }
    for (const state of ["reserved", "succeeded", "failed", "cancelled"])
      expect(unmet(status(x => { x.effects = [{ id: randomUUID(), scopeId: SCOPE, state, operation: "agent.send" } as never]; }))).toEqual([]);
  });
  it("A14: an unknown native callback owner holds, without re-prompting or transfer", () => {
    expect(unmet(status(x => { x.attempts[0]!.notificationStatus = "unknown"; }))).toEqual(["workers"]);
  });
  it("A10: an unresolved node (an uncertain launch) holds its scope; a running scoped node does not", () => {
    const plan = (state: string) => status(x => { x.plans = [{ scopeId: SCOPE, plan: { definition: { id: "scheduler" }, nodes: { build: { state, attempt: "a1" } } } as never }]; });
    expect(unmet(plan("unresolved"))).toEqual(["workers"]);
    expect(unmet(plan("running"))).toEqual([]);
  });
  it("A04: a suspect reservation (lease expired, no terminal evidence) holds; granted and released do not", () => {
    const row = (state: string) => status(x => { x.maintenance = { reservations: [{ id: randomUUID(), scopeId: SCOPE, state } as never], jobs: [], occurrences: [], hosts: [], incidents: [] }; });
    expect(unmet(row("suspect"))).toEqual(["reservations"]);
    for (const state of ["queued", "granted", "released", "cancelled"]) expect(unmet(row(state))).toEqual([]);
  });
  it("S09: a held cross-plan dependency resolution holds; an exact resolution does not", () => {
    const dep = (state: string) => status(x => { x.projects = { projects: [], sponsors: [], intents: [], memoryProposals: [], memory: [], conflicts: [],
      dependencies: [{ id: randomUUID(), scopeId: SCOPE, planId: "scheduler", nodeId: "build", edge: { node: "trial", on: "done" }, state, reason: state === "held" ? "ambiguous" : "exact" } as never] }; });
    expect(unmet(dep("held"))).toEqual(["dependencies"]);
    expect(unmet(dep("resolved"))).toEqual([]);
  });
  it("S08: a board message with no recorded or an unknown outcome holds", () => {
    for (const state of ["reserved", "uncertain"])
      expect(unmet(status(x => { x.sources.submissions = [{ scopeId: SCOPE, state, messageId: "m", agentId: "w1" } as never]; }))).toEqual(["board-sends"]);
    expect(unmet(status(x => { x.sources.submissions = [{ scopeId: SCOPE, state: "accepted", messageId: "m", agentId: "w1" } as never]; }))).toEqual([]);
  });
  it("A05: a stopped scope (operation hold) and a suspect or prepared supervisor are held, not taken over", () => {
    expect(unmet(status(x => { x.operationHolds = [{ scopeId: SCOPE, state: "held", operations: ["plan.start"], reason: "Project stopped." } as never]; }))).toEqual(["holds"]);
    for (const state of ["prepared", "suspect"])
      expect(unmet(status(x => { x.bindings = [bound(SCOPE, { epoch: 2, state })] as never; }))).toEqual(["binding"]);
    expect(unmet(status(x => { x.bindings = [bound(SCOPE, { epoch: 2 })] as never; }))).toEqual([]);
  });
  it("R11 B1: no supervisor is no owner. A scope without exactly one active, verified binding is not ready", () => {
    const r = cooperativeReadiness(status(x => { x.bindings = [bound(OTHER)] as never; }), SCOPE);
    expect(r.ready).toBe(false);
    expect(r.dependencies.find(d => d.id === "binding")).toMatchObject({ satisfied: false, reasons: [expect.stringMatching(/No current owner/)] });
    expect(unmet(status(x => { x.bindings = [bound(SCOPE, { state: "retired" })] as never; }))).toEqual(["binding"]);
    expect(unmet(status(x => { x.bindings = [bound(SCOPE, { workspaceId: null, workspaceIntent: "ws-i" })] as never; }))).toEqual(["binding"]);
    expect(unmet(status(x => { x.bindings = [bound(SCOPE), bound(SCOPE, { epoch: 2 })] as never; }))).toEqual(["binding"]);
    // A dormant, never-bound scope does not count either.
    expect(unmet(status(x => { x.scopes[0]!.state = "dormant"; x.bindings = [] as never; }))).toEqual(["binding"]);
    expect(cooperativeRollout(status(x => { x.bindings = [bound(OTHER)] as never; }))).toMatchObject({ ready: [OTHER], held: [{ scopeId: SCOPE, unmet: ["binding"] }] });
  });
  it("R11 B2: the binding counts only once its epoch's opening has succeeded; reserved, dispatching or failed does not", () => {
    const others = [1, 2].map(e => opening(OTHER, e));
    for (const [state, words] of [["reserved", /has not been sent its opening \(reserved\)/], ["dispatching", /has not been sent its opening/],
      ["failed", /opening failed/], ["uncertain", /unconfirmed outcome/], ["accepted", /unconfirmed outcome/]] as const) {
      const r = cooperativeReadiness(status(() => {}, [opening(SCOPE, 1, state), ...others]), SCOPE);
      expect(r.ready).toBe(false);
      expect(r.dependencies.find(d => d.id === "binding")).toMatchObject({ satisfied: false, reasons: [expect.stringMatching(words)] });
    }
    expect(cooperativeReadiness(status(() => {}, others), SCOPE).dependencies.find(d => d.id === "binding")!.reasons).toEqual([expect.stringMatching(/has not been sent its opening\.$/)]);
    // Another epoch's succeeded opening does not count for the current one.
    expect(unmet(status(() => {}, [opening(SCOPE, 2), ...others]))).toEqual(["binding"]);
  });
  it("R11 R3-N2: a replacement (epoch 2) is held while only epoch 1's opening has succeeded", () => {
    const others = [1, 2].map(e => opening(OTHER, e));
    const replaced = (openings: object[]) => cooperativeReadiness(status(x => { x.bindings = [bound(SCOPE, { epoch: 2 }), bound(OTHER)] as never; }, [...openings, ...others]), SCOPE);
    const r = replaced([opening(SCOPE, 1)]);
    expect(r.ready).toBe(false);
    expect(r.dependencies.find(d => d.id === "binding")!.reasons).toEqual(["Supervisor epoch 2 has not been sent its opening."]);
    expect(replaced([opening(SCOPE, 1), opening(SCOPE, 2, "reserved")]).dependencies.find(d => d.id === "binding")!.reasons)
      .toEqual([expect.stringMatching(/epoch 2 has not been sent its opening \(reserved\)/)]);
    expect(replaced([opening(SCOPE, 1), opening(SCOPE, 2)]).ready).toBe(true);
  });
  it("R11 N1/N9: a non-active backend without a migration row, and starting, planned-with-worker or unaccounted imported attempts hold", () => {
    for (const [backend, state] of [["scoped", "prepared"], ["scoped", "held"], ["legacy", "active"]])
      expect(unmet(status(x => { x.backends = [{ planId: "scheduler", ownerScopeId: SCOPE, backend, state, sourceHash: null, version: 1 } as never]; }))).toEqual(["cutover"]);
    expect(unmet(status(x => { x.backends = [{ planId: "scheduler", ownerScopeId: SCOPE, backend: "scoped", state: "active", sourceHash: null, version: 1 } as never]; }))).toEqual([]);
    const imported = (node: object | null) => status(x => {
      x.attempts[0]!.importedFrom = { migrationId: randomUUID(), legacyAttempt: "legacy-1", node: "build" };
      x.attempts[0]!.originalNotificationOwner = "general";
      x.plans = [{ scopeId: SCOPE, plan: { definition: { id: "scheduler" }, nodes: node ? { build: { attempt: "legacy-1", ...node } } : {} } as never }];
    });
    expect(unmet(imported(null))).toEqual(["workers"]); // Unaccounted: the legacy attempt is in no node.
    expect(unmet(imported({ state: "starting" }))).toEqual(["workers"]);
    expect(unmet(imported({ state: "planned", agentId: "worker-1" }))).toEqual(["workers"]);
    expect(unmet(imported({ state: "planned" }))).toEqual([]);
    expect(unmet(imported({ state: "done" }))).toEqual([]);
  });
  it("R11 N4: an S10 host pass with dispatched or uncertain items, or an open incident, of this scope's jobs holds", () => {
    const JOB = randomUUID();
    const rows = (hosts: object[], incidents: object[]) => status(x => { x.maintenance = { reservations: [], occurrences: [],
      jobs: [{ id: JOB, scopeId: SCOPE } as never], hosts: hosts as never, incidents: incidents as never }; });
    const host = (state: string) => ({ id: randomUUID(), jobId: JOB, hostId: "mini", items: [{ key: "k", state }] });
    expect(unmet(rows([host("dispatched")], []))).toEqual(["reservations"]);
    expect(unmet(rows([host("uncertain")], []))).toEqual(["reservations"]);
    expect(unmet(rows([host("done")], []))).toEqual([]);
    expect(unmet(rows([], [{ id: randomUUID(), jobId: JOB, kind: "offline", state: "open" }]))).toEqual(["reservations"]);
    expect(unmet(rows([], [{ id: randomUUID(), jobId: JOB, kind: "offline", state: "resolved" }]))).toEqual([]);
    // Another scope's job does not hold this one.
    expect(unmet(rows([{ ...host("uncertain"), jobId: randomUUID() }], []))).toEqual([]);
  });
  it("R11 N9: held admissions hold even with a current journal; a retired scope stays visibly held in the rollout", () => {
    expect(unmet(status(x => { x.storage.admissionsHeld = true; }))).toEqual(["journal"]);
    expect(cooperativeRollout(status(x => { x.scopes[1]!.state = "retired"; }))).toMatchObject({ ready: [SCOPE], held: [{ scopeId: OTHER, unmet: ["scope"] }] });
  });
  it("a legacy, held, transferring or unknown scope is not ready", () => {
    expect(unmet(status(x => { x.scopes[0]!.mode = "legacy"; }))).toEqual(["scope"]);
    for (const state of ["held", "transferring", "retired"]) expect(unmet(status(x => { x.scopes[0]!.state = state as never; }))).toEqual(["scope"]);
    expect(cooperativeReadiness(status(), randomUUID())).toMatchObject({ ready: false, dependencies: expect.arrayContaining([expect.objectContaining({ id: "scope", reasons: ["The scope is not registered."] })]) });
  });
  it("S07: a prepared or barrier migration and an unaccounted delivery hold", () => {
    const m = (state: string) => status(x => { x.migrations = [{ id: randomUUID(), scopeId: SCOPE, planId: "scheduler", state } as never]; });
    expect(unmet(m("prepared"))).toEqual(["cutover"]); expect(unmet(m("barrier"))).toEqual(["cutover"]); expect(unmet(m("committed"))).toEqual([]);
    const d = (extra: object) => status(x => { x.dispositions = [{ id: randomUUID(), scopeId: SCOPE, source: "watch-queue", route: "drain-legacy", resolvedBy: null,
      removal: { state: "drained", receipt: null }, receipts: { send: null, transfer: null, ack: null }, reason: "r", ...extra } as never]; });
    expect(unmet(d({}))).toEqual([]);
    expect(unmet(d({ route: "hold" }))).toEqual(["deliveries"]);
    expect(unmet(d({ removal: { state: "mismatch", receipt: null } }))).toEqual(["deliveries"]);
    expect(unmet(d({ route: "transfer-fact", removal: { state: "removed", receipt: "r" } }))).toEqual(["deliveries"]);
  });
  it("journal bands: a held journal or a reached band (128, 160, 192) is a lower bound and not ready", () => {
    expect(JOURNAL_BANDS.map(b => [b.slice, b.ceiling])).toEqual([["S08", 128], ["S10", 160], ["S04/S09", 192]]);
    expect(cooperativeReadiness(status(x => { x.freshness = "held"; }), SCOPE)).toMatchObject({ ready: false, lowerBound: true });
    for (const [sequence, bands] of [[127, 0], [128, 1], [160, 2], [192, 3]] as const) {
      const r = cooperativeReadiness(status(x => { x.sequence = sequence; }), SCOPE);
      expect(r.dependencies[0]!.reasons).toHaveLength(bands);
      expect(r.ready).toBe(bands === 0);
    }
  });
  it("the read writes nothing: the journal is unchanged", async () => {
    const before = (await readdir(join(pluginDir()), { recursive: true })).sort();
    const s = await store.read();
    cooperativeReadiness(s, SCOPE); cooperativeRollout(s);
    expect((await readdir(join(pluginDir()), { recursive: true })).sort()).toEqual(before);
    expect((await store.read()).sequence).toBe(s.sequence);
  });
});
