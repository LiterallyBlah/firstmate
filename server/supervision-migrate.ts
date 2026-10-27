/** S07 history import and per-scope single-writer cutover. Disabled by default and unwired: no RPC,
 * timer or start-up path constructs a writable migrator. A separately approved activation names one
 * target plan scope at a time, after its inventory, rollback build and policy import are accepted.
 *
 * Sequence (each stage durable before the next; a crash at any point resumes the same migration or
 * leaves both writers held):
 *   1. freeze: under the delivery gate AND the legacy writer's lock, snapshot the plan's exact bytes and
 *      every affected legacy delivery, then publish `.scoped/<plan>/freeze.json`. From here the legacy
 *      writer and every gated delivery path refuse this plan.
 *   2. prepared: one scoped transaction imports the original chain byte-for-byte, registers the scope,
 *      a prepared backend, the MigrationReceipt and one LegacyDeliveryDisposition per delivery.
 *   3. reconcile: transfer facts (outbox mapping committed BEFORE any old queue entry is removed by
 *      ID and payload), already-handled removals, accounted drains. Holds stay holds.
 *   4. barrier: verify source, claims, queues and dispositions; record the prepared sidecar.
 *   5. committed: publish the committed sidecar, then activate the scoped backend in one transaction.
 * Nothing here sends a message, calls a model, or replays an uncertain instruction.
 */
import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { FirstmateConfig } from "../shared/fleet";
import type { NeedsYouSnapshot } from "../shared/needs-you";
import type { SupervisionStatus } from "../shared/supervision";
import { LegacyDeliveryDispositionSchema, MigrationReceiptSchema, type CutoverSidecar, type CutoverTokens, type LegacyDeliveryDisposition, type MigrationReceipt } from "../shared/supervision-migration";
import type { WorkflowPlan } from "../shared/workflow-plans";
import { readFirstmateConfig, updateFirstmateConfig } from "./config";
import { resolveInHome } from "./files";
import { ITEM_TAGS_FILE } from "./item-tags";
import { noteItem } from "./mate";
import { serialized } from "./serialize";
import { digest } from "./submissions";
import { CutoverGate, cutoverGate, itemFingerprint, liveClaims, mentions, type Claim, type ClaimResult, type GateItem } from "./supervision-gate";
import { inventoryHash, SupervisionError, type StoreMutation, type SupervisionStore } from "./supervision-store";
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

