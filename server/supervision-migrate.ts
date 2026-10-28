/** S07 history import and per-scope single-writer cutover. Disabled by default and unwired: no RPC,
 * timer or start-up path constructs a writable migrator. A separately approved activation names one
 * target plan scope at a time, after its inventory, rollback build and policy import are accepted.
 *
 * Sequence (each stage durable before the next; a crash at any point resumes the same migration or
 * leaves both writers held until it is resumed or released):
 *   0. preflight: the whole migration's journal budget and both transaction bodies are checked with the
 *      store's read-only validator BEFORE anything is frozen. A plan that cannot finish is never frozen.
 *   1. freeze: under the delivery gate AND the legacy writer's lock, snapshot the plan's exact bytes and
 *      every affected legacy delivery, then publish `.scoped/<plan>/freeze.json`.
 *   2. prepared: one scoped transaction imports the original chain byte-for-byte, registers the scope,
 *      a prepared backend, its run tasks, the MigrationReceipt and one LegacyDeliveryDisposition each.
 *   3. reconcile: re-inventory (anything new for the plan becomes a hold), transfer facts (outbox mapping
 *      committed BEFORE the old entry is archived and removed by ID and payload), removals, drains.
 *   4. barrier, 5. committed: verify, then activate the scoped backend with its imported attempts.
 *   Release (`abort`): from prepared or barrier, retire the scoped side, restore every archived entry
 *   exactly, then publish `aborted.json`. The legacy writer owns the plan again. Nothing is re-sent.
 * Nothing here sends a message, calls a model, or replays an uncertain instruction.
 */
import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { FirstmateConfig } from "../shared/fleet";
import type { NeedsYouSnapshot } from "../shared/needs-you";
import type { SupervisionActor, SupervisionAttempt, SupervisionExpected, SupervisionStatus } from "../shared/supervision";
import { LegacyDeliveryDispositionSchema, MigrationReceiptSchema, type CutoverSidecar, type CutoverTokens, type LegacyDeliveryDisposition, type MigrationReceipt } from "../shared/supervision-migration";
import type { PlanNodeState, WorkflowPlan } from "../shared/workflow-plans";
import { readFirstmateConfig, updateFirstmateConfig } from "./config";
import { resolveInHome } from "./files";
import { ITEM_TAGS_FILE } from "./item-tags";
import { noteItem } from "./mate";
import { serialized } from "./serialize";
import { digest, publish } from "./submissions";
import { CutoverGate, cutoverGate, itemFingerprint, liveClaims, mentions, type Claim, type ClaimResult, type CutoverTarget, type GateItem } from "./supervision-gate";
import { inventoryHash, SUPERVISION_INDEX_LIMITS, SupervisionError, type StoreMutation, type SupervisionStore } from "./supervision-store";
import { replaySupervisionWorkflow } from "./supervision-workflows";
import { watchItem, type QueuedNote, type WatchRunner } from "./watches";
import { mergeOwnership, planOwnership, type WorkflowOwnership } from "./workflow-ownership";
import { WorkflowEventSchema, type WorkflowPlanStore } from "./workflow-plans";

type MateNote = FirstmateConfig["mateNotes"][number];
type Event = ReturnType<typeof WorkflowEventSchema.parse>;
function fail(code: "STALE" | "HELD" | "UNKNOWN_OWNER" | "UNSUPPORTED" | "CONFLICT", message: string): never { throw new SupervisionError(code, message); }
/** Deterministic v4-shaped identity, so a resumed step reuses its original request and record IDs. */
export function migrationUuid(...parts: unknown[]): string {
  const h = digest(parts); return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
}
const sha = (bytes: Uint8Array | string) => createHash("sha256").update(bytes).digest("hex");
/** One cutover's affected deliveries are capped so its worst case fits the 256-transaction pilot journal. */
export const MIGRATION_LIMITS = { dispositions: 64, reinventoryReserve: 8, abortReserve: 1 } as const;
const terminal = (state: string) => ["done", "landed", "failed", "cancelled"].includes(state);
const watchId = (w: { name: string; ran: string; kind: string }) => `${w.name}@${w.ran}#${w.kind}`;

/** The installed-shaped legacy queues, read and changed only through their own locks. */
export interface LegacyDeliveryAdapters {
  config(): Promise<FirstmateConfig>;
  removeMateNote(id: string, payloadHash: string): Promise<"removed" | "absent" | "mismatch">;
  restoreMateNote(note: MateNote): Promise<"restored" | "present">;
  watchQueue(): Promise<QueuedNote[]>;
  removeWatchEntry(id: string, payloadHash: string): Promise<"removed" | "absent" | "mismatch">;
  restoreWatchEntry(entry: QueuedNote): Promise<"restored" | "present">;
  /** Required. A missing, disabled, stale or unknown ledger refuses the cutover; it is never "no decisions". */
  decisions(): Promise<NeedsYouSnapshot | null>;
}
export function legacyAdapters(runner: WatchRunner | null, decisions: (() => Promise<NeedsYouSnapshot>) | null): LegacyDeliveryAdapters {
  return {
    config: () => readFirstmateConfig(),
    removeMateNote: (id, payloadHash) => serialized("firstmate.mate.notes", async () => {
      const config = await readFirstmateConfig(), same = config.mateNotes.filter(n => n.id === id);
      if (!same.length) return "absent" as const;
      if (!same.some(n => digest(n) === payloadHash)) return "mismatch" as const;
      await updateFirstmateConfig({ mateNotes: config.mateNotes.filter(n => !(n.id === id && digest(n) === payloadHash)) });
      return "removed" as const;
    }),
    restoreMateNote: note => serialized("firstmate.mate.notes", async () => {
      const config = await readFirstmateConfig();
      if (config.mateNotes.some(n => n.id === note.id)) return "present" as const;
      await updateFirstmateConfig({ mateNotes: [...config.mateNotes, note] });
      return "restored" as const;
    }),
    watchQueue: async () => runner ? runner.queued() : [],
    removeWatchEntry: async (id, payloadHash) => runner ? runner.removeQueued(id, payloadHash) : "absent",
    restoreWatchEntry: async entry => runner ? runner.restoreQueued(entry) : "present",
    decisions: async () => decisions ? decisions() : null,
  };
}

export interface MigrationInput {
  plan: string; scopeId: string; projectId: string; migrationId: string;
  prerequisites: MigrationReceipt["prerequisites"];
}
export interface MigratorOptions {
  home: string; store: SupervisionStore; legacy: WorkflowPlanStore; adapters: LegacyDeliveryAdapters;
  /** Off unless a separately approved activation turns it on. */
  enabled?: boolean;
  gate?: CutoverGate; now?: () => string;
  /** Crash-injection seam for isolated qualification only. */
  boundary?: (name: string) => Promise<void>;
}
export interface Capacity { sequence: number; transactionsNeeded: number; ceiling: number; preparedMutations: number; commitMutations: number; ok: boolean; problem: string | null }
interface Snapshot {
  plan: WorkflowPlan; events: Event[]; files: { name: string; sha256: string }[]; sourceHash: string; tokens: CutoverTokens;
  dispositions: LegacyDeliveryDisposition[]; receipt: MigrationReceipt; problems: string[]; prepared: StoreMutation[]; capacity: Capacity;
}
function claimItem(i: Claim["items"][number]): GateItem {
  return { source: i.source, id: i.id, payloadHash: i.payloadHash, text: i.text ?? i.mentions.join(" "), ...(i.plan ? { plan: i.plan } : {}),
    ...(i.actionId ? { actionId: i.actionId } : {}), ...(i.agentKey ? { agentKey: i.agentKey } : {}), ...(i.task ? { task: i.task } : {}) };
}
/** Every attempt the legacy plan ever recorded, current, prior and removed, with its last known state. */
function attemptStates(plan: WorkflowPlan): { node: string; attempt: string; state: PlanNodeState }[] {
  const out: { node: string; attempt: string; state: PlanNodeState }[] = [];
  const add = (node: string, s: PlanNodeState) => {
    for (const prior of s.priorAttempts ?? []) add(node, prior);
    if (s.attempt && !out.some(o => o.attempt === s.attempt)) out.push({ node, attempt: s.attempt, state: s });
  };
  for (const [node, s] of Object.entries(plan.nodes)) add(node, s);
  for (const r of plan.removed ?? []) add(r.node.id, r.state);
  return out;
}
/** Worst-case transactions for one migration: transfers map, remove and are acknowledged; holds resolve and
 * remove/drain; plus prepared, barrier, commit, re-inventory headroom and the release reserve. */
