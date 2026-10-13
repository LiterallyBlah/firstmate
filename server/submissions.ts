/** Content-bound outbox with immutable, linked revisions, independent of a topic registry.
 * No delivery scheduler, agent actions, RPC or filesystem request consumer is wired to it.
 * The caller supplies authenticated actor context; JSON and environment assertions are not auth.
 */
import { createHash, randomUUID } from "node:crypto";
import { link, mkdir, open, readFile, readdir, unlink } from "node:fs/promises";
import { join, resolve } from "node:path";
import { z } from "zod";
import {
  SubmissionActorSchema, SubmissionNamespaceSchema, SubmissionPayloadSchema,
  SubmissionReceiptSchema, SubmissionRecordSchema,
  type SubmissionActor, type SubmissionNamespace, type SubmissionPayload,
  type SubmissionReceipt, type SubmissionRecord,
} from "../shared/submissions";
import { serialized } from "./serialize";

/** Stable object order; array order and exact text remain part of the submitted content. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object") return `{${Object.entries(value).filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(",")}}`;
  return JSON.stringify(value);
}
function digest(value: unknown): string { return createHash("sha256").update(canonical(value)).digest("hex"); }
export function submissionHash(payload: SubmissionPayload): string { return digest(SubmissionPayloadSchema.parse(payload)); }
const sameActor = (a: SubmissionActor | null, b: SubmissionActor) => a?.agentId === b.agentId && a.generation === b.generation;
const terminal = (record: SubmissionRecord) => ["declined", "completed"].includes(record.receipts.at(-1)?.disposition ?? "");

export class SubmissionConflict extends Error {
  constructor(message: string, readonly saved: SubmissionRecord) { super(message); }
}

/** Hard-link publication is exclusive across processes. A crash leaves a whole revision or a temp,
 * never a partially published request. No file/registry registration gap exists.
 */
async function publish(path: string, value: unknown): Promise<void> {
  const temporary = `${path}.${randomUUID()}.tmp`;
  const file = await open(temporary, "wx");
  try { await file.writeFile(`${canonical(value)}\n`, "utf8"); await file.sync(); }
  finally { await file.close(); }
  try { await link(temporary, path); }
  finally { await unlink(temporary).catch(() => {}); }
}