/** The installed-shaped legacy queues, read and changed only through their own locks. */
export interface LegacyDeliveryAdapters {
  config(): Promise<FirstmateConfig>;
  removeMateNote(id: string, payloadHash: string): Promise<"removed" | "absent" | "mismatch">;
  watchQueue(): Promise<QueuedNote[]>;
  removeWatchEntry(id: string, payloadHash: string): Promise<"removed" | "absent" | "mismatch">;
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
    watchQueue: async () => runner ? runner.queued() : [],
    removeWatchEntry: async (id, payloadHash) => runner ? runner.removeQueued(id, payloadHash) : "absent",
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
interface Snapshot {
  plan: WorkflowPlan; events: Event[]; files: { name: string; sha256: string }[]; sourceHash: string; tokens: CutoverTokens;
  dispositions: LegacyDeliveryDisposition[]; receipt: MigrationReceipt; problems: string[];
}

function claimItem(i: Claim["items"][number]): GateItem {
  return { source: i.source, id: i.id, payloadHash: i.payloadHash, text: i.mentions.join(" "), ...(i.plan ? { plan: i.plan } : {}),
    ...(i.actionId ? { actionId: i.actionId } : {}), ...(i.agentKey ? { agentKey: i.agentKey } : {}), ...(i.task ? { task: i.task } : {}) };
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

  /** Read-only import report: parity, fingerprints and the dispositions a cutover would publish. */
  async dryRun(input: MigrationInput): Promise<{ plan: string; sourceHash: string; parity: boolean; problems: string[]; dispositions: LegacyDeliveryDisposition[]; receipt: MigrationReceipt }> {
    const snap = await this.snapshot(input, this.now(), await this.options.store.read());
    return { plan: input.plan, sourceHash: snap.sourceHash, parity: !snap.problems.length, problems: snap.problems, dispositions: snap.dispositions, receipt: snap.receipt };
  }

  /** Exact legacy bytes, chain, parity and delivery inventory. Pure read; caller holds locks for a freeze. */
  private async snapshot(input: MigrationInput, frozenAt: string, status: SupervisionStatus): Promise<Snapshot> {
    const { legacy } = this.options, problems: string[] = [];
    const read = await legacy.read();
    if (read.unavailable) fail("HELD", "The legacy plan store is unavailable; nothing can be imported.");
    if (read.quarantined.some(q => q.plan === input.plan)) fail("HELD", `Plan ${input.plan} is quarantined or retired in the legacy store; reconcile it deliberately, never import a damaged history.`);
    const plan = read.plans.find(p => p.definition.id === input.plan);
    if (!plan) fail("UNKNOWN_OWNER", `No readable legacy plan ${input.plan}.`);
    const files: { name: string; sha256: string }[] = [];
    for (const [dir, label] of [[input.plan, "events"], [join(".tips", input.plan), "tips"], [join(".published", input.plan), "published"], [join(".retired", input.plan), "retired"]] as const) {
      let names: string[] = [];
      try { names = await readdir(join(legacy.root, dir)); } catch (e) { if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e; }
      for (const name of names.sort()) files.push({ name: `${label}/${name}`, sha256: sha(await readFile(join(legacy.root, dir, name))) });
    }
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
    const states = [...Object.values(plan.nodes), ...(plan.removed ?? []).map(r => r.state)];
    const tokens: CutoverTokens = { plan: input.plan, nodes: [...new Set(nodes.map(n => n.id))].sort(),
      actions: (plan.captainEvents ?? []).map(a => a.id), agents: [...new Set(states.flatMap(s => s.agentId ? [s.agentId] : []))].sort(),
      tasks: nodes.flatMap(n => n.kind === "run" ? [{ task: n.id, host: n.launch.host }] : []) };
    const tip = { sequence: plan.sequence, hash: plan.hash };
    const dispositions = await this.inventory(input, plan, tokens, tip, status);
    let inventory: WorkflowOwnership | null = null, step: WorkflowPlan | null = null;
    for (const event of events) { step = replaySupervisionWorkflow(step, event, this.options.store.homeId); inventory = mergeOwnership([...(inventory ? [inventory] : []), planOwnership(step)]); }
    const requests = events.map(e => ({ requestId: e.requestId, requestHash: e.requestHash, eventHash: e.hash }));
    const others = read.plans.filter(p => p.definition.id !== input.plan);
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
    const preimage = async (path: string) => { try { return sha(await readFile((await resolveInHome(this.options.home, path)).absolute)); } catch (e) { if ((e as NodeJS.ErrnoException).code === "ENOENT") return null; throw e; } };
    const receipt = MigrationReceiptSchema.parse({ format: "firstmate.migration-receipt/1", id: input.migrationId, version: 1, compatibility: 1,
      homeId: this.options.store.homeId, planId: input.plan, scopeId: input.scopeId, state: "prepared", frozenAt, prerequisites: input.prerequisites,
      source: { tip, sourceHash, files },
      imported: { indexHash: digest(requests), requests, attempts: inventory?.attempts ?? [], budget: inventory?.budget ?? { agents: 0, turns: 0 },
        handled: plan.handled, told: plan.told, holds: Object.entries(plan.nodes).flatMap(([node, s]) => s.held ? [{ node, held: s.held }] : []) },
      dependents: others.flatMap(p => p.definition.nodes.flatMap(n => n.after.filter(e => tokens.nodes.includes(e.node)).map(e => ({ plan: p.definition.id, node: n.id, on: e.node })))),
      launches, inventory: { hash: inventoryHash(dispositions), dispositionIds: dispositions.map(d => d.id) },
      projectionPreimage: { backlog: await preimage("data/backlog.md"), itemTags: await preimage(ITEM_TAGS_FILE) },
      sidecars: { freeze: digest({ migrationId: input.migrationId, sourceHash, inventory: inventoryHash(dispositions) }), prepared: null, committed: null } });
    return { plan, events, files, sourceHash, tokens, dispositions, receipt, problems };
  }

  /** One disposition per affected legacy delivery. Pending facts come from authoritative actions and
   * handled keys; `notified`, queue presence and transport acceptance are only delivery history.
   */
  private async inventory(input: MigrationInput, plan: WorkflowPlan, tokens: CutoverTokens, tip: { sequence: number; hash: string }, _status: SupervisionStatus): Promise<LegacyDeliveryDisposition[]> {
    const { adapters } = this.options, gate = this.gate;
    const config = await adapters.config(), queue = await adapters.watchQueue(), decisions = await adapters.decisions();
    const claims = await gate.claims(), armed = await gate.armed(), preexisting = new Set(armed?.preexisting ?? []);
    const owner = config.mateAgentId.trim() || null;
    const latest = (id: string) => [...claims].reverse().find(c => c.claim.items.some(i => i.id === id) && c.result?.outcome !== "failed");
    const claimed = (id: string): { state: LegacyDeliveryDisposition["delivery"] | null; claim: { claim: Claim; result: ClaimResult | null } | undefined } => {
      const row = latest(id);
      if (!row) return { state: null, claim: undefined };
      if (!row.result && liveClaims().has(row.claim.id)) fail("HELD", `A legacy send (${id}) is in flight; account for it before freezing ${input.plan}.`);
      return { state: row.result?.outcome === "accepted" ? "accepted" : "uncertain", claim: row };
    };
    const rows: LegacyDeliveryDisposition[] = [];
    const base = (source: LegacyDeliveryDisposition["source"], key: string, rest: Partial<LegacyDeliveryDisposition>): LegacyDeliveryDisposition => LegacyDeliveryDispositionSchema.parse({
      format: "firstmate.legacy-delivery-disposition/1", id: migrationUuid(input.migrationId, source, key), version: 1, migrationId: input.migrationId,
      scopeId: input.scopeId, planId: input.plan, source, sourceTip: tip, originalOwner: owner, recipient: null, claimId: null, destination: null,
      receipts: { send: null, transfer: null, ack: null }, resolvedBy: null, ...rest });
    const fact = (key: string) => ({ scopeId: input.scopeId, consequenceId: migrationUuid(input.plan, "legacy-fact", key), outboxId: null });
    for (const action of plan.captainEvents ?? []) {
      const keys = [`${plan.definition.id}:captain:${action.id}`, ...(action.action === "changes" ? [`${plan.definition.id}:changes:${action.id}`] : [])];
      const handled = keys.filter(k => plan.handled.includes(k)), pending = keys.filter(k => !plan.handled.includes(k));
      const noteId = `firstmate-plan-${action.id}`, note = config.mateNotes.find(n => n.id === noteId);
      const { state, claim } = claimed(noteId);
      const delivery = pending.length === 0 ? "handled" : state ?? (note ? (preexisting.has(itemFingerprint(noteItem(note))) ? "uncertain" : "queued") : action.notified ? "uncertain" : "queued");
      rows.push(base("plan-action", action.id, { original: { actionId: action.id, noteId }, payloadHash: note ? digest(note) : digest(action),
        resolution: { by: "identity", plans: [plan.definition.id], unresolved: [] }, recipient: claim?.claim.recipient ?? null,
        observed: { notified: action.notified === true, handledKeys: handled, pendingKeys: pending, outcome: null }, delivery, claimId: claim?.claim.id ?? null,
        imperative: false, route: pending.length ? "transfer-fact" : "already-handled",
        reason: pending.length ? "Unhandled informational captain action; transfer one stable consequence to the scoped owner." : "Every handled key for this action is recorded.",
        destination: pending.length ? fact(action.id) : null, removal: { state: note ? "pending" : "not-queued", receipt: null } }));
    }
    for (const note of config.mateNotes) {
      if (!note.burst || !tokens.agents.includes(/^remote:[^:]+:(.+)$/.exec(note.burst.key)?.[1] ?? note.burst.key)) continue;
      const { state, claim } = claimed(note.id);
      rows.push(base("burst", note.id, { original: { noteId: note.id }, payloadHash: digest(note), resolution: { by: "identity", plans: [plan.definition.id], unresolved: [] },
        recipient: claim?.claim.recipient ?? null, observed: { notified: null, handledKeys: [], pendingKeys: [], outcome: null },
        delivery: state ?? (preexisting.has(itemFingerprint(noteItem(note))) ? "uncertain" : "queued"), claimId: claim?.claim.id ?? null, imperative: false,
        route: "transfer-fact", reason: "Captain/worker exchange relay for this plan's worker; informational, transferred with its parts.",
        destination: fact(note.id), removal: { state: "pending", receipt: null } }));
    }
    for (const entry of queue) {
      const item = watchItem(entry);
      if (!mentions(item.text!, tokens).length) continue;
      const { state, claim } = claimed(item.id);
      rows.push(base("watch-queue", `${item.id}:${item.payloadHash}`, { original: { watch: { name: entry.name, ran: entry.ran, kind: entry.kind } }, payloadHash: item.payloadHash,
        resolution: { by: "mention", plans: [plan.definition.id], unresolved: mentions(item.text!, tokens) }, recipient: claim?.claim.recipient ?? null,
        observed: { notified: null, handledKeys: [], pendingKeys: [], outcome: null }, delivery: state ?? (preexisting.has(itemFingerprint(item)) ? "uncertain" : "queued"),
        claimId: claim?.claim.id ?? null, imperative: true, route: "hold",
        reason: "Opaque watch output names this plan; no evidence splits it. It stays with its legacy owner and holds this transfer.",
        destination: null, removal: { state: "pending", receipt: null } }));
    }
    for (const request of decisions?.requests ?? []) {
      const host = request.source.hostId || null;
      const matches = tokens.tasks.filter(t => t.task === request.source.taskId);
      if (!matches.length) continue;
      const exact = matches.some(t => host === null || t.host.trim().toLowerCase() === host.trim().toLowerCase());
      for (const submission of request.submissions.filter(s => s.outcome !== "failed")) {
        const { state, claim } = claimed(submission.submissionId);
        rows.push(base("decision-submission", submission.submissionId, { original: { requestId: request.id, submissionId: submission.submissionId,
          messageId: `firstmate-answer-${submission.submissionId}`, revision: submission.revision },
          payloadHash: submission.messageHash ?? digest(submission), resolution: { by: "identity", plans: [plan.definition.id], unresolved: exact ? [] : [`${request.source.taskId}@${host}`] },
          recipient: claim?.claim.recipient ?? null, observed: { notified: null, handledKeys: [], pendingKeys: [], outcome: submission.outcome },
          delivery: submission.outcome === "accepted" || state === "accepted" ? "accepted" : "uncertain", claimId: claim?.claim.id ?? null, imperative: true, route: "hold",
          reason: "A captain answer already reserved for the old owner. Its handling is unknown; it is held, never re-sent or re-answered.",
          destination: null, removal: { state: "not-queued", receipt: null } }));
      }
    }
    if (rows.length > 200) fail("HELD", "More than 200 affected legacy deliveries; drain the old owner before this cutover.");
    return rows;
  }

  private async scopedTransaction(requestId: string, status: SupervisionStatus, mutations: StoreMutation[]) {
    const version = (kind: string, id: string) => status.versions.find(v => v.kind === kind && v.id === id)?.version ?? 0;
    return this.options.store.transact(mutations.map(m => {
      const [kind, id] = m.kind === "workflow-import" ? ["workflow", m.events[0]!.plan] : m.kind === "backend" ? [m.kind, m.value.planId] :
        m.kind === "binding" ? [m.kind, m.value.scopeId] : m.kind === "workflow" ? [m.kind, m.event.plan] : m.kind === "retirement" ? [m.kind, m.receipt.plan] : [m.kind, m.value.id];
      return { kind: kind as never, id, version: version(kind, id) };
    }), requestId, mutations);
  }
  private migration(status: SupervisionStatus, id: string) {
    const m = status.migrations?.find(r => r.id === id);
    if (!m) fail("UNKNOWN_OWNER", "No such migration.");
    return m;
  }

  /** Freeze and prepared commit. Refuses, without freezing, anything it cannot import exactly. */
  async prepare(input: MigrationInput): Promise<MigrationReceipt> {
    this.enabled();
    if (Object.values(input.prerequisites).some(v => !v.trim())) fail("UNSUPPORTED", "Name the accepted inventory, compatible rollback build and policy import evidence.");
    if (!await this.gate.armed()) fail("HELD", "Arm the delivery gate first so every legacy send leaves a claim.");
    if (await this.gate.sidecar(input.plan, "freeze")) fail("CONFLICT", "This plan already has a cutover; resume it rather than starting another.");
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
    const status = await this.options.store.read();
    const receipt = await this.scopedTransaction(input.migrationId, status, [
      { kind: "scope", value: { id: input.scopeId, homeId: this.options.store.homeId, kind: "plan", projectIds: [input.projectId], sponsorId: null, version: 1, mode: "scoped", state: "transferring" } },
      { kind: "backend", value: { planId: input.plan, ownerScopeId: input.scopeId, backend: "scoped", state: "prepared", sourceHash: snap.sourceHash, version: 1 } },
      { kind: "workflow-import", scopeId: input.scopeId, migrationId: input.migrationId, events: snap.events },
      // The imported plan's run tasks become scoped-owned, so the task/host index refuses any other writer.
      ...snap.plan.definition.nodes.flatMap(n => n.kind === "run" ? [{ kind: "task" as const, value: { id: migrationUuid(input.migrationId, "task", n.id),
        ownerScopeId: input.scopeId, planId: input.plan, nodeId: n.id, projectId: input.projectId, hostId: n.launch.host, version: 1, currentAttempt: null } }] : []),
      { kind: "migration", value: snap.receipt },
      ...snap.dispositions.map(value => ({ kind: "delivery-disposition" as const, value })),
    ]);
    await this.boundary("prepared");
    await this.publishPrepared(input.plan, receipt.hash);
    await this.boundary("prepared-sidecar");
    return snap.receipt;
  }
  private async publishPrepared(plan: string, transaction: string) {
    const freeze = await this.gate.sidecar(plan, "freeze");
    if (!freeze) fail("HELD", "The freeze sidecar is missing; reconcile deliberately.");
    const { hash: _h, ...body } = freeze;
    return this.gate.publishSidecar({ ...body, stage: "prepared", transaction });
  }

  /** Apply each disposition's route, never sending: commit the transfer mapping, then compare-remove. */
  async reconcile(migrationId: string): Promise<LegacyDeliveryDisposition[]> {
    this.enabled();
    for (;;) {
      const status = await this.options.store.read(), m = this.migration(status, migrationId);
      if (m.state !== "prepared") return status.dispositions!.filter(d => d.migrationId === migrationId);
      const d = status.dispositions!.find(x => x.migrationId === migrationId && x.removal.state !== "mismatch" && (
        (x.route === "transfer-fact" && !x.destination?.outboxId) || (["transfer-fact", "already-handled"].includes(x.route) && x.removal.state === "pending") ||
        (x.route === "drain-legacy" && x.removal.state === "pending")));
      if (!d) return status.dispositions!.filter(x => x.migrationId === migrationId);
      if (d.route === "transfer-fact" && !d.destination!.outboxId) {
        const outboxId = d.destination!.consequenceId;
        await this.scopedTransaction(migrationUuid(migrationId, d.id, "transfer"), status, [
          { kind: "outbox", value: { id: outboxId, version: 1, ownerScopeId: m.scopeId, planId: m.planId, kind: "legacy.fact",
            causationId: d.original.actionId ?? migrationUuid(d.original), subjectHash: d.payloadHash, decisionId: null, at: m.frozenAt, state: "pending", handledEpoch: null, resultRef: null } },
          { kind: "delivery-disposition", value: { ...d, version: d.version + 1, destination: { ...d.destination!, outboxId }, receipts: { ...d.receipts, transfer: `outbox:${outboxId}` } } }]);
        await this.boundary(`transferred:${d.id}`);
        continue;
      }
      if (d.route === "drain-legacy") {
        // The recorded old owner finishes this delivery; it is accounted once it left with a receipt.
        const queue = await this.options.adapters.watchQueue();
        if (queue.some(q => watchItem(q).id === `${d.original.watch!.name}@${d.original.watch!.ran}#${d.original.watch!.kind}` && watchItem(q).payloadHash === d.payloadHash)) return status.dispositions!.filter(x => x.migrationId === migrationId);
        const sent = (await this.gate.claims()).filter(c => c.result && c.result.outcome !== "failed" && c.claim.items.some(i => i.payloadHash === d.payloadHash));
        if (!sent.length) fail("HELD", `Drained delivery ${d.id} left its queue without a send receipt; reconcile deliberately.`);
        await this.scopedTransaction(migrationUuid(migrationId, d.id, "drained"), status, [{ kind: "delivery-disposition", value: { ...d, version: d.version + 1,
          recipient: sent.at(-1)!.claim.recipient, receipts: { ...d.receipts, send: `claim:${sent.at(-1)!.claim.id}` }, removal: { state: "drained", receipt: `claim:${sent.at(-1)!.claim.id}` } } }]);
        continue;
      }
      // The disposition (and any transfer mapping) is durable; only now does the old entry go.
      const id = d.original.noteId ?? `${d.original.watch!.name}@${d.original.watch!.ran}#${d.original.watch!.kind}`;
      const result = await this.gate.run(() => d.source === "watch-queue" ? this.options.adapters.removeWatchEntry(id, d.payloadHash) : this.options.adapters.removeMateNote(id, d.payloadHash));
      await this.boundary(`removed:${d.id}`);
      const after = await this.options.store.read();
      const current = after.dispositions!.find(x => x.id === d.id)!;
      await this.scopedTransaction(migrationUuid(migrationId, d.id, "removal"), after, [{ kind: "delivery-disposition", value: { ...current, version: current.version + 1,
        ...(result === "mismatch" ? { route: "hold" as const, reason: "The queued payload changed after its disposition; held for reconciliation, nothing removed." } : {}),
        removal: { state: result, receipt: `removal:${digest({ id, payloadHash: d.payloadHash, result })}` } } }]);
    }
  }

  /** Explicit, evidence-bound resolution of a hold. It never sends: a drain lets the recorded old
   * owner finish its own delivery; already-handled records outside evidence that it was handled.
   */
  async resolveHold(migrationId: string, dispositionId: string, route: "drain-legacy" | "already-handled", evidence: { ref: string; digest: string }, actor: string): Promise<void> {
    this.enabled();
    const status = await this.options.store.read(), m = this.migration(status, migrationId), d = status.dispositions!.find(x => x.id === dispositionId);
    if (m.state !== "prepared" || !d || d.migrationId !== migrationId || d.route !== "hold") fail("CONFLICT", "Only a held disposition of a prepared migration can be resolved.");
    if (route === "drain-legacy" && d.source !== "watch-queue" && d.removal.state !== "not-queued") fail("UNSUPPORTED", "Only queued opaque watch output or an already-sent answer can drain with its legacy owner.");
    await this.scopedTransaction(migrationUuid(migrationId, d.id, "resolve", route, evidence), status, [{ kind: "delivery-disposition", value: { ...d, version: d.version + 1, route,
      reason: `${d.reason} Resolved by ${actor}: ${route}.`, resolvedBy: { actor, evidenceRef: evidence.ref, evidenceDigest: evidence.digest, previousRoute: "hold" },
      ...(route === "drain-legacy" && d.removal.state === "not-queued" ? { removal: { state: "not-queued" as const, receipt: `drain:${d.recipient ?? d.originalOwner ?? "unknown"}` } } : {}) } }]);
    if (route === "drain-legacy" && d.source === "watch-queue")
      await this.gate.allowDrain(m.planId, itemFingerprint({ source: "watch", id: `${d.original.watch!.name}@${d.original.watch!.ran}#${d.original.watch!.kind}`, payloadHash: d.payloadHash }), d.id);
  }

  /** Verify everything still matches, then record the barrier. Any unaccounted delivery refuses. */
  async barrier(migrationId: string): Promise<MigrationReceipt> {
    this.enabled();
    let status = await this.options.store.read();
    const m = this.migration(status, migrationId);
    if (m.state !== "prepared") return m;
    const prepared = await this.gate.sidecar(m.planId, "prepared") ?? await this.publishPrepared(m.planId, (await this.options.store.requestReceipt(migrationId))!.hash);
    await this.verify(m, status);
    status = await this.options.store.read();
    const next = { ...m, version: m.version + 1, state: "barrier" as const, sidecars: { ...m.sidecars, prepared: prepared.hash } };
    await this.scopedTransaction(migrationUuid(migrationId, "barrier"), status, [{ kind: "migration", value: next }]);
    await this.boundary("barrier");
    return next;
  }
  private async verify(m: MigrationReceipt, status: SupervisionStatus): Promise<void> {
    const freeze = await this.gate.sidecar(m.planId, "freeze");
    if (!freeze || freeze.migrationId !== m.id || freeze.sourceHash !== m.source.sourceHash) fail("HELD", "Freeze sidecar does not match this migration.");
    const files = await this.sourceFiles(m.planId);
    if (digest(files) !== m.source.sourceHash) fail("HELD", "Legacy source changed during the freeze; reinspect it. The cutover stays held.");
    const rows = (status.dispositions ?? []).filter(d => d.migrationId === m.id);
    const unaccounted = rows.filter(d => d.route === "hold" || ["pending", "mismatch"].includes(d.removal.state) || (d.route === "transfer-fact" && !d.destination?.outboxId));
    if (unaccounted.length) fail("HELD", `Unaccounted legacy deliveries: ${unaccounted.map(d => `${d.source}:${d.id} (${d.route}, ${d.removal.state})`).join(", ")}.`);
    const known = new Set(rows.map(d => d.payloadHash));
    const open = (await this.gate.claims()).filter(c => !c.result && c.claim.items.some(i => CutoverGate.classify(claimItem(i), { plan: m.planId, stage: "freeze", sidecar: freeze, drains: new Set(), damaged: false })));
    if (open.length) fail("HELD", `Legacy send claims are unaccounted: ${open.map(c => c.claim.id).join(", ")}.`);
    const config = await this.options.adapters.config(), target = { plan: m.planId, stage: "freeze" as const, sidecar: freeze, drains: new Set<string>(), damaged: false as const };
    const strays = [...config.mateNotes.map(noteItem).filter(i => CutoverGate.classify(i, target) === "identity"),
      ...(await this.options.adapters.watchQueue()).map(watchItem).filter(i => CutoverGate.classify(i, target))].filter(i => !known.has(i.payloadHash));
    if (strays.length) fail("HELD", `Deliveries for ${m.planId} appeared outside the inventory: ${strays.map(i => i.id).join(", ")}.`);
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

  /** Publish the committed sidecar, then activate the one scoped backend. */
  async commit(migrationId: string): Promise<MigrationReceipt> {
    this.enabled();
    const status = await this.options.store.read(), m = this.migration(status, migrationId);
    if (m.state === "committed") return m;
    if (m.state !== "barrier") fail("HELD", "Commit follows a verified barrier.");
    const files = await this.sourceFiles(m.planId);
    if (digest(files) !== m.source.sourceHash) fail("HELD", "Legacy source changed during the freeze; reinspect it. The cutover stays held.");
    const freeze = (await this.gate.sidecar(m.planId, "freeze"))!, { hash: _h, ...body } = freeze;
    const barrier = await this.options.store.requestReceipt(migrationUuid(migrationId, "barrier"));
    const committed = await this.gate.sidecar(m.planId, "committed") ?? await this.gate.publishSidecar({ ...body, stage: "committed", transaction: barrier!.hash });
    await this.boundary("committed-sidecar");
    const scope = status.scopes.find(s => s.id === m.scopeId)!, backend = status.backends.find(b => b.planId === m.planId)!;
    const next = { ...m, version: m.version + 1, state: "committed" as const, sidecars: { ...m.sidecars, committed: committed.hash } };
    await this.scopedTransaction(migrationUuid(migrationId, "commit"), status, [
      { kind: "migration", value: next },
      { kind: "backend", value: { ...backend, version: backend.version + 1, state: "active" } },
      { kind: "scope", value: { ...scope, version: scope.version + 1, state: "active" } }]);
    await this.boundary("committed");
    return next;
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
        fail("HELD", "Source or delivery inventory changed since the freeze; reinspect it. Both writers stay held.");
      await this.commitPrepared(input, snap);
      status = await this.options.store.read();
    }
    const m = this.migration(status, input.migrationId);
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

  /** Cutover state in words for the operator. Complete only when every transfer has its owner's result. */
  async report(plan: string) {
    const status = await this.options.store.read(), m = status.migrations?.find(r => r.planId === plan) ?? null;
    const rows = (status.dispositions ?? []).filter(d => d.migrationId === m?.id);
    const stage = await this.gate.sidecar(plan, "committed") ? "committed" : await this.gate.sidecar(plan, "prepared") ? "prepared" : await this.gate.sidecar(plan, "freeze") ? "freeze" : null;
    return { plan, stage, migration: m, dispositions: rows,
      transfersAcknowledged: rows.filter(d => d.route === "transfer-fact").every(d => d.receipts.ack),
      complete: m?.state === "committed" && rows.filter(d => d.route === "transfer-fact").every(d => d.receipts.ack) };
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