export function migrationCost(dispositions: LegacyDeliveryDisposition[]): number {
  return dispositions.reduce((n, d) => n + (d.route === "transfer-fact" ? 2 + (d.removal.state === "pending" ? 1 : 0) :
    d.route === "already-handled" ? (d.removal.state === "pending" ? 1 : 0) : 2), 0) + 3 + MIGRATION_LIMITS.reinventoryReserve + MIGRATION_LIMITS.abortReserve;
}

export class SupervisionMigrator {
  readonly gate: CutoverGate;
  constructor(private readonly options: MigratorOptions) { this.gate = options.gate ?? cutoverGate(options.home); }
  private enabled() { if (!this.options.enabled) fail("UNSUPPORTED", "History import and cutover are disabled until separately activated."); }
  private async boundary(name: string) { await this.options.boundary?.(name); }
  private now() { return this.options.now?.() ?? new Date().toISOString(); }

  /** Arms claims on every gated send. Queue entries present now are marked preexisting: a send of one
   * may already have happened without a receipt, so it can never be classified as unsent later.
   */
  async arm(): Promise<void> {
    this.enabled();
    await this.gate.run(async () => {
      const config = await this.options.adapters.config(), queue = await this.options.adapters.watchQueue();
      await this.gate.arm([...config.mateNotes.map(n => itemFingerprint(noteItem(n))), ...queue.map(q => itemFingerprint(watchItem(q)))], this.now());
    });
  }

  /** Read-only import report: parity, fingerprints, capacity and the dispositions a cutover would publish. */
  async dryRun(input: MigrationInput) {
    const snap = await this.snapshot(input, this.now(), await this.options.store.read());
    return { plan: input.plan, sourceHash: snap.sourceHash, parity: !snap.problems.length, problems: snap.problems, capacity: snap.capacity,
      dispositions: snap.dispositions, receipt: snap.receipt };
  }

  /** Exact legacy bytes, chain, parity, delivery inventory and capacity. Pure read; caller holds locks for a freeze. */
  private async snapshot(input: MigrationInput, frozenAt: string, status: SupervisionStatus): Promise<Snapshot> {
    const { legacy } = this.options, problems: string[] = [];
    const read = await legacy.read();
    if (read.unavailable) fail("HELD", "The legacy plan store is unavailable; nothing can be imported.");
    if (read.quarantined.some(q => q.plan === input.plan)) fail("HELD", `Plan ${input.plan} is quarantined or retired in the legacy store; reconcile it deliberately, never import a damaged history.`);
    const plan = read.plans.find(p => p.definition.id === input.plan);
    if (!plan) fail("UNKNOWN_OWNER", `No readable legacy plan ${input.plan}.`);
    const files = await this.sourceFiles(input.plan);
    if (files.some(f => f.name.startsWith("retired/"))) fail("HELD", `Plan ${input.plan} is retired; its reservations stay with the legacy store.`);
    if (files.some(f => /^tips\/recovered-/.test(f.name))) fail("HELD", `Plan ${input.plan} has recovery receipts; reconcile that history deliberately before import.`);
    const events = await Promise.all(files.filter(f => /^events\/\d{8}\.json$/.test(f.name)).map(async f => JSON.parse(await readFile(join(legacy.root, input.plan, f.name.slice(7)), "utf8")) as Event));
    let replayed: WorkflowPlan | null = null;
    try { for (const event of events) replayed = replaySupervisionWorkflow(replayed, event, this.options.store.homeId); }
    catch (error) { fail("HELD", `Legacy chain for ${input.plan} does not replay exactly: ${error instanceof Error ? error.message : String(error)}`); }
    const parity = (p: WorkflowPlan) => digest({ hash: p.hash, sequence: p.sequence, revision: p.revision, status: p.status, nodes: p.nodes,
      handled: p.handled, told: p.told, captainEvents: p.captainEvents ?? [], removed: p.removed ?? [], approvedBudget: p.approvedBudget });
    if (!replayed || parity(replayed) !== parity(plan)) problems.push("Replayed scoped plan differs from the legacy projection; do not import.");
    const sourceHash = digest(files);
    const nodes = [...plan.definition.nodes, ...(plan.removed ?? []).map(r => r.node)];
    const attempts = attemptStates(plan);
    const tokens: CutoverTokens = { plan: input.plan, nodes: [...new Set(nodes.map(n => n.id))].sort(),
      actions: (plan.captainEvents ?? []).map(a => a.id), agents: [...new Set(attempts.flatMap(a => a.state.agentId ? [a.state.agentId] : []))].sort(),
      tasks: nodes.flatMap(n => n.kind === "run" ? [{ task: n.id, host: n.launch.host }] : []) };
    const tip = { sequence: plan.sequence, hash: plan.hash };
    const launches: MigrationReceipt["launches"] = [];
    for (const node of nodes) {
      let names: string[] = [];
      const directory = (await resolveInHome(this.options.home, `data/${node.id}/launches`)).absolute;
      try { names = await readdir(directory); } catch (e) { if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e; }
      for (const name of names.filter(n => /^[1-9]\d*\.json$/.test(n)).sort()) {
        const record = JSON.parse(await readFile(join(directory, name), "utf8")) as { state?: string; workflow?: { attempt?: string } };
        launches.push({ node: node.id, file: name, state: String(record.state ?? "unknown"), attempt: record.workflow?.attempt ?? null });
      }
    }
    const dispositions = await this.inventory(input, plan, tokens, tip, attempts, launches);
    let inventory: WorkflowOwnership | null = null, step: WorkflowPlan | null = null;
    for (const event of events) { step = replaySupervisionWorkflow(step, event, this.options.store.homeId); inventory = mergeOwnership([...(inventory ? [inventory] : []), planOwnership(step)]); }
    const requests = events.map(e => ({ requestId: e.requestId, requestHash: e.requestHash, eventHash: e.hash }));
    const others = read.plans.filter(p => p.definition.id !== input.plan);
    const preimage = async (path: string) => { try { return sha(await readFile((await resolveInHome(this.options.home, path)).absolute)); } catch (e) { if ((e as NodeJS.ErrnoException).code === "ENOENT") return null; throw e; } };
    const needed = migrationCost(dispositions), importedAttempts = inventory?.attempts ?? [];
    const receipt = MigrationReceiptSchema.parse({ format: "firstmate.migration-receipt/1", id: input.migrationId, version: 1, compatibility: 1,
      homeId: this.options.store.homeId, planId: input.plan, scopeId: input.scopeId, state: "prepared", frozenAt, prerequisites: input.prerequisites,
      source: { tip, sourceHash, files },
      imported: { indexHash: digest(requests), requests, attempts: importedAttempts, budget: inventory?.budget ?? { agents: 0, turns: 0 },
        handled: plan.handled, told: plan.told, holds: Object.entries(plan.nodes).flatMap(([node, s]) => s.held ? [{ node, held: s.held }] : []) },
      dependents: others.flatMap(p => p.definition.nodes.flatMap(n => n.after.filter(e => tokens.nodes.includes(e.node)).map(e => ({ plan: p.definition.id, node: n.id, on: e.node })))),
      launches, inventory: { hash: inventoryHash(dispositions), dispositionIds: dispositions.map(d => d.id) },
      projectionPreimage: { backlog: await preimage("data/backlog.md"), itemTags: await preimage(ITEM_TAGS_FILE) },
      sidecars: { freeze: digest({ migrationId: input.migrationId, sourceHash, inventory: inventoryHash(dispositions) }), prepared: null, committed: null },
      capacity: { sequenceAtFreeze: status.sequence, transactionsNeeded: needed, ceiling: SUPERVISION_INDEX_LIMITS.transactions,
        preparedMutations: 0, commitMutations: 3 + importedAttempts.length }, aborted: null });
    const prepared = this.preparedMutations(input, plan, events, receipt, dispositions);
    receipt.capacity.preparedMutations = prepared.length;
    const capacity: Capacity = { sequence: status.sequence, transactionsNeeded: needed, ceiling: SUPERVISION_INDEX_LIMITS.transactions,
      preparedMutations: prepared.length, commitMutations: receipt.capacity.commitMutations, ok: true, problem: null };
    // Preflight: the prepared body against every row rule, index and ceiling, plus the rest of the run's budget.
    try {
      if (dispositions.length > MIGRATION_LIMITS.dispositions) fail("HELD", `${dispositions.length} affected deliveries exceed the cutover cap of ${MIGRATION_LIMITS.dispositions}; drain the old owner first.`);
      if (capacity.commitMutations > 256) fail("HELD", `The activation would carry ${capacity.commitMutations} mutations; the journal body limit is 256.`);
      await this.options.store.validate(this.expected(status, prepared), prepared, needed - 1);
    } catch (error) { capacity.ok = false; capacity.problem = error instanceof Error ? error.message : String(error); problems.push(`Capacity: ${capacity.problem}`); }
    return { plan, events, files, sourceHash, tokens, dispositions, receipt, problems, prepared, capacity };
  }
  private preparedMutations(input: MigrationInput, plan: WorkflowPlan, events: Event[], receipt: MigrationReceipt, dispositions: LegacyDeliveryDisposition[]): StoreMutation[] {
    return [
      { kind: "scope", value: { id: input.scopeId, homeId: this.options.store.homeId, kind: "plan", projectIds: [input.projectId], sponsorId: null, version: 1, mode: "scoped", state: "transferring" } },
      { kind: "backend", value: { planId: input.plan, ownerScopeId: input.scopeId, backend: "scoped", state: "prepared", sourceHash: receipt.source.sourceHash, version: 1 } },
      { kind: "workflow-import", scopeId: input.scopeId, migrationId: input.migrationId, events },
      // The imported plan's run tasks become scoped-owned, so the task/host index refuses any other writer.
      ...plan.definition.nodes.flatMap(n => n.kind === "run" ? [{ kind: "task" as const, value: { id: migrationUuid(input.migrationId, "task", n.id),
        ownerScopeId: input.scopeId, planId: input.plan, nodeId: n.id, projectId: input.projectId, hostId: n.launch.host, version: 1, currentAttempt: null } }] : []),
      { kind: "migration", value: receipt },
      ...dispositions.map(value => ({ kind: "delivery-disposition" as const, value })),
    ];
  }

