/** Unwired S01 authority journal. Explicit writes only; reads never initialize or repair.
 * Cooperative same-user filesystem storage, not an authenticated dispatch boundary.
 */
import { AsyncLocalStorage } from "node:async_hooks";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, open, readFile, readdir, rename, rm, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { z } from "zod";
import {
  SupervisionActorSchema, SupervisionAttemptSchema, SupervisionBackendSchema, SupervisionBindingSchema,
  SupervisionEffectSchema, SupervisionExpectedSchema, SupervisionHash, SupervisionScopeSchema,
  SupervisionTaskSchema, SupervisionUtc, SupervisionUuid,
  type SupervisionActor, type SupervisionCode, type SupervisionExpected, type SupervisionOwnership,
  type SupervisionReceipt, type SupervisionStatus,
} from "../shared/supervision";
import type { WorkflowPlan } from "../shared/workflow-plans";
import { canonical, digest, publish, publishBytes } from "./submissions";
import { serialized } from "./serialize";
import { WorkflowEventSchema } from "./workflow-plans";
import { mergeOwnership, OwnershipSchema as WorkflowOwnershipSchema, planOwnership, RetirementSchema, workflowHomeIdentity, type WorkflowOwnership } from "./workflow-ownership";
import { replaySupervisionWorkflow } from "./supervision-workflows";
import { supervisionProcessIdentity, type ProcessIdentity } from "./supervision-process";
import { InboxAssignmentSchema, InboxEventSchema, InboxMailboxSchema, InboxOfferSchema, InboxRequestSchema, InboxSourceSchema, INBOX_LIMITS } from "../shared/supervision-inbox";
import { eventOwners, inboxProjection, terminal, validateInbox, validateInboxChange } from "./supervision-inbox-state";
import { AcceptedScopedCommandSchema, OperationHoldSchema, PolicyApprovalSchema, PolicyEvidenceSchema, PolicyRuleSchema,
  PolicySourceSchema, ScopedDecisionSchema, ScopedOutboxSchema, ScopedCommandResultSchema,
  type ScopedCommandResult } from "../shared/supervision-policy";
import { ContinuationSchema, type Continuation } from "../shared/supervision-continuation";

const number = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER), positive = number.min(1);
const BlobSchema = z.object({ id: SupervisionHash, bytes: number }).strict();
export const SupervisionMutationSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("policy-source"), value: PolicySourceSchema }).strict(),
  z.object({ kind: z.literal("policy-rule"), value: PolicyRuleSchema }).strict(),
  z.object({ kind: z.literal("policy-evidence"), value: PolicyEvidenceSchema }).strict(),
  z.object({ kind: z.literal("approval"), value: PolicyApprovalSchema }).strict(),
  z.object({ kind: z.literal("decision"), value: ScopedDecisionSchema }).strict(),
  z.object({ kind: z.literal("outbox"), value: ScopedOutboxSchema }).strict(),
  z.object({ kind: z.literal("operation-hold"), value: OperationHoldSchema }).strict(),
  z.object({ kind: z.literal("command"), value: AcceptedScopedCommandSchema }).strict(),
  z.object({ kind: z.literal("continuation"), value: ContinuationSchema }).strict(),
  z.object({ kind: z.literal("scope"), value: SupervisionScopeSchema }).strict(),
  z.object({ kind: z.literal("binding"), value: SupervisionBindingSchema }).strict(),
  z.object({ kind: z.literal("task"), value: SupervisionTaskSchema }).strict(),
  z.object({ kind: z.literal("attempt"), value: SupervisionAttemptSchema }).strict(),
  z.object({ kind: z.literal("effect"), value: SupervisionEffectSchema }).strict(),
  z.object({ kind: z.literal("backend"), value: SupervisionBackendSchema }).strict(),
  z.object({ kind: z.literal("blob"), value: BlobSchema }).strict(),
  z.object({ kind: z.literal("inbox-event"), value: InboxEventSchema }).strict(),
  z.object({ kind: z.literal("inbox-assignment"), value: InboxAssignmentSchema }).strict(),
  z.object({ kind: z.literal("inbox-source"), value: InboxSourceSchema }).strict(),
  z.object({ kind: z.literal("inbox-mailbox"), value: InboxMailboxSchema }).strict(),
  z.object({ kind: z.literal("inbox-offer"), value: InboxOfferSchema }).strict(),
  z.object({ kind: z.literal("inbox-request"), value: InboxRequestSchema }).strict(),
  // Validate without replacing original wire data with schema defaults. Legacy hashes stay exact.
  z.object({ kind: z.literal("workflow"), scopeId: SupervisionUuid,
    event: z.custom<z.infer<typeof WorkflowEventSchema>>(value => WorkflowEventSchema.safeParse(value).success) }).strict(),
  z.object({ kind: z.literal("retirement"), scopeId: SupervisionUuid, receipt: RetirementSchema }).strict(),
]);
export type SupervisionMutation = z.infer<typeof SupervisionMutationSchema>;
const BodySchema = z.object({ actor: SupervisionActorSchema,
  expectedVersions: z.array(SupervisionExpectedSchema).min(1).max(256), mutations: z.array(SupervisionMutationSchema).min(1).max(256) }).strict();
const CoordinatorSchema = z.object({ format: z.literal("firstmate.supervision-coordinator/1"), homeId: z.string(),
  generation: positive, previous: SupervisionHash.nullable(), pid: positive, start: z.string().min(1).max(1024), hash: SupervisionHash }).strict();
type Coordinator = z.infer<typeof CoordinatorSchema>;
const ReleaseSchema = z.object({ format: z.literal("firstmate.supervision-release/1"), homeId: z.string(), generation: positive,
  coordinatorHash: SupervisionHash, hash: SupervisionHash }).strict();
const IdentitySchema = z.object({ format: z.literal("firstmate.supervision/1"), homeId: z.string(), schema: z.literal(1) }).strict();
const OwnershipSchema = z.object({ scopes: z.array(SupervisionUuid), tasks: z.array(SupervisionTaskSchema),
  attempts: z.array(SupervisionAttemptSchema), effects: z.array(SupervisionEffectSchema), backends: z.array(SupervisionBackendSchema),
  workflows: z.array(z.object({ plan: z.string(), inventory: WorkflowOwnershipSchema }).strict()),
}).strict();
const TransactionSchema = z.object({ format: z.literal("firstmate.supervision-transaction/1"), homeId: z.string(), sequence: positive,
  previous: SupervisionHash.nullable(), generation: positive, coordinatorHash: SupervisionHash, requestId: SupervisionUuid,
  requestHash: SupervisionHash, at: SupervisionUtc, body: BodySchema, changes: z.array(SupervisionExpectedSchema),
  projectionHash: SupervisionHash, outbox: z.array(z.never()).max(0), hash: SupervisionHash }).strict();
type Transaction = z.infer<typeof TransactionSchema>;
const AnchorSchema = z.object({ format: z.enum(["firstmate.supervision-tip/1", "firstmate.supervision-publication/1"]),
  homeId: z.string(), sequence: positive, previous: SupervisionHash.nullable(), transactionHash: SupervisionHash,
  requestId: SupervisionUuid, requestHash: SupervisionHash, generation: positive,
  ownership: OwnershipSchema, hash: SupervisionHash }).strict();
type Anchor = z.infer<typeof AnchorSchema>;
type WorkflowRow = { scopeId: string; plan: WorkflowPlan; inventory: WorkflowOwnership;
  requests: { requestId: string; requestHash: string; eventHash: string }[] };
type Frame = { kind: SupervisionExpected["kind"]; id: string; version: number; value: unknown };
type Scan = { frames: Map<string, Frame>; transactions: Transaction[]; sequence: number; hash: string | null;
  problems: string[]; initialized: boolean; ownership: z.infer<typeof OwnershipSchema>[]; pending: { event: Transaction; tip: Anchor } | null;
  bytes: number; coordinators: Coordinator[]; prefixDigest: string };
/** Bounded cooperative pilot. Full audit/recovery is deliberately separate from warm reads.
 * These are admission ceilings, not history eviction or a guarantee about filesystem latency.
 */
export const SUPERVISION_INDEX_LIMITS = { transactions: 256, admissions: 192, tail: 32, projectionBytes: 8 * 1024 * 1024 } as const;
const CheckpointSchema = z.object({ format: z.literal("firstmate.supervision-checkpoint/1"), homeId: z.string(),
  sequence: number, transactionHash: SupervisionHash.nullable(), prefixDigest: SupervisionHash,
  projectionHash: SupervisionHash, anchorHash: SupervisionHash.nullable(), hash: SupervisionHash }).strict();
type Checkpoint = z.infer<typeof CheckpointSchema>;
type CachedScan = { scan: Scan; checkpoint: Checkpoint; directories: string; requests: Map<string, Transaction>;
  workflowRequests: Map<string, { requestHash: string; eventHash: string; transaction: Transaction }> };