export class SubmissionStore {
  private readonly root: string;
  readonly namespace: SubmissionNamespace;
  constructor(root: string, namespace: SubmissionNamespace,
    private readonly afterCommit?: (record: SubmissionRecord) => Promise<void>) {
    this.root = resolve(root);
    this.namespace = Object.freeze(SubmissionNamespaceSchema.parse(namespace));
  }
  /** Explicitly for a new store, never a missing-store fallback during recovery. */
  async initialize(): Promise<void> {
    await mkdir(this.root, { recursive: true });
    try { await this.identity(); return; }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    const entries = await readdir(this.root);
    if (entries.some(name => !/^identity\.json\.[\w-]+\.tmp$/.test(name))) {
      throw new Error("Submission identity is missing from a nonempty store; explicit repair is required.");
    }
    try { await publish(join(this.root, "identity.json"), { version: 1, ...this.namespace }); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; }
    await this.identity();
  }
  private async identity(): Promise<void> {
    const identity = z.object({ version: z.literal(1), ...SubmissionNamespaceSchema.shape }).strict()
      .parse(JSON.parse(await readFile(join(this.root, "identity.json"), "utf8")));
    if (identity.homeId !== this.namespace.homeId || identity.fleetId !== this.namespace.fleetId)
      throw new Error("Submission store belongs to a different home/fleet.");
  }
  private directory(id: string): string { return join(this.root, z.uuid().parse(id)); }
  private async read(id: string): Promise<SubmissionRecord | null> {
    const directory = this.directory(id);
    let files: string[];
    try { files = await readdir(directory); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw error; }
    const revisions = files.filter(file => /^\d{8}\.json$/.test(file)).sort();
    if (files.some(file => !/^\d{8}\.json(?:\.[\w-]+\.tmp)?$/.test(file))) throw new Error("Unknown file in submission journal.");
    let prior: SubmissionRecord | null = null;
    for (let n = 0; n < revisions.length; n++) {
      if (revisions[n] !== `${String(n).padStart(8, "0")}.json`) throw new Error("Submission journal has a revision gap.");
      const record = SubmissionRecordSchema.parse(JSON.parse(await readFile(join(directory, revisions[n]!), "utf8")));
      if (record.id !== id || record.revision !== n || record.previous !== (prior === null ? null : digest(prior)) ||
          record.payloadHash !== submissionHash(record.payload) ||
          (prior !== null && record.payloadHash !== prior.payloadHash) ||
          record.payload.homeId !== this.namespace.homeId || record.payload.fleetId !== this.namespace.fleetId)
        throw new Error("Submission journal identity/content mismatch.");
      prior = record;
    }
    return prior;
  }
  private async commit(record: SubmissionRecord): Promise<SubmissionRecord> {
    SubmissionRecordSchema.parse(record);
    if (record.revision > 99999999) throw new Error("Submission revision capacity exceeded.");
    const directory = this.directory(record.id);
    await mkdir(directory, { recursive: true });
    try { await publish(join(directory, `${String(record.revision).padStart(8, "0")}.json`), record); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST") throw new Error("Submission changed in another process; reload its receipt before retrying.");
      throw error;
    }
    await this.afterCommit?.(record);
    return record;
  }
  private async locked<T>(work: () => Promise<T>): Promise<T> {
    return serialized(this.root, async () => { await this.identity(); return work(); });
  }
  /** Persist BEFORE any transport call. Recoverable through list() after a lost return value. */
  prepare(id: string, input: SubmissionPayload): Promise<SubmissionRecord> {
    const payload = SubmissionPayloadSchema.parse(input);
    if (payload.homeId !== this.namespace.homeId || payload.fleetId !== this.namespace.fleetId)
      return Promise.reject(new Error("Wrong submission home/fleet."));
    return this.locked(async () => {
      const saved = await this.read(id);
      const hash = submissionHash(payload);
      if (saved !== null) {
        if (saved.payloadHash !== hash) throw new SubmissionConflict("Same submission ID has different content. Submit a correction with a new ID.", saved);
        return saved;
      }
      return this.commit({ version: 1, id, revision: 0, previous: null, payload, payloadHash: hash,
        createdAt: new Date().toISOString(), transport: "queued", owner: null, attempts: [], recorded: [], receipts: [] });
    });
  }
  get(id: string): Promise<SubmissionRecord | null> { return this.locked(() => this.read(id)); }
  list(): Promise<SubmissionRecord[]> {
    return this.locked(async () => {
      const records: SubmissionRecord[] = [];
      for (const entry of await readdir(this.root, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        const record = await this.read(entry.name);
        if (record) records.push(record); // Empty preparation never published or permitted a send.
      }
      return records.sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
    });
  }
  /** Includes recorded-to-old-mate and partially processed work, independent of backlog retention. */
  async recoveryInbox(): Promise<SubmissionRecord[]> { return (await this.list()).filter(record => !terminal(record)); }
  private change(id: string, operation: (record: SubmissionRecord) => SubmissionRecord): Promise<SubmissionRecord> {
    return this.locked(async () => {
      const current = await this.read(id);
      if (!current) throw new Error("Unknown submission.");
      const next = operation(structuredClone(current));
      if (digest(next) === digest(current)) return current;
      return this.commit({ ...next, revision: current.revision + 1, previous: digest(current) });
    });
  }
  /** Claim once, BEFORE sending. Crash before send and crash after send both remain uncertain.
   * No automatic resend method exists: an absent/unavailable timeline cannot prove nondelivery.
   */
  beginDelivery(id: string, actor: SubmissionActor): Promise<SubmissionRecord> {
    const target = SubmissionActorSchema.parse(actor);
    return this.change(id, record => {
      if (record.transport !== "queued") throw new SubmissionConflict("Delivery already claimed; reconcile uncertainty before any new instruction.", record);
      record.owner = target; record.transport = "uncertain";
      record.attempts.push({ id: randomUUID(), actor: target, messageId: `firstmate-topic-${id}`, at: new Date().toISOString() });
      return record;
    });
  }
  /** Call only with affirmative transport evidence matching the immutable envelope, never absence. */
  recordDelivery(id: string, attemptId: string, payloadHash: string, evidence: string): Promise<SubmissionRecord> {
    return this.change(id, record => {
      if (payloadHash !== record.payloadHash || !record.attempts.some(a => a.id === attemptId) || !evidence.trim())
        throw new SubmissionConflict("Delivery evidence does not match the saved attempt/content.", record);
      if (!record.recorded.some(r => r.attemptId === attemptId)) record.recorded.push({ attemptId, evidence, at: new Date().toISOString() });
      record.transport = "recorded";
      return record;
    });
  }
  /** Explicit reconciliation ownership transfer, not a resend and not completion. */
  transfer(id: string, expectedOwner: SubmissionActor, next: SubmissionActor): Promise<SubmissionRecord> {
    const expected = SubmissionActorSchema.parse(expectedOwner), target = SubmissionActorSchema.parse(next);
    return this.change(id, record => {
      if (!sameActor(record.owner, expected) || terminal(record)) throw new SubmissionConflict("Reconciliation owner changed or work is terminal.", record);
      record.owner = target; return record;
    });
  }
  /** The verifiedActor comes from a trusted server context, NOT fields in an ack request file. */
  acknowledge(id: string, input: SubmissionReceipt, verifiedActor: SubmissionActor): Promise<SubmissionRecord> {
    const receipt = SubmissionReceiptSchema.parse(input);
    const actor = SubmissionActorSchema.parse(verifiedActor);
    if (!sameActor(receipt.actor, actor)) return Promise.reject(new Error("Acknowledgement actor is not verified."));
    return this.change(id, record => {
      const prior = record.receipts.find(r => r.requestId === receipt.requestId);
      if (prior) {
        if (digest(prior) !== digest(receipt)) throw new SubmissionConflict("Ack request ID has different content.", record);
        return record;
      }
      if (!sameActor(record.owner, actor) || record.transport === "queued" || terminal(record))
        throw new SubmissionConflict("Stale mate generation, unclaimed submission, or terminal outcome.", record);
      const ids = receipt.actions.map(a => a.id);
      if (new Set(ids).size !== ids.length) throw new Error("Duplicate action identity.");
      for (const old of record.receipts.at(-1)?.actions ?? []) {
        const next = receipt.actions.find(a => a.id === old.id);
        if (!next || (old.state === "completed" && (next.state !== "completed" || next.evidence !== old.evidence)))
          throw new Error("Acknowledgement loses recorded action progress.");
      }
      if (receipt.actions.some(a => a.state === "completed" && !a.evidence.trim()) ||
          (receipt.disposition === "completed" && (!receipt.actions.length || receipt.actions.some(a => a.state !== "completed"))))
        throw new Error("Completed effects need individual evidence.");
      record.receipts.push(receipt);
      return record;
    });
  }
}