  /** One disposition per affected legacy delivery. Pending facts come from authoritative actions and
   * handled keys; `notified`, queue presence and transport acceptance are only delivery history.
   */
  private async inventory(input: MigrationInput, plan: WorkflowPlan, tokens: CutoverTokens, tip: { sequence: number; hash: string },
    attempts: { node: string; attempt: string; state: PlanNodeState }[], launches: MigrationReceipt["launches"]): Promise<LegacyDeliveryDisposition[]> {
    const { adapters } = this.options, gate = this.gate;
    const config = await adapters.config(), queue = await adapters.watchQueue(), decisions = await adapters.decisions();
    // Decision answers are imperative. Without a current ledger for this home there is no proof none was sent.
    if (!decisions || decisions.homeId === null || decisions.freshness.status !== "fresh")
      fail("HELD", `The Needs-you ledger is ${decisions ? decisions.freshness.status : "unavailable"}; a cutover cannot prove which answers were sent. Enable and refresh it first.`);
    if ((decisions.quarantined ?? []).some(q => q.taskId === null || tokens.tasks.some(t => t.task === q.taskId)))
      fail("HELD", "A quarantined Needs-you row may belong to this plan; repair it before the cutover.");
    const claims = await gate.claims(), armed = await gate.armed(), preexisting = new Set(armed?.preexisting ?? []);
    this.assertNoLiveClaims(claims, this.target(input.plan, tokens));
    const owner = config.mateAgentId.trim() || null;
    const latest = (id: string) => [...claims].reverse().find(c => c.claim.items.some(i => i.id === id) && c.result?.outcome !== "failed");
    const claimed = (id: string): { state: LegacyDeliveryDisposition["delivery"] | null; claim: { claim: Claim; result: ClaimResult | null } | undefined } => {
      const row = latest(id);
      if (!row) return { state: null, claim: undefined };
      if (!row.result && liveClaims().has(row.claim.id)) fail("HELD", `A legacy send (${id}) is in flight; account for it before freezing ${input.plan}.`);
      return { state: row.result?.outcome === "accepted" ? "accepted" : "uncertain", claim: row };
    };
    const rows: LegacyDeliveryDisposition[] = [];
    const fact = (key: string) => ({ scopeId: input.scopeId, consequenceId: migrationUuid(input.plan, "legacy-fact", key), outboxId: null });
    for (const action of plan.captainEvents ?? []) {
      const keys = [`${plan.definition.id}:captain:${action.id}`, ...(action.action === "changes" ? [`${plan.definition.id}:changes:${action.id}`] : [])];
      const handled = keys.filter(k => plan.handled.includes(k)), pending = keys.filter(k => !plan.handled.includes(k));
      const noteId = `firstmate-plan-${action.id}`, note = config.mateNotes.find(n => n.id === noteId);
      const { state, claim } = claimed(noteId);
      const delivery = pending.length === 0 ? "handled" : state ?? (note ? (preexisting.has(itemFingerprint(noteItem(note))) ? "uncertain" : "queued") : action.notified ? "uncertain" : "queued");
      rows.push(this.row(input, "plan-action", action.id, tip, owner, { original: { actionId: action.id, noteId }, payloadHash: note ? digest(note) : digest(action),
        resolution: { by: "identity", plans: [plan.definition.id], unresolved: [] }, recipient: claim?.claim.recipient ?? null,
        observed: { notified: action.notified === true, handledKeys: handled, pendingKeys: pending, outcome: null }, delivery, claimId: claim?.claim.id ?? null,
        imperative: false, route: pending.length ? "transfer-fact" : "already-handled",
        reason: pending.length ? "Unhandled informational captain action; transfer one stable consequence to the scoped owner." : "Every handled key for this action is recorded.",
        destination: pending.length ? fact(action.id) : null, removal: { state: note ? "pending" : "not-queued", receipt: null } }));
    }
    for (const note of config.mateNotes) {
      if (!note.burst || !tokens.agents.includes(/^remote:[^:]+:(.+)$/.exec(note.burst.key)?.[1] ?? note.burst.key)) continue;
      const { state, claim } = claimed(note.id);
      rows.push(this.row(input, "burst", note.id, tip, owner, { original: { noteId: note.id }, payloadHash: digest(note), resolution: { by: "identity", plans: [plan.definition.id], unresolved: [] },
        recipient: claim?.claim.recipient ?? null, observed: { notified: null, handledKeys: [], pendingKeys: [], outcome: null },
        delivery: state ?? (preexisting.has(itemFingerprint(noteItem(note))) ? "uncertain" : "queued"), claimId: claim?.claim.id ?? null, imperative: false,
        route: "transfer-fact", reason: "Captain/worker exchange relay for this plan's worker; informational, transferred with its parts.",
        destination: fact(note.id), removal: { state: "pending", receipt: null } }));
    }
    for (const entry of queue) {
      const item = watchItem(entry);
      if (!mentions(item.text!, tokens).length) continue;
      rows.push(this.watchHold(input, entry, tokens, tip, owner, claimed(item.id), preexisting.has(itemFingerprint(item))));
    }
    for (const request of decisions.requests) {
      const host = request.source.hostId || null;
      const matches = tokens.tasks.filter(t => t.task === request.source.taskId);
      if (!matches.length) continue;
      const exact = matches.some(t => host === null || t.host.trim().toLowerCase() === host.trim().toLowerCase());
      for (const submission of request.submissions.filter(s => s.outcome !== "failed")) {
        const { state, claim } = claimed(submission.submissionId);
        rows.push(this.row(input, "decision-submission", submission.submissionId, tip, owner, { original: { requestId: request.id, submissionId: submission.submissionId,
          messageId: `firstmate-answer-${submission.submissionId}`, revision: submission.revision },
          payloadHash: submission.messageHash ?? digest(submission), resolution: { by: "identity", plans: [plan.definition.id], unresolved: exact ? [] : [`${request.source.taskId}@${host}`] },
          recipient: claim?.claim.recipient ?? null, observed: { notified: null, handledKeys: [], pendingKeys: [], outcome: submission.outcome },
          delivery: submission.outcome === "accepted" || state === "accepted" ? "accepted" : "uncertain", claimId: claim?.claim.id ?? null, imperative: true, route: "hold",
          reason: "A captain answer already reserved for the old owner. Its handling is unknown; it is held, never re-sent or re-answered. The captain resolves it.",
          destination: null, removal: { state: "not-queued", receipt: null } }));
      }
    }
    // A live or uncertain legacy worker's native finish notification still goes to its original creator (U2 is
    // absent), so the cutover cannot be complete until each is quiescent and accounted with evidence.
    for (const a of attempts) {
      const uncertainLaunch = launches.find(l => l.attempt === a.attempt && ["issued", "unresolved"].includes(l.state));
      if (terminal(a.state.state) && !uncertainLaunch) continue;
      if (a.state.state === "planned" && !uncertainLaunch && !a.state.agentId) continue;
      rows.push(this.row(input, "worker-callback", a.attempt, tip, owner, { original: { attemptId: a.attempt, ...(a.state.agentId ? { agentId: a.state.agentId } : {}), ...(uncertainLaunch ? { launchFile: `data/${uncertainLaunch.node}/launches/${uncertainLaunch.file}` } : {}) },
        payloadHash: digest({ attempt: a.attempt, state: a.state.state, agentId: a.state.agentId ?? null, launch: uncertainLaunch ?? null }),
        resolution: { by: "identity", plans: [plan.definition.id], unresolved: [] }, recipient: owner,
        observed: { notified: null, handledKeys: [], pendingKeys: [], outcome: null }, delivery: uncertainLaunch ? "uncertain" : "offered", claimId: null, imperative: false, route: "hold",
        reason: `Legacy attempt ${a.attempt} on ${a.node} is ${uncertainLaunch ? `an uncertain launch (${uncertainLaunch.state})` : a.state.state}; its native callback still reaches the original first mate. Hold until it is quiescent and its finish is accounted.`,
        destination: null, removal: { state: "not-queued", receipt: null } }));
    }
    for (const row of claims.filter(c => (!c.result || c.result.outcome === "uncertain") && !rows.some(r => r.claimId === c.claim.id))) {
      const target = this.target(input.plan, tokens);
      if (row.claim.items.some(i => CutoverGate.classify(claimItem(i), target))) rows.push(this.claimHold(input, row.claim, tokens, tip, owner));
    }
    return rows;
  }
  private target(plan: string, tokens: CutoverTokens): CutoverTarget {
    return { plan, stage: "freeze", drains: new Set(), damaged: false, sidecar: { tokens } as CutoverSidecar };
  }
  /** A disposition can grant permission to finish, never make an executing native call disappear. */
  private assertNoLiveClaims(claims: Awaited<ReturnType<CutoverGate["claims"]>>, target: CutoverTarget, rows: LegacyDeliveryDisposition[] = []): void {
    const live = claims.filter(c => liveClaims().has(c.claim.id) &&
      (rows.some(d => d.claimId === c.claim.id) || c.claim.items.some(i => CutoverGate.classify(claimItem(i), target))));
    if (live.length) fail("HELD", `A legacy send is in flight (${live.map(c => c.claim.id).join(", ")}); wait for its native result before continuing the cutover.`);
  }
  private row(input: MigrationInput, source: LegacyDeliveryDisposition["source"], key: string, tip: { sequence: number; hash: string }, owner: string | null, rest: Partial<LegacyDeliveryDisposition>): LegacyDeliveryDisposition {
    return LegacyDeliveryDispositionSchema.parse({ format: "firstmate.legacy-delivery-disposition/1", id: migrationUuid(input.migrationId, source, key), version: 1,
      migrationId: input.migrationId, scopeId: input.scopeId, planId: input.plan, source, sourceTip: tip, originalOwner: owner, recipient: null, claimId: null,
      destination: null, receipts: { send: null, transfer: null, ack: null }, resolvedBy: null, ...rest });
  }
  private watchHold(input: MigrationInput, entry: QueuedNote, tokens: CutoverTokens, tip: { sequence: number; hash: string }, owner: string | null,
    c: { state: LegacyDeliveryDisposition["delivery"] | null; claim: { claim: Claim } | undefined }, preexisting: boolean, late = false) {
    const item = watchItem(entry);
    return this.row(input, "watch-queue", `${item.id}:${item.payloadHash}`, tip, owner, { original: { watch: { name: entry.name, ran: entry.ran, kind: entry.kind } }, payloadHash: item.payloadHash,
      resolution: { by: "mention", plans: [input.plan], unresolved: mentions(item.text!, tokens) }, recipient: c.claim?.claim.recipient ?? null,
      observed: { notified: null, handledKeys: [], pendingKeys: [], outcome: null }, delivery: c.state ?? (preexisting ? "uncertain" : "queued"),
      claimId: c.claim?.claim.id ?? null, imperative: true, route: "hold",
      reason: `Opaque watch output names this plan${late ? " (queued after the freeze)" : ""}; no evidence splits it. It stays with its legacy owner and holds only this transfer.`,
      destination: null, removal: { state: "pending", receipt: null } });
  }
  private claimHold(input: MigrationInput, claim: Claim, tokens: CutoverTokens, tip: { sequence: number; hash: string }, owner: string | null) {
    return this.row(input, "send-claim", claim.id, tip, owner, { original: { claimItem: claim.items.map(i => i.id).join(",").slice(0, 400) }, payloadHash: digest(claim),
      resolution: { by: claim.items.some(i => CutoverGate.classify(claimItem(i), this.target(input.plan, tokens)) === "identity") ? "identity" : "mention", plans: [input.plan], unresolved: [] },
      recipient: claim.recipient, observed: { notified: null, handledKeys: [], pendingKeys: [], outcome: null }, delivery: "uncertain", claimId: claim.id,
      imperative: claim.items.some(i => ["decision", "watch", "crew-action", "inspection"].includes(i.source)), route: "hold",
      reason: "A legacy send has no definite result. It may have arrived; it is never treated as unsent or re-sent.",
      destination: null, removal: { state: "not-queued", receipt: null } });
  }