type StoreLockLease = { active: boolean };
const storeLocks = new AsyncLocalStorage<ReadonlyMap<string, StoreLockLease>>();
type StorePublication = { epoch: number; active: Promise<void> | null };
const publications = new Map<string, StorePublication>();
function publicationFor(root: string): StorePublication {
  let state = publications.get(root);
  if (!state) { state = { epoch: 0, active: null }; publications.set(root, state); }
  return state;
}
const emptyPrefix = digest({ format: "firstmate.supervision-prefix/1" });
const extendPrefix = (previous: string, event: Transaction, tip: Anchor, marker: Anchor) => digest({ previous,
  sequence: event.sequence, event: event.hash, tip: tip.hash, publication: marker.hash });
export interface SupervisionStoreOptions {
  /** Defaults off. Internal fixture/shadow writer only; no env flag, RPC or runtime wiring. */
  writable?: boolean;
  actor?: SupervisionActor;
  /** Fault hooks and process stand-ins are for isolated qualification, never caller input. */
  boundary?: (name: string) => Promise<void>;
  processIdentity?: (pid: number) => Promise<ProcessIdentity>;
  maxJournalBytes?: number;
  /** Queue pressure counts unresolved primary events, including triage. No critical eviction. */
  maxPendingEvents?: number;
}
export class SupervisionError extends Error {
  constructor(readonly code: SupervisionCode, message: string) { super(message); }
}
function fail(code: SupervisionCode, message: string): never { throw new SupervisionError(code, message); }
function checkInboxRequest(mutations: SupervisionMutation[], requestId: string) {
  if (mutations.some(m => m.kind === "inbox-request" && m.value.id !== requestId)) fail("CONFLICT", "Inbox replay marker must name its publishing transaction's request ID.");
}
const key = (kind: string, id: string) => JSON.stringify([kind, id]);
const pad = (value: number) => String(value).padStart(12, "0");
const hashed = <T extends object>(body: T) => ({ ...body, hash: digest(body) });
function verifyHash<T extends { hash: string }>(value: T): T {
  const { hash, ...body } = value;
  if (digest(body) !== hash) fail("HELD", "Journal checksum mismatch.");
  return value;
}
/** Requiring the persisted canonical encoding also rejects duplicate keys and nonfinite JSON. */
async function readCanonical(path: string): Promise<unknown> {
  const text = await readFile(path, "utf8"), value: unknown = JSON.parse(text);
  if (`${canonical(value)}\n` !== text) fail("HELD", "Journal is not canonical JSON.");
  return value;
}
async function storageBytes(directory: string, names: string[]): Promise<number> {
  const sizes = await Promise.all(names.map(async name => {
    try { return (await stat(join(directory, name))).size; }
    catch (error) {
      // A publisher may unlink its inert staging file after our readdir. Missing durable
      // files and every other IO error still fail closed; never retry or skip authority.
      if (name.endsWith(".tmp") && (error as NodeJS.ErrnoException).code === "ENOENT") return 0;
      throw error;
    }
  }));
  return sizes.reduce((sum, size) => sum + size, 0);
}
const rawDigest = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
function mutationTarget(mutation: SupervisionMutation): [Frame["kind"], string] {
  if (mutation.kind === "workflow") return [mutation.kind, mutation.event.plan];
  if (mutation.kind === "retirement") return [mutation.kind, mutation.receipt.plan];
  if (mutation.kind === "binding") return [mutation.kind, mutation.value.scopeId];
  if (mutation.kind === "backend") return [mutation.kind, mutation.value.planId];
  return [mutation.kind, mutation.value.id];
}
function ownership(frames: Map<string, Frame>): z.infer<typeof OwnershipSchema> {
  const values = <T>(kind: Frame["kind"]) => [...frames.values()].filter(f => f.kind === kind).map(f => f.value as T);
  return { scopes: values<z.infer<typeof SupervisionScopeSchema>>("scope").map(s => s.id),
    tasks: values("task"), attempts: values("attempt"), effects: values("effect"), backends: values("backend"),
    workflows: [...values<WorkflowRow>("workflow").map(w => ({ plan: w.plan.definition.id, inventory: w.inventory })),
      ...values<{ receipt: z.infer<typeof RetirementSchema> }>("retirement").map(r => ({ plan: r.receipt.plan, inventory: r.receipt.inventory }))] };
}
const frameDigest = (frames: Map<string, Frame>) => digest([...frames.entries()].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0));

