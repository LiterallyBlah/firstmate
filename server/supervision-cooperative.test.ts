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
/** A drained scope with one finished scoped attempt, and an unrelated scope. Extra rows are synthetic projection rows. */
function status(patch: (s: SupervisionStatus) => void = () => {}): SupervisionStatus {
  const s = structuredClone(base) as SupervisionStatus;
  s.scopes = [scope(SCOPE), scope(OTHER)] as never;
  s.tasks = [{ id: TASK, ownerScopeId: SCOPE, planId: "scheduler", nodeId: "build", projectId: randomUUID(), hostId: "local", version: 1, currentAttempt: ATTEMPT }];
  s.attempts = [{ id: ATTEMPT, taskId: TASK, ordinal: 1, briefHash: "a".repeat(64), launchEffectId: randomUUID(), worker: { hostId: "local", agentId: "w1", workspaceId: "ws1" },
    originalNotificationOwner: null, notificationStatus: "known", spentAgents: 1, spentTurns: 1, state: "prompted", evidenceIds: [], version: 2 }];
  patch(s);
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
      expect(unmet(status(x => { x.bindings = [{ scopeId: SCOPE, epoch: 2, state } as never]; }))).toEqual(["binding"]);
    expect(unmet(status(x => { x.bindings = [{ scopeId: SCOPE, epoch: 2, state: "active" } as never]; }))).toEqual([]);
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