  private expected(status: SupervisionStatus, mutations: StoreMutation[]): SupervisionExpected[] {
    const version = (kind: string, id: string) => status.versions.find(v => v.kind === kind && v.id === id)?.version ?? 0;
    return mutations.map(m => {
      const [kind, id] = m.kind === "workflow-import" ? ["workflow", m.events[0]!.plan] : m.kind === "backend" ? [m.kind, m.value.planId] :
        m.kind === "binding" ? [m.kind, m.value.scopeId] : m.kind === "workflow" ? [m.kind, m.event.plan] : m.kind === "retirement" ? [m.kind, m.receipt.plan] : [m.kind, m.value.id];
      return { kind: kind as never, id, version: version(kind, id) };
    });
  }
  private scopedTransaction(requestId: string, status: SupervisionStatus, mutations: StoreMutation[]) {
    return this.options.store.transact(this.expected(status, mutations), requestId, mutations);
  }
  private migration(status: SupervisionStatus, id: string) {
    const m = status.migrations?.find(r => r.id === id);
    if (!m) fail("UNKNOWN_OWNER", "No such migration.");
    return m;
  }

  /** Preflight, freeze and prepared commit. Refuses, without freezing, anything it cannot import and finish. */
  async prepare(input: MigrationInput): Promise<MigrationReceipt> {
    this.enabled();
    if (Object.values(input.prerequisites).some(v => !v.trim())) fail("UNSUPPORTED", "Name the accepted inventory, compatible rollback build and policy import evidence.");
    if (!await this.gate.armed()) fail("HELD", "Arm the delivery gate first so every legacy send leaves a claim.");
    if (await this.gate.sidecar(input.plan, "freeze")) fail("CONFLICT", "This plan already has a cutover record; resume or release it. A released plan is not migrated again in this journal.");
    const status = await this.options.store.read();
    if (status.freshness !== "current") fail("HELD", "The scoped journal is not current.");
    if (status.scopes.some(s => s.id === input.scopeId) || status.backends.some(b => b.planId === input.plan)) fail("CONFLICT", "Target scope or plan already exists in the scoped journal.");
    const snap = await this.gate.run(() => this.options.legacy.locked(async () => {
      const frozenAt = this.now(), snap = await this.snapshot(input, frozenAt, status);
      if (snap.problems.length) fail("HELD", snap.problems.join(" "));
      await this.gate.publishSidecar({ format: "firstmate.cutover-sidecar/1", compatibility: 1, stage: "freeze", homeId: this.options.store.homeId,
        planId: input.plan, migrationId: input.migrationId, scopeId: input.scopeId, at: frozenAt, sourceHash: snap.sourceHash,
        inventoryHash: snap.receipt.inventory.hash, tokens: snap.tokens, transaction: null });
      return snap;
    }));
    await this.boundary("frozen");
    return this.commitPrepared(input, snap);
  }
  private async commitPrepared(input: MigrationInput, snap: Snapshot): Promise<MigrationReceipt> {
    const receipt = await this.scopedTransaction(input.migrationId, await this.options.store.read(), snap.prepared);
    await this.boundary("prepared");
    await this.publishPrepared(input.plan, receipt.hash);
    await this.boundary("prepared-sidecar");
    return snap.receipt;
  }
  private async publishPrepared(plan: string, transaction: string) {
    const freeze = await this.gate.sidecar(plan, "freeze");
    if (!freeze) fail("HELD", "The freeze sidecar is missing; the main first mate reconciles it deliberately.");
    const { hash: _h, ...body } = freeze;
    return this.gate.publishSidecar({ ...body, stage: "prepared", transaction });
  }