export class SupervisionStore {
  readonly homeId: string;
  readonly root: string;
  private coordinator: Coordinator | null = null;
  private cached: CachedScan | null = null;
  private readonly actor: SupervisionActor;
  constructor(dataRoot: string, home: string, private readonly options: SupervisionStoreOptions = {}) {
    this.homeId = workflowHomeIdentity(home); // Never realpath; exactly the existing durable namespace.
    this.root = join(resolve(dataRoot), "supervision", digest(this.homeId));
    this.actor = SupervisionActorSchema.parse(options.actor ?? { kind: "system", id: "s01-fixture", source: "unwired-storage" });
  }
  private locked<T>(work: () => Promise<T>): Promise<T> {
    return serialized(this.root, () => {
      const publication = publicationFor(this.root);
      let release!: () => void;
      publication.active = new Promise<void>(resolve => { release = resolve; });
      publication.epoch++;
      const lease: StoreLockLease = { active: true };
      const held = new Map(storeLocks.getStore()); held.set(this.root, lease);
      return storeLocks.run(held, async () => {
        try { return await work(); }
        finally { lease.active = false; publication.epoch++; publication.active = null; release(); }
      });
    });
  }
  private async reading<T>(work: () => Promise<T>): Promise<T> {
    // A prepare callback reads within its own transaction. Other reads wait for active
    // publication, but never acquire the writer lock. If a writer overlaps the read,
    // discard that result (including a transient hold) and check the new checkpoint.
    if (storeLocks.getStore()?.get(this.root)?.active) return work();
    const publication = publicationFor(this.root);
    for (;;) {
      if (publication.active) { await publication.active; continue; }
      const epoch = publication.epoch;
      let result: T | undefined, error: unknown, failed = false;
      try { result = await work(); } catch (cause) { error = cause; failed = true; }
      if (publication.active || publication.epoch !== epoch) continue;
      if (failed) throw error;
      return result as T;
    }
  }
  private writable(): void { if (!this.options.writable) fail("UNSUPPORTED", "Scoped supervision writes are disabled."); }
  private file(sequence: number, suffix: string) { return join(this.root, "transactions", `${pad(sequence)}.${suffix}.json`); }
  private async boundary(name: string) { await this.options.boundary?.(name); }
  private async publish(path: string, value: unknown, phase: string) {
    await publish(path, value, stage => this.boundary(`${phase}:${stage}`));
  }
  /** Explicit NEW-store operation. A missing identity in any nonempty store is never repaired here. */
  async initialize(): Promise<void> {
    this.writable();
    await this.locked(async () => {
      await mkdir(this.root, { recursive: true });
      const names = await readdir(this.root);
      if (names.includes("identity.json")) {
        const identity = IdentitySchema.parse(await readCanonical(join(this.root, "identity.json")));
        if (identity.homeId !== this.homeId) fail("HELD", "Wrong supervision home identity.");
        return;
      }
      if (names.some(n => !/^identity\.json\.[0-9a-f-]+\.tmp$/.test(n))) fail("HELD", "Missing identity in a nonempty supervision store; reconcile, never reset.");
      for (const directory of ["transactions", "coordinators", "blobs"]) await mkdir(join(this.root, directory));
      await this.publish(join(this.root, "identity.json"), { format: "firstmate.supervision/1", homeId: this.homeId, schema: 1 }, "identity");
      await this.saveCheckpoint(await this.scanFull());
    });
  }
  private async coordinators(): Promise<Coordinator[]> {
    const directory = join(this.root, "coordinators"), files = await readdir(directory);
    if (files.some(f => !/^\d{12}(?:\.release)?\.json(?:\.[0-9a-f-]+\.tmp)?$/.test(f))) fail("HELD", "Unknown coordinator metadata.");
    const records: Coordinator[] = [];
    for (const name of files.filter(n => /^\d{12}\.json$/.test(n)).sort()) {
      const record = verifyHash(CoordinatorSchema.parse(await readCanonical(join(directory, name))));
      if (record.homeId !== this.homeId || record.generation !== records.length + 1 || name !== `${pad(record.generation)}.json` || record.previous !== (records.at(-1)?.hash ?? null)) fail("HELD", "Coordinator generation chain is incomplete.");
      records.push(record);
    }
    for (const name of files.filter(n => /^\d{12}\.release\.json$/.test(n))) {
      const release = verifyHash(ReleaseSchema.parse(await readCanonical(join(directory, name))));
      if (release.homeId !== this.homeId || name !== `${pad(release.generation)}.release.json` || records[release.generation - 1]?.hash !== release.coordinatorHash) fail("HELD", "Invalid coordinator release.");
    }
    return records;
  }
  private async released(record: Coordinator): Promise<boolean> {
    try {
      const release = verifyHash(ReleaseSchema.parse(await readCanonical(join(this.root, "coordinators", `${pad(record.generation)}.release.json`))));
      if (release.homeId !== this.homeId || release.generation !== record.generation || release.coordinatorHash !== record.hash) fail("HELD", "Release does not match coordinator.");
      return true;
    } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return false; throw error; }
  }
  async acquireCoordinator(): Promise<number> {
    this.writable();
    return this.locked(async () => {
      const snapshot = await this.scan();
      // A complete pending event can be published by recoverPublication after ownership is acquired.
      if (!snapshot.initialized || snapshot.problems.some(p => p !== "Final transaction awaits publication.")) fail("HELD", snapshot.problems.join(" ") || "Store is not initialized.");
      if (this.coordinator) { await this.assertCoordinator(); return this.coordinator.generation; }
      const previous = snapshot.coordinators.at(-1);
      const inspect = this.options.processIdentity ?? supervisionProcessIdentity;
      if (previous && !await this.released(previous)) {
        const state = await inspect(previous.pid);
        if (state.state === "unknown" || (state.state === "alive" && state.start === previous.start)) fail("HELD", "The coordinator is alive or its termination is unknown; no timestamp takeover.");
      }
      const self = await inspect(process.pid);
      if (self.state !== "alive") fail("UNSUPPORTED", "Cannot verify this process start identity.");
      const record = hashed({ format: "firstmate.supervision-coordinator/1" as const, homeId: this.homeId,
        generation: (previous?.generation ?? 0) + 1, previous: previous?.hash ?? null, pid: process.pid, start: self.start });
      try { await this.publish(join(this.root, "coordinators", `${pad(record.generation)}.json`), record, "coordinator"); }
      catch (error) { if ((error as NodeJS.ErrnoException).code === "EEXIST") fail("CONFLICT", "Another process claimed this coordinator generation; reread without retrying."); throw error; }
      this.coordinator = record;
      return record.generation;
    });
  }
  private async assertCoordinator(): Promise<Coordinator> {
    const current = (await this.coordinators()).at(-1);
    if (!this.coordinator || current?.hash !== this.coordinator.hash || await this.released(current)) fail("HELD", "No current coordinator claim; acquire explicitly.");
    return current;
  }
  async releaseCoordinator(): Promise<void> {
    this.writable();
    await this.locked(async () => {
      const current = await this.assertCoordinator();
      await this.publish(join(this.root, "coordinators", `${pad(current.generation)}.release.json`), hashed({
        format: "firstmate.supervision-release/1", homeId: this.homeId, generation: current.generation, coordinatorHash: current.hash,
      }), "release");
      this.coordinator = null;
    });
  }
  private apply(frames: Map<string, Frame>, body: z.infer<typeof BodySchema>): { frames: Map<string, Frame>; changes: SupervisionExpected[] } {
    const next = new Map(structuredClone([...frames.entries()]));
    const expected = new Map<string, SupervisionExpected>();
    for (const ref of body.expectedVersions) {
      const k = key(ref.kind, ref.id);
      if (expected.has(k)) fail("CONFLICT", "Duplicate expected row.");
      expected.set(k, ref);
      if ((frames.get(k)?.version ?? 0) !== ref.version) fail("STALE", `Row changed: ${ref.kind}/${ref.id}.`);
    }
    const changed = new Set<string>(), changes: SupervisionExpected[] = [];
    for (const mutation of body.mutations) {
      const [kind, id] = mutationTarget(mutation), k = key(kind, id), prior = frames.get(k), version = (prior?.version ?? 0) + 1;
      if (!expected.has(k) || changed.has(k) || !Number.isSafeInteger(version)) fail("CONFLICT", "Every changed row needs one expected version and one mutation.");
      changed.add(k);
      let value: unknown;
      if (mutation.kind === "workflow") {
        if (next.has(key("retirement", id))) fail("HELD", "Retired plan identity and reservations cannot be reused.");
        const old = prior?.value as WorkflowRow | undefined;
        if (old && old.scopeId !== mutation.scopeId) fail("UNSUPPORTED", "Workflow transfer requires a checked migration.");
        if (old?.requests.some(r => r.requestId === mutation.event.requestId)) fail("CONFLICT", "Workflow request already committed; use its original transaction receipt.");
        const plan = replaySupervisionWorkflow(old?.plan ?? null, mutation.event, this.homeId);
        value = { scopeId: mutation.scopeId, plan, inventory: mergeOwnership([...(old ? [old.inventory] : []), planOwnership(plan)]),
          requests: [...(old?.requests ?? []), { requestId: mutation.event.requestId, requestHash: mutation.event.requestHash, eventHash: mutation.event.hash }] };
      } else if (mutation.kind === "retirement") {
        const receipt = mutation.receipt, { hash, ...rest } = receipt;
        if (prior || workflowHomeIdentity(receipt.home) !== this.homeId || digest(rest) !== hash) fail("HELD", "Invalid/reused retirement receipt.");
        const old = next.get(key("workflow", id))?.value as WorkflowRow | undefined;
        if (old && (old.scopeId !== mutation.scopeId || digest(mergeOwnership([old.inventory, receipt.inventory])) !== digest(receipt.inventory))) fail("HELD", "Retirement loses ownership, attempts or budget.");
        value = { scopeId: mutation.scopeId, receipt };
      } else {
        value = mutation.value;
        if ("version" in mutation.value && mutation.value.version !== version) fail("STALE", "New row version must increment once.");
        const old = prior?.value as Record<string, unknown> | undefined;
        validateInboxChange(mutation.kind, mutation.value, old, next, fail);
        if (mutation.kind === "scope") {
          if (mutation.value.homeId !== this.homeId) fail("CONFLICT", "Scope belongs to another lexical home.");
          if (old && (old.kind !== mutation.value.kind || old.mode !== mutation.value.mode || (old.state === "retired" && mutation.value.state !== "retired"))) fail("HELD", "Scope identity/mode or retirement cannot be reset.");
        }
        if (mutation.kind === "binding" && old) {
          const binding = mutation.value;
          if (binding.epoch < Number(old.epoch) || binding.epoch > Number(old.epoch) + 1 || binding.acknowledgedSeq < Number(old.acknowledgedSeq) ||
            (binding.epoch === old.epoch && ["hostId", "agentId", "profileDigest", "workspaceIntent"].some(p => old[p] !== binding[p as keyof typeof binding]))) fail("STALE", "Binding identity change requires the next epoch; acknowledgement cannot regress.");
          // The verified workspace is set once, by prepared -> active; it never changes within an epoch.
          if (binding.epoch === old.epoch && old.workspaceId !== binding.workspaceId &&
            !(old.workspaceId === null && old.state === "prepared" && binding.state === "active")) fail("STALE", "A verified workspace identity is set once on activation and is otherwise immutable within its epoch.");
          if (binding.epoch !== old.epoch && (binding.state !== "prepared" || !["retired", "suspect"].includes(String(old.state)))) fail("HELD", "Replacement must be explicitly prepared from a retired/suspect binding.");
          if (old.state === "retired" && binding.epoch === old.epoch && binding.state !== "retired") fail("HELD", "A retired binding cannot reactivate its old epoch.");
        }
        if (mutation.kind === "task" && old && ["planId", "nodeId", "projectId", "hostId"].some(p => old[p] !== mutation.value[p as keyof typeof mutation.value])) fail("CONFLICT", "Task identity cannot be renamed or reset.");
        if (mutation.kind === "attempt" && old) {
          const attempt = mutation.value;
          if (["taskId", "ordinal", "briefHash", "launchEffectId", "originalNotificationOwner"].some(p => old[p] !== attempt[p as keyof typeof attempt]) ||
            attempt.spentAgents < Number(old.spentAgents) || attempt.spentTurns < Number(old.spentTurns) ||
            (old.worker && digest(old.worker) !== digest(attempt.worker)) || (old.evidenceIds as string[]).some(id => !attempt.evidenceIds.includes(id))) fail("HELD", "Attempt identity, evidence and cumulative spend must be retained.");
        }
        if (mutation.kind === "effect" && old) {
          const effect = mutation.value;
          const { version: _v, state: _s, receiptRef: _r, ...identity } = effect;
          const { version: _ov, state: _os, receiptRef: _or, ...oldIdentity } = old;
          const transitions: Record<string, string[]> = { reserved: ["reserved", "dispatching", "cancelled", "failed"],
            dispatching: ["dispatching", "accepted", "uncertain", "succeeded", "failed"], accepted: ["accepted", "uncertain", "succeeded", "failed"],
            uncertain: ["uncertain", "accepted", "succeeded", "failed"], succeeded: ["succeeded"], failed: ["failed"], cancelled: ["cancelled"] };
          if (digest(identity) !== digest(oldIdentity) || (old.receiptRef && old.receiptRef !== effect.receiptRef) ||
            !transitions[String(old.state)]?.includes(effect.state)) fail("HELD", "Effect identity, receipts and uncertain reservations cannot reset.");
        }
        if (mutation.kind === "backend") {
          if (next.has(key("retirement", id)) && mutation.value.state !== "retired") fail("HELD", "Retired plan backend cannot reactivate.");
          if (old && (old.backend !== mutation.value.backend || old.sourceHash !== mutation.value.sourceHash || old.ownerScopeId !== mutation.value.ownerScopeId)) fail("UNSUPPORTED", "Backend cutover/source replacement requires the S07 protocol.");
          if (old && ((["prepared", "held", "retired"].includes(String(old.state)) && mutation.value.state === "active") ||
            (old.state === "retired" && mutation.value.state !== "retired"))) fail("HELD", "A held backend requires checked forward recovery, not rollback.");
        }
        if (mutation.kind === "blob" && prior) fail("CONFLICT", "Evidence references are immutable.");
        if (["command", "approval"].includes(mutation.kind) && prior) fail("CONFLICT", "Accepted commands and approvals are immutable.");
        if (mutation.kind === "continuation" && old) {
          // Obligations survive owner transfer. Accepted completions are history: a later assessment may
          // supersede one (for example after its evidence is invalidated), but must retain it verbatim.
          const history = (old.superseded as Continuation["superseded"]), next = mutation.value.superseded;
          if (old.scopeId !== mutation.value.scopeId || old.planId !== mutation.value.planId || Number(old.epoch) > mutation.value.epoch ||
            next.length < history.length || history.some((h, i) => digest(h) !== digest(next[i])) ||
            (old.completion && digest(old.completion) !== digest(mutation.value.completion) &&
              !next.slice(history.length).some(h => digest(h.completion) === digest(old.completion)))) fail("HELD", "Continuation identity, epoch order and completion history must be retained.");
        }
        if (mutation.kind === "decision" && old) {
          if (["ownerScopeId", "planId", "nodeId"].some(p => old[p] !== mutation.value[p as keyof typeof mutation.value]) ||
            (old.answer && digest(old) !== digest({ ...mutation.value, version: old.version }))) fail("HELD", "Decision identity and accepted answers cannot be rewritten.");
        }
        if (mutation.kind === "outbox" && old) {
          const { version: _v, state: _s, handledEpoch: _e, resultRef: _r, ...identity } = mutation.value;
          const { version: _ov, state: _os, handledEpoch: _oe, resultRef: _or, ...oldIdentity } = old;
          if (digest(identity) !== digest(oldIdentity) || (old.state === "handled" && digest(old) !== digest({ ...mutation.value, version: old.version })))
            fail("HELD", "Outbox identity and handled result must be retained.");
        }
      }
      next.set(k, { kind, id, version, value }); changes.push({ kind, id, version });
    }
    this.validateIndexes(next);
    validateInbox(next, fail);
    for (const mutation of body.mutations) if (mutation.kind === "inbox-assignment" && mutation.value.scopeId) {
      const prior = frames.get(key("inbox-assignment", mutation.value.id))?.value as z.infer<typeof InboxAssignmentSchema> | undefined;
      if (prior && !prior.scopeId) {
        const event = next.get(key("inbox-event", mutation.value.id))!.value as z.infer<typeof InboxEventSchema>;
        const projection = (kind: Frame["kind"]) => [...next.values()].filter(f => f.kind === kind).map(f => f.value);
        const owners = eventOwners(event, projection("task") as SupervisionStatus["tasks"], projection("attempt") as SupervisionStatus["attempts"]);
        if (owners.length !== 1 || owners[0]!.attempt.id !== mutation.value.attemptId) fail("UNKNOWN_OWNER", "Triage resolution became ambiguous before publication.");
      }
    }
    // Fixed wire ceiling at replay; a smaller fixture/admission alarm is checked at append only.
    if (inboxProjection(next).assignments.filter(a => a.primaryEventId === a.id && !terminal(a)).length > INBOX_LIMITS.pending)
      fail("HELD", "Pending event ceiling reached; retain history and reconcile source gaps.");
    for (const mutation of body.mutations) {
      if (mutation.kind === "effect" && !frames.has(key("effect", mutation.value.id))) {
        const binding = next.get(key("binding", mutation.value.scopeId))?.value as z.infer<typeof SupervisionBindingSchema> | undefined;
        if (binding?.epoch !== mutation.value.epoch || binding.state === "retired") fail("STALE", "New effect requires the current binding epoch.");
      }
      if (mutation.kind === "task") {
        if (next.has(key("retirement", mutation.value.planId)) ||
          (next.get(key("scope", mutation.value.ownerScopeId))?.value as z.infer<typeof SupervisionScopeSchema> | undefined)?.state === "retired") fail("HELD", "Retired ownership remains reserved; it cannot acquire or mutate tasks.");
      }
    }
    return { frames: next, changes };
  }
  private validateIndexes(frames: Map<string, Frame>): void {
    const get = (kind: Frame["kind"], id: string) => frames.get(key(kind, id))?.value;
    const aliases = new Set<string>(), effects = new Set<string>(), workers = new Set<string>(), ordinals = new Set<string>();
    const currentWorkerTasks = new Map<string, string>();
    const reservations = ownership(frames).workflows.flatMap(w => w.inventory.scopes.map(scope => ({ ...scope, plan: w.plan })));
    for (let i = 0; i < reservations.length; i++) for (const other of reservations.slice(i + 1)) {
      const held = reservations[i]!;
      if (held.plan !== other.plan && held.node === other.node && (held.host === null || other.host === null || held.host === other.host)) fail("CONFLICT", "Retained workflow/retirement task reservations conflict.");
    }
    for (const frame of frames.values()) {
      const value = frame.value as Record<string, unknown>;
      const scopeId = frame.kind === "scope" ? frame.id : value.ownerScopeId ?? value.scopeId;
      if (scopeId && !get("scope", String(scopeId))) fail("UNKNOWN_OWNER", "A row has no registered scope owner.");
      if (frame.kind === "binding") {
        const binding = SupervisionBindingSchema.parse(value);
        if (binding.workspaceId !== null && binding.workspaceIntent !== undefined) {
          const intent = [...frames.values()].find(f => f.kind === "effect" && (f.value as z.infer<typeof SupervisionEffectSchema>).scopeId === binding.scopeId &&
            (f.value as z.infer<typeof SupervisionEffectSchema>).epoch === binding.epoch && (f.value as z.infer<typeof SupervisionEffectSchema>).operation === "workspace.open" &&
            (f.value as z.infer<typeof SupervisionEffectSchema>).receiverKey === binding.workspaceIntent)?.value as z.infer<typeof SupervisionEffectSchema> | undefined;
          let receipt: unknown = null;
          try { receipt = intent?.state === "succeeded" && intent.receiptRef ? JSON.parse(intent.receiptRef) : null; } catch { receipt = null; }
          if ((receipt as { workspaceId?: unknown } | null)?.workspaceId !== binding.workspaceId) fail("CONFLICT", "A verified binding workspace must equal its own intent's succeeded receipt.");
        }
        if (binding.state !== "retired") {
          const k = key(binding.hostId.trim().toLowerCase(), binding.agentId);
          if (workers.has(k)) fail("CONFLICT", "An agent is bound to two scopes."); workers.add(k);
        }
      }
      if (frame.kind === "task") {
        const task = SupervisionTaskSchema.parse(value), alias = JSON.stringify([task.hostId.trim().toLowerCase(), task.projectId, task.nodeId]);
        const owner = get("scope", task.ownerScopeId) as z.infer<typeof SupervisionScopeSchema>;
        if (!owner.projectIds.includes(task.projectId)) fail("UNKNOWN_OWNER", "Task project is outside its registered scope.");
        if (aliases.has(alias)) fail("CONFLICT", "Task/host/project identity already has an owner."); aliases.add(alias);
        if (reservations.some(r => r.plan !== task.planId && r.node === task.nodeId && (r.host === null || r.host === task.hostId.trim().toLowerCase()))) fail("HELD", "Retired/quarantined workflow retains this task/host reservation.");
        const backend = get("backend", task.planId) as z.infer<typeof SupervisionBackendSchema> | undefined;
        if (!backend || backend.ownerScopeId !== task.ownerScopeId) fail("UNKNOWN_OWNER", "Task and backend owner must agree atomically.");
        const attempt = task.currentAttempt ? get("attempt", task.currentAttempt) as z.infer<typeof SupervisionAttemptSchema> | undefined : null;
        if (task.currentAttempt && attempt?.taskId !== task.id) fail("CONFLICT", "Task current attempt does not match.");
      }
      if (frame.kind === "attempt") {
        const attempt = SupervisionAttemptSchema.parse(value), task = get("task", attempt.taskId) as z.infer<typeof SupervisionTaskSchema> | undefined;
        const effect = get("effect", attempt.launchEffectId) as z.infer<typeof SupervisionEffectSchema> | undefined;
        const ordinal = key(attempt.taskId, String(attempt.ordinal));
        if (!task || !effect || effect.attemptId !== attempt.id || effect.scopeId !== task.ownerScopeId) fail("CONFLICT", "Attempt/task/launch effect must be committed together.");
        if (attempt.worker && attempt.worker.hostId.trim().toLowerCase() !== task.hostId.trim().toLowerCase()) fail("CONFLICT", "Worker host does not match its task identity.");
        // Current task pointers define ownership, including later worker assignment. Historical
        // attempts retain their reservations without becoming a second current worker owner.
        if (attempt.worker && task.currentAttempt === attempt.id) {
          const worker = key(attempt.worker.hostId.trim().toLowerCase(), attempt.worker.agentId);
          const owner = currentWorkerTasks.get(worker);
          if (owner !== undefined && owner !== task.id) fail("CONFLICT", "A worker is current for two tasks.");
          currentWorkerTasks.set(worker, task.id);
        }
        if (ordinals.has(ordinal)) fail("CONFLICT", "Duplicate attempt ordinal."); ordinals.add(ordinal);
      }
      if (frame.kind === "effect") {
        const effect = SupervisionEffectSchema.parse(value);
        if (effects.has(effect.logicalKey)) fail("CONFLICT", "Logical effect already reserved."); effects.add(effect.logicalKey);
        const binding = get("binding", effect.scopeId) as z.infer<typeof SupervisionBindingSchema> | undefined;
        if (!binding || binding.epoch < effect.epoch) fail("STALE", "Effect binding epoch is unavailable.");
        if (effect.attemptId) {
          const attempt = get("attempt", effect.attemptId) as z.infer<typeof SupervisionAttemptSchema> | undefined;
          if (!attempt) fail("CONFLICT", "Effect attempt is unavailable.");
          const task = get("task", attempt.taskId) as z.infer<typeof SupervisionTaskSchema> | undefined;
          if (!task || task.ownerScopeId !== effect.scopeId) fail("CONFLICT", "Effect scope does not own its attempt's task.");
        }
      }
      if (frame.kind === "workflow") {
        const row = frame.value as WorkflowRow, backend = get("backend", row.plan.definition.id) as z.infer<typeof SupervisionBackendSchema> | undefined;
        if (!backend || backend.ownerScopeId !== row.scopeId) fail("UNKNOWN_OWNER", "Workflow and backend ownership must agree atomically.");
        // A recorded worker identity must be the gateway-verified worker of that exact attempt.
        for (const node of Object.values(row.plan.nodes)) {
          if (!node.attempt || (node.agentId === undefined && node.workspaceId === undefined)) continue;
          const attempt = get("attempt", node.attempt) as z.infer<typeof SupervisionAttemptSchema> | undefined;
          if (!attempt) continue; // Not a gateway reservation; nothing to cross-check.
          if (!attempt.worker) fail("HELD", "Verify the reserved worker before recording its running identity.");
          if (node.agentId !== attempt.worker.agentId || node.workspaceId !== attempt.worker.workspaceId) fail("CONFLICT", "Recorded worker identity differs from the verified attempt worker.");
        }
      }
      if (frame.kind === "continuation") {
        const row = value as Continuation, backend = get("backend", row.planId) as z.infer<typeof SupervisionBackendSchema> | undefined;
        if (!backend || backend.ownerScopeId !== row.scopeId || backend.backend !== "scoped") fail("UNKNOWN_OWNER", "Continuation and scoped plan owner must agree.");
      }
      if (frame.kind === "decision") {
        const row = ScopedDecisionSchema.parse(value), backend = get("backend", row.planId) as z.infer<typeof SupervisionBackendSchema> | undefined;
        if (!backend || backend.ownerScopeId !== row.ownerScopeId) fail("UNKNOWN_OWNER", "Decision and plan owner must agree.");
        if ((row.state === "answered") !== !!row.answer) fail("CONFLICT", "Decision answer and state must agree.");
        if (row.answer) {
          const outbox = get("outbox", row.answer.outboxId) as z.infer<typeof ScopedOutboxSchema> | undefined;
          if (!outbox || outbox.decisionId !== row.id || outbox.ownerScopeId !== row.ownerScopeId || outbox.causationId !== row.answer.submissionId)
            fail("CONFLICT", "Answer and logical delivery must commit together.");
        }
      }
      if (frame.kind === "outbox") {
        const row = ScopedOutboxSchema.parse(value), backend = get("backend", row.planId) as z.infer<typeof SupervisionBackendSchema> | undefined;
        if (!backend || backend.ownerScopeId !== row.ownerScopeId || (row.state === "handled") !== !!(row.handledEpoch && row.resultRef))
          fail("CONFLICT", "Outbox ownership or handled receipt is inconsistent.");
        if (row.decisionId) {
          const decision = get("decision", row.decisionId) as z.infer<typeof ScopedDecisionSchema> | undefined;
          if (decision?.answer?.outboxId !== row.id) fail("CONFLICT", "Answer outbox must reference its committed decision result.");
        }
      }
    }
  }
  private async scanFull(): Promise<Scan> {
    const result: Scan = { frames: new Map(), transactions: [], sequence: 0, hash: null, problems: [], initialized: false, ownership: [], pending: null, bytes: 0, coordinators: [], prefixDigest: emptyPrefix };
    try {
      let names: string[];
      try { names = await readdir(this.root); }
      catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return result; throw error; }
      if (names.some(n => !["identity.json", "transactions", "coordinators", "blobs", "checkpoint.json"].includes(n) && !/^(?:identity|checkpoint)\.json\.[0-9a-f-]+\.tmp$/.test(n))) fail("HELD", "Unknown supervision root metadata.");
      const identity = IdentitySchema.parse(await readCanonical(join(this.root, "identity.json")));
      if (identity.homeId !== this.homeId) fail("HELD", "Supervision home identity mismatch.");
      result.initialized = true;
      const files = await readdir(join(this.root, "transactions"));
      const blobs = await readdir(join(this.root, "blobs")); // Missing storage is not an empty-store fallback.
      if (blobs.some(n => !/^[0-9a-f]{64}(?:\.[0-9a-f-]+\.tmp)?$/.test(n))) fail("HELD", "Unknown evidence blob metadata.");
      if (files.some(n => !/^\d{12}\.(?:tip|event|publication)\.json(?:\.[0-9a-f-]+\.tmp)?$/.test(n))) fail("HELD", "Unknown transaction metadata.");
      const durable = files.filter(n => n.endsWith(".json"));
      result.bytes = await storageBytes(join(this.root, "transactions"), files);
      result.bytes += await storageBytes(join(this.root, "blobs"), blobs);
      const sequences = [...new Set(durable.map(n => Number(n.slice(0, 12))))].sort((a, b) => a - b);
      // Retain independently checked capsules even when an earlier authority record is damaged.
      // Hash each checked capsule once. Rehashing every saved capsule for every anchor made a
      // scan quadratic in history size (and repeated gateway reads amplified that cost).
      // This set lives only in this scan: every read still checks every persisted anchor.
      const retainedDigests = new Set<string>();
      for (const name of durable.filter(n => /\.(tip|publication)\.json$/.test(n))) {
        try {
          const anchor = verifyHash(AnchorSchema.parse(await readCanonical(join(this.root, "transactions", name))));
          if (anchor.homeId !== this.homeId || name !== `${pad(anchor.sequence)}.${anchor.format.includes("publication") ? "publication" : "tip"}.json`) fail("HELD", "Anchor identity mismatch.");
          const ownershipDigest = digest(anchor.ownership);
          if (!retainedDigests.has(ownershipDigest)) {
            retainedDigests.add(ownershipDigest); result.ownership.push(anchor.ownership);
          }
        } catch (error) { result.problems.push(`Damaged retained ownership ${name}: ${String(error)}`); }
      }
      result.coordinators = await this.coordinators();
      for (let index = 0; index < sequences.length; index++) {
        const sequence = sequences[index]!;
        if (sequence !== index + 1) fail("HELD", "Transaction history has a gap; retained publications cannot reset it.");
        const tip = verifyHash(AnchorSchema.parse(await readCanonical(this.file(sequence, "tip"))));
        if (tip.format !== "firstmate.supervision-tip/1" || tip.homeId !== this.homeId || tip.sequence !== sequence || tip.previous !== result.hash) fail("HELD", "Expected tip is inconsistent with the committed prefix.");
        const event = verifyHash(TransactionSchema.parse(await readCanonical(this.file(sequence, "event"))));
        if (event.homeId !== this.homeId || event.sequence !== sequence || event.previous !== result.hash || tip.transactionHash !== event.hash ||
          tip.requestId !== event.requestId || tip.requestHash !== event.requestHash || tip.generation !== event.generation || digest(event.body) !== event.requestHash ||
          result.coordinators[event.generation - 1]?.hash !== event.coordinatorHash || result.transactions.some(t => t.requestId === event.requestId)) fail("HELD", "Transaction chain, request or coordinator identity mismatch.");
        await this.checkBlobs(event.body.mutations);
        checkInboxRequest(event.body.mutations, event.requestId);
        const next = this.apply(result.frames, event.body);
        if (digest(next.changes) !== digest(event.changes) || frameDigest(next.frames) !== event.projectionHash || digest(ownership(next.frames)) !== digest(tip.ownership)) fail("HELD", "Transaction projection or retained ownership mismatch.");
        if (!durable.includes(`${pad(sequence)}.publication.json`)) {
          if (index !== sequences.length - 1) fail("HELD", "Unpublished transaction precedes later history.");
          result.pending = { event, tip }; fail("HELD", "Final transaction awaits publication.");
        }
        const marker = verifyHash(AnchorSchema.parse(await readCanonical(this.file(sequence, "publication"))));
        if (digest({ ...marker, format: tip.format, hash: tip.hash }) !== digest(tip)) fail("HELD", "Publication does not match its expected tip.");
        result.frames = next.frames; result.transactions.push(event); result.sequence = sequence; result.hash = event.hash;
        result.prefixDigest = extendPrefix(result.prefixDigest, event, tip, marker);
      }
      if (result.sequence > SUPERVISION_INDEX_LIMITS.transactions || Buffer.byteLength(canonical({ frames: [...result.frames], ownership: result.ownership })) > SUPERVISION_INDEX_LIMITS.projectionBytes)
        fail("HELD", "Pilot index history/projection bound exceeded; retain history for deliberate reconciliation.");
    } catch (error) { result.problems.push(error instanceof Error ? error.message : String(error)); }
    return result;
  }
  /** The checkpoint is a derived index, never authority. On each instance's first use the
   * entire journal is validated before its in-memory projection can be trusted. Unchanged
   * prefix bytes are thereafter audited explicitly; its anchor is checked on EVERY read.
   */
  private async directories(): Promise<string> {
    return canonical(await Promise.all([this.root, join(this.root, "transactions"), join(this.root, "blobs"), join(this.root, "coordinators")].map(async path => {
      const s = await stat(path, { bigint: true });
      return [s.dev, s.ino, s.mtimeNs, s.ctimeNs].map(String);
    })));
  }
  private async anchorHash(sequence: number): Promise<string | null> {
    if (!sequence) return null;
    await Promise.all(["event", "tip", "publication"].map(suffix => stat(this.file(sequence, suffix))));
    const event = verifyHash(TransactionSchema.parse(await readCanonical(this.file(sequence, "event"))));
    const tip = verifyHash(AnchorSchema.parse(await readCanonical(this.file(sequence, "tip"))));
    const marker = verifyHash(AnchorSchema.parse(await readCanonical(this.file(sequence, "publication"))));
    if (event.homeId !== this.homeId || event.sequence !== sequence || tip.homeId !== this.homeId || tip.sequence !== sequence ||
      tip.format !== "firstmate.supervision-tip/1" || tip.transactionHash !== event.hash ||
      digest({ ...marker, format: tip.format, hash: tip.hash }) !== digest(tip)) fail("HELD", "Checkpoint anchor identity mismatch.");
    await this.checkBlobs(event.body.mutations);
    return digest({ event: event.hash, tip: tip.hash, publication: marker.hash });
  }
  private async readCheckpoint(): Promise<Checkpoint> {
    const path = join(this.root, "checkpoint.json");
    if ((await stat(path)).size > 16 * 1024) fail("HELD", "Checkpoint index exceeds its metadata bound.");
    const checkpoint = verifyHash(CheckpointSchema.parse(await readCanonical(path)));
    if (checkpoint.homeId !== this.homeId || checkpoint.sequence > SUPERVISION_INDEX_LIMITS.transactions) fail("HELD", "Checkpoint home/history bound mismatch.");
    return checkpoint;
  }
  private async checkpointFor(snapshot: Scan): Promise<Checkpoint> {
    return hashed({ format: "firstmate.supervision-checkpoint/1" as const, homeId: this.homeId,
      sequence: snapshot.sequence, transactionHash: snapshot.hash, prefixDigest: snapshot.prefixDigest,
      projectionHash: frameDigest(snapshot.frames), anchorHash: await this.anchorHash(snapshot.sequence) });
  }
  private cache(snapshot: Scan, checkpoint: Checkpoint, directories: string): Scan {
    const prior = this.cached, reuse = prior && prior.scan.sequence <= snapshot.sequence &&
      (prior.scan.hash === null || snapshot.transactions[prior.scan.sequence - 1]?.hash === prior.scan.hash);
    const requests = reuse ? prior.requests : new Map<string, Transaction>();
    const workflowRequests: CachedScan["workflowRequests"] = reuse ? prior.workflowRequests : new Map();
    for (const transaction of snapshot.transactions.slice(reuse ? prior.scan.sequence : 0)) {
      requests.set(transaction.requestId, transaction);
      for (const mutation of transaction.body.mutations) if (mutation.kind === "workflow") workflowRequests.set(key(mutation.event.plan, mutation.event.requestId),
        { requestHash: mutation.event.requestHash, eventHash: mutation.event.hash, transaction });
    }
    this.cached = { scan: snapshot, checkpoint, directories, requests, workflowRequests };
    return snapshot;
  }
  private async saveCheckpoint(snapshot: Scan): Promise<void> {
    if (snapshot.problems.length || !snapshot.initialized) fail("HELD", snapshot.problems.join(" ") || "No validated journal for checkpoint.");
    const checkpoint = await this.checkpointFor(snapshot), path = join(this.root, "checkpoint.json"), temporary = `${path}.${randomUUID()}.tmp`;
    try {
      const file = await open(temporary, "wx", 0o600);
      try { await file.writeFile(`${canonical(checkpoint)}\n`); await this.boundary("checkpoint:written"); await file.sync(); await this.boundary("checkpoint:synced"); }
      finally { await file.close(); }
      await rename(temporary, path); await this.boundary("checkpoint:replaced");
      this.cache(snapshot, checkpoint, await this.directories());
    } finally { await rm(temporary, { force: true }); }
  }
  private async checkedFullScan(): Promise<Scan> {
    this.cached = null;
    const snapshot = await this.scanFull();
    if (!snapshot.initialized || snapshot.problems.length) return snapshot;
    try {
      const before = await this.directories(), checkpoint = await this.readCheckpoint();
      if (digest(checkpoint) !== digest(await this.checkpointFor(snapshot)) || before !== await this.directories())
        fail("HELD", "Checkpoint is stale or mismatches the validated prefix; explicit index recovery required.");
      return this.cache(snapshot, checkpoint, before);
    } catch (error) {
      snapshot.problems.push(`Checkpoint validation failed; full history was checked, admissions held until explicit recovery: ${String(error)}`);
      // Keep independent ownership reservations, but do not expose an unaccepted projection.
      snapshot.frames = new Map(); return snapshot;
    }
  }
  private async scan(): Promise<Scan> {
    const cached = this.cached;
    if (!cached) return this.checkedFullScan();
    try {
      const checkpoint = await this.readCheckpoint(), before = await this.directories();
      const identity = IdentitySchema.parse(await readCanonical(join(this.root, "identity.json")));
      if (identity.homeId !== this.homeId || checkpoint.anchorHash !== await this.anchorHash(checkpoint.sequence)) fail("HELD", "Checkpoint anchor/digest mismatch.");
      const coordinator = cached.scan.coordinators.at(-1);
      if (coordinator && verifyHash(CoordinatorSchema.parse(await readCanonical(join(this.root, "coordinators", `${pad(coordinator.generation)}.json`)))).hash !== coordinator.hash)
        fail("HELD", "Checkpoint coordinator identity changed.");
      if (checkpoint.hash === cached.checkpoint.hash && before === cached.directories) return cached.scan;
      // A current writer can advance this reader by at most a bounded tail. Missing/stale
      // checkpoints and unrelated directory changes go through a full validation below.
      if (checkpoint.sequence > cached.scan.sequence && checkpoint.sequence - cached.scan.sequence <= SUPERVISION_INDEX_LIMITS.tail &&
        canonical(JSON.parse(before).slice(2)) === canonical(JSON.parse(cached.directories).slice(2))) {
        if (cached.checkpoint.anchorHash !== await this.anchorHash(cached.scan.sequence)) fail("HELD", "Prior checkpoint anchor changed.");
        const next = { ...cached.scan, frames: new Map(cached.scan.frames), transactions: [...cached.scan.transactions], ownership: [...cached.scan.ownership] };
        const seen = new Set(next.transactions.map(t => t.requestId));
        for (let sequence = next.sequence + 1; sequence <= checkpoint.sequence; sequence++) {
          const event = verifyHash(TransactionSchema.parse(await readCanonical(this.file(sequence, "event"))));
          const tip = verifyHash(AnchorSchema.parse(await readCanonical(this.file(sequence, "tip"))));
          const marker = verifyHash(AnchorSchema.parse(await readCanonical(this.file(sequence, "publication"))));
          if (event.homeId !== this.homeId || event.sequence !== sequence || event.previous !== next.hash || tip.previous !== next.hash ||
            tip.homeId !== this.homeId || tip.sequence !== sequence || tip.format !== "firstmate.supervision-tip/1" || tip.transactionHash !== event.hash ||
            tip.requestId !== event.requestId || tip.requestHash !== event.requestHash || tip.generation !== event.generation ||
            digest(event.body) !== event.requestHash || next.coordinators[event.generation - 1]?.hash !== event.coordinatorHash || seen.has(event.requestId) ||
            digest({ ...marker, format: tip.format, hash: tip.hash }) !== digest(tip)) fail("HELD", "Checkpoint tail chain/identity mismatch.");
          await this.checkBlobs(event.body.mutations); checkInboxRequest(event.body.mutations, event.requestId);
          const applied = this.apply(next.frames, event.body);
          if (digest(applied.changes) !== digest(event.changes) || frameDigest(applied.frames) !== event.projectionHash ||
            digest(ownership(applied.frames)) !== digest(tip.ownership)) fail("HELD", "Checkpoint tail projection mismatch.");
          next.frames = applied.frames; next.transactions.push(event); seen.add(event.requestId);
          if (!next.ownership.some(o => digest(o) === digest(tip.ownership))) next.ownership.push(tip.ownership);
          next.sequence = sequence; next.hash = event.hash; next.prefixDigest = extendPrefix(next.prefixDigest, event, tip, marker);
          next.bytes += Buffer.byteLength(canonical(event) + canonical(tip) + canonical(marker)) + 3;
        }
        // Directory accounting and coordinator changes cannot be guessed from the event tail.
        if (digest(checkpoint) !== digest(await this.checkpointFor(next)) || before !== await this.directories()) fail("HELD", "Checkpoint tail digest mismatch.");
        return this.cache(next, checkpoint, before);
      }
    } catch { /* Full historical validation supplies retained ownership and the exact failure. */ }
    return this.checkedFullScan();
  }
  /** Explicit read-only audit command. Also runs automatically on startup and every recovery.
   * Historical corruption holds this instance until a subsequent successful audit/recovery.
   */
  async audit(): Promise<SupervisionStatus> {
    return this.locked(async () => structuredClone(this.status(await this.checkedFullScan())));
  }
  /** Rebuild only a derived checkpoint after a full valid history scan. Never reconstruct an
   * authority record or discard a pending transaction. No receiver/agent effects are involved.
   */
  async recoverIndex(observed?: { homeId: string; sequence: number; hash: string | null }): Promise<void> {
    this.writable();
    await this.locked(async () => {
      this.cached = null;
      const snapshot = await this.scanFull();
      if (snapshot.problems.length || !snapshot.initialized) fail("HELD", snapshot.problems.join(" ") || "No validated journal for index recovery.");
      if (observed && (observed.homeId !== this.homeId || observed.sequence !== snapshot.sequence || observed.hash !== snapshot.hash))
        fail("STALE", "Recovery observation changed under the index repair lock.");
      if (observed) {
        try {
          const checkpoint = await this.readCheckpoint();
          if (digest(checkpoint) === digest(await this.checkpointFor(snapshot)))
            fail("STALE", "Checkpoint is already current; inspect before another repair.");
        } catch (error) {
          if (error instanceof SupervisionError && error.code === "STALE") throw error;
          // Missing or invalid derived checkpoint is the explicit repair case.
        }
      }
      await this.saveCheckpoint(snapshot);
    });
  }
  private accepted(snapshot: Scan, requestId: string): Transaction | undefined {
    return this.cached?.scan === snapshot ? this.cached.requests.get(requestId) : snapshot.transactions.find(t => t.requestId === requestId);
  }
  private async checkBlobs(mutations: SupervisionMutation[]): Promise<void> {
    for (const mutation of mutations) if (mutation.kind === "blob") {
      const bytes = await readFile(join(this.root, "blobs", mutation.value.id));
      if (bytes.length !== mutation.value.bytes || rawDigest(bytes) !== mutation.value.id) fail("HELD", "Referenced evidence blob is missing or corrupt.");
    }
  }
  private receipt(event: Transaction): SupervisionReceipt {
    return { requestId: event.requestId, requestHash: event.requestHash, sequence: event.sequence, hash: event.hash,
      generation: event.generation, versions: structuredClone(event.changes) };
  }
  async transact(expectedVersions: SupervisionExpected[], requestId: string, mutations: SupervisionMutation[]): Promise<SupervisionReceipt> {
    SupervisionUuid.parse(requestId);
    const input = { actor: this.actor, expectedVersions, mutations }, body = structuredClone(BodySchema.parse(input));
    // Bind exact canonical submitted data; schema defaults must not silently change request identity.
    if (digest(input) !== digest(body)) fail("CONFLICT", "Submit the complete canonical mutation contract, including workflow defaults.");
    checkInboxRequest(body.mutations, requestId);
    const requestHash = digest(body);
    return this.locked(async () => {
      const snapshot = await this.scan();
      if (snapshot.problems.length) fail("HELD", snapshot.problems.join(" "));
      const replay = this.accepted(snapshot, requestId);
      if (replay) {
        if (replay.requestHash !== requestHash) fail("CONFLICT", "Request ID has different content; retain and inspect the original receipt.");
        return this.receipt(replay); // Before CAS/admission; historical approval is not reauthorized.
      }
      return this.commit(snapshot, body, requestId, requestHash);
    });
  }
  /** Internal S03 checked preparation: replay precedes current admission; preparation and publication
   * share the coordinator's serialization boundary. No model/network call belongs in prepare.
   */
  async transactCommand(requestId: string, inputHash: string, actorInput: SupervisionActor,
    prepare: (status: SupervisionStatus) => Promise<{ expectedVersions: SupervisionExpected[]; mutations: SupervisionMutation[]; result: ScopedCommandResult }>,
  ): Promise<{ receipt: SupervisionReceipt; result: ScopedCommandResult }> {
    SupervisionUuid.parse(requestId); SupervisionHash.parse(inputHash);
    const actor = structuredClone(SupervisionActorSchema.parse(actorInput));
    return this.locked(async () => {
      const snapshot = await this.scan();
      if (snapshot.problems.length) fail("HELD", snapshot.problems.join(" "));
      const replay = this.accepted(snapshot, requestId);
      if (replay) {
        const accepted = replay.body.mutations.find(m => m.kind === "command" && m.value.id === requestId);
        if (accepted?.kind !== "command" || accepted.value.inputHash !== inputHash || digest(accepted.value.actor) !== digest(actor))
          fail("CONFLICT", "Request ID belongs to different command content or provenance.");
        return { receipt: this.receipt(replay), result: structuredClone(accepted.value.result) };
      }
      this.writable(); await this.assertCoordinator();
      const prepared = await prepare(structuredClone(this.status(snapshot)));
      const result = ScopedCommandResultSchema.parse(prepared.result);
      if (prepared.mutations.some(m => m.kind === "command")) fail("CONFLICT", "Command replay index is store-owned.");
      const body = BodySchema.parse({ actor, expectedVersions: [...prepared.expectedVersions, { kind: "command", id: requestId, version: 0 }],
        mutations: [...prepared.mutations, { kind: "command", value: { id: requestId, version: 1, inputHash, actor, result } }] });
      return { receipt: await this.commit(snapshot, body, requestId, digest(body)), result };
    });
  }
  private async commit(snapshot: Scan, body: z.infer<typeof BodySchema>, requestId: string, requestHash: string): Promise<SupervisionReceipt> {
      // Both transaction entry points must publish a replay marker for this exact request.
      checkInboxRequest(body.mutations, requestId);
      this.writable();
      if (!snapshot.initialized) fail("HELD", "Initialize a new fixture store explicitly.");
      const coordinator = await this.assertCoordinator();
      if (snapshot.sequence >= SUPERVISION_INDEX_LIMITS.admissions && body.mutations.some(m => m.kind === "effect" && !snapshot.frames.has(key("effect", m.value.id))))
        fail("HELD", "Pilot admission bound reached; reserve the remaining journal headroom for known work and reconciliation.");
      const next = this.apply(snapshot.frames, body);
      const nextOwnership = ownership(next.frames), ownershipDigest = digest(nextOwnership);
      const retainedOwnership = snapshot.ownership.some(o => digest(o) === ownershipDigest) ? snapshot.ownership : [...snapshot.ownership, nextOwnership];
      if (snapshot.sequence >= SUPERVISION_INDEX_LIMITS.transactions || Buffer.byteLength(canonical({ frames: [...next.frames], ownership: retainedOwnership })) > SUPERVISION_INDEX_LIMITS.projectionBytes)
        fail("HELD", "Pilot history/projection bound reached; stop admissions and retain the journal for audit.");
      const pending = inboxProjection(next.frames).assignments.filter(a => a.primaryEventId === a.id && !terminal(a)).length;
      const oldPending = inboxProjection(snapshot.frames).assignments.filter(a => a.primaryEventId === a.id && !terminal(a)).length;
      if (pending > oldPending && pending > (this.options.maxPendingEvents ?? INBOX_LIMITS.pending)) fail("HELD", "Pending event alarm; ingress baseline has not advanced.");
      await this.checkBlobs(body.mutations);
      const event = hashed({ format: "firstmate.supervision-transaction/1" as const, homeId: this.homeId,
        sequence: snapshot.sequence + 1, previous: snapshot.hash, generation: coordinator.generation, coordinatorHash: coordinator.hash,
        requestId, requestHash, at: new Date().toISOString(), body, changes: next.changes, projectionHash: frameDigest(next.frames), outbox: [] as never[] });
      const capsule = { homeId: this.homeId, sequence: event.sequence, previous: event.previous, transactionHash: event.hash,
        requestId, requestHash, generation: event.generation, ownership: nextOwnership };
      const tip = hashed({ format: "firstmate.supervision-tip/1" as const, ...capsule });
      const marker = hashed({ format: "firstmate.supervision-publication/1" as const, ...capsule });
      const bytes = Buffer.byteLength(canonical(event) + canonical(tip) + canonical(marker)) + 3;
      if (snapshot.bytes + bytes > (this.options.maxJournalBytes ?? 100 * 1024 * 1024)) fail("HELD", "Journal storage alarm; admissions held without evicting history.");
      try {
        await this.publish(this.file(event.sequence, "tip"), tip, "tip");
        await this.publish(this.file(event.sequence, "event"), event, "event");
        await this.publish(this.file(event.sequence, "publication"), marker, "publication");
        await this.saveCheckpoint({ ...snapshot, frames: next.frames, transactions: [...snapshot.transactions, event], sequence: event.sequence,
          hash: event.hash, prefixDigest: extendPrefix(snapshot.prefixDigest, event, tip, marker), ownership: retainedOwnership, bytes: snapshot.bytes + bytes });
      } catch (error) {
        fail("HELD", `Publication interrupted; reread/reconcile the original request without repeating an effect: ${String(error)}`);
      }
      return this.receipt(event);
  }
  /** Only completes an exact validated event+tip. Missing events/anchors require deliberate repair.
   * No anchor deletion/reconstruction, external dispatch or recovery of a shorter history exists.
   */
  async recoverPublication(): Promise<SupervisionReceipt | null> {
    this.writable();
    return this.locked(async () => {
      await this.assertCoordinator();
      this.cached = null;
      const snapshot = await this.scanFull();
      if (snapshot.problems.some(p => p !== "Final transaction awaits publication.")) fail("HELD", snapshot.problems.join(" "));
      if (!snapshot.pending) { await this.saveCheckpoint(snapshot); return null; }
      const { event, tip } = snapshot.pending;
      const { hash: _hash, ...body } = tip;
      await this.publish(this.file(event.sequence, "publication"), hashed({ ...body, format: "firstmate.supervision-publication/1" }), "publication");
      await this.saveCheckpoint(await this.scanFull());
      return this.receipt(event);
    });
  }
  async putBlob(bytes: Uint8Array): Promise<{ id: string; bytes: number }> {
    this.writable();
    if (bytes.length > 512 * 1024) fail("HELD", "Evidence blob exceeds 512 KiB; use a bounded evidence handle.");
    const copy = Uint8Array.from(bytes), id = rawDigest(copy);
    return this.locked(async () => {
      await this.assertCoordinator();
      const snapshot = await this.scan();
      if (snapshot.problems.length) fail("HELD", snapshot.problems.join(" "));
      if (snapshot.bytes + copy.length > (this.options.maxJournalBytes ?? 100 * 1024 * 1024)) fail("HELD", "Evidence storage alarm; retain existing history.");
      const path = join(this.root, "blobs", id);
      let created = false;
      try { await publishBytes(path, copy, stage => this.boundary(`blob:${stage}`)); created = true; }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") fail("HELD", `Evidence publication failed; no reference committed: ${String(error)}`);
        if (rawDigest(await readFile(path)) !== id) fail("HELD", "Existing evidence blob is corrupt; never overwrite it.");
      }
      // Account newly published evidence without replaying journal history. The anchor and
      // derived checkpoint are unchanged; only physical staging/storage accounting advances.
      const priorBytes = created ? copy.length : 0;
      this.cache({ ...snapshot, bytes: snapshot.bytes + priorBytes }, await this.readCheckpoint(), await this.directories());
      return { id, bytes: copy.length };
    });
  }
  async read(): Promise<SupervisionStatus> {
    return this.reading(async () => structuredClone(this.status(await this.scan())));
  }
  private status(snapshot: Scan): SupervisionStatus {
    const values = <T>(kind: Frame["kind"]) => [...snapshot.frames.values()].filter(f => f.kind === kind).map(f => f.value as T);
    const tasks = values<SupervisionStatus["tasks"][number]>("task"), effects = values<SupervisionStatus["effects"][number]>("effect");
    return { format: "firstmate.supervision-status/1", homeId: this.homeId,
      freshness: snapshot.problems.length ? "held" : snapshot.initialized ? "current" : "uninitialized",
      sequence: snapshot.sequence, hash: snapshot.hash, executable: false, guarantee: "cooperative-storage-only",
      limits: ["No live command transport, sends, session creation or backend migration is enabled.",
        "Pilot index ceilings: new effects stop at 192 transactions; all writes stop at 256; 8 MiB projection plus retained ownership; 32 transactions per incremental read.",
        "Warm reads trust the validated checkpoint prefix. Old in-place corruption is detected on startup, recovery or explicit audit; anchors are checked on every read.",
        "Actor provenance and filesystem ownership are cooperative, not authenticated IPC or receiver fencing.",
        "Process-crash qualification only; coordinated loss of journal and all local metadata can hide truncation."],
      problems: snapshot.problems, versions: [...snapshot.frames.values()].map(({ kind, id, version }) => ({ kind, id, version })),
      storage: { bytes: snapshot.bytes, limitBytes: this.options.maxJournalBytes ?? 100 * 1024 * 1024,
        admissionsHeld: snapshot.problems.length > 0 || snapshot.bytes >= (this.options.maxJournalBytes ?? 100 * 1024 * 1024) ||
          snapshot.sequence >= SUPERVISION_INDEX_LIMITS.admissions },
      scopes: values("scope"), bindings: values("binding"), tasks, attempts: values("attempt"), effects, backends: values("backend"),
      policySources: values("policy-source"), policyRules: values("policy-rule"), policyEvidence: values("policy-evidence"), approvals: values("approval"),
      decisions: values("decision"), outbox: values("outbox"), operationHolds: values("operation-hold"), commands: values("command"),
      continuations: values("continuation"),
      uncertainEffectIds: effects.filter(e => ["dispatching", "uncertain"].includes(e.state)).map(e => e.id),
      plans: values<WorkflowRow>("workflow").map(({ scopeId, plan }) => ({ scopeId, plan })),
      retirements: values<{ scopeId: string; receipt: z.infer<typeof RetirementSchema> }>("retirement")
        .map(({ scopeId, receipt }) => ({ scopeId, plan: receipt.plan, evidence: receipt.evidence, hash: receipt.hash })),
      retainedOwnership: snapshot.ownership,
      inbox: inboxProjection(snapshot.frames),
      index: { schema: 1, sequence: snapshot.sequence, hash: snapshot.hash,
        taskOwners: Object.fromEntries(tasks.map(t => [JSON.stringify([t.hostId.trim().toLowerCase(), t.projectId, t.nodeId]), t.ownerScopeId])),
        effectKeys: Object.fromEntries(effects.map(e => [e.logicalKey, e.id])) },
    };
  }
  /** Read accepted transaction identity without reauthorizing it or acquiring the coordinator. */
  async requestReceipt(requestId: string): Promise<SupervisionReceipt | null> {
    return this.reading(async () => {
      const snapshot = await this.scan();
      if (snapshot.problems.length) fail("HELD", snapshot.problems.join(" "));
      const transaction = this.accepted(snapshot, requestId);
      return transaction ? this.receipt(transaction) : null;
    });
  }
  /** Original event/request identity and transaction receipt, independent of later policy changes. */
  async workflowRequest(planId: string, requestId: string): Promise<{ requestHash: string; eventHash: string; receipt: SupervisionReceipt } | null> {
    return this.reading(async () => {
      const snapshot = await this.scan();
      if (snapshot.problems.length) fail("HELD", snapshot.problems.join(" "));
      const saved = this.cached?.scan === snapshot ? this.cached.workflowRequests.get(key(planId, requestId)) : null;
      return saved ? { requestHash: saved.requestHash, eventHash: saved.eventHash, receipt: this.receipt(saved.transaction) } : null;
    });
  }
  /** Read-only partition answer. S04/S07 must integrate both actual writer paths before activation. */
  async backend(planId: string): Promise<{ backend: "legacy" | "scoped" | null; held: boolean; ownerScopeId: string | null }> {
    const status = await this.read(), row = status.backends.find(b => b.planId === planId);
    const retired = status.versions.some(v => v.kind === "retirement" && v.id === planId);
    const owner = status.scopes.find(s => s.id === row?.ownerScopeId);
    return { backend: row?.backend ?? null, held: status.freshness === "held" || retired || !row || row.state !== "active" || !owner || ["held", "transferring", "retired"].includes(owner.state),
      ownerScopeId: row?.ownerScopeId ?? null };
  }
}
