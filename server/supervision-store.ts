/** Unwired S01 authority journal. Explicit writes only; reads never initialize or repair.
 * Cooperative same-user filesystem storage, not an authenticated dispatch boundary.
 */
import { AsyncLocalStorage } from "node:async_hooks";
import { CapacitySchema, DEFAULT_CAPACITY, pressure, type Capacity } from "./supervision-capacity";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, open, readFile, readdir, rename, rm, stat, realpath } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { z } from "zod";
import {
  SupervisionActorSchema, SupervisionAttemptSchema, SupervisionBackendSchema, SupervisionBindingSchema,
  SupervisionEffectSchema, SupervisionExpectedSchema, SupervisionHash, SupervisionScopeSchema,
  SupervisionTaskSchema, SupervisionUtc, SupervisionUuid, superviseReplayEquivalent,
  type SupervisionActor, type SupervisionCode, type SupervisionExpected, type SupervisionOwnership,
  type SupervisionReceipt, type SupervisionStatus,
} from "../shared/supervision";
import type { WorkflowPlan } from "../shared/workflow-plans";
import { canonical, canonicalCached, digest, digestCached, publish, publishBytes } from "./submissions";
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
import { LegacyDeliveryDispositionSchema, MigrationReceiptSchema, type LegacyDeliveryDisposition, type MigrationReceipt } from "../shared/supervision-migration";
import { BoardSubmissionSchema, SourceBindingSchema } from "../shared/supervision-sources";
import { validateSourceChange, validateSourceRows } from "./supervision-source-state";
import { DependencyResolutionSchema, IntentSchema, MemoryProposalSchema, PlanSponsorSchema, PortfolioConflictSchema, ProjectMemorySchema,
  ProjectRecordSchema } from "../shared/supervision-projects";
import { validateProjectChange, validateProjectRows } from "./supervision-project-state";
import { MaintenanceIncidentSchema, MaintenanceJobSchema, OccurrenceHostSchema, OccurrenceSchema, ResourceReservationSchema } from "../shared/supervision-maintenance";
import { validateMaintenanceChange, validateMaintenanceRows } from "./supervision-maintenance-state";
import { PlanRuleRecordSchema, RuleVerificationSchema, RuleFailureSchema, RuleViolationSchema } from "../shared/plan-rules";

const number = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER), positive = number.min(1);
const BlobSchema = z.object({ id: SupervisionHash, bytes: number }).strict();
export const SupervisionMutationSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("plan-rules"), value: PlanRuleRecordSchema }).strict(),
  z.object({ kind: z.literal("rule-verification"), value: RuleVerificationSchema }).strict(),
  z.object({ kind: z.literal("rule-failure"), value: RuleFailureSchema }).strict(),
  z.object({ kind: z.literal("rule-violation"), value: RuleViolationSchema }).strict(),
  z.object({ kind: z.literal("policy-source"), value: PolicySourceSchema }).strict(),
  z.object({ kind: z.literal("policy-rule"), value: PolicyRuleSchema }).strict(),
  z.object({ kind: z.literal("policy-evidence"), value: PolicyEvidenceSchema }).strict(),
  z.object({ kind: z.literal("approval"), value: PolicyApprovalSchema }).strict(),
  z.object({ kind: z.literal("decision"), value: ScopedDecisionSchema }).strict(),
  z.object({ kind: z.literal("outbox"), value: ScopedOutboxSchema }).strict(),
  z.object({ kind: z.literal("operation-hold"), value: OperationHoldSchema }).strict(),
  z.object({ kind: z.literal("command"), value: AcceptedScopedCommandSchema }).strict(),
  z.object({ kind: z.literal("continuation"), value: ContinuationSchema }).strict(),
  z.object({ kind: z.literal("source-binding"), value: SourceBindingSchema }).strict(),
  z.object({ kind: z.literal("board-submission"), value: BoardSubmissionSchema }).strict(),
  // S09: project context, sponsors, intents, qualified dependencies, memory and portfolio conflicts.
  z.object({ kind: z.literal("project"), value: ProjectRecordSchema }).strict(),
  z.object({ kind: z.literal("plan-sponsor"), value: PlanSponsorSchema }).strict(),
  z.object({ kind: z.literal("intent"), value: IntentSchema }).strict(),
  z.object({ kind: z.literal("dependency-resolution"), value: DependencyResolutionSchema }).strict(),
  z.object({ kind: z.literal("memory-proposal"), value: MemoryProposalSchema }).strict(),
  z.object({ kind: z.literal("project-memory"), value: ProjectMemorySchema }).strict(),
  z.object({ kind: z.literal("portfolio-conflict"), value: PortfolioConflictSchema }).strict(),
  // S10: resource reservations, maintenance jobs, daily occurrences, host passes and incidents.
  z.object({ kind: z.literal("resource-reservation"), value: ResourceReservationSchema }).strict(),
  z.object({ kind: z.literal("maintenance-job"), value: MaintenanceJobSchema }).strict(),
  z.object({ kind: z.literal("occurrence"), value: OccurrenceSchema }).strict(),
  z.object({ kind: z.literal("occurrence-host"), value: OccurrenceHostSchema }).strict(),
  z.object({ kind: z.literal("maintenance-incident"), value: MaintenanceIncidentSchema }).strict(),
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
  // S07: one checked import of an original legacy chain, byte-exact, beside its migration receipt.
  z.object({ kind: z.literal("workflow-import"), scopeId: SupervisionUuid, migrationId: SupervisionUuid,
    events: z.array(z.custom<z.infer<typeof WorkflowEventSchema>>(value => WorkflowEventSchema.safeParse(value).success)).min(1).max(5000) }).strict(),
  z.object({ kind: z.literal("migration"), value: MigrationReceiptSchema }).strict(),
  z.object({ kind: z.literal("delivery-disposition"), value: LegacyDeliveryDispositionSchema }).strict(),
]);
/** Every journal mutation. The S07 import is migrator-only; ordinary callers use `SupervisionMutation`. */
export type StoreMutation = z.infer<typeof SupervisionMutationSchema>;
export type SupervisionMutation = Exclude<StoreMutation, { kind: "workflow-import" }>;
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
const TransactionSchema = z.object({ format: z.enum(["firstmate.supervision-transaction/1", "firstmate.supervision-transaction/2"]), homeId: z.string(), sequence: positive,
  previous: SupervisionHash.nullable(), generation: positive, coordinatorHash: SupervisionHash, requestId: SupervisionUuid,
  requestHash: SupervisionHash, at: SupervisionUtc, body: BodySchema, changes: z.array(SupervisionExpectedSchema),
  projectionHash: SupervisionHash, outbox: z.array(z.never()).max(0), hash: SupervisionHash }).strict();
type Transaction = z.infer<typeof TransactionSchema>;
/** Rebuildable metadata index: event bodies stay on disk, never retained for warm history/replay reads. */
type IndexedTransaction = Pick<Transaction, "format" | "requestId" | "requestHash" | "sequence" | "hash" | "generation" | "changes" | "projectionHash" | "at"> & {
  actor: SupervisionActor; workflows: { plan: string; requestId: string; requestHash: string; eventHash: string }[] };
function indexedTransaction(event: Transaction): IndexedTransaction {
  const { format, requestId, requestHash, sequence, hash, generation, changes, projectionHash, at } = event;
  return { format, requestId, requestHash, sequence, hash, generation, changes, projectionHash, at, actor: event.body.actor,
    workflows: event.body.mutations.flatMap(m => m.kind === "workflow" ? [m.event] : m.kind === "workflow-import" ? m.events : [])
      .map(e => ({ plan: e.plan, requestId: e.requestId, requestHash: e.requestHash, eventHash: e.hash })) };
}
const AnchorSchema = z.object({ format: z.enum(["firstmate.supervision-tip/1", "firstmate.supervision-publication/1"]),
  homeId: z.string(), sequence: positive, previous: SupervisionHash.nullable(), transactionHash: SupervisionHash,
  requestId: SupervisionUuid, requestHash: SupervisionHash, generation: positive,
  ownership: OwnershipSchema, hash: SupervisionHash }).strict();
type Anchor = z.infer<typeof AnchorSchema>;
/** One changed ownership contribution, exactly as `ownership(frames)` derives it from its frame.
 * A /2 anchor carries only the contributions its own transaction changed (or every contribution
 * on a reset anchor), plus the full ownership digest, instead of embedding the whole retained
 * ownership - which grew every anchor with history (89 KB each at 3,349 transactions, duplicated
 * in tip and publication: 365 MB of a 372 MB journal whose events are 7 MB). */
const OwnershipEntrySchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("scope"), id: SupervisionUuid }).strict(),
  z.object({ kind: z.literal("task"), value: SupervisionTaskSchema }).strict(),
  z.object({ kind: z.literal("attempt"), value: SupervisionAttemptSchema }).strict(),
  z.object({ kind: z.literal("effect"), value: SupervisionEffectSchema }).strict(),
  z.object({ kind: z.literal("backend"), value: SupervisionBackendSchema }).strict(),
  z.object({ kind: z.literal("workflow"), value: z.object({ plan: z.string(), inventory: WorkflowOwnershipSchema }).strict() }).strict(),
  z.object({ kind: z.literal("retirement"), value: z.object({ plan: z.string(), inventory: WorkflowOwnershipSchema }).strict() }).strict(),
]);
type OwnershipEntry = z.infer<typeof OwnershipEntrySchema>;
const OwnershipDeltaSchema = z.object({ reset: z.boolean(), entries: z.array(OwnershipEntrySchema).max(16384) }).strict();
type OwnershipDelta = z.infer<typeof OwnershipDeltaSchema>;
const Anchor2Schema = z.object({ format: z.enum(["firstmate.supervision-tip/2", "firstmate.supervision-publication/2"]),
  homeId: z.string(), sequence: positive, previous: SupervisionHash.nullable(), transactionHash: SupervisionHash,
  requestId: SupervisionUuid, requestHash: SupervisionHash, generation: positive,
  ownershipDigest: SupervisionHash, ownershipDelta: OwnershipDeltaSchema, projectionSet: SupervisionHash, hash: SupervisionHash }).strict();
type Anchor2 = z.infer<typeof Anchor2Schema>;
type AnyAnchor = Anchor | Anchor2;
const AnyAnchorSchema = z.union([AnchorSchema, Anchor2Schema]);
const isAnchor2 = (anchor: AnyAnchor): anchor is Anchor2 => anchor.format.endsWith("/2");
/** Written before the first anchor file is replaced: both anchor generations' hashes per sequence
 * and both prefix digests, so an interrupted migration is verifiable and resumable at any point. */
const AnchorMigrationSchema = z.object({ format: z.literal("firstmate.supervision-anchor-migration/1"), homeId: z.string(),
  sequence: positive, headHash: SupervisionHash, oldPrefixDigest: SupervisionHash, newPrefixDigest: SupervisionHash,
  createdAt: z.string(),
  old: z.array(z.object({ sequence: positive, tip: SupervisionHash, publication: SupervisionHash }).strict()),
  next: z.array(z.object({ sequence: positive, tip: SupervisionHash, publication: SupervisionHash }).strict()), hash: SupervisionHash }).strict();
type AnchorMigration = z.infer<typeof AnchorMigrationSchema>;
const AnchorRollbackSchema = z.object({ format: z.literal("firstmate.supervision-anchor-rollback/1"), homeId: z.string(),
  migrationSequence: positive, headSequence: positive, oldPrefixDigest: SupervisionHash, createdAt: z.string(),
  files: z.array(z.object({ sequence: positive, kind: z.enum(["event", "tip", "publication"]), before: SupervisionHash, after: SupervisionHash }).strict()),
  hash: SupervisionHash }).strict();
type AnchorRollback = z.infer<typeof AnchorRollbackSchema>;
type WorkflowRow = { scopeId: string; plan: WorkflowPlan; inventory: WorkflowOwnership;
  requests: { requestId: string; requestHash: string; eventHash: string }[] };
type Frame = { kind: SupervisionExpected["kind"]; id: string; version: number; value: unknown };
type Scan = { frames: Map<string, Frame>; transactions: IndexedTransaction[]; sequence: number; hash: string | null;
  problems: string[]; initialized: boolean; ownership: z.infer<typeof OwnershipSchema>[]; pending: { event: Transaction; tip: AnyAnchor } | null;
  bytes: number; coordinators: Coordinator[]; prefixDigest: string; projection: string; projectionSet: string; projectionVector: string; legacyAnchors: number };
/** Bounded cooperative pilot. Full audit/recovery is deliberately separate from warm reads.
 * These are admission ceilings, not history eviction or a guarantee about filesystem latency.
 */
export const SUPERVISION_INDEX_LIMITS = { transactions: 256, admissions: 192, tail: 32, projectionBytes: 8 * 1024 * 1024 } as const;
const CheckpointSchema = z.object({ format: z.literal("firstmate.supervision-checkpoint/1"), homeId: z.string(),
  sequence: number, transactionHash: SupervisionHash.nullable(), prefixDigest: SupervisionHash,
  projectionHash: SupervisionHash, anchorHash: SupervisionHash.nullable(), hash: SupervisionHash }).strict();
type Checkpoint = z.infer<typeof CheckpointSchema>;
const IndexedTransactionSchema = z.object({ format: z.enum(["firstmate.supervision-transaction/1", "firstmate.supervision-transaction/2"]),
  requestId: SupervisionUuid, requestHash: SupervisionHash, sequence: positive, hash: SupervisionHash, generation: positive,
  changes: z.array(SupervisionExpectedSchema), projectionHash: SupervisionHash, at: z.string(), actor: SupervisionActorSchema,
  workflows: z.array(z.object({ plan: z.string(), requestId: z.string(), requestHash: SupervisionHash, eventHash: SupervisionHash }).strict()) }).strict();
/** A derived restart cache: the projection a full audit verified, bound to the checkpoint
 * that witnessed it. Written only after a full validation; a cold read may serve it after
 * re-binding it to the on-disk checkpoint and anchor chain and validating the tail, while a
 * background full audit re-verifies the whole history and poisons the instance if it diverges.
 * The cache is an index, never authority - like the checkpoint, a forged cache+checkpoint
 * pair is only caught by that background audit, which is the stated integrity trade-off. */
const ProjectionCacheSchema = z.object({ format: z.literal("firstmate.supervision-projection-cache/1"), homeId: z.string(),
  sequence: z.number().int().nonnegative(), transactionHash: SupervisionHash.nullable(), prefixDigest: SupervisionHash,
  projection: SupervisionHash, projectionSet: SupervisionHash, projectionVector: z.string().regex(/^[0-9a-f]{256}$/),
  checkpoint: CheckpointSchema, legacyAnchors: z.number().int().nonnegative(), directories: z.string(), bytes: z.number().int().nonnegative(), ownershipDigest: SupervisionHash,
  frames: z.array(z.tuple([z.string(), z.object({ kind: z.string(), id: z.string(), version: z.number().int().nonnegative(), value: z.unknown() }).strict()])),
  transactions: z.array(IndexedTransactionSchema), ownership: z.array(z.unknown()), hash: SupervisionHash }).strict();
type ProjectionCache = z.infer<typeof ProjectionCacheSchema>;
/** Durable blob name -> stat identity. Evidence is content-addressed and append-only. */
type BlobIdentities = Map<string, string>;
type CachedScan = { scan: Scan; checkpoint: Checkpoint; directories: string; blobs: BlobIdentities; requests: Map<string, IndexedTransaction>;
  workflowRequests: Map<string, { requestHash: string; eventHash: string; transaction: IndexedTransaction }> };
type StoreLockLease = { active: boolean };
const storeLocks = new AsyncLocalStorage<ReadonlyMap<string, StoreLockLease>>();
type StorePublication = { epoch: number; active: Promise<void> | null };
const publications = new Map<string, StorePublication>();
function publicationFor(root: string): StorePublication {
  let state = publications.get(root);
  if (!state) { state = { epoch: 0, active: null }; publications.set(root, state); }
  return state;
}
/** One background audit per journal per process, shared by every instance serving it: its
 * failure must poison all of them, not just the instance that happened to schedule it. */