  /** Bring anything new for the frozen plan into the inventory as a hold: watch output mentioning it after the
   * freeze, a stray identity note from a non-compliant writer, or a crashed send claim. Never terminal.
   */
  async reinventory(migrationId: string): Promise<LegacyDeliveryDisposition[]> {
    this.enabled();
    return this.gate.run(async () => {
      const status = await this.options.store.read(), m = this.migration(status, migrationId);
      if (m.state !== "prepared") return [];
      const freeze = (await this.gate.sidecar(m.planId, "freeze"))!, tokens = freeze.tokens, target = this.target(m.planId, tokens);
      const rows = (status.dispositions ?? []).filter(d => d.migrationId === migrationId);
      const input = { plan: m.planId, scopeId: m.scopeId, projectId: "", migrationId, prerequisites: m.prerequisites };
      const owner = (await this.options.adapters.config()).mateAgentId.trim() || null, tip = m.source.tip, added: LegacyDeliveryDisposition[] = [];
      const ids = new Set(rows.map(d => d.id));
      const add = (d: LegacyDeliveryDisposition) => { if (!ids.has(d.id)) { ids.add(d.id); added.push(d); } };
      const claims = await this.gate.claims();
      this.assertNoLiveClaims(claims, target, rows);
      for (const entry of await this.options.adapters.watchQueue())
        if (CutoverGate.classify(watchItem(entry), target)) add(this.watchHold(input, entry, tokens, tip, owner, { state: null, claim: undefined }, false, true));
      for (const note of (await this.options.adapters.config()).mateNotes) {
        const item = noteItem(note);
        if (CutoverGate.classify(item, target) !== "identity" || rows.some(d => d.payloadHash === item.payloadHash)) continue;
        add(this.row(input, "config.mateNotes", `${note.id}:${item.payloadHash}`, tip, owner, { original: { noteId: note.id }, payloadHash: item.payloadHash,
          resolution: { by: "identity", plans: [m.planId], unresolved: [] }, observed: { notified: null, handledKeys: [], pendingKeys: [], outcome: null }, delivery: "queued",
          imperative: false, route: "hold", reason: "A note for this plan appeared after the freeze, outside the gate. Held for review.", removal: { state: "pending", receipt: null } }));
      }
      for (const c of claims) {
        if ((c.result && c.result.outcome !== "uncertain") || rows.some(d => d.claimId === c.claim.id)) continue;
        if (c.claim.items.some(i => CutoverGate.classify(claimItem(i), target))) add(this.claimHold(input, c.claim, tokens, tip, owner));
      }
      if (!added.length) return [];
      const all = [...rows, ...added];
      if (all.length > MIGRATION_LIMITS.dispositions) fail("HELD", "The cutover's delivery cap is reached; release it (abort) and drain the old owner first.");
      if (status.sequence + 1 + migrationCost(added) - 3 - MIGRATION_LIMITS.reinventoryReserve > SUPERVISION_INDEX_LIMITS.transactions - MIGRATION_LIMITS.abortReserve)
        fail("HELD", "Not enough journal headroom to account for the new deliveries; release the cutover (abort).");
      const ordered = m.inventory.dispositionIds.map(id => all.find(d => d.id === id)!).concat(added);
      await this.scopedTransaction(migrationUuid(migrationId, "reinventory", added.map(d => d.id)), status, [
        { kind: "migration", value: { ...m, version: m.version + 1, inventory: { hash: inventoryHash(ordered), dispositionIds: ordered.map(d => d.id) } } },
        ...added.map(value => ({ kind: "delivery-disposition" as const, value }))]);
      return added;
    });
  }

  /** Apply each disposition's route, never sending: commit the transfer mapping, archive, then compare-remove. */
  async reconcile(migrationId: string): Promise<LegacyDeliveryDisposition[]> {
    this.enabled();
    await this.reinventory(migrationId);
    for (;;) {
      const status = await this.options.store.read(), m = this.migration(status, migrationId);
      const rows = status.dispositions!.filter(x => x.migrationId === migrationId);
      if (m.state !== "prepared") return rows;
      const d = rows.find(x => x.removal.state !== "mismatch" && (
        (x.route === "transfer-fact" && !x.destination?.outboxId) || (["transfer-fact", "already-handled"].includes(x.route) && x.removal.state === "pending") ||
        (x.source === "send-claim" && x.route === "drain-legacy" && !x.receipts.send) ||
        (x.route === "drain-legacy" && x.removal.state === "pending")));
      if (!d) return rows;
      if (d.source === "send-claim" && d.route === "drain-legacy") {
        const recorded = await this.gate.run(async () => {
          const claims = await this.gate.claims(), freeze = (await this.gate.sidecar(m.planId, "freeze"))!;
          this.assertNoLiveClaims(claims, this.target(m.planId, freeze.tokens), rows);
          const native = claims.find(c => c.claim.id === d.claimId);
          if (!native?.result || native.result.outcome === "uncertain") return false;
          // Older permission receipts and resolutions are immutable. Append the actual native receipt separately.
          await this.scopedTransaction(migrationUuid(migrationId, d.id, "native-result"), status, [{ kind: "delivery-disposition", value: {
            ...d, version: d.version + 1, receipts: { ...d.receipts, send: `claim:${native.claim.id}` },
          } }]);
          return true;
        });
        if (!recorded) return rows;
        continue;
      }
      if (d.route === "transfer-fact" && !d.destination!.outboxId) {
        const outboxId = d.destination!.consequenceId;
        await this.scopedTransaction(migrationUuid(migrationId, d.id, "transfer"), status, [
          { kind: "outbox", value: { id: outboxId, version: 1, ownerScopeId: m.scopeId, planId: m.planId, kind: "legacy.fact",
            causationId: d.original.actionId ?? migrationUuid(d.original), subjectHash: d.payloadHash, decisionId: null, at: m.frozenAt, state: "pending", handledEpoch: null, resultRef: null } },
          { kind: "delivery-disposition", value: { ...d, version: d.version + 1, destination: { ...d.destination!, outboxId }, receipts: { ...d.receipts, transfer: `outbox:${outboxId}` } } }]);
        await this.boundary(`transferred:${d.id}`);
        continue;
      }
      const id = d.original.noteId ?? watchId(d.original.watch!);
      if (d.route === "drain-legacy") {
        // The recorded old owner finishes this delivery; it is accounted once it left with a receipt.
        await this.gate.run(async () => {
          const claims = await this.gate.claims(), freeze = (await this.gate.sidecar(m.planId, "freeze"))!;
          this.assertNoLiveClaims(claims, this.target(m.planId, freeze.tokens), rows);
          const queue = await this.options.adapters.watchQueue();
          if (queue.some(q => watchItem(q).id === id && watchItem(q).payloadHash === d.payloadHash)) return;
          const sent = claims.filter(c => c.result && c.result.outcome !== "failed" && c.claim.items.some(i => i.payloadHash === d.payloadHash));
          // A full watch queue may have dropped it (MAX_QUEUED): it left without being sent, and nothing is re-sent.
          const receipt = sent.length ? `claim:${sent.at(-1)!.claim.id}` : "dropped-from-legacy-queue";
          await this.scopedTransaction(migrationUuid(migrationId, d.id, "drained"), status, [{ kind: "delivery-disposition", value: { ...d, version: d.version + 1,
            recipient: sent.at(-1)?.claim.recipient ?? d.recipient, receipts: { ...d.receipts, send: sent.length ? receipt : d.receipts.send },
            removal: { state: sent.length ? "drained" : "absent", receipt } } }]);
        });
        // A queued drain has no completion receipt until the native send has settled and removed its entry.
        if ((await this.options.adapters.watchQueue()).some(q => watchItem(q).id === id && watchItem(q).payloadHash === d.payloadHash)) return rows;
        continue;
      }
      // The disposition (and any transfer mapping) is durable; archive the exact entry for a release, then remove it.
      const result = await this.gate.run(async () => {
        const freeze = (await this.gate.sidecar(m.planId, "freeze"))!;
        this.assertNoLiveClaims(await this.gate.claims(), this.target(m.planId, freeze.tokens), rows);
        const entry = d.source === "watch-queue" ? (await this.options.adapters.watchQueue()).find(q => watchItem(q).id === id && watchItem(q).payloadHash === d.payloadHash)
          : (await this.options.adapters.config()).mateNotes.find(n => n.id === id && digest(n) === d.payloadHash);
        if (entry) await this.archive(m.planId, d.id, { source: d.source, entry });
        return d.source === "watch-queue" ? this.options.adapters.removeWatchEntry(id, d.payloadHash) : this.options.adapters.removeMateNote(id, d.payloadHash);
      });
      await this.boundary(`removed:${d.id}`);
      await this.gate.run(async () => {
        const after = await this.options.store.read(), freeze = (await this.gate.sidecar(m.planId, "freeze"))!;
        this.assertNoLiveClaims(await this.gate.claims(), this.target(m.planId, freeze.tokens), rows);
        const current = after.dispositions!.find(x => x.id === d.id)!;
        await this.scopedTransaction(migrationUuid(migrationId, d.id, "removal"), after, [{ kind: "delivery-disposition", value: { ...current, version: current.version + 1,
          ...(result === "mismatch" ? { route: "hold" as const, reason: "The queued payload changed after its disposition; held for reconciliation, nothing removed." } : {}),
          removal: { state: result, receipt: `removal:${digest({ id, payloadHash: d.payloadHash, result })}` } } }]);
      });
    }
  }
  private async archive(plan: string, dispositionId: string, value: unknown) {
    try { await publish(join(this.gate.directory, plan, "removed", `${dispositionId}.json`), value); }
    catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "EEXIST") return;
      if (code !== "ENOENT") throw error;
      await (await import("node:fs/promises")).mkdir(join(this.gate.directory, plan, "removed"), { recursive: true });
      await publish(join(this.gate.directory, plan, "removed", `${dispositionId}.json`), value);
    }
  }

  /** Explicit, evidence-bound resolution of a hold. It never sends. A drain lets the recorded old owner finish
   * its own delivery; already-handled records outside evidence that it was handled. Answer holds are the
   * captain's to resolve; other holds the main first mate's (or the captain's). Cooperative attestation.
   */
  async resolveHold(migrationId: string, dispositionId: string, route: "drain-legacy" | "already-handled", evidence: { ref: string; digest: string }, actor: SupervisionActor): Promise<void> {
    this.enabled();
    if (!evidence.ref.trim() || !/^[0-9a-f]{64}$/.test(evidence.digest)) fail("HELD", "A resolution needs an evidence reference and its SHA-256.");
    await this.reinventory(migrationId);
    await this.gate.run(async () => {
      const status = await this.options.store.read(), m = this.migration(status, migrationId), d = status.dispositions!.find(x => x.id === dispositionId);
      if (m.state !== "prepared" || !d || d.migrationId !== migrationId || d.route !== "hold")
        fail("CONFLICT", "Only a held disposition of a prepared migration can be resolved.");
      const claims = await this.gate.claims(), freeze = (await this.gate.sidecar(m.planId, "freeze"))!;
      this.assertNoLiveClaims(claims, this.target(m.planId, freeze.tokens), status.dispositions!.filter(row => row.migrationId === migrationId));
      if (d.source === "decision-submission" && actor.kind !== "captain-ui") fail("UNKNOWN_OWNER", "An answer hold is the captain's to resolve: the old owner cannot attest its own handling.");
      if (!["captain-ui", "mate-chat", "agent"].includes(actor.kind)) fail("UNKNOWN_OWNER", "Name the first mate or the captain as the resolving owner.");
      if (route === "drain-legacy" && !["watch-queue", "decision-submission", "worker-callback", "send-claim"].includes(d.source)) fail("UNSUPPORTED", "This delivery cannot drain with its legacy owner.");
      const native = d.source === "send-claim" && route === "drain-legacy" ? claims.find(c => c.claim.id === d.claimId) : null;
      if (d.source === "send-claim" && route === "drain-legacy" && (!native?.result || native.result.outcome === "uncertain"))
        fail("HELD", "A direct drain needs a definite recorded native result. Permission to finish is not proof of finishing; reconcile with verified handling evidence instead.");
      const nativeReceipt = native ? `claim:${native.claim.id}` : null;
      const who = `${actor.kind}:${actor.id}`;
      await this.scopedTransaction(migrationUuid(migrationId, d.id, "resolve", route, evidence), status, [{ kind: "delivery-disposition", value: { ...d, version: d.version + 1, route,
        reason: `${d.reason} Resolved by ${who}: ${route}, evidence ${evidence.ref}.`, resolvedBy: { actor: who, evidenceRef: evidence.ref, evidenceDigest: evidence.digest, previousRoute: d.route },
        ...(nativeReceipt ? { receipts: { ...d.receipts, send: nativeReceipt }, removal: { state: "not-queued" as const, receipt: nativeReceipt } }
          : d.removal.state === "not-queued" ? { removal: { state: "not-queued" as const, receipt: `${route}:${evidence.ref}`.slice(0, 1024) } } : {}) } }]);
      if (route === "drain-legacy" && d.source === "watch-queue")
        await this.gate.allowDrain(m.planId, itemFingerprint({ source: "watch", id: watchId(d.original.watch!), payloadHash: d.payloadHash }), d.id);
    });
  }

  /** Verify everything still matches, then record the barrier. Any unaccounted delivery refuses, resolvably. */
  async barrier(migrationId: string): Promise<MigrationReceipt> {
    this.enabled();
    await this.reinventory(migrationId);
    return this.gate.run(async () => {
      let status = await this.options.store.read();
      const m = this.migration(status, migrationId);
      if (m.state !== "prepared") {
        if (m.state === "barrier") await this.verify(m, status, 1);
        return m;
      }
      const prepared = await this.gate.sidecar(m.planId, "prepared") ?? await this.publishPrepared(m.planId, (await this.options.store.requestReceipt(migrationId))!.hash);
      await this.verify(m, status);
      status = await this.options.store.read();
      const next = { ...m, version: m.version + 1, state: "barrier" as const, sidecars: { ...m.sidecars, prepared: prepared.hash } };
      await this.scopedTransaction(migrationUuid(migrationId, "barrier"), status, [{ kind: "migration", value: next }]);
      await this.boundary("barrier");
      return next;
    });
  }
  private async verify(m: MigrationReceipt, status: SupervisionStatus, transactionsNeeded = 2): Promise<void> {
    const freeze = await this.gate.sidecar(m.planId, "freeze");
    if (!freeze || freeze.migrationId !== m.id || freeze.sourceHash !== m.source.sourceHash) fail("HELD", "Freeze sidecar does not match this migration.");
    if (digest(await this.sourceFiles(m.planId)) !== m.source.sourceHash) fail("HELD", "Legacy source changed during the freeze; reinspect it, then release (abort) the cutover. It stays held meanwhile.");
    const rows = (status.dispositions ?? []).filter(d => d.migrationId === m.id);
    const claims = await this.gate.claims(), target = this.target(m.planId, freeze.tokens);
    this.assertNoLiveClaims(claims, target, rows);
    for (const d of rows.filter(row => row.source === "send-claim" && row.route === "drain-legacy")) {
      const native = claims.find(c => c.claim.id === d.claimId);
      if (!native?.result || native.result.outcome === "uncertain" || d.receipts.send !== `claim:${native.claim.id}`)
        fail("HELD", `Direct drain ${d.id} has no definite native result receipt; permission to finish is not proof of finishing.`);
    }
    const unaccounted = rows.filter(d => d.route === "hold" || ["pending", "mismatch"].includes(d.removal.state) || (d.route === "transfer-fact" && !d.destination?.outboxId));
    if (unaccounted.length) fail("HELD", `Unaccounted legacy deliveries (resolve each hold with evidence, or release the cutover): ${unaccounted.map(d => `${d.source}:${d.id} (${d.route}, ${d.removal.state})`).join(", ")}.`);
    // Live claims block even when a disposition names them. Other unresolved claims still need a hold or evidence.
    // Re-verified here, not only at the freeze: the barrier, the commit and the release reserve must still fit.
    if (status.sequence + transactionsNeeded + MIGRATION_LIMITS.abortReserve > SUPERVISION_INDEX_LIMITS.transactions)
      fail("HELD", `Journal headroom fell below what the barrier and commit need (sequence ${status.sequence}); release the cutover (abort) with the reserved transaction.`);
    const open = claims.filter(c => !c.result && !rows.some(d => d.claimId === c.claim.id) && c.claim.items.some(i => CutoverGate.classify(claimItem(i), target)));
    if (open.length) fail("HELD", `Legacy send claims are unaccounted: ${open.map(c => c.claim.id).join(", ")}.`);
  }
  private async sourceFiles(plan: string) {
    const files: { name: string; sha256: string }[] = [];
    for (const [dir, label] of [[plan, "events"], [join(".tips", plan), "tips"], [join(".published", plan), "published"], [join(".retired", plan), "retired"]] as const) {
      let names: string[] = [];
      try { names = await readdir(join(this.options.legacy.root, dir)); } catch (e) { if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e; }
      for (const name of names.sort()) files.push({ name: `${label}/${name}`, sha256: sha(await readFile(join(this.options.legacy.root, dir, name))) });
    }
    return files;
  }

  /** Publish the committed sidecar, then activate the one scoped backend with its imported attempts. */
  async commit(migrationId: string): Promise<MigrationReceipt> {
    this.enabled();
    return this.gate.run(async () => {
      const status = await this.options.store.read(), m = this.migration(status, migrationId);
      if (m.state === "committed") return m;
      if (m.state !== "barrier") fail("HELD", "Commit follows a verified barrier.");
      await this.verify(m, status, 1);
      if (digest(await this.sourceFiles(m.planId)) !== m.source.sourceHash) fail("HELD", "Legacy source changed during the freeze; reinspect it, then release (abort) the cutover.");
      const freeze = (await this.gate.sidecar(m.planId, "freeze"))!, { hash: _h, ...body } = freeze;
      const barrier = await this.options.store.requestReceipt(migrationUuid(migrationId, "barrier"));
      const committed = await this.gate.sidecar(m.planId, "committed") ?? await this.gate.publishSidecar({ ...body, stage: "committed", transaction: barrier!.hash });
      await this.boundary("committed-sidecar");
      const scope = status.scopes.find(s => s.id === m.scopeId)!, backend = status.backends.find(b => b.planId === m.planId)!;
      const next = { ...m, version: m.version + 1, state: "committed" as const, sidecars: { ...m.sidecars, committed: committed.hash } };
      await this.scopedTransaction(migrationUuid(migrationId, "commit"), status, [
        { kind: "migration", value: next },
        { kind: "backend", value: { ...backend, version: backend.version + 1, state: "active" } },
        { kind: "scope", value: { ...scope, version: scope.version + 1, state: "active" } },
        ...this.importedAttempts(m, status).map(value => ({ kind: "attempt" as const, value }))]);
      await this.boundary("committed");
      return next;
    });
  }
  /** Scoped attempt rows for the imported history, so scoped worker guards (S06 board, S08 sources) recognize
   * migrated workers. Spend and worker identity are the legacy record's; no launch effect is invented. */
  private importedAttempts(m: MigrationReceipt, status: SupervisionStatus): SupervisionAttempt[] {
    const plan = status.plans.find(p => p.plan.definition.id === m.planId)!.plan, states = attemptStates(plan);
    const ordinals = new Map<string, number>();
    return m.imported.attempts.flatMap(a => {
      const task = status.tasks.find(t => t.planId === m.planId && t.nodeId === a.node);
      if (!task) return []; // A removed or decision node has no scoped task; its reservation stays in the workflow inventory.
      const state = states.find(s => s.attempt === a.attempt)?.state, ordinal = (ordinals.get(a.node) ?? 0) + 1; ordinals.set(a.node, ordinal);
      const launch = m.launches.find(l => l.attempt === a.attempt);
      return [{ id: migrationUuid(m.id, "attempt", a.attempt), taskId: task.id, ordinal, briefHash: state?.briefHash ?? digest(["no-recorded-brief", a.attempt]),
        launchEffectId: migrationUuid(m.id, "imported-launch", a.attempt),
        worker: a.agentId && a.workspaceId ? { hostId: task.hostId, agentId: a.agentId, workspaceId: a.workspaceId } : null,
        originalNotificationOwner: (status.dispositions ?? []).find(d => d.migrationId === m.id)?.originalOwner ?? null,
        notificationStatus: launch?.state === "recorded" ? "reported" : "unknown", spentAgents: a.spent, spentTurns: a.spent,
        state: state ? `imported:${state.state}` : "imported", evidenceIds: [], version: 1, importedFrom: { migrationId: m.id, legacyAttempt: a.attempt, node: a.node } }];
    });
  }

  /** Release a prepared or barrier cutover back to the legacy backend: retire the scoped side (history kept),
   * restore every archived entry exactly as it was, then publish `aborted.json`. Nothing is sent; restored
   * informational notes may reach the old owner again under their original identity. Holds stay with it.
   */
  async abort(migrationId: string, reason: string, actor: SupervisionActor): Promise<MigrationReceipt> {
    this.enabled();
    if (!reason.trim() || !["captain-ui", "mate-chat", "agent"].includes(actor.kind)) fail("UNKNOWN_OWNER", "A release names the main first mate or the captain and a reason.");
    let status = await this.options.store.read(), m = this.migration(status, migrationId);
    if (m.state === "committed" || await this.gate.sidecar(m.planId, "committed")) fail("HELD", "The cutover has committed; recovery is forward (hold, or transfer at a higher epoch).");
    if (m.state !== "aborted") {
      // Only transferred informational facts go back to the old owner. An entry whose disposition records it as
      // handled (already-handled, including an opaque, possibly imperative watch row) is withheld: restoring it
      // would deliver an instruction its own record says was carried out.
      const archived = await this.archived(m.planId), rows = status.dispositions ?? [];
      const restore = archived.filter(a => rows.find(d => d.id === a.id)?.route === "transfer-fact");
      const withheld = archived.filter(a => !restore.includes(a)).map(a => {
        const d = rows.find(x => x.id === a.id);
        return { id: a.id, reason: `${d?.source ?? "unknown"} recorded ${d?.route ?? "without a disposition"}${d?.resolvedBy ? ` by ${d.resolvedBy.actor} (${d.resolvedBy.evidenceRef})` : ""}; not re-delivered.`.slice(0, 2000) };
      });
      const scope = status.scopes.find(s => s.id === m.scopeId)!, backend = status.backends.find(b => b.planId === m.planId)!;
      await this.scopedTransaction(migrationUuid(migrationId, "abort"), status, [
        { kind: "migration", value: { ...m, version: m.version + 1, state: "aborted", aborted: { actor: `${actor.kind}:${actor.id}`, reason: reason.slice(0, 2000), restored: restore.map(a => a.id), withheld } } },
        { kind: "backend", value: { ...backend, version: backend.version + 1, state: "retired" } },
        { kind: "scope", value: { ...scope, version: scope.version + 1, state: "retired" } }]);
      await this.boundary("aborted");
      status = await this.options.store.read(); m = this.migration(status, migrationId);
    }
    return this.finishRelease(m);
  }
  /** Restore exactly the entries the release receipt names (only where absent), then publish the release.
   * Idempotent after a crash; withheld entries stay archived as evidence. */
  private async finishRelease(m: MigrationReceipt): Promise<MigrationReceipt> {
    const archived = (await this.archived(m.planId)).filter(a => m.aborted!.restored.includes(a.id));
    await this.gate.run(async () => {
      for (const a of archived) {
        const value = a.value as { source: string; entry: unknown };
        if (value.source === "watch-queue") await this.options.adapters.restoreWatchEntry(value.entry as QueuedNote);
        else await this.options.adapters.restoreMateNote(value.entry as MateNote);
      }
    });
    await this.boundary("restored");
    const freeze = (await this.gate.sidecar(m.planId, "freeze"))!, { hash: _h, ...body } = freeze;
    await this.gate.publishSidecar({ ...body, stage: "aborted", transaction: (await this.options.store.requestReceipt(migrationUuid(m.id, "abort")))!.hash });
    return m;
  }
  private async archived(plan: string): Promise<{ id: string; value: unknown }[]> {
    let names: string[] = [];
    try { names = await readdir(join(this.gate.directory, plan, "removed")); } catch (e) { if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e; }
    return Promise.all(names.filter(n => /^[0-9a-f-]{36}\.json$/.test(n)).sort().map(async n => ({ id: n.slice(0, 36), value: JSON.parse(await readFile(join(this.gate.directory, plan, "removed", n), "utf8")) as unknown })));
  }

  /** Finish whatever stage a crash interrupted, or refuse and leave both writers held. */
  async resume(input: MigrationInput): Promise<MigrationReceipt> {
    this.enabled();
    const freeze = await this.gate.sidecar(input.plan, "freeze");
    if (!freeze || freeze.migrationId !== input.migrationId) fail("UNKNOWN_OWNER", "No freeze for this migration.");
    let status = await this.options.store.read();
    if (!status.migrations?.some(m => m.id === input.migrationId)) {
      const snap = await this.gate.run(() => this.options.legacy.locked(() => this.snapshot(input, freeze.at, status)));
      if (snap.sourceHash !== freeze.sourceHash || snap.receipt.inventory.hash !== freeze.inventoryHash || snap.problems.length)
        fail("HELD", "Source or delivery inventory changed since the freeze; reinspect it. Both writers stay held until it is released.");
      await this.commitPrepared(input, snap);
      status = await this.options.store.read();
    }
    const m = this.migration(status, input.migrationId);
    if (m.state === "aborted") return await this.gate.sidecar(input.plan, "aborted") ? m : this.finishRelease(m);
    if (m.state === "prepared" && !await this.gate.sidecar(input.plan, "prepared")) await this.publishPrepared(input.plan, (await this.options.store.requestReceipt(input.migrationId))!.hash);
    if (m.state === "barrier" && await this.gate.sidecar(input.plan, "committed")) return this.commit(input.migrationId);
    return this.migration(await this.options.store.read(), input.migrationId);
  }

  /** Copy the current owner's typed handled result onto each transferred disposition. */
  async recordAcknowledgements(migrationId: string): Promise<number> {
    this.enabled();
    let recorded = 0;
    for (;;) {
      const status = await this.options.store.read();
      const d = status.dispositions!.find(x => x.migrationId === migrationId && x.route === "transfer-fact" && !x.receipts.ack &&
        status.outbox.some(o => o.id === x.destination?.outboxId && o.state === "handled"));
      if (!d) return recorded;
      const outbox = status.outbox.find(o => o.id === d.destination!.outboxId)!;
      await this.scopedTransaction(migrationUuid(migrationId, d.id, "ack"), status, [{ kind: "delivery-disposition", value: { ...d, version: d.version + 1,
        receipts: { ...d.receipts, ack: `${outbox.resultRef}@epoch:${outbox.handledEpoch}` } } }]);
      recorded++;
    }
  }

  /** Cutover state for the operator. `complete` only when no legacy delivery to General can still happen for this
   * plan by identity: committed, every transfer acknowledged by its owner, no open hold, worker callback or claim.
   * Watch output that merely mentions the plan keeps its original route (S08/S10 classify sources); it is listed.
   */
  async report(plan: string) {
    const status = await this.options.store.read(), m = [...(status.migrations ?? [])].reverse().find(r => r.planId === plan) ?? null;
    const rows = (status.dispositions ?? []).filter(d => d.migrationId === m?.id);
    const stage = await this.gate.sidecar(plan, "aborted") ? "aborted" : await this.gate.sidecar(plan, "committed") ? "committed" :
      await this.gate.sidecar(plan, "prepared") ? "prepared" : await this.gate.sidecar(plan, "freeze") ? "freeze" : null;
    const freeze = await this.gate.sidecar(plan, "freeze");
    const openClaims = freeze ? (await this.gate.claims()).filter(c =>
      (liveClaims().has(c.claim.id) || (!c.result && !rows.some(d => d.claimId === c.claim.id))) &&
      (rows.some(d => d.claimId === c.claim.id) || c.claim.items.some(i => CutoverGate.classify(claimItem(i), this.target(plan, freeze.tokens))))).map(c => c.claim.id) : [];
    const legacyDeliveryPossible = [
      ...rows.filter(d => d.route === "transfer-fact" && !d.receipts.ack).map(d => `transfer ${d.id} awaits its owner's result`),
      ...rows.filter(d => d.route === "hold").map(d => `hold ${d.source}:${d.id}`),
      ...rows.filter(d => d.source === "send-claim" && d.route === "drain-legacy" && !d.receipts.send).map(d => `direct drain ${d.id} awaits a native result receipt`),
      ...rows.filter(d => d.source === "worker-callback" && !d.resolvedBy).map(d => `worker callback ${d.original.attemptId} unaccounted`),
      ...openClaims.map(c => `open claim ${c}`),
    ];
    return { plan, stage, migration: m, dispositions: rows,
      transfersAcknowledged: rows.filter(d => d.route === "transfer-fact").every(d => d.receipts.ack),
      legacyDeliveryPossible, originalRouteKept: ["Watch output that only mentions this plan keeps its original route until S08/S10 classify its source."],
      complete: m?.state === "committed" && legacyDeliveryPossible.length === 0 };
  }
}