type StoreAudit = { running: boolean; failure: string[] | null; promise: Promise<void> | null; target: number; divergence: string | null };
const audits = new Map<string, StoreAudit>();
function auditFor(root: string): StoreAudit {
  let state = audits.get(root);
  if (!state) { state = { running: false, failure: null, promise: null, target: -1, divergence: null }; audits.set(root, state); }
  return state;
}
/** Sentinel: journal metadata moved while a warm read was checking it. */
const changedDuringRead = new Error("Supervision journal changed during a warm read.");
/** A week after migration the /1 anchor backup (about a journal's worth) expires on the next verified writer. */
const ANCHOR_BACKUP_TTL_MS = 7 * 24 * 3600 * 1000;
const emptyPrefix = digest({ format: "firstmate.supervision-prefix/1" });
const extendPrefix = (previous: string, event: Pick<Transaction, "sequence" | "hash">, tip: AnyAnchor, marker: AnyAnchor) => digest({ previous,
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
  /** Fixture-only: write original /1 events and whole-ownership anchors so anchor migration can be regression-tested on a genuine legacy journal. No runtime wiring. */
  legacyFormat?: boolean;
}
export class SupervisionError extends Error {
  constructor(readonly code: SupervisionCode, message: string) { super(message); }
}
function fail(code: SupervisionCode, message: string): never { throw new SupervisionError(code, message); }
function checkInboxRequest(mutations: StoreMutation[], requestId: string) {
  if (mutations.some(m => m.kind === "inbox-request" && m.value.id !== requestId)) fail("CONFLICT", "Inbox replay marker must name its publishing transaction's request ID.");
}
const key = (kind: string, id: string) => JSON.stringify([kind, id]);
const pad = (value: number) => String(value).padStart(12, "0");
const hashed = <T extends object>(body: T) => ({ ...body, hash: digest(body) });
function verifyHash<T extends { hash: string }>(value: T): T {
  const { hash, ...body } = value;
  // Every caller passes a freshly parsed record it never mutates, so the identity-keyed
  // canonical cache below is exact here and lets later ownership/anchor digests in the same
  // scan reuse this walk instead of re-serializing each anchor several times.
  if (cachedDigest(body) !== hash) fail("HELD", "Journal checksum mismatch.");
  return value;
}
/** Hash-verify a journal record as written, before schema defaults/transforms can rebuild it —
 * the order the legacy plan log already uses ("check original committed data BEFORE
 * defaults/transforms"). The writer hashed the exact object it published, so a record whose
 * checksum verifies as written is the record that was committed; full schema validation still
 * runs on every record before any use. */
function parseVerified<T extends { hash: string }>(schema: { parse(value: unknown): T }, raw: unknown): T {
  return schema.parse(verifyHash(raw as T));
}
/** Requiring the persisted canonical encoding also rejects duplicate keys and nonfinite JSON. */
async function readCanonical(path: string): Promise<unknown> {
  const text = await readFile(path, "utf8"), value: unknown = JSON.parse(text);
  if (`${cachedCanonical(value)}\n` !== text) fail("HELD", "Journal is not canonical JSON.");
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
function mutationTarget(mutation: StoreMutation): [Frame["kind"], string] {
  if (mutation.kind === "workflow") return [mutation.kind, mutation.event.plan];
  if (mutation.kind === "workflow-import") return ["workflow", mutation.events[0]!.plan];
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
/** digest(ownership(frames)) built from each row's cached canonical bytes: byte-identical
 * to hashing the assembled ownership object, without re-walking every row it contains. */
function ownershipDigestOf(frames: Map<string, Frame>): string {
  supervisionDigestStats.ownershipCalls++;
  const byKind = { scope: [] as Frame[], task: [] as Frame[], attempt: [] as Frame[], effect: [] as Frame[], backend: [] as Frame[], workflow: [] as Frame[], retirement: [] as Frame[] };
  for (const frame of frames.values()) if (frame.kind in byKind) byKind[frame.kind as keyof typeof byKind].push(frame);
  const list = (rows: Frame[]) => `[${rows.map(f => cachedCanonical(f.value)).join(",")}]`;
  const scopes = `[${byKind.scope.map(f => JSON.stringify((f.value as { id: string }).id)).join(",")}]`;
  const workflows = `[${[...byKind.workflow.map(f => { const w = f.value as WorkflowRow; return `{"inventory":${cachedCanonical(w.inventory)},"plan":${JSON.stringify(w.plan.definition.id)}}`; }),
    ...byKind.retirement.map(f => { const r = (f.value as { receipt: z.infer<typeof RetirementSchema> }).receipt; return `{"inventory":${cachedCanonical(r.inventory)},"plan":${JSON.stringify(r.plan)}}`; })].join(",")}]`;
  return createHash("sha256").update(`{"attempts":${list(byKind.attempt)},"backends":${list(byKind.backend)},"effects":${list(byKind.effect)},"scopes":${scopes},"tasks":${list(byKind.task)},"workflows":${workflows}}`).digest("hex");
}
/** Retained capsules are never mutated once validated, and one is kept per distinct ownership,
 * so nearly one per transaction. Hash each once rather than once per comparison per transaction.
 */
const ownershipDigests = new WeakMap<object, string>();
function ownershipDigest(value: z.infer<typeof OwnershipSchema>): string {
  let saved = ownershipDigests.get(value);
  if (saved === undefined) { supervisionDigestStats.ownershipCalls++; ownershipDigests.set(value, saved = cachedDigest(value)); }
  return saved;
}
/** Frame rows are replaced, never mutated in place (`apply` builds a new row object for
 * every changed row and the validators only read), so the identity-keyed canonical cache in
 * submissions is exact for them and for freshly parsed journal records. */
const cachedCanonical = canonicalCached, cachedDigest = digestCached;
/** The digest of the sorted entries, built directly from each row's cached canonical bytes:
 * byte-identical to `digest([...frames.entries()].sort(...))` without re-walking throwaway
 * entry arrays for every transaction. */
export const supervisionDigestStats = { frameCalls: 0, frameBytes: 0, ownershipCalls: 0 };
/** Test/diagnostic evidence that the projection digest stays linear: a full journal check
 * may hash the head projection a constant number of times, never once per transaction. */
const frameDigest = (frames: Map<string, Frame>) => { const text = `[${[...frames.entries()].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([k, f]) => `[${JSON.stringify(k)},${cachedCanonical(f)}]`).join(",")}]`; supervisionDigestStats.frameCalls++; supervisionDigestStats.frameBytes += text.length; return createHash("sha256").update(text).digest("hex"); };
/** Incremental whole-projection digest for /2 records: an LtHash-style additive set hash -
 * each frame entry expands to a 128-byte vector and the accumulator adds or subtracts it
 * lane-wise (uint16, modular), bound to the frame count - updated only for the rows a
 * transaction changed. (Plain XOR of SHA-256 would be XHASH, forgeable by linear algebra
 * from ~257 chosen entries; modular addition over the wide vector is not.) Verifying it per
 * transaction pins the replayed projection at every sequence without hashing the whole
 * projection text each time - the /1 `frameDigest` check could only afford stride+head.
 * Frame rows are immutable once built, so entry vectors cache by row identity. */
const PROJECTION_VECTOR_BYTES = 128;
const frameEntryVectors = new WeakMap<object, Buffer>();
function frameEntryVector(k: string, frame: Frame): Buffer {
  let saved = frameEntryVectors.get(frame);
  if (!saved) {
    const segment = `[${JSON.stringify(k)},${cachedCanonical(frame)}]`, parts: Buffer[] = [];
    for (let counter = 0; parts.length * 32 < PROJECTION_VECTOR_BYTES; counter++) parts.push(createHash("sha256").update(`${segment}#${counter}`).digest());
    frameEntryVectors.set(frame, saved = Buffer.concat(parts).subarray(0, PROJECTION_VECTOR_BYTES));
  }
  return saved;
}
type ProjectionAcc = { vector: Buffer; count: number };
const emptyProjectionAcc = (): ProjectionAcc => ({ vector: Buffer.alloc(PROJECTION_VECTOR_BYTES), count: 0 });
const projectionSetHash = (acc: ProjectionAcc) => digest({ format: "firstmate.supervision-projection-set/1", count: acc.count, vector: acc.vector.toString("hex") });
/** The set accumulator over a whole frame map (addition is order-independent). */
function projectionAccOf(frames: Map<string, Frame>): ProjectionAcc {
  const vector = Buffer.alloc(PROJECTION_VECTOR_BYTES);
  for (const [k, frame] of frames) {
    const entry = frameEntryVector(k, frame);
    for (let lane = 0; lane < PROJECTION_VECTOR_BYTES / 2; lane++) vector.writeUInt16LE((vector.readUInt16LE(lane * 2) + entry.readUInt16LE(lane * 2)) & 0xffff, lane * 2);
  }
  return { vector, count: frames.size };
}
function advanceProjection(acc: ProjectionAcc, before: Map<string, Frame>, after: Map<string, Frame>, changes: SupervisionExpected[]): ProjectionAcc {
  const vector = Buffer.from(acc.vector);
  const add = (entry: Buffer, sign: 1 | -1) => { for (let lane = 0; lane < PROJECTION_VECTOR_BYTES / 2; lane++) vector.writeUInt16LE((vector.readUInt16LE(lane * 2) + sign * entry.readUInt16LE(lane * 2)) & 0xffff, lane * 2); };
  for (const change of changes) {
    const k = key(change.kind, change.id), old = before.get(k), next = after.get(k);
    if (old) add(frameEntryVector(k, old), -1);
    if (next) add(frameEntryVector(k, next), 1);
  }
  return { vector, count: after.size };
}
/** The ownership contribution of one frame, or null for kinds ownership() does not retain. */
function ownershipEntry(frame: Frame): OwnershipEntry | null {
  switch (frame.kind) {
    case "scope": return { kind: "scope", id: (frame.value as { id: string }).id };
    case "task": return { kind: "task", value: frame.value as z.infer<typeof SupervisionTaskSchema> };
    case "attempt": return { kind: "attempt", value: frame.value as z.infer<typeof SupervisionAttemptSchema> };
    case "effect": return { kind: "effect", value: frame.value as z.infer<typeof SupervisionEffectSchema> };
    case "backend": return { kind: "backend", value: frame.value as z.infer<typeof SupervisionBackendSchema> };
    case "workflow": { const w = frame.value as WorkflowRow; return { kind: "workflow", value: { plan: w.plan.definition.id, inventory: w.inventory } }; }
    case "retirement": { const r = (frame.value as { receipt: z.infer<typeof RetirementSchema> }).receipt; return { kind: "retirement", value: { plan: r.plan, inventory: r.inventory } }; }
    default: return null;
  }
}
function ownershipDeltaFor(changes: SupervisionExpected[], after: Map<string, Frame>, reset: boolean): OwnershipDelta {
  if (reset) return { reset: true, entries: [...after.values()].flatMap(frame => { const entry = ownershipEntry(frame); return entry ? [entry] : []; }) };
  return { reset: false, entries: changes.flatMap(change => { const frame = after.get(key(change.kind, change.id)); const entry = frame ? ownershipEntry(frame) : null; return entry ? [entry] : []; }) };
}
/** Cumulative ownership rebuilt from /2 deltas. Per-kind ordered maps mirror ownership()'s
 * frame-order grouping exactly: Map.set keeps a replaced row at its first position and appends
 * new rows in entry order, as the frame map does. Frames are never deleted, so deltas need no
 * removals; the recorded full digest verifies every reconstruction. */
type OwnershipAcc = { scopes: Map<string, true>; tasks: Map<string, OwnershipEntry & { kind: "task" }>; attempts: Map<string, OwnershipEntry & { kind: "attempt" }>;
  effects: Map<string, OwnershipEntry & { kind: "effect" }>; backends: Map<string, OwnershipEntry & { kind: "backend" }>;
  workflows: Map<string, { plan: string; inventory: WorkflowOwnership }>; retirements: Map<string, { plan: string; inventory: WorkflowOwnership }> };
const emptyOwnershipAcc = (): OwnershipAcc => ({ scopes: new Map(), tasks: new Map(), attempts: new Map(), effects: new Map(), backends: new Map(), workflows: new Map(), retirements: new Map() });
function applyOwnershipDelta(acc: OwnershipAcc, delta: OwnershipDelta): void {
  if (delta.reset) { const fresh = emptyOwnershipAcc(); acc.scopes = fresh.scopes; acc.tasks = fresh.tasks; acc.attempts = fresh.attempts; acc.effects = fresh.effects; acc.backends = fresh.backends; acc.workflows = fresh.workflows; acc.retirements = fresh.retirements; }
  for (const entry of delta.entries) {
    if (entry.kind === "scope") acc.scopes.set(entry.id, true);
    else if (entry.kind === "task") acc.tasks.set(entry.value.id, entry);
    else if (entry.kind === "attempt") acc.attempts.set(entry.value.id, entry);
    else if (entry.kind === "effect") acc.effects.set(entry.value.id, entry);
    else if (entry.kind === "backend") acc.backends.set(entry.value.planId, entry);
    else if (entry.kind === "workflow") acc.workflows.set(entry.value.plan, entry.value);
    else acc.retirements.set(entry.value.plan, entry.value);
  }
}
const cloneOwnershipAcc = (acc: OwnershipAcc): OwnershipAcc => ({ scopes: new Map(acc.scopes), tasks: new Map(acc.tasks), attempts: new Map(acc.attempts),
  effects: new Map(acc.effects), backends: new Map(acc.backends), workflows: new Map(acc.workflows), retirements: new Map(acc.retirements) });
function buildOwnership(acc: OwnershipAcc): z.infer<typeof OwnershipSchema> {
  return { scopes: [...acc.scopes.keys()], tasks: [...acc.tasks.values()].map(e => e.value), attempts: [...acc.attempts.values()].map(e => e.value),
    effects: [...acc.effects.values()].map(e => e.value), backends: [...acc.backends.values()].map(e => e.value),
    workflows: [...acc.workflows.values(), ...acc.retirements.values()] };
}
/** Exact seed from replayed frames: each frame's kind says whether its contribution is a
 * workflow or a retirement entry. (Seeding from a /1 capsule alone must guess that a plan's
 * second entry is its retirement - wrong for a retired plan with no workflow row, which then
 * rebuilds in the wrong order once another workflow appears. Frames are authoritative.) */
function ownershipAccFromFrames(frames: Map<string, Frame>): OwnershipAcc {
  const acc = emptyOwnershipAcc();
  applyOwnershipDelta(acc, ownershipDeltaFor([], frames, true));
  return acc;
}
function ownershipAccFrom(full: z.infer<typeof OwnershipSchema>): OwnershipAcc {
  const acc = emptyOwnershipAcc();
  for (const id of full.scopes) acc.scopes.set(id, true);
  for (const value of full.tasks) acc.tasks.set(value.id, { kind: "task", value });
  for (const value of full.attempts) acc.attempts.set(value.id, { kind: "attempt", value });
  for (const value of full.effects) acc.effects.set(value.id, { kind: "effect", value });
  for (const value of full.backends) acc.backends.set(value.planId, { kind: "backend", value });
  // A plan's second entry in a /1 capsule is its retirement contribution (workflow rows first).
  for (const entry of full.workflows) (acc.workflows.has(entry.plan) ? acc.retirements : acc.workflows).set(entry.plan, entry);
  return acc;
}
const anchorOwnershipDigest = (anchor: AnyAnchor, rawOwnership?: z.infer<typeof OwnershipSchema>) =>
  isAnchor2(anchor) ? anchor.ownershipDigest : ownershipDigest(rawOwnership ?? anchor.ownership);
/** Reset anchors restart delta reconstruction from a full entry list, bounding what one damaged
 * anchor can lose from the fallback capsule collection to less than one journal page. */
const anchorReset = (sequence: number) => (sequence - 1) % 256 === 0;
const publicationFormat = (version: 1 | 2) => version === 2 ? "firstmate.supervision-publication/2" as const : "firstmate.supervision-publication/1" as const;
const anchorVersion = (anchor: AnyAnchor): 1 | 2 => isAnchor2(anchor) ? 2 : 1;
const emptyFrameDigest = frameDigest(new Map());
/** One sequence's replacement anchors as a migration audit computes them from replay. */
type AnchorPlanEntry = { sequence: number; oldTipHash: string; oldPublicationHash: string; nextTip: Anchor2; nextPublication: Anchor2 };

/** The immutable part of a disposition; the migration's inventory hash binds exactly these. */
export function dispositionIdentity(d: LegacyDeliveryDisposition) {
  return { id: d.id, source: d.source, original: d.original, payloadHash: d.payloadHash, resolution: d.resolution,
    imperative: d.imperative, sourceTip: d.sourceTip, observed: d.observed, delivery: d.delivery, claimId: d.claimId };
}
export const inventoryHash = (rows: LegacyDeliveryDisposition[]) => digest(rows.map(dispositionIdentity));
function checkMigrationChange(next: MigrationReceipt, old: MigrationReceipt | undefined): void {
  if (!old) { if (next.state !== "prepared" || next.version !== 1) fail("CONFLICT", "A migration starts prepared."); return; }
  const fixed = (m: MigrationReceipt) => ({ ...m, version: 0, state: null, inventory: null, sidecars: { freeze: m.sidecars.freeze }, aborted: null });
  const order = ["prepared", "barrier", "committed"];
  // Abort is a recorded release from prepared or barrier only; committed and aborted are terminal.
  const aborting = next.state === "aborted" && ["prepared", "barrier"].includes(old.state) && !!next.aborted && digest(old.inventory) === digest(next.inventory);
  if (!aborting && (next.state === "aborted" || old.aborted || next.aborted)) fail("HELD", "Only a prepared or barrier migration can be released, once, with its record.");
  if (digest(fixed(old)) !== digest(fixed(next)) || (!aborting && order.indexOf(next.state) < order.indexOf(old.state)) || ["committed", "aborted"].includes(old.state) ||
    (old.state !== "prepared" && digest(old.inventory) !== digest(next.inventory)) || (old.sidecars.prepared && old.sidecars.prepared !== next.sidecars.prepared) ||
    old.inventory.dispositionIds.some(id => !next.inventory.dispositionIds.includes(id)))
    fail("HELD", "Migration identity, source, imported index and inventory are immutable; cutover only moves forward.");
}
function checkDispositionChange(next: LegacyDeliveryDisposition, old: LegacyDeliveryDisposition | undefined): void {
  if (!old) { if (next.version !== 1 || next.resolvedBy || next.receipts.ack) fail("CONFLICT", "A disposition starts unresolved and unacknowledged."); return; }
  const removalOrder = ["pending", "mismatch", "removed", "absent", "drained", "not-queued"];
  if (digest(dispositionIdentity(old)) !== digest(dispositionIdentity(next)) || old.migrationId !== next.migrationId ||
    old.scopeId !== next.scopeId || old.planId !== next.planId || digest(old.destination?.consequenceId ?? null) !== digest(next.destination?.consequenceId ?? null) ||
    (old.destination?.outboxId && old.destination.outboxId !== next.destination?.outboxId) ||
    (Object.keys(old.receipts) as (keyof typeof old.receipts)[]).some(k => old.receipts[k] !== null && old.receipts[k] !== next.receipts[k]) ||
    (!["pending", "mismatch"].includes(old.removal.state) && digest(old.removal) !== digest(next.removal) &&
      !(old.removal.receipt === null && old.removal.state === next.removal.state)) ||
    removalOrder.indexOf(next.removal.state) < removalOrder.indexOf(old.removal.state)) fail("HELD", "Disposition identity, delivery history and receipts are retained.");
  if (old.route !== next.route) {
    // Only an explicit, evidence-bound resolution moves a hold; a removal mismatch may only become a hold.
    const resolved = old.route === "hold" && ["drain-legacy", "already-handled"].includes(next.route) && next.resolvedBy?.previousRoute === "hold";
    const mismatched = next.route === "hold" && next.removal.state === "mismatch";
    if (!resolved && !mismatched) fail("HELD", "A disposition route changes only by explicit evidence-bound resolution; uncertain imperatives are never replayed.");
  } else if (digest(old.resolvedBy) !== digest(next.resolvedBy)) fail("HELD", "A resolution is immutable.");
}

export class SupervisionStore {
  readonly homeId: string;
  readonly root: string;
  private coordinator: Coordinator | null = null;
  private capacity: Capacity | null = null;
  private cached: CachedScan | null = null;
  private migrating: Promise<{ migrated: number; sequence: number; held: boolean }> | null = null;
  private projectionCacheWritten = -1;
  private projectionCacheTried = false;
  private coldCacheTail = false;

  private cacheServed: { sequence: number; hash: string | null; prefixDigest: string; projection: string;
    transactionsDigest: string; ownershipDigest: string; framesDigest: string } | null = null;
  private shared: { epoch: number; scan: Promise<Scan> } | null = null;
  // Single-entry memos for the read path, keyed on scan identity (below). Scans are immutable
  // once validated — rows and their Maps are replaced, never mutated in place (see apply()) —
  // and every write publishes a fresh Scan, so identity plus the guarded content refs below
  // can never serve a status older than the scan it was built from. The lengths additionally
  // guard the one in-place change: scanFull's failure path retains into the same ownership list.
  private statusMemo: { scan: Scan; capacityHash: string | null; frames: Scan["frames"]; transactions: Scan["transactions"];
    ownership: Scan["ownership"]; problems: number; bytes: number; status: SupervisionStatus } | null = null;
  private projectionSizeMemo: { snapshot: object; capacityHash: string | null; frames: Scan["frames"]; framesSize: number;
    ownership: Scan["ownership"]; ownershipLength: number; transactions: Scan["transactions"] | undefined; transactionsLength: number; size: number } | null = null;
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
  private async reading<T>(work: () => Promise<T>, settle?: { afterMs: number; committed: (result: T) => boolean }): Promise<T> {
    // A prepare callback reads within its own transaction. Other reads wait for active
    // publication, but never acquire the writer lock. If a writer overlaps the read,
    // discard that result (including a transient hold) and check the new checkpoint.
    if (storeLocks.getStore()?.get(this.root)?.active) return work();
    const publication = publicationFor(this.root), started = performance.now();
    for (;;) {
      if (publication.active) { await publication.active; continue; }
      const epoch = publication.epoch;
      let result: T | undefined, error: unknown, failed = false;
      try { result = await work(); } catch (cause) { error = cause; failed = true; }
      if (publication.active || publication.epoch !== epoch) {
        // Back-to-back writes (a launch) would otherwise hold a status poll for their whole run.
        // Past its budget, a display read may serve its own result if it validated against a
        // published checkpoint: an earlier committed head, never a staging-window hold.
        if (settle && !failed && performance.now() - started >= settle.afterMs && settle.committed(result as T)) return result as T;
        continue;
      }
      if (failed) throw error;
      return result as T;
    }
  }
  private writable(): void { if (!this.options.writable) fail("UNSUPPORTED", "Scoped supervision writes are disabled."); }
  private file(sequence: number, suffix: string) {
    return join(this.root, "transactions", ...(sequence > 256 ? [pad(Math.floor((sequence - 1) / 256))] : []), `${pad(sequence)}.${suffix}.json`);
  }
  private projectionSize(snapshot: Pick<Scan, "frames" | "ownership"> & Partial<Pick<Scan, "transactions">>) {
    const capacityHash = this.capacity?.hash ?? null, memo = this.projectionSizeMemo;
    if (memo && memo.snapshot === snapshot && memo.capacityHash === capacityHash && memo.frames === snapshot.frames &&
      memo.framesSize === snapshot.frames.size && memo.ownership === snapshot.ownership && memo.ownershipLength === snapshot.ownership.length &&
      memo.transactions === snapshot.transactions && memo.transactionsLength === (snapshot.transactions?.length ?? -1)) return memo.size;
    const size = Buffer.byteLength(canonical({ frames: [...snapshot.frames], ownership: snapshot.ownership,
      ...(this.capacity ? { historyIndex: snapshot.transactions ?? [] } : {}) }));
    this.projectionSizeMemo = { snapshot, capacityHash, frames: snapshot.frames, framesSize: snapshot.frames.size,
      ownership: snapshot.ownership, ownershipLength: snapshot.ownership.length, transactions: snapshot.transactions, transactionsLength: snapshot.transactions?.length ?? -1, size };
    return size;
  }
  private obligations(snapshot: Scan) {
    return [...snapshot.frames.values()].filter(f => f.kind === "effect" && ["reserved", "dispatching", "accepted", "uncertain"].includes((f.value as { state: string }).state) ||
      f.kind === "migration" && ["prepared", "barrier"].includes((f.value as { state: string }).state)).length;
  }
  private capacityPressure(snapshot: Scan) { return this.capacity ? pressure(this.capacity, snapshot.bytes, this.projectionSize(snapshot), this.obligations(snapshot)) : undefined; }
  private journalLimit() { return Math.min(this.capacity?.journalBytes ?? 100 * 1024 * 1024, this.options.maxJournalBytes ?? Number.MAX_SAFE_INTEGER); }
  /** Explicit upgrade under the existing coordinator. Retains every original byte and global sequence. */
  async enableLongLived(limits = DEFAULT_CAPACITY): Promise<void> {
    this.writable();
    await this.locked(async () => {
      await this.assertCoordinator(); const snapshot = await this.scan();
      if (snapshot.problems.length) fail("HELD", snapshot.problems.join(" "));
      if (this.capacity) return;
      const receipt = CapacitySchema.parse(hashed({ format: "firstmate.supervision-capacity/1", homeId: this.homeId,
        baseSequence: snapshot.sequence, baseHash: snapshot.hash, ...limits }));
      await this.publish(join(this.root, "capacity.json"), receipt, "capacity");
      this.capacity = receipt; this.cached = null;
    });
  }
  private async replaceFile(path: string, value: unknown): Promise<void> {
    const temporary = `${path}.${randomUUID()}.tmp`;
    try {
      const file = await open(temporary, "wx", 0o600);
      try { await file.writeFile(`${canonical(value)}\n`); await file.sync(); }
      finally { await file.close(); }
      // Windows intermittently refuses a rename over a just-read file (EPERM from a lagging
      // close or indexer); the replacement is idempotent, so retry briefly before failing.
      for (let attempt = 0; ; attempt++) {
        try { await rename(temporary, path); break; }
        catch (error) {
          if (!["EPERM", "EBUSY", "EACCES"].includes(String((error as NodeJS.ErrnoException).code)) || attempt >= 39) throw error;
          await new Promise(resolve => setTimeout(resolve, 25 * Math.min(attempt + 1, 8)));
        }
      }
    } finally { await rm(temporary, { force: true }); }
  }
  private async readAnchorMigration(): Promise<AnchorMigration | null> {
    try {
      const receipt = verifyHash(AnchorMigrationSchema.parse(await readCanonical(join(this.root, "anchor-migration.json"))));
      if (receipt.homeId !== this.homeId) fail("HELD", "Anchor migration receipt belongs to another home.");
      return receipt;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
  }
  /** One-time in-place anchor format upgrade under the coordinator: /1 anchors embed the whole
   * retained ownership (365 MB of the owner's 372 MB journal); /2 anchors carry only its delta
   * and digest. Safe migration, in order: a full audit first (including every /1 projection
   * hash, the one-time expensive check), a published receipt binding the old and new anchor
   * hash lists and prefix digests to the unchanged event head, atomic per-file replacement,
   * then the derived checkpoint rebuilt over the new prefix. Events are never rewritten and
   * no receipt or transaction hash changes. Interruption at any point leaves a readable mixed
   * journal and a stale checkpoint: calling this again verifies every file against the receipt
   * and replaces only what remains. A journal whose audit fails is left byte-for-byte intact.
   * Runs automatically on the runtime's first writer after upgrade; journal-state problems
   * report `held` instead of throwing so ordinary held handling still applies. */
  private async readAnchorRollback(): Promise<AnchorRollback | null> {
    try {
      const plan = verifyHash(AnchorRollbackSchema.parse(await readCanonical(join(this.root, "anchor-rollback.json"))));
      if (plan.homeId !== this.homeId) fail("HELD", "Anchor rollback receipt belongs to another home.");
      return plan;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
  }
  private rollbackStagePath(sequence: number, kind: "event" | "tip" | "publication"): string {
    return join(this.root, "anchor-rollback-staging", this.file(sequence, kind).slice(join(this.root, "transactions").length + 1));
  }
  private backupPath(sequence: number, kind: "tip" | "publication"): string {
    return join(this.root, "anchor-backup", this.file(sequence, kind).slice(join(this.root, "transactions").length + 1));
  }
  /** Keep the /1 original of an anchor about to be replaced, content-published beside the
   * journal (never inside transactions/, whose names are authority). Once present a backup
   * is never overwritten: a resume must not back up a /2 replacement as if it were the original. */
  private async backupAnchor(sequence: number, kind: "tip" | "publication"): Promise<void> {
    const target = this.backupPath(sequence, kind);
    try { await stat(target); return; } catch { /* not yet backed up */ }
    await mkdir(dirname(target), { recursive: true });
    const bytes = await readFile(this.file(sequence, kind));
    for (let attempt = 0; ; attempt++) {
      try { await publishBytes(target, bytes); return; }
      catch (error) {
        const code = String((error as NodeJS.ErrnoException).code);
        if (code === "EEXIST") return;
        if (!["EPERM", "EBUSY", "EACCES"].includes(code) || attempt >= 39) throw error;
        await new Promise(resolve => setTimeout(resolve, 25 * Math.min(attempt + 1, 8)));
      }
    }
  }
  async migrateAnchors(): Promise<{ migrated: number; sequence: number; held: boolean }> {
    this.writable();
    if (this.migrating) return this.migrating;
    const work = this.migrateAnchorsOnce();
    this.migrating = work;
    try { return await work; } finally { if (this.migrating === work) this.migrating = null; }
  }
  /** One-time in-place anchor format upgrade: /1 anchors embed the whole retained ownership
   * (365 MB of the owner's 372 MB journal); /2 anchors carry only its delta and digest.
   * Safety, in order: an unlocked full audit first (including every /1 projection hash, the
   * one-time expensive check) while reads and writes still serve the old form; then, under
   * the store lock in bounded chunks (reads interleave between chunks instead of freezing),
   * a published receipt binding the old and new anchor hash lists and prefix digests to the
   * event head, a byte copy of each /1 original under anchor-backup/, atomic per-file
   * replacement, and finally the derived checkpoint rebuilt over the new prefix. Events are
   * never rewritten and no receipt or transaction hash changes. Interruption at any point
   * leaves a readable mixed journal; a later call verifies every file against the receipt
   * and replaces only what remains, including when new transactions landed after the receipt
   * (the receipt then binds the prefix it recorded and the checkpoint is rebuilt over the
   * current head). A failure mid-replacement reports held instead of throwing, so the caller
   * keeps a usable held journal and a later writer retries; a journal whose audit fails is
   * left byte-for-byte intact. Runs on the runtime's first writer after upgrade (and before
   * its coordinator claim when a receipt says a previous attempt was interrupted, since the
   * resulting stale checkpoint is what blocks claiming). */
  /** A migration receipt whose /1 backups are still on disk: the rollback window is open. */
  private async anchorBackupRetained(): Promise<boolean> {
    try {
      if (!(await this.readAnchorMigration().catch(() => null))) return false;
      await stat(join(this.root, "anchor-backup"));
      return true;
    } catch { return false; }
  }
  private async migrateAnchorsOnce(): Promise<{ migrated: number; sequence: number; held: boolean }> {
    let receipt: AnchorMigration | null;
    try { receipt = await this.readAnchorMigration(); }
    catch { return { migrated: 0, sequence: this.cached?.scan.sequence ?? 0, held: true }; }
    if (!this.coordinator && !receipt) return { migrated: 0, sequence: this.cached?.scan.sequence ?? 0, held: false };
    if (this.coordinator) await this.assertCoordinator();
    if (receipt && this.coordinator && Date.now() - Date.parse(receipt.createdAt) > ANCHOR_BACKUP_TTL_MS && await this.anchorBackupRetained()) {
      // Automatic expiry: a verified journal a week past migration no longer keeps the
      // journal-sized /1 backup (or the downgrade it enables). discardAnchorBackup stays
      // the deliberate early path. Anything short of a clean full audit keeps the backup.
      const audited = await this.scanFull({ verifyAllProjections: true });
      if (!audited.problems.length && !audited.legacyAnchors && audited.transactions[receipt.sequence - 1]?.hash === receipt.headHash) {
        await rm(join(this.root, "anchor-migration.json"), { force: true });
        await rm(join(this.root, "anchor-backup"), { recursive: true, force: true });
        receipt = null;
      }
    }
    if (this.cached && !this.cached.scan.problems.length && this.cached.scan.legacyAnchors === 0)
      return { migrated: 0, sequence: this.cached.scan.sequence, held: false };
    const current = await this.scan();
    if (!current.initialized || !current.sequence) return { migrated: 0, sequence: current.sequence, held: false };
    // Journal problems with nothing to migrate (no receipt, no legacy anchors) are not a
    // migration failure: the ordinary held/recovery machinery owns them, and writer creation
    // must not strand crash recovery by treating them as an unfinished upgrade.
    if (current.problems.length && !receipt) return { migrated: 0, sequence: current.sequence, held: current.legacyAnchors > 0 };
    if (!current.legacyAnchors && !current.problems.length) {
      // Completed (possibly long ago and since grown): the checked scan already validated the
      // checkpoint over the current anchors; verify the receipt still binds its head.
      if (receipt && current.transactions[receipt.sequence - 1]?.hash !== receipt.headHash)
        return { migrated: 0, sequence: current.sequence, held: true };
      return { migrated: 0, sequence: current.sequence, held: false };
    }
    // The audit is read-only and runs unlocked: the journal keeps serving its old form while
    // every /1 projection hash is verified and every replacement anchor is computed.
    const anchorPlan: AnchorPlanEntry[] = [];
    const snapshot = await this.scanFull({ verifyAllProjections: true, anchorPlan });
    if (!snapshot.initialized || !snapshot.sequence) return { migrated: 0, sequence: snapshot.sequence, held: false };
    if (snapshot.problems.length) return { migrated: 0, sequence: snapshot.sequence, held: true };
    let newPrefixDigest = emptyPrefix, receiptPrefixDigest = emptyPrefix;
    for (const entry of anchorPlan) {
      newPrefixDigest = extendPrefix(newPrefixDigest, { sequence: entry.sequence, hash: entry.nextTip.transactionHash }, entry.nextTip, entry.nextPublication);
      if (receipt && entry.sequence <= receipt.sequence) receiptPrefixDigest = newPrefixDigest;
    }
    if (receipt) {
      const bound = receipt.sequence <= snapshot.sequence && snapshot.transactions[receipt.sequence - 1]?.hash === receipt.headHash &&
        receiptPrefixDigest === receipt.newPrefixDigest && receipt.next.length === receipt.sequence &&
        receipt.next.every((row, i) => anchorPlan[i]?.nextTip.hash === row.tip && anchorPlan[i]?.nextPublication.hash === row.publication) &&
        anchorPlan.slice(0, receipt.sequence).every((entry, i) => [entry.oldTipHash, entry.oldPublicationHash].every((hash, side) =>
          hash === (side ? receipt!.next[i]!.publication : receipt!.next[i]!.tip) || hash === (side ? receipt!.old[i]!.publication : receipt!.old[i]!.tip)));
      if (!bound) return { migrated: 0, sequence: snapshot.sequence, held: true };
    } else {
      // Fresh migration: the audited snapshot must still be the checkpoint's head, exactly as
      // a checked scan requires, or a concurrent writer moved history under the audit.
      try {
        const checkpoint = verifyHash(CheckpointSchema.parse(await readCanonical(join(this.root, "checkpoint.json"))));
        if (digest(checkpoint) !== digest(await this.checkpointFor(snapshot))) return { migrated: 0, sequence: snapshot.sequence, held: false };
      } catch { return { migrated: 0, sequence: snapshot.sequence, held: true }; }
      receipt = AnchorMigrationSchema.parse(hashed({ format: "firstmate.supervision-anchor-migration/1" as const, homeId: this.homeId,
        createdAt: new Date().toISOString(),
        sequence: snapshot.sequence, headHash: snapshot.hash!, oldPrefixDigest: snapshot.prefixDigest, newPrefixDigest,
        old: anchorPlan.map(entry => ({ sequence: entry.sequence, tip: entry.oldTipHash, publication: entry.oldPublicationHash })),
        next: anchorPlan.map(entry => ({ sequence: entry.sequence, tip: entry.nextTip.hash, publication: entry.nextPublication.hash })) }));
    }
    const headMoved = async (): Promise<boolean> => {
      try { await stat(this.file(snapshot.sequence + 1, "event")); return true; } catch { /* no newer event */ }
      try { return verifyHash(TransactionSchema.parse(await readCanonical(this.file(snapshot.sequence, "event")))).hash !== snapshot.hash; }
      catch { return true; }
    };
    let migrated = 0, bytes = snapshot.bytes, published = false;
    try {
      for (let at = 0; at < anchorPlan.length; at += 128) {
        const chunk = anchorPlan.slice(at, at + 128);
        const moved = await this.locked(async () => {
          if (this.coordinator) await this.assertCoordinator();
          if (await headMoved()) return true;
          if (!published) {
            if (!(await this.readAnchorMigration().catch(() => null))) await this.publish(join(this.root, "anchor-migration.json"), receipt!, "anchor-migration");
            published = true;
          }
          for (const entry of chunk) {
            for (const [kind, next, currentHash] of [["tip", entry.nextTip, entry.oldTipHash], ["publication", entry.nextPublication, entry.oldPublicationHash]] as const) {
              if (next.hash === currentHash) continue;
              const path = this.file(entry.sequence, kind);
              await this.backupAnchor(entry.sequence, kind);
              bytes += Buffer.byteLength(`${canonical(next)}\n`) - (await stat(path)).size;
              await this.replaceFile(path, next); migrated++;
              await this.boundary("anchor-migration:replaced");
            }
          }
          return false;
        });
        if (moved) return { migrated, sequence: snapshot.sequence, held: false };
      }
      await this.locked(async () => {
        if (this.coordinator) await this.assertCoordinator();
        if (await headMoved()) return;
        const next = { ...snapshot, prefixDigest: newPrefixDigest, legacyAnchors: 0, bytes };
        // Skip the checkpoint rewrite when it is already exactly this checkpoint: a completed
        // migration must not rewrite derived state on every later writer start.
        const existing = await readCanonical(join(this.root, "checkpoint.json")).catch(() => null);
        if (migrated || !existing || digest(existing) !== digest(await this.checkpointFor(next))) await this.saveCheckpoint(next);
        else await this.cache(next, verifyHash(CheckpointSchema.parse(existing)), await this.directories());
        // The first restart after migration must not pay a full check: write the restart
        // cache over the new checkpoint and anchors (the claim-time cache binds the old ones).
        await this.writeProjectionCache(next, await this.checkpointFor(next), await this.directories(), true);
      });
    } catch {
      // Replacement or publication failed midway: the mixed journal and its receipt are the
      // resumable state. Report held; never strand the caller with a thrown upgrade.
      return { migrated, sequence: snapshot.sequence, held: true };
    }
    return { migrated, sequence: snapshot.sequence, held: false };
  }
  /** Supported way back to an older plugin: restore the backed-up /1 anchors over the
   * migrated prefix, CONVERT the post-migration tail (events and anchors rewritten in /1
   * form, whole ownership re-derived from replay - an older plugin cannot read /2 events),
   * remove every /2 trace (receipt, backups, restart cache), then rebuild the checkpoint.
   * Bodies and request identities never change; converted transaction hashes do, so
   * receipts already issued for converted transactions stop matching the journal - the
   * deliberate, reported cost of a downgrade (`converted` in the result).
   * Crash-safety: every replacement file is staged under anchor-rollback-staging/ and a
   * conversion receipt (anchor-rollback.json) recording each file's before/after hash is
   * published BEFORE any swap. An interrupted rollback resumes from that receipt: files
   * already swapped verify as their "after" hash, the rest swap from staging, and any
   * other content holds the operation instead of guessing. */
  async rollbackAnchors(): Promise<{ restored: number; sequence: number; converted: number }> {
    this.writable();
    return this.locked(async () => {
      let plan = await this.readAnchorRollback();
      const receipt = await this.readAnchorMigration();
      // A surviving conversion receipt is enough to finish: cleanup deletes the
      // migration receipt before it, so a crash there must not strand the journal.
      if (!plan && !receipt) fail("HELD", "No anchor migration receipt; nothing to roll back.");
      // A fresh rollback needs the coordinator; resuming an interrupted one must not:
      // mid-swap the checkpoint is stale, so no claim could ever be taken to finish it
      // (the same reason migration resume runs pre-claim).
      if (!plan || this.coordinator) await this.assertCoordinator();
      if (plan && receipt && plan.migrationSequence !== receipt.sequence)
        fail("HELD", "Anchor rollback receipt does not bind this migration; reconcile deliberately.");
      if (!plan) {
        if (!receipt) fail("HELD", "No anchor migration receipt; nothing to roll back.");
        const snapshot = await this.scanFull();
        if (snapshot.problems.length) fail("HELD", `Anchor rollback needs a validated journal first: ${snapshot.problems.join(" | ")}`);
        if (snapshot.transactions[receipt!.sequence - 1]?.hash !== receipt!.headHash)
          fail("HELD", "History moved at the migration point; anchor rollback is refused.");
        const staged: AnchorRollback["files"] = [];
        await rm(join(this.root, "anchor-rollback-staging"), { recursive: true, force: true });
        const stage = async (sequence: number, kind: "event" | "tip" | "publication", before: string, value: { hash: string }) => {
          const target = this.rollbackStagePath(sequence, kind);
          await mkdir(dirname(target), { recursive: true });
          await this.publish(target, value, "anchor-rollback-stage");
          staged.push({ sequence, kind, before, after: value.hash });
        };
        for (const row of receipt.old) {
          for (const [kind, expected] of [["tip", row.tip], ["publication", row.publication]] as const) {
            const currentFile = verifyHash(AnyAnchorSchema.parse(await readCanonical(this.file(row.sequence, kind))));
            if (currentFile.hash === expected) continue; // never replaced (interrupted migration): no backup needed
            const backup = verifyHash(AnyAnchorSchema.parse(await readCanonical(this.backupPath(row.sequence, kind))));
            if (backup.hash !== expected) fail("HELD", `Anchor backup ${row.sequence}.${kind} does not match the migration receipt.`);
            await stage(row.sequence, kind, currentFile.hash, backup);
          }
        }
        if (snapshot.sequence > receipt.sequence) {
          let frames = new Map<string, Frame>(), previous: string | null = null;
          for (let seq = 1; seq <= snapshot.sequence; seq++) {
            const event = verifyHash(TransactionSchema.parse(await readCanonical(this.file(seq, "event"))));
            frames = this.apply(frames, event.body).frames;
            if (seq <= receipt.sequence || !event.format.endsWith("/2")) { previous = event.hash; continue; }
            const convertedEvent: Transaction = hashed({ format: "firstmate.supervision-transaction/1" as const, homeId: this.homeId,
              sequence: seq, previous, generation: event.generation, coordinatorHash: event.coordinatorHash,
              requestId: event.requestId, requestHash: event.requestHash, at: event.at, body: event.body,
              changes: event.changes, projectionHash: frameDigest(frames), outbox: event.outbox });
            const capsuleBase = { homeId: this.homeId, sequence: seq, previous, transactionHash: convertedEvent.hash,
              requestId: event.requestId, requestHash: event.requestHash, generation: event.generation };
            const own = ownership(frames);
            const tipNow = verifyHash(AnyAnchorSchema.parse(await readCanonical(this.file(seq, "tip"))));
            const pubNow = verifyHash(AnyAnchorSchema.parse(await readCanonical(this.file(seq, "publication"))));
            await stage(seq, "event", event.hash, convertedEvent);
            await stage(seq, "tip", tipNow.hash, hashed({ format: "firstmate.supervision-tip/1" as const, ...capsuleBase, ownership: own }));
            await stage(seq, "publication", pubNow.hash, hashed({ format: "firstmate.supervision-publication/1" as const, ...capsuleBase, ownership: own }));
            previous = convertedEvent.hash;
          }
        }
        plan = AnchorRollbackSchema.parse(hashed({ format: "firstmate.supervision-anchor-rollback/1" as const, homeId: this.homeId,
          migrationSequence: receipt.sequence, headSequence: snapshot.sequence, oldPrefixDigest: receipt.oldPrefixDigest, createdAt: new Date().toISOString(), files: staged }));
        await this.publish(join(this.root, "anchor-rollback.json"), plan, "anchor-rollback");
      } else {
        // Resume: the journal must not have grown past the planned head meanwhile.
        const files = await this.transactionFiles();
        const head = files.reduce((max, name) => Math.max(max, Number(basename(name).slice(0, 12)) || 0), 0);
        if (head !== plan.headSequence) fail("HELD", "Journal grew after an interrupted anchor rollback; reconcile deliberately.");
      }
      // Swap phase: idempotent per file, so an interruption anywhere resumes cleanly.
      for (const file of plan.files) {
        const path = this.file(file.sequence, file.kind);
        const current = verifyHash(JSON.parse(await readFile(path, "utf8")) as { hash: string });
        if (current.hash === file.after) continue;
        if (current.hash !== file.before) fail("HELD", `Anchor rollback found unexpected content at ${file.sequence}.${file.kind}; reconcile deliberately.`);
        const stagedFile = verifyHash(JSON.parse(await readFile(this.rollbackStagePath(file.sequence, file.kind), "utf8")) as { hash: string });
        if (stagedFile.hash !== file.after) fail("HELD", "Anchor rollback staging does not match its receipt.");
        await this.replaceFile(path, stagedFile);
        await this.boundary("anchor-rollback:converted");
      }
      const restored = plan.files.filter(f => f.sequence <= plan.migrationSequence).length;
      const converted = new Set(plan.files.filter(f => f.sequence > plan.migrationSequence).map(f => f.sequence)).size;
      // Write the new checkpoint BEFORE deleting anything, and delete the rollback
      // receipt LAST: a crash anywhere in cleanup then leaves either a journal whose
      // checkpoint already binds the /1 form, or a surviving conversion receipt from
      // which a retry finishes - even if the migration receipt is already gone.
      this.cached = null;
      const restoredScan = await this.scanFull();
      if (restoredScan.problems.length || await this.prefixAt(restoredScan, plan.migrationSequence) !== plan.oldPrefixDigest ||
        restoredScan.transactions.some(t => t.format.endsWith("/2")) || restoredScan.legacyAnchors !== restoredScan.sequence)
        fail("HELD", "Restored anchors do not revalidate against the pre-migration prefix; reconcile deliberately.");
      await this.saveCheckpoint(restoredScan);
      await this.boundary("anchor-rollback:checkpoint");
      await rm(join(this.root, "projection-cache.json"), { force: true });
      await rm(join(this.root, "anchor-backup"), { recursive: true, force: true });
      await rm(join(this.root, "anchor-migration.json"), { force: true });
      await rm(join(this.root, "anchor-rollback-staging"), { recursive: true, force: true });
      await this.boundary("anchor-rollback:cleanup");
      await rm(join(this.root, "anchor-rollback.json"), { force: true });
      return { restored, sequence: restoredScan.sequence, converted };
    });
  }
  /** Drop the /1 backups and the migration receipt once the journal is verified healthy on
   * /2 anchors. This is the point of no return for rollbackAnchors. The backup also
   * expires automatically a week after migration on the next verified writer; this is
   * the deliberate early path. */
  async discardAnchorBackup(): Promise<void> {
    this.writable();
    await this.locked(async () => {
      await this.assertCoordinator();
      const receipt = await this.readAnchorMigration();
      if (!receipt) fail("HELD", "No anchor migration receipt; no backup to discard.");
      const snapshot = await this.scan();
      if (snapshot.problems.length || snapshot.transactions[receipt.sequence - 1]?.hash !== receipt.headHash)
        fail("HELD", "Anchor backup discard needs a verified journal bound to the migration receipt.");
      await rm(join(this.root, "anchor-migration.json"), { force: true });
      await rm(join(this.root, "anchor-backup"), { recursive: true, force: true });
      this.cached = null;
    });
  }
  private async loadCapacity() {
    try {
      const value = verifyHash(CapacitySchema.parse(await readCanonical(join(this.root, "capacity.json"))));
      if (value.homeId !== this.homeId || this.capacity && this.capacity.hash !== value.hash) fail("HELD", "Capacity receipt changed or belongs to another home.");
      this.capacity = value;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      if (this.capacity) fail("HELD", "Capacity receipt was removed; retain history and reconcile.");
    }
  }
  /** At most 256 events in each directory; the original pilot prefix stays byte-for-byte in place. */
  private async transactionFiles(): Promise<string[]> {
    const entries = await readdir(join(this.root, "transactions"), { withFileTypes: true }), files: string[] = [];
    for (const entry of entries) {
      if (!entry.isDirectory()) { files.push(entry.name); continue; }
      if (!this.capacity || !/^\d{12}$/.test(entry.name) || Number(entry.name) < 1) fail("HELD", "Unknown journal page metadata.");
      for (const name of await readdir(join(this.root, "transactions", entry.name))) {
        const sequence = Number(name.slice(0, 12));
        if (!/^\d{12}\.(?:tip|event|publication)\.json(?:\.[0-9a-f-]+\.tmp)?$/.test(name) || Math.floor((sequence - 1) / 256) !== Number(entry.name))
          fail("HELD", "Transaction is outside its journal page.");
        files.push(`${entry.name}/${name}`);
      }
    }
    return files;
  }
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
    const inspect = this.options.processIdentity ?? supervisionProcessIdentity;
    // Probe identities before the publication lock: an OS probe can take seconds on a cold or stalled
    // Windows host, and holding publication.active that long starves every read of this store. The
    // locked claim below re-reads the chain and only uses a result probed for that exact record
    // (matched by hash); anything that changed meanwhile is probed again inside. The exclusive
    // generation publish still arbitrates, so two coordinators remain impossible.
    let probedPrevious: { hash: string; state: ProcessIdentity } | null = null, probedSelf: ProcessIdentity | null = null;
    if (!this.coordinator) {
      let previous: Coordinator | undefined;
      try {
        previous = (await this.coordinators()).at(-1);
        if (previous && !await this.released(previous)) probedPrevious = { hash: previous.hash, state: await inspect(previous.pid) };
      } catch { /* The locked claim re-reads everything and reports the authoritative problem. */ }
      const doomed = previous && probedPrevious && (probedPrevious.state.state === "unknown" ||
        (probedPrevious.state.state === "alive" && probedPrevious.state.start === previous.start));
      if (!doomed) try { probedSelf = await inspect(process.pid); } catch { /* Reprobed inside, where a failure is authoritative. */ }
    }
    return this.locked(async () => {
      const snapshot = await this.scan();
      // A complete pending event can be published by recoverPublication after ownership is acquired.
      if (!snapshot.initialized || snapshot.problems.some(p => p !== "Final transaction awaits publication.")) fail("HELD", snapshot.problems.join(" ") || "Store is not initialized.");
      if (this.coordinator) { await this.assertCoordinator(); return this.coordinator.generation; }
      const previous = snapshot.coordinators.at(-1);
      // `inspect` and the pre-lock probes are set up above, before locked().
      if (previous && !await this.released(previous)) {
        const state = probedPrevious?.hash === previous.hash ? probedPrevious.state : await inspect(previous.pid);
        if (state.state === "unknown" || (state.state === "alive" && state.start === previous.start)) fail("HELD", "The coordinator is alive or its termination is unknown; no timestamp takeover.");
      }
      const self = probedSelf ?? await inspect(process.pid);
      if (self.state !== "alive") fail("UNSUPPORTED", "Cannot verify this process start identity.");
      const record = hashed({ format: "firstmate.supervision-coordinator/1" as const, homeId: this.homeId,
        generation: (previous?.generation ?? 0) + 1, previous: previous?.hash ?? null, pid: process.pid, start: self.start });
      try { await this.publish(join(this.root, "coordinators", `${pad(record.generation)}.json`), record, "coordinator"); }
      catch (error) { if ((error as NodeJS.ErrnoException).code === "EEXIST") fail("CONFLICT", "Another process claimed this coordinator generation; reread without retrying."); throw error; }
      this.coordinator = record;
      // Absorb our own just-published claim into the validated cache: the record's exact
      // contents are known and the exclusive publish just succeeded under this lock, so the
      // next read need not re-validate the whole journal for coordinator metadata it wrote.
      // Snapshot the cache locally: a background audit failing on this same instance can
      // clear this.cached between awaits; a claim must never crash on that race.
      const cachedAtClaim = this.cached;
      if (cachedAtClaim) { const now = await this.directories(); if (this.onlyCoordinatorsMoved(now, cachedAtClaim.directories)) this.cached = { ...cachedAtClaim, scan: { ...cachedAtClaim.scan, coordinators: [...cachedAtClaim.scan.coordinators, record] }, directories: now }; }
      // A freshly claimed writer's validated projection becomes the restart cache once per claim.
      const cachedForCache = this.cached;
      if (cachedForCache) await this.writeProjectionCache(cachedForCache.scan, cachedForCache.checkpoint, cachedForCache.directories);
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
      // Same absorption as the claim above: our own release file's name is now current.
      if (this.cached) { const now = await this.directories(); if (this.onlyCoordinatorsMoved(now, this.cached.directories)) this.cached = { ...this.cached, directories: now }; }
      this.coordinator = null;
    });
  }
  private apply(frames: Map<string, Frame>, body: z.infer<typeof BodySchema>): { frames: Map<string, Frame>; changes: SupervisionExpected[] } {
    // Rows are replaced below, never mutated in place, and every validator only reads rows, so the
    // next projection can share untouched row objects with the previous one. A failure discards
    // `next` with the input map and its rows exactly as they were. (A deep clone of every row per
    // transaction made replay quadratic in journal length without changing any outcome.)
    const next = new Map(frames);
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
        const imported = (old as { migrationId?: string } | undefined)?.migrationId;
        const migration = imported ? next.get(key("migration", imported))?.value as MigrationReceipt | undefined : undefined;
        if (migration && migration.state !== "committed") fail("HELD", "This plan is in a partial cutover; neither backend may write until it commits.");
        if (old?.requests.some(r => r.requestId === mutation.event.requestId)) fail("CONFLICT", "Workflow request already committed; use its original transaction receipt.");
        const plan = replaySupervisionWorkflow(old?.plan ?? null, mutation.event, this.homeId);
        value = { scopeId: mutation.scopeId, plan, inventory: mergeOwnership([...(old ? [old.inventory] : []), planOwnership(plan)]),
          ...(imported ? { migrationId: imported } : {}),
          requests: [...(old?.requests ?? []), { requestId: mutation.event.requestId, requestHash: mutation.event.requestHash, eventHash: mutation.event.hash }] };
      } else if (mutation.kind === "workflow-import") {
        if (prior || next.has(key("retirement", id))) fail("HELD", "An imported plan identity must be new to this journal and unretired.");
        let plan: WorkflowPlan | null = null, inventory: WorkflowOwnership | null = null;
        for (const event of mutation.events) {
          if (event.plan !== id) fail("CONFLICT", "One import carries exactly one plan chain.");
          plan = replaySupervisionWorkflow(plan, event, this.homeId);
          inventory = mergeOwnership([...(inventory ? [inventory] : []), planOwnership(plan)]);
        }
        value = { scopeId: mutation.scopeId, plan, inventory, migrationId: mutation.migrationId,
          requests: mutation.events.map(e => ({ requestId: e.requestId, requestHash: e.requestHash, eventHash: e.hash })) };
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
        if (["rule-verification", "rule-failure", "rule-violation"].includes(mutation.kind) && prior)
          fail("CONFLICT", "Rule evidence and violation receipts are immutable.");
        if (["plan-rules", "rule-verification", "rule-failure", "rule-violation"].includes(mutation.kind)) {
          const row = mutation.value as { homeId: string; scopeId: string; planId: string; revision?: number };
          if (row.homeId !== this.homeId) fail("HELD", "Rules belong to another home.");
          const scope = next.get(key("scope", row.scopeId))?.value as z.infer<typeof SupervisionScopeSchema> | undefined;
          if (!scope || scope.kind !== "plan") fail("HELD", "Rules require one retained plan scope.");
          if (mutation.kind === "plan-rules" && old && ["homeId", "scopeId", "planId", "revision"].some(k => old[k] !== row[k as keyof typeof row]))
            fail("HELD", "Rule identity and effective revision cannot change.");
        }
        validateInboxChange(mutation.kind, mutation.value, old, next, fail);
        validateSourceChange(mutation.kind, mutation.value, old, next, fail);
        validateProjectChange(mutation.kind, mutation.value, old, fail);
        validateMaintenanceChange(mutation.kind, mutation.value, old, next, fail);
        if (mutation.kind === "scope") {
          if (mutation.value.homeId !== this.homeId) fail("CONFLICT", "Scope belongs to another lexical home.");
          if (old && (old.kind !== mutation.value.kind || old.mode !== mutation.value.mode || (old.state === "retired" && mutation.value.state !== "retired"))) fail("HELD", "Scope identity/mode or retirement cannot be reset.");
        }
        if (mutation.kind === "binding" && old) {
          const binding = mutation.value;
          if (binding.epoch < Number(old.epoch) || binding.epoch > Number(old.epoch) + 1 || binding.acknowledgedSeq < Number(old.acknowledgedSeq) ||
            (binding.epoch === old.epoch && ["hostId", "agentId", "profileDigest", "workspaceIntent", "configurationId"].some(p => old[p] !== binding[p as keyof typeof binding]))) fail("STALE", "Binding identity change requires the next epoch; acknowledgement cannot regress.");
          // The verified workspace is set once, by prepared -> active; it never changes within an epoch.
          if (binding.epoch === old.epoch && old.profileReadback && digest(old.profileReadback) !== digest(binding.profileReadback))
            fail("STALE", "Verified native profile readback is immutable within its epoch.");
          if (binding.epoch === old.epoch && old.workspaceId !== binding.workspaceId &&
            !(old.workspaceId === null && old.state === "prepared" && binding.state === "active")) fail("STALE", "A verified workspace identity is set once on activation and is otherwise immutable within its epoch.");
          if (binding.epoch !== old.epoch && (binding.state !== "prepared" || !["retired", "suspect"].includes(String(old.state)))) fail("HELD", "Replacement must be explicitly prepared from a retired/suspect binding.");
          if (old.state === "retired" && binding.epoch === old.epoch && binding.state !== "retired") fail("HELD", "A retired binding cannot reactivate its old epoch.");
        }
        if (mutation.kind === "task" && old && ["planId", "nodeId", "projectId", "hostId"].some(p => old[p] !== mutation.value[p as keyof typeof mutation.value])) fail("CONFLICT", "Task identity cannot be renamed or reset.");
        if (mutation.kind === "attempt" && old) {
          const attempt = mutation.value;
          if (["taskId", "ordinal", "briefHash", "launchEffectId", "originalNotificationOwner", "reservedAt"].some(p => old[p] !== attempt[p as keyof typeof attempt]) ||
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
          // The single forward exception: a migrated backend activates in its own committed cutover transaction.
          const activating = old?.state === "prepared" && mutation.value.state === "active" && body.mutations.some(m => m.kind === "migration" &&
            m.value.planId === id && m.value.state === "committed" && (frames.get(key("migration", m.value.id))?.value as MigrationReceipt | undefined)?.state === "barrier");
          // A migrated backend never returns to its cutover barrier: rollback is forward (hold or higher-epoch transfer).
          if (old && old.state !== "prepared" && mutation.value.state === "prepared" && (next.get(key("workflow", id))?.value as { migrationId?: string } | undefined)?.migrationId)
            fail("HELD", "A migrated backend never returns to prepared; forward recovery holds it or transfers at a higher epoch.");
          if (old && !activating && ((["prepared", "held", "retired"].includes(String(old.state)) && mutation.value.state === "active") ||
            (old.state === "retired" && mutation.value.state !== "retired"))) fail("HELD", "A held backend requires checked forward recovery, not rollback.");
        }
        if (mutation.kind === "migration") checkMigrationChange(mutation.value, old as MigrationReceipt | undefined);
        if (mutation.kind === "delivery-disposition") checkDispositionChange(mutation.value, old as LegacyDeliveryDisposition | undefined);
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
          if (old.maintenance) {
            const { version: _v, state: _s, answer: _a, ...identity } = mutation.value;
            const { version: _ov, state: _os, answer: _oa, ...oldIdentity } = old;
            if (digest(identity) !== digest(oldIdentity)) fail("HELD", "Maintenance decision context and displayed evidence are immutable.");
          }
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
    this.validateMigrations(frames, next, body.mutations);
    this.validateIndexes(next);
    validateInbox(next, fail);
    validateSourceRows(next, fail);
    validateProjectRows(next, fail);
    validateMaintenanceRows(next, fail);
    for (const mutation of body.mutations) if (mutation.kind === "inbox-assignment" && mutation.value.scopeId) {
      const prior = frames.get(key("inbox-assignment", mutation.value.id))?.value as z.infer<typeof InboxAssignmentSchema> | undefined;
      if (prior && !prior.scopeId) {
        const event = next.get(key("inbox-event", mutation.value.id))!.value as z.infer<typeof InboxEventSchema>;
        const projection = (kind: Frame["kind"]) => [...next.values()].filter(f => f.kind === kind).map(f => f.value);
        const owners = eventOwners(event, projection("task") as SupervisionStatus["tasks"], projection("attempt") as SupervisionStatus["attempts"],
          projection("source-binding") as SupervisionStatus["sources"]["bindings"]);
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
  /** S07 cutover invariants, checked again on every replay: one backend authority per plan. */
  private validateMigrations(previous: Map<string, Frame>, frames: Map<string, Frame>, mutations: StoreMutation[]): void {
    const get = (kind: Frame["kind"], id: string) => frames.get(key(kind, id))?.value;
    for (const mutation of mutations) {
      if (mutation.kind === "workflow-import") {
        const row = get("workflow", mutation.events[0]!.plan) as WorkflowRow & { migrationId: string };
        const migration = get("migration", mutation.migrationId) as MigrationReceipt | undefined;
        if (!migration || migration.planId !== row.plan.definition.id || migration.scopeId !== mutation.scopeId || migration.state !== "prepared" ||
          !mutations.some(m => m.kind === "migration" && m.value.id === mutation.migrationId && m.value.version === 1) ||
          digest(row.requests) !== digest(migration.imported.requests) || row.plan.hash !== migration.source.tip.hash)
          fail("CONFLICT", "An import commits with its own new prepared migration receipt, request index and source tip.");
      }
      if (mutation.kind === "migration") {
        const m = mutation.value, backend = get("backend", m.planId) as z.infer<typeof SupervisionBackendSchema> | undefined;
        const row = get("workflow", m.planId) as (WorkflowRow & { migrationId?: string }) | undefined;
        if (m.homeId !== this.homeId || !backend || backend.backend !== "scoped" || backend.ownerScopeId !== m.scopeId || backend.sourceHash !== m.source.sourceHash ||
          row?.migrationId !== m.id || digest(m.imported.requests) !== m.imported.indexHash) fail("CONFLICT", "Migration receipt, backend, source and imported index must agree.");
        if (m.state === "aborted" ? backend.state !== "retired" || (get("scope", m.scopeId) as { state?: string } | undefined)?.state !== "retired" :
          (m.state === "committed") !== (backend.state === "active") || (m.state !== "committed" && backend.state !== "prepared"))
          fail("HELD", "The scoped backend activates only with a committed cutover, and a release retires it with its scope; before that both writers stay held.");
        const rows = m.inventory.dispositionIds.map(id => get("delivery-disposition", id) as LegacyDeliveryDisposition | undefined);
        if (rows.some(d => !d || d.migrationId !== m.id || d.planId !== m.planId || d.scopeId !== m.scopeId) ||
          inventoryHash(rows as LegacyDeliveryDisposition[]) !== m.inventory.hash) fail("CONFLICT", "Delivery inventory hash does not match its dispositions.");
        if (m.state === "barrier" || m.state === "committed") {
          if (!m.sidecars.prepared) fail("HELD", "The barrier follows a verified prepared sidecar.");
          for (const d of rows as LegacyDeliveryDisposition[]) if (d.route === "hold" || ["pending", "mismatch"].includes(d.removal.state) ||
            (d.route === "transfer-fact" && !(d.destination?.outboxId && get("outbox", d.destination.outboxId))))
            fail("HELD", `Delivery ${d.id} is not accounted; the cutover stays held.`);
        }
        if (m.state === "committed" && !m.sidecars.committed) fail("HELD", "Activation follows the committed compatibility sidecar.");
      }
      if (mutation.kind === "delivery-disposition") {
        const m = get("migration", mutation.value.migrationId) as MigrationReceipt | undefined;
        if (!m || !m.inventory.dispositionIds.includes(mutation.value.id)) fail("CONFLICT", "A disposition belongs to its migration inventory.");
        // After the barrier, only the current owner's receipt for a transferred fact may still be recorded.
        const before = previous.get(key("delivery-disposition", mutation.value.id))?.value as LegacyDeliveryDisposition | undefined;
        const beforeMigration = previous.get(key("migration", m.id))?.value as MigrationReceipt | undefined;
        if (beforeMigration && beforeMigration.state !== "prepared" && (!before || mutation.value.route !== "transfer-fact" ||
          digest({ ...before, version: 0, receipts: { ...before.receipts, ack: null } }) !== digest({ ...mutation.value, version: 0, receipts: { ...mutation.value.receipts, ack: null } })))
          fail("HELD", "An accounted inventory only records current-owner receipts.");
      }
    }
  }
  /** Row objects are replaced, never mutated, so a schema parse of one is a pure function of
   * its identity. Whole-projection validation re-parsed every row on every replayed transaction. */
  private static readonly parsedRows = new WeakMap<object, Map<unknown, unknown>>();
  private parseRow<T>(schema: { parse(value: unknown): T }, value: unknown): T {
    if (typeof value !== "object" || value === null) return schema.parse(value);
    let bySchema = SupervisionStore.parsedRows.get(value);
    if (!bySchema) SupervisionStore.parsedRows.set(value, bySchema = new Map());
    if (!bySchema.has(schema)) bySchema.set(schema, schema.parse(value));
    return bySchema.get(schema) as T;
  }
  private validateIndexes(frames: Map<string, Frame>): void {
    const get = (kind: Frame["kind"], id: string) => frames.get(key(kind, id))?.value;
    // A project exception must retain the owner judgment and original checked logical input.
    // It does not acquire a fabricated workflow backend.
    const projectDecisionOwner = (row: z.infer<typeof ScopedDecisionSchema>) => {
      const command = [...frames.values()].filter(f => f.kind === "command").map(f => f.value as z.infer<typeof AcceptedScopedCommandSchema>)
        .find(c => c.actor.kind === "agent" && c.result.projectException?.decisionId === row.id);
      const e = command?.result.projectException, inputCommand = e ? get("command", e.sourceCommandId) as z.infer<typeof AcceptedScopedCommandSchema> | undefined : undefined;
      const input = inputCommand?.result.projectInput, project = e ? get("project", e.projectId) as { scopeId: string } | undefined : undefined;
      const original = e ? get("outbox", e.inputOutboxId) as z.infer<typeof ScopedOutboxSchema> | undefined : undefined;
      return !!(e && input && project && original && project.scopeId === row.ownerScopeId && e.scopeId === row.ownerScopeId &&
        row.planId === `project-${e.projectId}` && e.subjectHash === row.subjectHash && input.scopeId === row.ownerScopeId && input.projectId === e.projectId &&
        inputCommand?.actor.kind === "system" && inputCommand.actor.id === "project-judgment-input" && original.causationId === inputCommand.id &&
        original.state === "handled" && original.subjectHash === input.subjectHash && original.resultRef === `command:${command.id}` &&
        command.result.projectJudgment?.outboxId === original.id && command.result.projectJudgment.disposition === "judged" &&
        command.result.captainDecisions?.some(c => c.decisionId === row.id && c.subjectHash === row.subjectHash && c.scope.kind === "project" && c.scope.id === row.ownerScopeId && c.origin.kind === "project" && c.origin.id === e.projectId));
    };
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
        const binding = this.parseRow(SupervisionBindingSchema, value);
        if (binding.configurationId) {
          const command = get("command", binding.configurationId) as z.infer<typeof AcceptedScopedCommandSchema> | undefined;
          const configuration = command?.result.supervisorConfiguration;
          if (!configuration || configuration.id !== binding.configurationId || configuration.scopeId !== binding.scopeId ||
            configuration.effectiveEpoch !== binding.epoch || digest(configuration.resolved) !== binding.profileDigest)
            fail("HELD", "Binding configuration generation is missing or does not match its immutable profile and epoch.");
        }
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
        const task = this.parseRow(SupervisionTaskSchema, value), alias = JSON.stringify([task.hostId.trim().toLowerCase(), task.projectId, task.nodeId]);
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
        const attempt = this.parseRow(SupervisionAttemptSchema, value), task = get("task", attempt.taskId) as z.infer<typeof SupervisionTaskSchema> | undefined;
        const effect = get("effect", attempt.launchEffectId) as z.infer<typeof SupervisionEffectSchema> | undefined;
        const ordinal = key(attempt.taskId, String(attempt.ordinal));
        if (attempt.importedFrom) {
          // An S07 import: no gateway launch effect exists; the committed migration's imported index vouches for it.
          const m = get("migration", attempt.importedFrom.migrationId) as MigrationReceipt | undefined;
          if (!task || !m || m.planId !== task.planId || task.nodeId !== attempt.importedFrom.node || effect ||
            !m.imported.attempts.some(a => a.attempt === attempt.importedFrom!.legacyAttempt && a.node === attempt.importedFrom!.node)) fail("CONFLICT", "An imported attempt must match its migration's imported index.");
        } else
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
        const effect = this.parseRow(SupervisionEffectSchema, value);
        if (effect.configurationId) {
          const command = get("command", effect.configurationId) as z.infer<typeof AcceptedScopedCommandSchema> | undefined;
          const configuration = command?.result.supervisorConfiguration;
          if (!configuration || configuration.id !== effect.configurationId || configuration.scopeId !== effect.scopeId || configuration.effectiveEpoch !== effect.epoch)
            fail("HELD", "Effect configuration generation is missing or belongs to another owner/epoch.");
        }
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
        const row = this.parseRow(ScopedDecisionSchema, value), backend = get("backend", row.planId) as z.infer<typeof SupervisionBackendSchema> | undefined;
        if (row.maintenance) {
          const job = get("maintenance-job", row.maintenance.jobId) as z.infer<typeof MaintenanceJobSchema> | undefined;
          const incident = get("maintenance-incident", row.maintenance.incidentId) as z.infer<typeof MaintenanceIncidentSchema> | undefined;
          const scope = get("scope", row.ownerScopeId) as z.infer<typeof SupervisionScopeSchema> | undefined;
          if (scope?.kind !== "maintenance" || job?.scopeId !== row.ownerScopeId || incident?.jobId !== job.id || row.planId !== job.id || row.nodeId !== incident.id)
            fail("UNKNOWN_OWNER", "Maintenance decision must retain its exact logical job, incident and maintenance owner.");
        } else if (!(backend?.ownerScopeId === row.ownerScopeId || projectDecisionOwner(row))) fail("UNKNOWN_OWNER", "Decision and checked logical owner must agree.");
        if ((row.state === "answered") !== !!row.answer) fail("CONFLICT", "Decision answer and state must agree.");
        if (row.answer) {
          const outbox = get("outbox", row.answer.outboxId) as z.infer<typeof ScopedOutboxSchema> | undefined;
          if (!outbox || outbox.decisionId !== row.id || outbox.ownerScopeId !== row.ownerScopeId || outbox.causationId !== row.answer.submissionId)
            fail("CONFLICT", "Answer and logical delivery must commit together.");
        }
      }
      if (frame.kind === "outbox") {
        const row = this.parseRow(ScopedOutboxSchema, value), backend = get("backend", row.planId) as z.infer<typeof SupervisionBackendSchema> | undefined;
        const maintenanceDecision = row.decisionId ? get("decision", row.decisionId) as z.infer<typeof ScopedDecisionSchema> | undefined : undefined;
        const introduced = get("command", row.causationId) as z.infer<typeof AcceptedScopedCommandSchema> | undefined;
        const input = introduced?.result.projectInput, project = input ? get("project", input.projectId) as { scopeId: string } | undefined : undefined;
        const projectOwned = input && introduced?.actor.kind === "system" && introduced.actor.id === "project-judgment-input" &&
          introduced.result.outboxId === row.id && input.scopeId === row.ownerScopeId && project?.scopeId === row.ownerScopeId &&
          row.planId === `project-${input.projectId}` && row.kind === "plan.command" && row.decisionId === null && row.subjectHash === input.subjectHash;
        const projectAnswer = row.decisionId ? get("decision", row.decisionId) as z.infer<typeof ScopedDecisionSchema> | undefined : undefined;
        const exceptionOwned = projectAnswer && projectDecisionOwner(projectAnswer) && projectAnswer.ownerScopeId === row.ownerScopeId &&
          projectAnswer.planId === row.planId && projectAnswer.subjectHash === row.subjectHash && row.kind === "decision.answer" && projectAnswer.answer?.outboxId === row.id;
        if ((row.maintenance ? !maintenanceDecision || !maintenanceDecision.maintenance || maintenanceDecision.ownerScopeId !== row.ownerScopeId || maintenanceDecision.planId !== row.planId || row.kind !== "decision.answer"
          : !(backend?.ownerScopeId === row.ownerScopeId || projectOwned || exceptionOwned)) || (row.state === "handled") !== !!(row.handledEpoch && row.resultRef))
          fail("CONFLICT", "Outbox ownership or handled receipt is inconsistent.");
        if ((projectOwned || exceptionOwned) && row.state === "handled") {
          const id = /^command:([0-9a-f-]{36})$/.exec(row.resultRef!)?.[1], command = id ? get("command", id) as z.infer<typeof AcceptedScopedCommandSchema> | undefined : undefined;
          const judgment = command?.result.projectJudgment;
          if (command?.actor.kind !== "agent" || !judgment || judgment.scopeId !== row.ownerScopeId || judgment.outboxId !== row.id || judgment.subjectHash !== row.subjectHash || judgment.epoch !== row.handledEpoch)
            fail("CONFLICT", "Project outbox handling needs its exact committed owner judgment.");
        }
        if (row.decisionId) {
          const decision = get("decision", row.decisionId) as z.infer<typeof ScopedDecisionSchema> | undefined;
          if (decision?.answer?.outboxId !== row.id) fail("CONFLICT", "Answer outbox must reference its committed decision result.");
        }
      }
    }
  }
  private async scanFull(options: { verifyAllProjections?: boolean; anchorPlan?: AnchorPlanEntry[]; upto?: number } = {}): Promise<Scan> {
    const result: Scan = { frames: new Map(), transactions: [], sequence: 0, hash: null, problems: [], initialized: false, ownership: [], pending: null, bytes: 0, coordinators: [], prefixDigest: emptyPrefix, projection: emptyFrameDigest, projectionSet: projectionSetHash(emptyProjectionAcc()), projectionVector: "0".repeat(256), legacyAnchors: 0 };
    try {
      let names: string[];
      try { names = await readdir(this.root); }
      catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return result; throw error; }
      if (names.some(n => !["identity.json", "capacity.json", "transactions", "coordinators", "blobs", "checkpoint.json", "anchor-migration.json", "anchor-backup", "projection-cache.json", "anchor-rollback.json", "anchor-rollback-staging"].includes(n) && !/^(?:identity|capacity|checkpoint|anchor-migration|anchor-rollback|projection-cache)\.json\.[0-9a-f-]+\.tmp$/.test(n))) fail("HELD", "Unknown supervision root metadata.");
      await this.loadCapacity();
      const identity = IdentitySchema.parse(await readCanonical(join(this.root, "identity.json")));
      if (identity.homeId !== this.homeId) fail("HELD", "Supervision home identity mismatch.");
      result.initialized = true;
      const files = await this.transactionFiles();
      const blobs = await readdir(join(this.root, "blobs")); // Missing storage is not an empty-store fallback.
      if (blobs.some(n => !/^[0-9a-f]{64}(?:\.[0-9a-f-]+\.tmp)?$/.test(n))) fail("HELD", "Unknown evidence blob metadata.");
      if (files.some(n => !/^\d{12}\.(?:tip|event|publication)\.json(?:\.[0-9a-f-]+\.tmp)?$/.test(basename(n)))) fail("HELD", "Unknown transaction metadata.");
      const durable = files.filter(n => n.endsWith(".json"));
      result.bytes = await storageBytes(join(this.root, "transactions"), files);
      result.bytes += await storageBytes(join(this.root, "blobs"), blobs);
      const durableNames = new Set(durable.map(n => basename(n)));
      if (durableNames.size !== durable.length) fail("HELD", "Duplicate transaction page identity.");
      const sequences = [...new Set(durable.map(n => Number(basename(n).slice(0, 12))))].sort((a, b) => a - b).filter(seq => options.upto === undefined || seq <= options.upto);
      // Retain independently checked capsules even when an earlier authority record is damaged.
      // Hash each checked capsule once. Rehashing every saved capsule for every anchor made a
      // scan quadratic in history size (and repeated gateway reads amplified that cost).
      // This set lives only in this scan: every read still checks every persisted anchor.
      const retainedDigests = new Set<string>();
      // Capsules are collected from tips during the chain walk itself - a separate first pass
      // re-read and re-parsed every tip. Only when the walk fails are the remaining anchors
      // checked in a fallback pass (below), so a damaged early record still cannot lose the
      // capsules after it; publications are checked there only where their tip is missing or
      // damaged, as the walk already pins every other publication to its checked tip.
      // Read ahead a bounded window: thousands of sequential file reads left the thread idle
      // between validations. Every check still runs in order on the same bytes; a prefetched
      // failure is held in its settled result and surfaces exactly where it did.
      type SettledRead = { value: unknown } | { error: unknown };
      const settledRead = (path: string): Promise<SettledRead> => readCanonical(path).then(value => ({ value }), (error: unknown) => ({ error }));
      const takenRead = (read: SettledRead): unknown => { if ("error" in read) throw read.error; return read.value; };
      const anchorReads = new Map<string, Promise<SettledRead>>();
      const tipNames = durable.filter(n => /\.tip\.json$/.test(n)), publicationNames = durable.filter(n => /\.publication\.json$/.test(n));
      const aheadAnchors = (names: string[], n: number) => { for (const name of names.slice(n, n + 16)) if (!anchorReads.has(name)) anchorReads.set(name, settledRead(join(this.root, "transactions", name))); };
      // Retained ownership from anchors of either generation, in sequence order. /1 capsules
      // are self-contained; /2 capsules rebuild cumulatively from deltas, seeded by the last
      // /1 capsule and restarted by every reset anchor. A delta that does not reconstruct its
      // recorded digest breaks the chain until the next reset, exactly like a damaged capsule.
      const anchorState = { acc: null as OwnershipAcc | null, lastFull: null as z.infer<typeof OwnershipSchema> | null, accDigest: null as string | null, broken: false };
      const resetAnchorState = () => { anchorState.acc = null; anchorState.lastFull = null; anchorState.accDigest = null; anchorState.broken = false; };
      const retainFromAnchor = (anchor: AnyAnchor, raw: unknown, frames?: Map<string, Frame>) => {
        if (!isAnchor2(anchor)) {
          anchorState.lastFull = anchor.ownership; anchorState.acc = null; anchorState.broken = false;
          const retained = ownershipDigest((raw as Anchor).ownership); anchorState.accDigest = retained;
          if (!retainedDigests.has(retained)) { retainedDigests.add(retained); result.ownership.push(anchor.ownership); }
          return;
        }
        if (anchorState.broken && !anchor.ownershipDelta.reset) return;
        anchorState.acc ??= frames ? ownershipAccFromFrames(frames) : anchorState.lastFull ? ownershipAccFrom(anchorState.lastFull) : emptyOwnershipAcc();
        applyOwnershipDelta(anchorState.acc, anchor.ownershipDelta); anchorState.broken = false;
        if (!anchor.ownershipDelta.entries.length && !anchor.ownershipDelta.reset && anchor.ownershipDigest === anchorState.accDigest) return;
        const built = buildOwnership(anchorState.acc);
        if (ownershipDigest(built) !== anchor.ownershipDigest) { anchorState.broken = true; fail("HELD", "Anchor ownership delta does not reconstruct its recorded ownership."); }
        anchorState.accDigest = anchor.ownershipDigest;
        if (!retainedDigests.has(anchor.ownershipDigest)) { retainedDigests.add(anchor.ownershipDigest); result.ownership.push(built); }
      };
      // Fallback capsule collection in one in-order pass: a damaged tip's publication stands
      // in for it at its own sequence (the same capsule, mirrored), so one damaged anchor
      // cannot lose every ownership reservation after it until the next reset. A failed
      // attempt restores the accumulator it touched before the substitute is tried.
      const collectAnchors = async () => {
        const bySequence = new Map<number, { tip?: string; publication?: string }>();
        for (const name of tipNames) bySequence.set(Number(basename(name).slice(0, 12)), { ...bySequence.get(Number(basename(name).slice(0, 12))), tip: name });
        for (const name of publicationNames) bySequence.set(Number(basename(name).slice(0, 12)), { ...bySequence.get(Number(basename(name).slice(0, 12))), publication: name });
        const ordered = [...bySequence.entries()].sort(([a], [b]) => a - b).flatMap(([, pair]) => [pair.tip, pair.publication].filter((name): name is string => !!name));
        let cursor = 0;
        for (const [, pair] of [...bySequence.entries()].sort(([a], [b]) => a - b)) {
          const pairNames = [pair.tip, pair.publication].filter((name): name is string => !!name);
          for (let j = 0; j < pairNames.length; j++) {
            const name = pairNames[j]!;
            if (!name) continue;
            aheadAnchors(ordered, cursor + j);
            const saved = { acc: anchorState.acc && cloneOwnershipAcc(anchorState.acc), lastFull: anchorState.lastFull, accDigest: anchorState.accDigest, broken: anchorState.broken,
              retained: result.ownership.length, digests: new Set(retainedDigests) };
            try {
              const rawAnchor = takenRead(await anchorReads.get(name)!); anchorReads.delete(name); const anchor = parseVerified(AnyAnchorSchema, rawAnchor);
              if (anchor.homeId !== this.homeId || name.replaceAll("\\", "/") !== this.file(anchor.sequence, anchor.format.includes("publication") ? "publication" : "tip").slice(join(this.root, "transactions").length + 1).replaceAll("\\", "/")) fail("HELD", "Anchor identity mismatch.");
              retainFromAnchor(anchor, rawAnchor);
              break;
            } catch (error) {
              anchorState.acc = saved.acc; anchorState.lastFull = saved.lastFull; anchorState.accDigest = saved.accDigest; anchorState.broken = saved.broken;
              result.ownership.length = saved.retained; retainedDigests.clear(); for (const d of saved.digests) retainedDigests.add(d);
              result.problems.push(`Damaged retained ownership ${name}: ${String(error)}`);
            }
          }
          cursor += pairNames.length;
        }
      };
      try {
        result.coordinators = await this.coordinators();
        const requestIds = new Set<string>();
        let projectionAcc = emptyProjectionAcc();
        const reads = new Map<string, Promise<SettledRead>>();
        const ahead = (n: number) => { for (const seq of sequences.slice(n, n + 16)) for (const kind of ["tip", "event", "publication"] as const) { const key = `${seq}:${kind}`; if (!reads.has(key)) reads.set(key, settledRead(this.file(seq, kind))); } };
        const take = async (seq: number, kind: "tip" | "event" | "publication") => { const key = `${seq}:${kind}`; const value = takenRead(await reads.get(key)!); reads.delete(key); return value; };
        for (let index = 0; index < sequences.length; index++) {
          const sequence = sequences[index]!;
          if (sequence !== index + 1) fail("HELD", "Transaction history has a gap; retained publications cannot reset it.");
          ahead(index); const rawTip = await take(sequence, "tip"); const tip = parseVerified(AnyAnchorSchema, rawTip);
          if (tip.homeId === this.homeId && tip.sequence === sequence) { if (!isAnchor2(tip)) result.legacyAnchors++; retainFromAnchor(tip, rawTip, result.frames); }
          if (!tip.format.includes("tip") || tip.homeId !== this.homeId || tip.sequence !== sequence || tip.previous !== result.hash) fail("HELD", "Expected tip is inconsistent with the committed prefix.");
          const event = parseVerified(TransactionSchema, await take(sequence, "event"));
          if (event.format.endsWith("/2") && !isAnchor2(tip)) fail("HELD", "A /2 transaction requires its /2 anchors.");
          if (event.homeId !== this.homeId || event.sequence !== sequence || event.previous !== result.hash || tip.transactionHash !== event.hash ||
            tip.requestId !== event.requestId || tip.requestHash !== event.requestHash || tip.generation !== event.generation || cachedDigest(event.body) !== event.requestHash ||
            result.coordinators[event.generation - 1]?.hash !== event.coordinatorHash || requestIds.has(event.requestId)) fail("HELD", "Transaction chain, request or coordinator identity mismatch.");
          await this.checkBlobs(event.body.mutations);
          checkInboxRequest(event.body.mutations, event.requestId);
          const next = this.apply(result.frames, event.body);
          const nextProjectionAcc = advanceProjection(projectionAcc, result.frames, next.frames, next.changes);
          const projectionSet = projectionSetHash(nextProjectionAcc);
          // A /2 anchor's delta must be exactly the contributions replay changed - comparing
          // the small delta replaces hashing the whole ownership text per transaction; the
          // cumulative reconstruction above already verified its full recorded digest.
          if (digest(next.changes) !== digest(event.changes) ||
            (isAnchor2(tip) ? cachedDigest(tip.ownershipDelta) !== cachedDigest(ownershipDeltaFor(next.changes, next.frames, anchorReset(sequence)))
              : ownershipDigestOf(next.frames) !== anchorOwnershipDigest(tip, (rawTip as Anchor).ownership)) ||
            (isAnchor2(tip) && tip.projectionSet !== projectionSet) ||
            (event.format.endsWith("/2") ? projectionSet !== event.projectionHash : (options.verifyAllProjections || sequence % 64 === 0) && frameDigest(next.frames) !== event.projectionHash))
            fail("HELD", "Transaction projection or retained ownership mismatch.");
          if (!durableNames.has(`${pad(sequence)}.publication.json`)) {
            if (index !== sequences.length - 1) fail("HELD", "Unpublished transaction precedes later history.");
            result.pending = { event, tip }; fail("HELD", "Final transaction awaits publication.");
          }
          const rawMarker = await take(sequence, "publication"); verifyHash(rawMarker as AnyAnchor); const marker = rawMarker as AnyAnchor;
          // The publication is pinned to its fully schema-checked tip: same keys, same fields,
          // same ownership digest - as strong as re-parsing it, without a second schema walk.
          // A same-generation publication is pinned byte-for-byte to its tip. A mixed pair is
          // an interrupted anchor migration (one file replaced, its pair not yet): both files
          // are hash- and schema-checked and must agree on every shared field and on the
          // ownership digest - the same capsule in its two encodings.
          if (anchorVersion(marker) === anchorVersion(tip)
            ? marker.format !== publicationFormat(anchorVersion(tip)) ||
              (isAnchor2(tip) ? digest({ ...(marker as Anchor2), format: tip.format, hash: tip.hash }) !== digest(tip)
                : Object.keys(marker).sort().join(",") !== "format,generation,hash,homeId,ownership,previous,requestHash,requestId,sequence,transactionHash" || marker.homeId !== tip.homeId || marker.sequence !== tip.sequence || marker.previous !== tip.previous || marker.transactionHash !== tip.transactionHash || marker.requestId !== tip.requestId || marker.requestHash !== tip.requestHash || marker.generation !== tip.generation || ownershipDigest((marker as Anchor).ownership) !== ownershipDigest((rawTip as Anchor).ownership))
            : marker.format !== publicationFormat(anchorVersion(marker)) || digest((() => { const parsed = parseVerified(AnyAnchorSchema, rawMarker); return { homeId: parsed.homeId, sequence: parsed.sequence, previous: parsed.previous, transactionHash: parsed.transactionHash, requestId: parsed.requestId, requestHash: parsed.requestHash, generation: parsed.generation, ownership: anchorOwnershipDigest(parsed) }; })()) !== digest({ homeId: tip.homeId, sequence: tip.sequence, previous: tip.previous, transactionHash: tip.transactionHash, requestId: tip.requestId, requestHash: tip.requestHash, generation: tip.generation, ownership: anchorOwnershipDigest(tip, isAnchor2(tip) ? undefined : (rawTip as Anchor).ownership) })) fail("HELD", "Publication does not match its expected tip.");
          if (options.anchorPlan) {
            const capsule = { homeId: this.homeId, sequence, previous: event.previous, transactionHash: event.hash, requestId: event.requestId, requestHash: event.requestHash,
              generation: event.generation, ownershipDigest: anchorOwnershipDigest(tip, isAnchor2(tip) ? undefined : (rawTip as Anchor).ownership),
              ownershipDelta: ownershipDeltaFor(next.changes, next.frames, anchorReset(sequence)), projectionSet };
            options.anchorPlan.push({ sequence, oldTipHash: tip.hash, oldPublicationHash: marker.hash,
              nextTip: hashed({ format: "firstmate.supervision-tip/2" as const, ...capsule }), nextPublication: hashed({ format: "firstmate.supervision-publication/2" as const, ...capsule }) });
          }
          projectionAcc = nextProjectionAcc; result.projectionSet = projectionSet; result.projectionVector = projectionAcc.vector.toString("hex");
          result.frames = next.frames; result.transactions.push(indexedTransaction(event)); requestIds.add(event.requestId); result.sequence = sequence; result.hash = event.hash;
          result.prefixDigest = extendPrefix(result.prefixDigest, event, tip, marker);
        }
        // The projection hash binds the whole replayed frame set, so checking it per transaction
        // hashed the entire projection text once per transaction (over 1 GB hashed at 2k
        // transactions). Every 64th transaction is still spot-checked above, and replay is
        // deterministic with every event - including its recorded
        // projectionHash - is hash-chained and anchor-verified, so hashing the head projection
        // once (the same value the checkpoint binds) pins what these frames replayed to. The
        // bounded warm tail (at most 32) keeps its per-transaction check.
        const head = result.transactions.at(-1);
        if (head) {
          if (head.format.endsWith("/2")) result.projection = result.projectionSet;
          else if ((result.projection = frameDigest(result.frames)) !== head.projectionHash) fail("HELD", "Transaction projection or retained ownership mismatch.");
        }
        const migrationReceipt = await this.readAnchorMigration();
        if (migrationReceipt && migrationReceipt.sequence <= result.sequence && result.transactions[migrationReceipt.sequence - 1]?.hash !== migrationReceipt.headHash) fail("HELD", "History at the anchor-migration receipt head does not match the receipt.");
        if (this.capacity && (this.capacity.baseSequence > result.sequence || (this.capacity.baseSequence ? result.transactions[this.capacity.baseSequence - 1]?.hash : null) !== this.capacity.baseHash))
          fail("HELD", "Capacity upgrade prefix is missing or changed.");
        if ((!this.capacity && result.sequence > SUPERVISION_INDEX_LIMITS.transactions) || this.projectionSize(result) > (this.capacity?.projectionBytes ?? SUPERVISION_INDEX_LIMITS.projectionBytes))
          fail("HELD", "Pilot index history/projection bound exceeded; retain history for deliberate reconciliation.");
      } catch (error) {
        result.problems.push(error instanceof Error ? error.message : String(error));
        // Retain capsules from anchors the walk never reached (or whose tip it refused), so a
        // damaged record cannot lose the ownership history after it. Failure path only.
        resetAnchorState();
        await collectAnchors();
      }
    } catch (error) { result.problems.push(error instanceof Error ? error.message : String(error)); }
    return result;
  }
  /** The checkpoint is a derived index, never authority. On each instance's first use the
   * entire journal is validated before its in-memory projection can be trusted. Unchanged
   * prefix bytes are thereafter audited explicitly; its anchor is checked on EVERY read.
   */
  private async directories(): Promise<string> {
    // Durable entry names, not directory write times: Windows can report a directory's earlier
    // write time late, with no new write, and a stat-only signature then forced a full journal
    // check on an untouched store. Names catch exactly the adds/removes a directory time would,
    // while file contents stay pinned by the checkpoint anchor checked on every warm read.
    const segment = async (path: string, nested: boolean): Promise<string[]> => {
      const s = await stat(path, { bigint: true }), names: string[] = [];
      for (const entry of (await readdir(path, { withFileTypes: true })).sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0)) {
        if (entry.name.endsWith(".tmp")) continue;
        if (nested && entry.isDirectory()) { for (const child of (await readdir(join(path, entry.name))).sort()) if (!child.endsWith(".tmp")) names.push(`${entry.name}/${child}`); }
        else names.push(entry.name);
      }
      return [String(s.dev), String(s.ino), ...names];
    };
    return canonical(await Promise.all([
      segment(this.root, false), segment(join(this.root, "transactions"), true),
      segment(join(this.root, "blobs"), false), segment(join(this.root, "coordinators"), false)]));
  }
  /** Whether only the coordinators segment moved since `cached` - the guard for absorbing our
   * own coordinator publication (see acquireCoordinator): any other directory change means
   * something else wrote in the window and the next read must validate as usual. */
  private onlyCoordinatorsMoved(now: string, before: string): boolean {
    const a = JSON.parse(now) as string[][], b = JSON.parse(before) as string[][];
    return [0, 1, 2].every(i => a[i]?.join("\n") === b[i]?.join("\n"));
  }
  private async anchorHash(sequence: number): Promise<string | null> {
    if (!sequence) return null;
    await Promise.all(["event", "tip", "publication"].map(suffix => stat(this.file(sequence, suffix))));
    const event = verifyHash(TransactionSchema.parse(await readCanonical(this.file(sequence, "event"))));
    const tip = verifyHash(AnyAnchorSchema.parse(await readCanonical(this.file(sequence, "tip"))));
    const marker = verifyHash(AnyAnchorSchema.parse(await readCanonical(this.file(sequence, "publication"))));
    if (event.homeId !== this.homeId || event.sequence !== sequence || tip.homeId !== this.homeId || tip.sequence !== sequence ||
      !tip.format.includes("tip") || marker.format !== publicationFormat(anchorVersion(tip)) || tip.transactionHash !== event.hash ||
      digest({ ...marker, format: tip.format, hash: tip.hash }) !== digest(tip)) fail("HELD", "Checkpoint anchor identity mismatch.");
    await this.checkBlobs(event.body.mutations);
    return digest({ event: event.hash, tip: tip.hash, publication: marker.hash });
  }
  private async readCheckpoint(): Promise<Checkpoint> {
    const path = join(this.root, "checkpoint.json");
    if ((await stat(path)).size > 16 * 1024) fail("HELD", "Checkpoint index exceeds its metadata bound.");
    const checkpoint = verifyHash(CheckpointSchema.parse(await readCanonical(path)));
    if (checkpoint.homeId !== this.homeId || !this.capacity && checkpoint.sequence > SUPERVISION_INDEX_LIMITS.transactions) fail("HELD", "Checkpoint home/history bound mismatch.");
    return checkpoint;
  }
  private async checkpointFor(snapshot: Scan): Promise<Checkpoint> {
    return hashed({ format: "firstmate.supervision-checkpoint/1" as const, homeId: this.homeId,
      sequence: snapshot.sequence, transactionHash: snapshot.hash, prefixDigest: snapshot.prefixDigest,
      projectionHash: snapshot.projection, anchorHash: await this.anchorHash(snapshot.sequence) });
  }
  private async blobIdentities(): Promise<BlobIdentities> {
    const directory = join(this.root, "blobs"), names = await readdir(directory);
    if (names.some(n => !/^[0-9a-f]{64}(?:\.[0-9a-f-]+\.tmp)?$/.test(n))) fail("HELD", "Unknown evidence blob metadata.");
    return new Map(await Promise.all(names.filter(n => !n.endsWith(".tmp")).map(async name => {
      const s = await stat(join(directory, name), { bigint: true });
      return [name, [s.ino, s.size, s.mtimeNs].map(String).join(":")] as const;
    })));
  }
  /** A changed blobs directory need not cost a full validation. Every cached blob must keep its
   * identity (no removal or replacement), and every new one must hash to its own name. Blobs a
   * tail transaction references are checked again there; unreferenced evidence stays inert.
   */
  private async addedBlobs(prior: BlobIdentities): Promise<{ identities: BlobIdentities; bytes: number }> {
    const identities = await this.blobIdentities();
    let bytes = 0;
    for (const [name, identity] of prior) if (identities.get(name) !== identity) fail("HELD", "Evidence blob removed or replaced.");
    for (const name of identities.keys()) if (!prior.has(name)) {
      const content = await readFile(join(this.root, "blobs", name));
      if (rawDigest(content) !== name) fail("HELD", "New evidence blob is not content-addressed.");
      bytes += content.length;
    }
    return { identities, bytes };
  }
  private async cache(snapshot: Scan, checkpoint: Checkpoint, directories: string, blobs?: BlobIdentities): Promise<Scan> {
    // A writer reuses the identities it already holds while the blobs directory is unchanged.
    const blobsDirectory = (signature: string) => (JSON.parse(signature) as string[][])[2]!.join();
    blobs ??= this.cached && blobsDirectory(this.cached.directories) === blobsDirectory(directories) ? this.cached.blobs : await this.blobIdentities();
    const prior = this.cached, reuse = prior && prior.scan.sequence <= snapshot.sequence &&
      (prior.scan.hash === null || snapshot.transactions[prior.scan.sequence - 1]?.hash === prior.scan.hash);
    const requests = reuse ? prior.requests : new Map<string, IndexedTransaction>();
    const workflowRequests: CachedScan["workflowRequests"] = reuse ? prior.workflowRequests : new Map();
    for (const transaction of snapshot.transactions.slice(reuse ? prior.scan.sequence : 0)) {
      requests.set(transaction.requestId, transaction);
      for (const event of transaction.workflows) workflowRequests.set(key(event.plan, event.requestId), { requestHash: event.requestHash, eventHash: event.eventHash, transaction });
    }
    this.cached = { scan: snapshot, checkpoint, directories, blobs, requests, workflowRequests };
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
      await this.cache(snapshot, checkpoint, await this.directories());
    } finally { await rm(temporary, { force: true }); }
  }
  /** Persist the just-validated projection as the restart cache. Best-effort and writable
   * writers only: the cache is a derived index, its absence only costs a full first scan. */
  private async writeProjectionCache(snapshot: Scan, checkpoint: Checkpoint, directories: string, force = false): Promise<void> {
    if (!this.options.writable || !snapshot.initialized || snapshot.problems.length) return;
    if (!force && snapshot.sequence <= this.projectionCacheWritten) return;
    try {
      // The signature must name the cache file itself: it is usually captured before the file exists.
      const dirs = JSON.parse(directories) as string[][];
      if (!dirs[0]!.includes("projection-cache.json")) dirs[0] = [dirs[0]![0]!, dirs[0]![1]!, ...dirs[0]!.slice(2).concat("projection-cache.json").sort()];
      const value = ProjectionCacheSchema.parse(hashed({ format: "firstmate.supervision-projection-cache/1" as const, homeId: this.homeId,
        sequence: snapshot.sequence, transactionHash: snapshot.hash, prefixDigest: snapshot.prefixDigest, projection: snapshot.projection,
        projectionSet: snapshot.projectionSet, projectionVector: snapshot.projectionVector, checkpoint, legacyAnchors: snapshot.legacyAnchors, directories: canonical(dirs), bytes: snapshot.bytes, ownershipDigest: ownershipDigestOf(snapshot.frames),
        frames: [...snapshot.frames.entries()], transactions: snapshot.transactions, ownership: snapshot.ownership }));
      await this.replaceFile(join(this.root, "projection-cache.json"), value);
      this.projectionCacheWritten = snapshot.sequence;
    } catch { /* derived cache only */ }
  }
  /** Cold path: serve the restart cache after re-binding it to the on-disk checkpoint and
   * the anchor chain (anchor hash and prefix recomputed over the small /2 anchors), then let
   * the warm tail validate everything after it. The event bodies before the cache sequence
   * are re-verified by the background audit scheduled here, not on this path - that is the
   * explicit trade-off that makes a restart independent of journal length, and a divergence
   * poisons the instance so the next read surfaces held instead of serving on. Any mismatch
   * falls back to the ordinary full validation. */
  private async loadProjectionCache(): Promise<boolean> {
    if (this.projectionCacheTried) return false;
    this.projectionCacheTried = true;
    try {
      const file = verifyHash(ProjectionCacheSchema.parse(await readCanonical(join(this.root, "projection-cache.json"))));
      if (file.homeId !== this.homeId || file.transactions.length !== file.sequence) return false;
      await this.loadCapacity();
      const identity = IdentitySchema.parse(await readCanonical(join(this.root, "identity.json")));
      if (identity.homeId !== this.homeId) return false;
      const checkpoint = await this.readCheckpoint();
      if (checkpoint.sequence < file.sequence || file.checkpoint.sequence !== file.sequence ||
        file.checkpoint.transactionHash !== file.transactionHash || file.checkpoint.prefixDigest !== file.prefixDigest ||
        file.checkpoint.projectionHash !== file.projection) return false;
      if (file.checkpoint.anchorHash !== await this.anchorHash(file.sequence)) return false;
      const scan: Scan = { frames: new Map(file.frames.map(([k, frame]) => [k, frame as Frame])),
        transactions: file.transactions as IndexedTransaction[], sequence: file.sequence, hash: file.transactionHash,
        problems: [], initialized: true, ownership: file.ownership as Scan["ownership"], pending: null, bytes: 0,
        coordinators: await this.coordinators(), prefixDigest: file.prefixDigest, projection: file.projection,
        projectionSet: file.projectionSet, projectionVector: file.projectionVector, legacyAnchors: file.legacyAnchors };
      // Verify the CONTENTS, never the cache's claims about them: recompute the projection
      // and the ownership digest from the loaded frames and bind them to the checkpoint.
      // A forged or edited cache file whose frames do not hash to the witnessed projection
      // is rejected here and never served (the ordinary full scan decides instead).
      const recomputedAcc = projectionAccOf(scan.frames);
      const recomputedSet = projectionSetHash(recomputedAcc);
      // Never use the stored vector: the next write would record a projection hash derived
      // from it. The accumulator recomputed from the frames is the only trusted one.
      scan.projectionVector = recomputedAcc.vector.toString("hex");
      const v2Head = file.sequence > 0 && scan.transactions[file.sequence - 1]!.format.endsWith("/2");
      const recomputedProjection = file.sequence === 0 ? emptyFrameDigest : v2Head ? recomputedSet : frameDigest(scan.frames);
      if (recomputedSet !== file.projectionSet || recomputedProjection !== file.projection ||
        recomputedProjection !== file.checkpoint.projectionHash || ownershipDigestOf(scan.frames) !== file.ownershipDigest) return false;
      // Light prefix pass: hash-verify each anchor without schema-parsing it (the audit does
      // that); batched reads keep it near a second even at thousands of transactions.
      {
        let prefix = emptyPrefix, ok = true;
        const txs = scan.transactions;
        // The cached index and retained ownership are witnessed here too: every index
        // entry must match its hash-verified tip, and every retained capsule's digest must
        // appear as some anchor's recorded ownership digest, or the cache is rejected whole.
        const capsuleDigests = new Set(scan.ownership.map(capsule => ownershipDigest(capsule)));
        const witnessed = new Set<string>();
        let headOwnershipDigest: string | null = null;
        for (let at = 0; at < txs.length && ok; at += 64) {
          const batch = await Promise.all(txs.slice(at, at + 64).flatMap(tx => (["tip", "publication"] as const).map(async kind => {
            const raw = JSON.parse(await readFile(this.file(tx.sequence, kind), "utf8")) as AnyAnchor;
            verifyHash(raw);
            if (raw.homeId !== this.homeId || raw.sequence !== tx.sequence || !raw.format.includes(kind)) fail("HELD", "Restart cache anchor mismatch.");
            return raw;
          })));
          for (let i = 0; i < batch.length; i += 2) {
            const tx = txs[at + i / 2]!, tip = batch[i]!;
            if (tip.transactionHash !== tx.hash || tip.requestId !== tx.requestId || tip.requestHash !== tx.requestHash || tip.generation !== tx.generation) { ok = false; break; }
            const tipDigest = isAnchor2(tip) ? tip.ownershipDigest : ownershipDigest((tip as Anchor).ownership);
            witnessed.add(tipDigest);
            headOwnershipDigest = tipDigest;
            prefix = extendPrefix(prefix, tx, tip, batch[i + 1]!);
          }
        }
        if (!ok || prefix !== file.prefixDigest) return false;
        // Set equality, not just witnessing what is present: a capsule silently dropped
        // from the cache would hide retained reservations from every pre-audit read.
        if (witnessed.size !== capsuleDigests.size || [...capsuleDigests].some(d => !witnessed.has(d))) return false;
        if (file.sequence > 0 && headOwnershipDigest !== file.ownershipDigest) return false;
      }
      const receipt = await this.readAnchorMigration().catch(() => null);
      if (receipt && receipt.sequence <= file.sequence && scan.transactions[receipt.sequence - 1]?.hash !== receipt.headHash) return false;
      const files = await this.transactionFiles(), blobs = await readdir(join(this.root, "blobs"));
      // Anything durable beyond the checkpoint is a partial publication the full scan must judge.
      if (files.some(name => name.endsWith(".json") && Number(basename(name).slice(0, 12)) > checkpoint.sequence)) return false;
      scan.bytes = file.bytes;
      // Adopt the directory signature as of validation, never today's: a file linked after
      // the cache was written (e.g. a crashed partial publication) must still read as a
      // change the warm path refuses, exactly as it did for in-memory caches. The coordinator
      // segment is the one exception: claims are append-only and were just re-read above.
      const dirs = JSON.parse(file.directories) as string[][], nowDirs = JSON.parse(await this.directories()) as string[][];
      dirs[3] = nowDirs[3]!;
      await this.cache(scan, file.checkpoint, JSON.stringify(dirs));
      this.cacheServed = { sequence: file.sequence, hash: file.transactionHash, prefixDigest: file.prefixDigest, projection: file.projection,
        transactionsDigest: digest(scan.transactions), ownershipDigest: digest(scan.ownership),
        framesDigest: file.sequence > 0 && !v2Head ? recomputedProjection : frameDigest(scan.frames) };
      this.projectionCacheWritten = file.sequence;
      this.coldCacheTail = true;
      this.scheduleAudit();
      return true;
    } catch { return false; }
  }
  /** Background full audit after a restart-cache serve: every event body, anchor and /1
   * projection hash re-verified off the read path. A clean audit refreshes the restart
   * cache to the audited head; a dirty one poisons every instance of this journal so the next read runs the
   * ordinary checked scan and surfaces held with the exact problems. History moving under
   * the audit retries instead of judging a torn snapshot. */
  private scheduleAudit(): void {    if (!this.cacheServed) return;
    const state = auditFor(this.root);
    if (state.failure) return;
    if (state.running) {
      // An audit of an earlier serve may cover less than this serve: chain one for ours.
      if (state.target < this.cacheServed.sequence) void state.promise?.then(() => this.scheduleAudit());
      return;
    }
    state.running = true; state.target = this.cacheServed.sequence;
    const run = this.auditCacheServe().catch(() => undefined).finally(() => { state.running = false; state.promise = null; });
    state.promise = run;
  }
  /**
   * The one outstanding promise of a cache serve: re-verify every event, anchor and
   * recorded /1 projection hash up to the SERVED prefix and compare the result against
   * what was actually served - frames, transaction index and ownership, digested from
   * the served objects, never the cache file's stored claims. The audit is bounded to
   * the served sequence, so appends after it can neither disturb it nor make it give
   * up; it always finishes, and a divergence (or an audit that cannot complete) holds
   * every instance of this root in this process. Writes await a running audit, so a
   * new transaction is never committed on top of unverified cache contents.
   */
  private async auditCacheServe(): Promise<void> {
    const state = auditFor(this.root);
    const served = this.cacheServed; if (!served) return;
    for (let attempt = 0; attempt < 3; attempt++) {
      if (this.migrating) { await new Promise(r => setTimeout(r, 100)); continue; }
      try {
        const snapshot = await this.scanFull({ verifyAllProjections: true, upto: served.sequence });
        if (!snapshot.initialized) return;
        const diverged = snapshot.sequence !== served.sequence || snapshot.hash !== served.hash ||
          (served.sequence > 0 && snapshot.prefixDigest !== served.prefixDigest) || snapshot.projection !== served.projection ||
          digest(snapshot.transactions) !== served.transactionsDigest || digest(snapshot.ownership) !== served.ownershipDigest ||
          frameDigest(snapshot.frames) !== served.framesDigest;        if (snapshot.problems.length || diverged) {
          if (!snapshot.problems.length) state.divergence = "Background audit: the verified journal prefix does not match the restart cache that was served.";
          state.failure = snapshot.problems.length ? snapshot.problems :
            ["Background audit: the verified journal prefix does not match the restart cache that was served."];
          return;
        }
        // Audited truth replaces the cache file at the served sequence (never a re-entrant
        // scan on the serving instance). If the head has since moved, the next writer claim
        // or checked scan refreshes it instead; load-time recomputation guards every serve.
        try {
          const checkpoint = await this.checkpointFor(snapshot);
          if (digest(await this.readCheckpoint()) === digest(checkpoint))
            await this.writeProjectionCache(snapshot, checkpoint, await this.directories(), true);
        } catch { /* derived cache only */ }
        return;
      } catch { if (attempt === 2) { state.failure = ["Background journal audit could not complete; the journal is unverified."]; } }
    }
  }
  private async checkedFullScan(options: { verifyAllProjections?: boolean; anchorPlan?: AnchorPlanEntry[] } = {}): Promise<Scan> {
    this.cached = null;
    const snapshot = await this.scanFull(options);
    if (!snapshot.initialized || snapshot.problems.length) return snapshot;
    try {
      const before = await this.directories(), checkpoint = await this.readCheckpoint();
      if (digest(checkpoint) !== digest(await this.checkpointFor(snapshot)) || before !== await this.directories())
        fail("HELD", "Checkpoint is stale or mismatches the validated prefix; explicit index recovery required.");
      const validated = await this.cache(snapshot, checkpoint, before, await this.blobIdentities());
      // A cache-versus-journal divergence stays held for this process even though the
      // journal itself validates: the cache file below is healed from truth, but the
      // forgery must surface loudly instead of silently resuming as if nothing happened.
      const auditState = auditFor(this.root);
      if (!auditState.divergence) auditState.failure = null;
      await this.writeProjectionCache(snapshot, checkpoint, before, !!auditState.divergence);
      return auditState.divergence ? { ...validated, problems: [auditState.divergence] } : validated;
    } catch (error) {
      snapshot.problems.push(`Checkpoint validation failed; full history was checked, admissions held until explicit recovery: ${String(error)}`);
      // Keep independent ownership reservations, but do not expose an unaccepted projection.
      snapshot.frames = new Map(); return snapshot;
    }
  }
  private async scan(): Promise<Scan> {
    if (auditFor(this.root).failure) { this.cached = null; return this.checkedFullScan(); }
    if (!this.cached) await this.loadProjectionCache();
    for (let attempt = 0; ; attempt++) {
      const cached = this.cached;
      if (!cached) return this.checkedFullScan();
      try { return await this.warmScan(cached); }
      catch (error) {
        // A write that lands mid-read is retried warm, a few times; anything else, or a writer
        // that keeps overlapping, gets full validation (retained ownership, exact failure).
        if (error === changedDuringRead && attempt < 3) continue;
        return this.checkedFullScan();
      }
    }
  }
  private async warmScan(cached: CachedScan): Promise<Scan> {
    // The first advance from a restart cache may cross an unbounded tail; later warm reads keep the bound.
    const coldTail = this.coldCacheTail; this.coldCacheTail = false;
    await this.loadCapacity();
    const checkpoint = await this.readCheckpoint(), before = await this.directories();
    const identity = IdentitySchema.parse(await readCanonical(join(this.root, "identity.json")));
    if (identity.homeId !== this.homeId || checkpoint.anchorHash !== await this.anchorHash(checkpoint.sequence)) fail("HELD", "Checkpoint anchor/digest mismatch.");
    const coordinator = cached.scan.coordinators.at(-1);
    if (coordinator && verifyHash(CoordinatorSchema.parse(await readCanonical(join(this.root, "coordinators", `${pad(coordinator.generation)}.json`)))).hash !== coordinator.hash)
      fail("HELD", "Checkpoint coordinator identity changed.");
    if (checkpoint.hash === cached.checkpoint.hash && before === cached.directories) return cached.scan;
    const now = JSON.parse(before) as string[][], prior = JSON.parse(cached.directories) as string[][];
    const same = (index: number) => now[index]!.join() === prior[index]!.join();
    if (!same(3)) fail("HELD", "Coordinator metadata changed; validate full history.");
    // Nearly every writer operation adds evidence: accept checked additions, never a loss.
    const blobs = same(2) ? { identities: cached.blobs, bytes: 0 } : await this.addedBlobs(cached.blobs);
    if (checkpoint.hash === cached.checkpoint.hash) {
      if (!same(0) || !same(1)) fail("HELD", "Journal metadata changed without a checkpoint.");
      if (before !== await this.directories()) throw changedDuringRead;
      return await this.cache({ ...cached.scan, bytes: cached.scan.bytes + blobs.bytes }, checkpoint, before, blobs.identities);
    }
    // A current writer can advance this reader by at most a bounded tail. Missing/stale
    // checkpoints and unrelated directory changes go through a full validation below.
    if (checkpoint.sequence > cached.scan.sequence && checkpoint.sequence - cached.scan.sequence <= (coldTail ? Number.POSITIVE_INFINITY : SUPERVISION_INDEX_LIMITS.tail)) {
      if (cached.checkpoint.anchorHash !== await this.anchorHash(cached.scan.sequence)) fail("HELD", "Prior checkpoint anchor changed.");
      const next = { ...cached.scan, frames: new Map(cached.scan.frames), transactions: [...cached.scan.transactions], ownership: [...cached.scan.ownership],
        bytes: cached.scan.bytes + blobs.bytes };
      const seen = new Set(next.transactions.map(t => t.requestId));
      let tailProjection: ProjectionAcc = { vector: Buffer.from(cached.scan.projectionVector, "hex"), count: cached.scan.frames.size };
      let tailOwnership: OwnershipAcc | null = null, tailOwnershipDigest: string | null = null;
      for (let sequence = next.sequence + 1; sequence <= checkpoint.sequence; sequence++) {
        const event = parseVerified(TransactionSchema, await readCanonical(this.file(sequence, "event")));
        const rawTip = await readCanonical(this.file(sequence, "tip")); const tip = parseVerified(AnyAnchorSchema, rawTip);
        const rawMarker = await readCanonical(this.file(sequence, "publication")); const marker = parseVerified(AnyAnchorSchema, rawMarker);
        if (event.homeId !== this.homeId || event.sequence !== sequence || event.previous !== next.hash || tip.previous !== next.hash ||
          tip.homeId !== this.homeId || tip.sequence !== sequence || !tip.format.includes("tip") || marker.format !== publicationFormat(anchorVersion(tip)) || (event.format.endsWith("/2") && !isAnchor2(tip)) || tip.transactionHash !== event.hash ||
          tip.requestId !== event.requestId || tip.requestHash !== event.requestHash || tip.generation !== event.generation ||
          cachedDigest(event.body) !== event.requestHash || next.coordinators[event.generation - 1]?.hash !== event.coordinatorHash || seen.has(event.requestId) ||
          digest({ ...marker, format: tip.format, hash: tip.hash }) !== digest(tip)) fail("HELD", "Checkpoint tail chain/identity mismatch.");
        await this.checkBlobs(event.body.mutations); checkInboxRequest(event.body.mutations, event.requestId);
        const applied = this.apply(next.frames, event.body);
        const appliedProjection = advanceProjection(tailProjection, next.frames, applied.frames, applied.changes);
        const appliedSet = projectionSetHash(appliedProjection);
        const appliedFrameDigest = event.format.endsWith("/2") ? null : frameDigest(applied.frames);
        if (digest(applied.changes) !== digest(event.changes) ||
          (isAnchor2(tip) && tip.projectionSet !== appliedSet) || (event.format.endsWith("/2") ? appliedSet !== event.projectionHash : appliedFrameDigest !== event.projectionHash) ||
          (isAnchor2(tip) ? cachedDigest(tip.ownershipDelta) !== cachedDigest(ownershipDeltaFor(applied.changes, applied.frames, anchorReset(sequence)))
            : ownershipDigestOf(applied.frames) !== anchorOwnershipDigest(tip))) fail("HELD", "Checkpoint tail projection mismatch.");
        tailProjection = appliedProjection; next.projectionSet = appliedSet; next.projectionVector = appliedProjection.vector.toString("hex");
        next.projection = event.format.endsWith("/2") ? appliedSet : appliedFrameDigest!;
        next.frames = applied.frames; next.transactions.push(indexedTransaction(event)); seen.add(event.requestId);
        if (isAnchor2(tip)) {
          tailOwnership ??= ownershipAccFromFrames(cached.scan.frames);
          applyOwnershipDelta(tailOwnership, tip.ownershipDelta);
          if (tip.ownershipDelta.entries.length || tip.ownershipDelta.reset || tip.ownershipDigest !== tailOwnershipDigest) {
            const built = buildOwnership(tailOwnership);
            if (ownershipDigest(built) !== tip.ownershipDigest) fail("HELD", "Checkpoint tail projection mismatch.");
            tailOwnershipDigest = tip.ownershipDigest;
            if (!next.ownership.some(o => ownershipDigest(o) === tip.ownershipDigest)) next.ownership.push(built);
          }
        } else {
          next.legacyAnchors++;
          const tipOwnership = ownershipDigest(tip.ownership);
          if (!next.ownership.some(o => ownershipDigest(o) === tipOwnership)) next.ownership.push(tip.ownership);
          tailOwnership = null; tailOwnershipDigest = tipOwnership;
        }
        next.sequence = sequence; next.hash = event.hash; next.prefixDigest = extendPrefix(next.prefixDigest, event, tip, marker);
        next.bytes += Buffer.byteLength(canonical(event) + canonical(tip) + canonical(marker)) + 3;
      }
      // Directory accounting and coordinator changes cannot be guessed from the event tail.
      if (before !== await this.directories()) throw changedDuringRead;
      if (digest(checkpoint) !== digest(await this.checkpointFor(next))) fail("HELD", "Checkpoint tail digest mismatch.");
      return await this.cache(next, checkpoint, before, blobs.identities);
    }
    fail("HELD", "Checkpoint is not a bounded advance of the cached prefix.");
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
      const checkpoint = await this.ancestorCheckpoint(snapshot);
      if (observed && checkpoint && digest(checkpoint) === digest(await this.checkpointFor(snapshot)))
        fail("STALE", "Checkpoint is already current; inspect before another repair.");
      await this.saveCheckpoint(snapshot);
    });
  }
  /** Repair may only move a checkpoint forward. A crash between publication and checkpoint
   * replacement leaves it behind the journal, never ahead or on another prefix, so either of
   * those is an integrity incident: the checkpoint may be the last witness of lost history.
   * Checkpoints are replaced atomically and never deleted, so a missing or unreadable one is
   * only repairable over an empty journal (initialization interrupted before its first index).
   */
  private async ancestorCheckpoint(snapshot: Scan): Promise<Checkpoint | null> {
    let checkpoint: Checkpoint;
    try { checkpoint = await this.readCheckpoint(); }
    catch (error) {
      if (snapshot.sequence === 0) return null;
      fail("HELD", `Integrity incident: the checkpoint over a nonempty journal is missing or unreadable, so lost history cannot be ruled out; reconcile deliberately, never rebuild: ${String(error)}`);
    }
    const at = checkpoint.sequence, transaction = at ? snapshot.transactions[at - 1] : undefined;
    if (at > snapshot.sequence)
      fail("HELD", `Integrity incident: the checkpoint records sequence ${at} but the journal ends at ${snapshot.sequence}; published history may be lost. Reconcile deliberately, never rebuild.`);
    if (checkpoint.transactionHash !== (transaction?.hash ?? null) || checkpoint.projectionHash !== (transaction?.projectionHash ?? emptyFrameDigest) ||
      checkpoint.prefixDigest !== await this.prefixAt(snapshot, at) || checkpoint.anchorHash !== await this.anchorHash(at)) {
      // An interrupted anchor migration is the one expected divergence: the old checkpoint
      // still binds the pre-migration prefix the published receipt recorded. Resuming the
      // migration (never a silent index rebuild over half-replaced anchors) is the repair.
      const migration = await this.readAnchorMigration().catch(() => null);
      if (migration && migration.sequence === at && migration.headHash === checkpoint.transactionHash && migration.oldPrefixDigest === checkpoint.prefixDigest)
        fail("HELD", "Anchor migration is incomplete; resume it (the next writer does) before index recovery.");
      fail("HELD", `Integrity incident: the checkpoint at sequence ${at} diverges from the validated journal prefix. Reconcile deliberately, never rebuild.`);
    }
    return checkpoint;
  }
  private async prefixAt(snapshot: Scan, sequence: number): Promise<string> {
    let prefix = emptyPrefix;
    for (const event of snapshot.transactions.slice(0, sequence)) {
      const tip = verifyHash(AnyAnchorSchema.parse(await readCanonical(this.file(event.sequence, "tip"))));
      const marker = verifyHash(AnyAnchorSchema.parse(await readCanonical(this.file(event.sequence, "publication"))));
      prefix = extendPrefix(prefix, event, tip, marker);
    }
    return prefix;
  }
  private accepted(snapshot: Scan, requestId: string): IndexedTransaction | undefined {
    return this.cached?.scan === snapshot ? this.cached.requests.get(requestId) : snapshot.transactions.find(t => t.requestId === requestId);
  }
  private async checkBlobs(mutations: StoreMutation[]): Promise<void> {
    for (const mutation of mutations) if (mutation.kind === "blob") {
      const bytes = await readFile(join(this.root, "blobs", mutation.value.id));
      if (bytes.length !== mutation.value.bytes || rawDigest(bytes) !== mutation.value.id) fail("HELD", "Referenced evidence blob is missing or corrupt.");
    }
  }
  private receipt(event: Pick<Transaction, "requestId" | "requestHash" | "sequence" | "hash" | "generation" | "changes">): SupervisionReceipt {
    return { requestId: event.requestId, requestHash: event.requestHash, sequence: event.sequence, hash: event.hash,
      generation: event.generation, versions: structuredClone(event.changes) };
  }
  /** Index/ownership-derived reads, replay lookups and every write wait for a running
   * restart audit - before the store lock, so a first write never freezes reads behind it. */
  private async awaitAudit(): Promise<void> {
    const state = auditFor(this.root);
    if (state.promise) await state.promise;
    if (state.failure) fail("HELD", 'Restart audit failed: ' + state.failure.join(' '));
  }
  async transact(expectedVersions: SupervisionExpected[], requestId: string, mutations: StoreMutation[], actorInput: SupervisionActor = this.actor): Promise<SupervisionReceipt> {
    SupervisionUuid.parse(requestId);
    const input = { actor: actorInput, expectedVersions, mutations }, body = structuredClone(BodySchema.parse(input));
    // Bind exact canonical submitted data; schema defaults must not silently change request identity.
    if (digest(input) !== digest(body)) fail("CONFLICT", "Submit the complete canonical mutation contract, including workflow defaults.");
    checkInboxRequest(body.mutations, requestId);
    const requestHash = digest(body);
    await this.awaitAudit();
    return this.locked(async () => {
      const snapshot = await this.scan();
      if (snapshot.problems.length) fail("HELD", snapshot.problems.join(" "));
      const replay = this.accepted(snapshot, requestId);
      if (replay) {
        // A supervise-origin successor (a replaced first mate, or the captain's app) may replay the exact
        // recorded content: substitute the recorded actor before comparing hashes. Replay writes nothing.
        if (replay.requestHash !== requestHash && !(superviseReplayEquivalent(replay.actor, body.actor) && digest({ ...body, actor: replay.actor }) === replay.requestHash))
          fail("CONFLICT", "Request ID has different content; retain and inspect the original receipt.");
        return this.receipt(replay); // Before CAS/admission; historical approval is not reauthorized.
      }
      return this.commit(snapshot, body, requestId, requestHash);
    });
  }
  /** Read-only admission check for a whole prepared body: schema, row rules, indexes and the pilot ceilings,
   * without publishing anything. S07 runs it before a freeze so a cutover never strands on an append refusal.
   */
  async validate(expectedVersions: SupervisionExpected[], mutations: StoreMutation[], reserve = 0): Promise<{ sequence: number }> {
    const body = BodySchema.parse({ actor: this.actor, expectedVersions, mutations });
    const snapshot = await this.reading(() => this.sharedScan());
    if (snapshot.problems.length) fail("HELD", snapshot.problems.join(" "));
    const next = this.apply(snapshot.frames, body);
    if ((!this.capacity && snapshot.sequence + 1 + reserve > SUPERVISION_INDEX_LIMITS.transactions) ||
      (this.capacity && (this.capacityPressure(snapshot)!.held.includes("admissions") || snapshot.bytes + (reserve + 1) * 65536 > this.capacity.journalBytes - this.capacityPressure(snapshot)!.reserveBytes)) ||
      Buffer.byteLength(canonical({ frames: [...next.frames], ownership: [...snapshot.ownership, ownership(next.frames)] })) > (this.capacity?.projectionBytes ?? SUPERVISION_INDEX_LIMITS.projectionBytes))
      fail("HELD", `Not enough journal headroom: sequence ${snapshot.sequence}, ${reserve + 1} transactions needed, ceiling ${SUPERVISION_INDEX_LIMITS.transactions}.`);
    return { sequence: snapshot.sequence };
  }
  /** Internal S03 checked preparation: replay precedes current admission; preparation and publication
   * share the coordinator's serialization boundary. No model/network call belongs in prepare.
   */
  async transactCommand(requestId: string, inputHash: string, actorInput: SupervisionActor,
    prepare: (status: SupervisionStatus) => Promise<{ expectedVersions: SupervisionExpected[]; mutations: SupervisionMutation[]; result: ScopedCommandResult }>,
  ): Promise<{ receipt: SupervisionReceipt; result: ScopedCommandResult }> {
    SupervisionUuid.parse(requestId); SupervisionHash.parse(inputHash);
    const actor = structuredClone(SupervisionActorSchema.parse(actorInput));
    await this.awaitAudit();
    return this.locked(async () => {
      const snapshot = await this.scan();
      if (snapshot.problems.length) fail("HELD", snapshot.problems.join(" "));
      const replay = this.accepted(snapshot, requestId);
      if (replay) {
        const accepted = AcceptedScopedCommandSchema.safeParse(snapshot.frames.get(key("command", requestId))?.value);
        if (!accepted.success || accepted.data.inputHash !== inputHash || !superviseReplayEquivalent(accepted.data.actor, actor))
          fail("CONFLICT", "Request ID belongs to different command content or provenance.");
        return { receipt: this.receipt(replay), result: structuredClone(accepted.data.result) };
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
      // Callers (transact/transactCommand) already waited out any restart audit before
      // taking the lock; a write never lands on unverified cache contents.
      // Both transaction entry points must publish a replay marker for this exact request.
      checkInboxRequest(body.mutations, requestId);
      this.writable();
      if (!snapshot.initialized) fail("HELD", "Initialize a new fixture store explicitly.");
      const coordinator = await this.assertCoordinator();
      if ((this.capacity ? this.capacityPressure(snapshot)!.held.includes("admissions") : snapshot.sequence >= SUPERVISION_INDEX_LIMITS.admissions) && body.mutations.some(m => m.kind === "effect" && !snapshot.frames.has(key("effect", m.value.id))))
        fail("HELD", "Pilot admission bound reached; reserve the remaining journal headroom for known work and reconciliation.");
      const next = this.apply(snapshot.frames, body);
      const nextOwnership = ownership(next.frames), nextDigest = ownershipDigest(nextOwnership);
      const retainedOwnership = snapshot.ownership.some(o => ownershipDigest(o) === nextDigest) ? snapshot.ownership : [...snapshot.ownership, nextOwnership];
      // S07: every open cutover keeps one transaction reserved for its release; no other write may take it.
      const open = [...snapshot.frames.values()].filter(f => f.kind === "migration" && ["prepared", "barrier"].includes((f.value as MigrationReceipt).state)).length;
      const releasing = body.mutations.some(m => m.kind === "migration" && m.value.state === "aborted");
      if (open && !releasing && (this.capacity ? snapshot.bytes + (open + 1) * 65536 > this.capacity.journalBytes : snapshot.sequence + 1 > SUPERVISION_INDEX_LIMITS.transactions - open))
        fail("HELD", "The last journal transactions are reserved to release open cutovers; release one (abort) or reconcile the journal deliberately.");
      if ((!this.capacity && snapshot.sequence >= SUPERVISION_INDEX_LIMITS.transactions) || this.projectionSize({ ...snapshot, frames: next.frames, ownership: retainedOwnership }) > (this.capacity?.projectionBytes ?? SUPERVISION_INDEX_LIMITS.projectionBytes))
        fail("HELD", "Pilot history/projection bound reached; stop admissions and retain the journal for audit.");
      const pending = inboxProjection(next.frames).assignments.filter(a => a.primaryEventId === a.id && !terminal(a)).length;
      const oldPending = inboxProjection(snapshot.frames).assignments.filter(a => a.primaryEventId === a.id && !terminal(a)).length;
      if (pending > oldPending && pending > (this.options.maxPendingEvents ?? INBOX_LIMITS.pending)) fail("HELD", "Pending event alarm; ingress baseline has not advanced.");
      await this.checkBlobs(body.mutations);
      const version: 1 | 2 = this.options.legacyFormat ? 1 : 2;
      const nextProjectionAcc = advanceProjection({ vector: Buffer.from(snapshot.projectionVector, "hex"), count: snapshot.frames.size }, snapshot.frames, next.frames, next.changes);
      const projectionSet = projectionSetHash(nextProjectionAcc);
      const event = hashed({ format: version === 2 ? "firstmate.supervision-transaction/2" as const : "firstmate.supervision-transaction/1" as const, homeId: this.homeId,
        sequence: snapshot.sequence + 1, previous: snapshot.hash, generation: coordinator.generation, coordinatorHash: coordinator.hash,
        requestId, requestHash, at: new Date().toISOString(), body, changes: next.changes, projectionHash: version === 2 ? projectionSet : frameDigest(next.frames), outbox: [] as never[] });
      const capsuleBase = { homeId: this.homeId, sequence: event.sequence, previous: event.previous, transactionHash: event.hash,
        requestId, requestHash, generation: event.generation };
      const tip: AnyAnchor = version === 2
        ? hashed({ format: "firstmate.supervision-tip/2" as const, ...capsuleBase, ownershipDigest: nextDigest, ownershipDelta: ownershipDeltaFor(next.changes, next.frames, anchorReset(event.sequence)), projectionSet })
        : hashed({ format: "firstmate.supervision-tip/1" as const, ...capsuleBase, ownership: nextOwnership });
      const marker: AnyAnchor = version === 2
        ? hashed({ format: "firstmate.supervision-publication/2" as const, ...capsuleBase, ownershipDigest: nextDigest, ownershipDelta: ownershipDeltaFor(next.changes, next.frames, anchorReset(event.sequence)), projectionSet })
        : hashed({ format: "firstmate.supervision-publication/1" as const, ...capsuleBase, ownership: nextOwnership });
      const bytes = Buffer.byteLength(canonical(event) + canonical(tip) + canonical(marker)) + 3;
      const candidate = { ...snapshot, frames: next.frames, ownership: retainedOwnership, bytes: snapshot.bytes + bytes,
        transactions: [...snapshot.transactions, indexedTransaction(event)] };
      if (this.projectionSize(candidate) > (this.capacity?.projectionBytes ?? SUPERVISION_INDEX_LIMITS.projectionBytes)) fail("HELD", "Projection/index pressure limit reached; retain history for reconciliation.");
      if (this.capacity && body.mutations.some(m => (m.kind === "effect" || m.kind === "migration") && !snapshot.frames.has(key(m.kind, m.value.id)))) {
        if (this.capacityPressure(candidate)!.held.includes("admissions")) fail("HELD", "Admission would consume reserved reconciliation capacity; no effect was reserved.");
      }
      if (snapshot.bytes + bytes > this.journalLimit()) fail("HELD", "Journal storage alarm; admissions held without evicting history.");
      if (event.sequence > 256) await mkdir(dirname(this.file(event.sequence, "tip")), { recursive: true });
      try {
        await this.publish(this.file(event.sequence, "tip"), tip, "tip");
        await this.publish(this.file(event.sequence, "event"), event, "event");
        await this.publish(this.file(event.sequence, "publication"), marker, "publication");
        await this.saveCheckpoint({ ...snapshot, frames: next.frames, transactions: [...snapshot.transactions, indexedTransaction(event)], sequence: event.sequence,
          hash: event.hash, prefixDigest: extendPrefix(snapshot.prefixDigest, event, tip, marker), ownership: retainedOwnership, bytes: snapshot.bytes + bytes,
          projection: event.projectionHash, projectionSet, projectionVector: nextProjectionAcc.vector.toString("hex"), legacyAnchors: snapshot.legacyAnchors + (version === 1 ? 1 : 0) });
      } catch (error) {
        fail("HELD", `Publication interrupted; reread/reconcile the original request without repeating an effect: ${String(error)}`);
      }
      return this.receipt(event);
  }
  /** Only completes an exact validated event+tip. Missing events/anchors require deliberate repair.
   * No anchor deletion/reconstruction, external dispatch or recovery of a shorter history exists.
   */
  async recoverPublication(observed?: { homeId: string; sequence: number; hash: string | null }): Promise<SupervisionReceipt | null> {
    this.writable();
    return this.locked(async () => {
      await this.assertCoordinator();
      this.cached = null;
      const snapshot = await this.scanFull();
      if (snapshot.problems.some(p => p !== "Final transaction awaits publication.")) fail("HELD", snapshot.problems.join(" "));
      if (observed && (observed.homeId !== this.homeId || observed.sequence !== snapshot.sequence || observed.hash !== snapshot.hash))
        fail("STALE", "Recovery observation changed under the publication repair lock.");
      await this.ancestorCheckpoint(snapshot);
      if (!snapshot.pending) { await this.saveCheckpoint(snapshot); return null; }
      const { event, tip } = snapshot.pending;
      const { hash: _hash, ...body } = tip;
      await this.publish(this.file(event.sequence, "publication"), hashed({ ...body, format: publicationFormat(anchorVersion(tip)) }), "publication");
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
      if (snapshot.bytes + copy.length > (this.capacity ? this.journalLimit() - this.capacityPressure(snapshot)!.reserveBytes : this.journalLimit())) fail("HELD", "Evidence storage alarm; retain existing history and reconciliation reserve.");
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
      await this.cache({ ...snapshot, bytes: snapshot.bytes + priorBytes }, await this.readCheckpoint(), await this.directories());
      return { id, bytes: copy.length };
    });
  }
  /** Explicit migration export only. A consistent audited prefix; never called by a view. */
  async exportSnapshot<T>(copy: (status: SupervisionStatus) => Promise<T>): Promise<T> {
    this.writable();
    return this.locked(async () => {
      await this.assertCoordinator();
      const snapshot = await this.scanFull();
      if (snapshot.problems.length) fail("HELD", "Snapshot requires a complete audited published journal prefix.");
      return copy(structuredClone(this.status(snapshot)));
    });
  }
  /** Concurrent reads in one publication epoch share one validation. reading() still discards,
   * for every sharer, a result that a writer overlapped, so sharing never serves an older head.
   */
  private sharedScan(): Promise<Scan> {
    if (storeLocks.getStore()?.get(this.root)?.active) return this.scan();
    const epoch = publicationFor(this.root).epoch;
    if (this.shared?.epoch === epoch) return this.shared.scan;
    const entry = { epoch, scan: this.scan() }, clear = () => { if (this.shared === entry) this.shared = null; };
    this.shared = entry; entry.scan.then(clear, clear);
    return entry.scan;
  }
  /** Hand a completed full validation from another same-process instance for this exact
   * journal to this cold instance (the runtime's writer adopting its reader's work, instead
   * of validating the whole journal a second time at startup). Only a deep copy is taken, so
   * the two instances diverge independently from here; every later read still verifies the
   * checkpoint anchor before trusting the adopted prefix, exactly as for its own cache.
   * Returns false when there is nothing validated to adopt, leaving the usual full scan.
   */
  adoptValidatedCacheFrom(other: SupervisionStore): boolean {
    if (this.cached || !other.cached || other === this || other.root !== this.root || other.homeId !== this.homeId) return false;
    if (other.cached.scan.problems.length || !other.cached.scan.initialized) return false;
    this.cached = structuredClone(other.cached);
    if (other.capacity) this.capacity = structuredClone(other.capacity);
    return true;
  }
  /** `settleAfterMs` is for status displays only; see reading(). Decisions keep the default. */
  async read(options: { settleAfterMs?: number } = {}): Promise<SupervisionStatus> {
    return this.reading(async () => structuredClone(this.status(await this.sharedScan())),
      options.settleAfterMs === undefined ? undefined : { afterMs: options.settleAfterMs, committed: status => status.freshness === "current" });
  }
  /** Bounded read-only history pages. Continuation pins the inspected head, so concurrent appends cannot silently retarget it. */
  async historyPage(input: { after: number; limit?: number; hash?: string | null }) {
    const limit = input.limit ?? 50;
    if (!Number.isSafeInteger(input.after) || input.after < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 100) fail("CONFLICT", "Invalid history page bounds.");
    await this.awaitAudit();
    return this.reading(async () => {
      const snapshot = await this.sharedScan();
      if (snapshot.problems.length) fail("HELD", snapshot.problems.join(" "));
      if (input.after > snapshot.sequence) fail("STALE", "History cursor is beyond the retained head.");
      if (input.hash !== undefined && input.hash !== snapshot.hash) fail("STALE", "History head changed; restart paging from the current head.");
      const events = snapshot.transactions.slice(input.after, input.after + limit).map(t => ({ ...this.receipt(t), at: t.at, actor: t.actor }));
      return { sequence: snapshot.sequence, hash: snapshot.hash, events, next: input.after + events.length < snapshot.sequence ? input.after + events.length : null };
    });
  }
  /** Content-addressed, confined and bounded; a caller never supplies a filesystem path. */
  async readBlob(id: string, maxBytes = 512 * 1024): Promise<Uint8Array> {
    SupervisionHash.parse(id);
    if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > 512 * 1024) fail("CONFLICT", "Invalid blob read bound.");
    const status = await this.read();
    if (status.freshness !== "current" || !status.versions.some(v => v.kind === "blob" && v.id === id)) fail("HELD", "Only committed evidence in a current journal is readable.");
    const root = await realpath(this.root), directory = await realpath(join(this.root, "blobs")), path = await realpath(join(directory, id));
    const equal = (a: string, b: string) => process.platform === "win32" ? a.toLowerCase() === b.toLowerCase() : a === b;
    if (!equal(directory, join(root, "blobs")) || !equal(path, join(directory, id))) fail("HELD", "Blob escapes its evidence directory.");
    const handle = await open(path, "r");
    try {
      const before = await handle.stat();
      if (!before.isFile() || before.size > maxBytes) fail("HELD", "Evidence text exceeds its read bound.");
      const bytes = Buffer.alloc(before.size + 1), { bytesRead } = await handle.read(bytes, 0, bytes.length, 0), after = await handle.stat();
      const content = bytes.subarray(0, bytesRead);
      if (bytesRead !== before.size || before.size !== after.size || before.mtimeMs !== after.mtimeMs || rawDigest(content) !== id) fail("HELD", "Evidence changed or failed its content digest.");
      return content;
    } finally { await handle.close(); }
  }
  /** The status for one validated scan, memoised on that scan's identity: the scoped clock
   * reads several times a beat, and rebuilding this (two capacity serialisations of every
   * frame and history entry) per read saturated the process on a large journal. Callers
   * still receive only clones (read()/transactCommand), so the memoised master can never be
   * mutated through a returned status; a write publishes a fresh Scan and misses the memo. */
  private status(snapshot: Scan): SupervisionStatus {
    const memo = this.statusMemo, capacityHash = this.capacity?.hash ?? null;
    if (memo && memo.scan === snapshot && memo.capacityHash === capacityHash && memo.frames === snapshot.frames &&
      memo.transactions === snapshot.transactions && memo.ownership === snapshot.ownership &&
      memo.problems === snapshot.problems.length && memo.bytes === snapshot.bytes) return memo.status;
    const status = this.buildStatus(snapshot);
    this.statusMemo = { scan: snapshot, capacityHash, frames: snapshot.frames, transactions: snapshot.transactions,
      ownership: snapshot.ownership, problems: snapshot.problems.length, bytes: snapshot.bytes, status };
    return status;
  }
  private buildStatus(snapshot: Scan): SupervisionStatus {
    const values = <T>(kind: Frame["kind"]) => [...snapshot.frames.values()].filter(f => f.kind === kind).map(f => f.value as T);
    const tasks = values<SupervisionStatus["tasks"][number]>("task"), effects = values<SupervisionStatus["effects"][number]>("effect");
    const pressure = this.capacity ? this.capacityPressure(snapshot)! : undefined;
    return { format: "firstmate.supervision-status/1", homeId: this.homeId,
      freshness: snapshot.problems.length ? "held" : snapshot.initialized ? "current" : "uninitialized",
      sequence: snapshot.sequence, hash: snapshot.hash, executable: false, guarantee: "cooperative-storage-only",
      limits: ["This projection grants no effect authority.",
        this.capacity ? "Paged journal: 256 transactions per directory, global hash chain and full startup audit; byte/projection pressure retains reconciliation reserves. No history eviction." : "Pilot index ceilings: new effects stop at 192 transactions; all writes stop at 256; 8 MiB projection plus retained ownership; 32 transactions per incremental read.",
        "Warm reads trust the validated checkpoint prefix. A restart serves the last fully validated projection cache after re-binding it to the checkpoint and anchor chain and validating the tail; a background full audit then re-verifies every event and anchor, and a divergence surfaces as held on the next read. Anchors are checked on every read.",
        "Actor provenance and filesystem ownership are cooperative, not authenticated IPC or receiver fencing.",
        "Process-crash qualification only; coordinated loss of journal and all local metadata can hide truncation."],
      problems: snapshot.problems, versions: [...snapshot.frames.values()].map(({ kind, id, version }) => ({ kind, id, version })),
      storage: { bytes: snapshot.bytes, limitBytes: this.journalLimit(), ...(pressure ? { capacity: pressure } : {}),
        admissionsHeld: snapshot.problems.length > 0 || snapshot.bytes >= this.journalLimit() ||
          (pressure ? pressure.held.includes("admissions") : snapshot.sequence >= SUPERVISION_INDEX_LIMITS.admissions) },
      scopes: values("scope"), bindings: values("binding"), tasks, attempts: values("attempt"), effects, backends: values("backend"),
      policySources: values("policy-source"), policyRules: values("policy-rule"), policyEvidence: values("policy-evidence"), approvals: values("approval"),
      decisions: values("decision"), outbox: values("outbox"), operationHolds: values("operation-hold"), commands: values("command"),
      continuations: values("continuation"),
      planRules: values("plan-rules"), ruleVerifications: values("rule-verification"), ruleFailures: values("rule-failure"), ruleViolations: values("rule-violation"),
      migrations: values("migration"), dispositions: values("delivery-disposition"),
      uncertainEffectIds: effects.filter(e => ["dispatching", "uncertain"].includes(e.state)).map(e => e.id),
      plans: values<WorkflowRow>("workflow").map(({ scopeId, plan }) => ({ scopeId, plan })),
      retirements: values<{ scopeId: string; receipt: z.infer<typeof RetirementSchema> }>("retirement")
        .map(({ scopeId, receipt }) => ({ scopeId, plan: receipt.plan, evidence: receipt.evidence, hash: receipt.hash })),
      retainedOwnership: snapshot.ownership,
      inbox: inboxProjection(snapshot.frames),
      sources: { bindings: values("source-binding"), submissions: values("board-submission") },
      projects: { projects: values("project"), sponsors: values("plan-sponsor"), intents: values("intent"), dependencies: values("dependency-resolution"),
        memoryProposals: values("memory-proposal"), memory: values("project-memory"), conflicts: values("portfolio-conflict") },
      maintenance: { reservations: values("resource-reservation"), jobs: values("maintenance-job"), occurrences: values("occurrence"),
        hosts: values("occurrence-host"), incidents: values("maintenance-incident") },
      index: { schema: 1, sequence: snapshot.sequence, hash: snapshot.hash,
        taskOwners: Object.fromEntries(tasks.map(t => [JSON.stringify([t.hostId.trim().toLowerCase(), t.projectId, t.nodeId]), t.ownerScopeId])),
        effectKeys: Object.fromEntries(effects.map(e => [e.logicalKey, e.id])) },
    };
  }
  /** Read accepted transaction identity without reauthorizing it or acquiring the coordinator. */
  async requestReceipt(requestId: string): Promise<SupervisionReceipt | null> {
    await this.awaitAudit();
    return this.reading(async () => {
      const snapshot = await this.sharedScan();
      if (snapshot.problems.length) fail("HELD", snapshot.problems.join(" "));
      const transaction = this.accepted(snapshot, requestId);
      return transaction ? this.receipt(transaction) : null;
    });
  }
  /** Original event/request identity and transaction receipt, independent of later policy changes. */
  async workflowRequest(planId: string, requestId: string): Promise<{ requestHash: string; eventHash: string; receipt: SupervisionReceipt } | null> {
    await this.awaitAudit();
    return this.reading(async () => {
      const snapshot = await this.sharedScan();
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