/** Separate scoped projection export. Never writes `data/backlog.md`; binds to the preimage it replaces. */
export async function exportScopedProjection(home: string, receipt: MigrationReceipt, status: SupervisionStatus, expected: string | null): Promise<{ path: string; preimage: string | null; text: string }> {
  const row = status.plans.find(p => p.plan.definition.id === receipt.planId);
  if (!row) fail("UNKNOWN_OWNER", "No scoped plan to export.");
  const plan = row.plan, path = `data/scoped/${receipt.planId}.md`;
  const text = [`<!-- Scoped projection of ${receipt.planId}: generated from scoped sequence ${status.sequence} (${status.hash}). Edits here are proposals, not authority. -->`,
    `# ${plan.definition.title}`, "", ...plan.definition.nodes.map(n => `- ${n.id}: ${plan.nodes[n.id]?.state ?? "planned"}${plan.nodes[n.id]?.held ? ` (hold: ${plan.nodes[n.id]!.held})` : ""}`), ""].join("\n");
  const { absolute } = await resolveInHome(home, path);
  let current: string | null = null;
  try { current = await readFile(absolute, "utf8"); } catch (e) { if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e; }
  if (current !== expected) fail("STALE", "The scoped projection changed since it was read; a direct edit is a proposal to review, never overwritten.");
  const { mkdir, writeFile, rename } = await import("node:fs/promises");
  await mkdir(join(absolute, ".."), { recursive: true });
  const temporary = `${absolute}.${migrationUuid(path, status.hash)}.tmp`;
  await writeFile(temporary, text, { flag: "w" }); await rename(temporary, absolute);
  return { path, preimage: current === null ? null : sha(current), text };
}
export type { CutoverSidecar };
