/**
 * The receipt journal: a forward-only, append-only, hash-linked record of what the plugin sends, what it
 * sees the first mate do, which first mate was at the helm, and what it writes into the home.
 *
 * **Observe-only, behind `FIRSTMATE_RECEIPT_JOURNAL`, off by default.** Off, nothing here runs: no file is
 * read or written, no message id is added, and every send and write takes exactly the path it took before.
 * On, a receipt is queued beside the live operation and written after it, never before it and never in its
 * way: a journal that cannot be written costs the receipt, not the send. A receipt that could not be written
 * becomes an `uncertainty` entry at the next append that succeeds, and is logged meanwhile; one the chain
 * itself refuses (a broken or tampered journal) is logged and appended, best effort, to
 * `receipt-uncertainties.jsonl` beside it.
 *
 * **Shape.** One canonical-JSON file per entry, `NNNNNNNN.json`, in shards of `SHARD_SIZE` under
 * `$PASEO_HOME/plugin-data/firstmate/receipts/`, published by the same exclusive hard link as
 * `server/submissions.ts`, so a crash leaves a whole entry or a temporary, never half of one. Each entry
 * carries its sequence and the SHA-256 of the canonical previous entry. `verifyReceiptJournal` checks the
 * whole chain and fails closed with a coded `ReceiptJournalError`; an append checks the newest shard and its
 * link to the one before, once per process.
 *
 * **What it cannot see.** Native finish notes (`<paseo-system>`) never reach a timeline the plugin can read,
 * so a crewmate's finish is recorded as `native-finish` with `certainty: "uncertain"` and is never a receipt
 * of delivery. The first mate's own record writes, and anything before the journal was switched on, are not
 * in it either.
 */
import { createHash, randomUUID } from "node:crypto";
import { appendFile, mkdir, readFile, readdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { z } from "zod";

import { readFirstmateConfig } from "./config";
import { pluginDir } from "./data-dir";
import { serialized } from "./serialize";
import { canonical, digest, publish } from "./submissions";

export const RECEIPT_JOURNAL_ENV = "FIRSTMATE_RECEIPT_JOURNAL";

/** The switch. Anything but an explicit yes is off. */
export function receiptJournalEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return /^(1|true|on|yes)$/i.test((env[RECEIPT_JOURNAL_ENV] ?? "").trim());
}

const SHARD_SIZE = 1000;
const MAX_PENDING_UNCERTAINTIES = 1000;
const MAX_ERROR_CHARS = 2000;

const Sha256 = z.string().regex(/^[0-9a-f]{64}$/);
/** A file's content hash, or that it was not there, or that it could not be read. */
const ContentState = z.union([Sha256, z.literal("absent"), z.literal("unknown")]);
const GenerationRef = z.object({ agentId: z.string().min(1), sequence: z.number().int().positive() }).strict();
export type GenerationRef = z.infer<typeof GenerationRef>;

export const SEND_CHANNELS = [
  "crew-steer", "remote-steer", "mate-ask", "mate-compact", "mate-note", "mate-opening", "mate-handover",
  "watch-flush", "inspection-prompt", "inspection-delivery",
] as const;
export type SendChannel = (typeof SEND_CHANNELS)[number];
const Actor = z.enum(["captain", "plugin"]);
export type ReceiptActor = z.infer<typeof Actor>;

const EventSchema = z.discriminatedUnion("kind", [
  /** A plugin process started journaling: anything between its predecessor's last entry and this is unrecorded. */
  z.object({ kind: z.literal("journal-start"), processId: z.uuid(), nativeFinishes: z.literal("excluded-uncertain") }).strict(),
  /** The first entry of every shard: the generation ledger as it stands, so a start-up need read only the newest shard. */
  z.object({
    kind: z.literal("checkpoint"),
    generations: z.record(z.string(), z.number().int().positive()), current: GenerationRef.nullable(),
  }).strict(),
  /** A first mate took or left the helm. `observed` is a change the plugin found in the config rather than made. */
  z.object({
    kind: z.literal("generation"),
    change: z.enum(["launch", "restart", "adopt", "release", "handover", "observed"]),
    agentId: z.string(), previousAgentId: z.string(),
  }).strict(),
  z.object({
    kind: z.literal("send-attempt"), attemptId: z.uuid(), messageId: z.string().min(1),
    /** Whether the recipient's timeline keeps `messageId` as the message's `clientMessageId`. */
    carried: z.boolean(),
    channel: z.enum(SEND_CHANNELS), actor: Actor, recipient: z.string().min(1),
    generation: GenerationRef.nullable(),
    contentSha256: Sha256, contentBytes: z.number().int().nonnegative(), attachments: z.number().int().nonnegative(),
    relates: z.array(z.string().min(1)).max(100),
  }).strict(),
  z.object({
    kind: z.literal("send-result"), attemptId: z.uuid(), messageId: z.string().min(1),
    result: z.enum(["sent", "failed"]), error: z.string().max(MAX_ERROR_CHARS).nullable(),
  }).strict(),
  /** A note for the first mate put in the config's durable outbox; its later send carries `noteId`. */
  z.object({
    kind: z.literal("note-queued"), noteId: z.string().min(1), source: z.enum(["steer-relay", "remote-steer", "watch-runtime"]),
    generation: GenerationRef.nullable(), contentSha256: Sha256, contentBytes: z.number().int().nonnegative(),
    relates: z.array(z.string().min(1)).max(100),
  }).strict(),
  /** A crewmate's ended turn showed it read a board steer: the evidence the steer relay acts on. */
  z.object({
    kind: z.literal("steer-read"), messageId: z.string().min(1), crewAgentId: z.string().min(1),
    turnId: z.string().nullable(), clientMessageIdSeen: z.boolean(),
  }).strict(),
  /** The first mate's tool calls in a turn the plugin saw end; the timeline RPC pages the full record. */
  z.object({
    kind: z.literal("mate-actions"), mateAgentId: z.string().min(1), generation: GenerationRef.nullable(),
    turnId: z.string().nullable(), outcome: z.enum(["completed", "failed", "canceled"]), source: z.literal("turn_ended"),
    actions: z.array(z.object({ callId: z.string(), name: z.string(), status: z.string(), detailSha256: Sha256 }).strict()).max(500),
  }).strict(),
  /** A crewmate of the first mate ended a turn. Paseo may have sent a finish note; nothing the plugin reads says so. */
  z.object({
    kind: z.literal("native-finish"), childAgentId: z.string().min(1), parentAgentId: z.string().min(1),
    turnId: z.string().nullable(), outcome: z.enum(["completed", "failed", "canceled"]),
    certainty: z.literal("uncertain"), reason: z.literal("paseo-system-envelope-not-recorded"),
  }).strict(),
  /** A write the plugin made into the home, bound to the action that made it. */
  z.object({
    kind: z.literal("record-revision"), path: z.string().min(1), before: ContentState, after: ContentState,
    actionId: z.string().min(1), actor: Actor, reason: z.string().min(1).max(200),
  }).strict(),
  /** A receipt that could not be recorded when it happened. */
  z.object({
    kind: z.literal("uncertainty"), reason: z.literal("recording-failed"), lost: z.string(),
    detail: z.record(z.string(), z.string()), error: z.string().max(MAX_ERROR_CHARS), at: z.string(),
  }).strict(),
]);
export type ReceiptEvent = z.infer<typeof EventSchema>;

export const ReceiptEntrySchema = z.object({
  version: z.literal(1), sequence: z.number().int().positive(), previous: Sha256.nullable(), at: z.string(), event: EventSchema,
}).strict();
export type ReceiptEntry = z.infer<typeof ReceiptEntrySchema>;

/** A fail-closed refusal, each with its own code. */
export class ReceiptJournalError extends Error {
  constructor(readonly code: string, message: string, readonly detail: Record<string, unknown> = {}) {
    super(`${code}: ${message}`);
    this.name = "ReceiptJournalError";
  }
}

const ENTRY_FILE = /^(\d{8})\.json$/;
const TEMPORARY_FILE = /^\d{8}\.json\.[\w-]+\.tmp$/;
const SHARD_DIR = /^\d{6}$/;

export const sha256 = (text: string | Buffer) => createHash("sha256").update(text).digest("hex");
const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error)).slice(0, MAX_ERROR_CHARS);
const shardOf = (sequence: number, size: number) => String(Math.floor((sequence - 1) / size)).padStart(6, "0");
const opensShard = (sequence: number, size: number) => (sequence - 1) % size === 0;
const fileOf = (sequence: number) => `${String(sequence).padStart(8, "0")}.json`;

async function listOrEmpty(directory: string): Promise<string[]> {
  try { return await readdir(directory); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return []; throw error; }
}

async function shards(root: string): Promise<string[]> {
  const names = await listOrEmpty(root);
  const unknown = names.find((name) => !SHARD_DIR.test(name));
  if (unknown !== undefined) throw new ReceiptJournalError("JOURNAL_UNEXPECTED_FILE", "The journal directory holds something that is not a shard.", { name: unknown });
  const sorted = names.sort();
  sorted.forEach((name, index) => {
    if (name !== String(index).padStart(6, "0")) throw new ReceiptJournalError("JOURNAL_SHARD_GAP", "The journal's shards are not contiguous.", { name });
  });
  return sorted;
}

/** One entry, read and checked against where it sits and what it follows. */
async function readEntry(root: string, shard: string, name: string, sequence: number, previous: string | null): Promise<ReceiptEntry> {
  const bytes = await readFile(join(root, shard, name), "utf8");
  let parsed: unknown;
  try { parsed = JSON.parse(bytes); }
  catch { throw new ReceiptJournalError("JOURNAL_ENTRY_INVALID", "An entry is not JSON.", { sequence }); }
  const result = ReceiptEntrySchema.safeParse(parsed);
  if (!result.success) throw new ReceiptJournalError("JOURNAL_ENTRY_INVALID", "An entry does not have the journal's shape.", { sequence, issues: result.error.issues.map((issue) => issue.message) });
  const entry = result.data;
  if (bytes !== `${canonical(entry)}\n`) throw new ReceiptJournalError("JOURNAL_NOT_CANONICAL", "An entry is not in canonical form.", { sequence });
  if (entry.sequence !== sequence) throw new ReceiptJournalError("JOURNAL_SEQUENCE_MISMATCH", "An entry's sequence does not match its file.", { sequence });
  if (entry.previous !== previous) throw new ReceiptJournalError("JOURNAL_LINK_BROKEN", "An entry does not link to the one before it.", { sequence });
  return entry;
}

/** The entry files of one shard, in order, checked to be exactly the run its position calls for. */
async function shardEntries(root: string, shard: string, isLast: boolean, size: number): Promise<string[]> {
  const names = await listOrEmpty(join(root, shard));
  const unknown = names.find((name) => !ENTRY_FILE.test(name) && !TEMPORARY_FILE.test(name));
  if (unknown !== undefined) throw new ReceiptJournalError("JOURNAL_UNEXPECTED_FILE", "A shard holds a file that is not an entry.", { shard, name: unknown });
  const entries = names.filter((name) => ENTRY_FILE.test(name)).sort();
  const first = Number(shard) * size + 1;
  entries.forEach((name, index) => {
    if (name !== fileOf(first + index)) throw new ReceiptJournalError("JOURNAL_SEQUENCE_GAP", "The journal has a missing or misplaced entry.", { shard, name });
  });
  if (entries.length === 0 || (!isLast && entries.length !== size))
    throw new ReceiptJournalError("JOURNAL_SHARD_INCOMPLETE", "A shard is empty, or an older shard is not full.", { shard });
  return entries;
}

export interface JournalHead {
  sequence: number;
  hash: string | null;
  /** The newest generation entry for each first mate, and which one is current. */
  generations: Map<string, number>;
  current: GenerationRef | null;
}

function applyGeneration(head: JournalHead, entry: ReceiptEntry): void {
  if (entry.event.kind !== "generation") return;
  if (entry.event.agentId === "") { head.current = null; return; }
  head.generations.set(entry.event.agentId, entry.sequence);
  head.current = { agentId: entry.event.agentId, sequence: entry.sequence };
}

function checkpointOf(head: JournalHead): Extract<ReceiptEvent, { kind: "checkpoint" }> {
  return { kind: "checkpoint", generations: Object.fromEntries([...head.generations].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))), current: head.current };
}

/**
 * Checks the whole chain and answers with its head; throws `ReceiptJournalError` on anything out of place.
 * Read-only.
 */
export async function verifyReceiptJournal(root: string, size = SHARD_SIZE): Promise<{ entries: number; head: string | null; generations: number }> {
  const head = await loadHead(resolve(root), "full", size);
  return { entries: head.sequence, head: head.hash, generations: head.generations.size };
}

/**
 * The chain's head. `full` reads every entry; `newest` reads the newest shard and the last entry of the one
 * before, which is what an append needs to link and to stay on a chain that is whole where it grows, and
 * takes the generations from the shard's opening checkpoint.
 */
async function loadHead(root: string, mode: "full" | "newest", size: number): Promise<JournalHead> {
  const all = await shards(root);
  const head: JournalHead = { sequence: 0, hash: null, generations: new Map(), current: null };
  if (all.length === 0) return head;
  let start = 0;
  if (mode === "newest" && all.length > 1) {
    start = all.length - 1;
    const before = all[start - 1]!;
    const entries = await shardEntries(root, before, false, size);
    const last = Number(before) * size + entries.length;
    const bytes = await readFile(join(root, before, entries.at(-1)!), "utf8");
    const parsed = ReceiptEntrySchema.safeParse((() => { try { return JSON.parse(bytes); } catch { return null; } })());
    if (!parsed.success || parsed.data.sequence !== last || bytes !== `${canonical(parsed.data)}\n`)
      throw new ReceiptJournalError("JOURNAL_ENTRY_INVALID", "The last entry before the newest shard is unreadable.", { sequence: last });
    head.sequence = last;
    head.hash = digest(parsed.data);
  }
  for (let index = start; index < all.length; index++) {
    const shard = all[index]!;
    for (const name of await shardEntries(root, shard, index === all.length - 1, size)) {
      const entry = await readEntry(root, shard, name, head.sequence + 1, head.hash);
      if (opensShard(entry.sequence, size) !== (entry.event.kind === "checkpoint"))
        throw new ReceiptJournalError("JOURNAL_CHECKPOINT_MISPLACED", "Every shard opens with a checkpoint, and only there.", { sequence: entry.sequence });
      if (entry.event.kind === "checkpoint") {
        if (mode === "full" || index > start) {
          if (canonical(entry.event) !== canonical(checkpointOf(head)))
            throw new ReceiptJournalError("JOURNAL_CHECKPOINT_MISMATCH", "A checkpoint does not match the generations before it.", { sequence: entry.sequence });
        } else {
          head.generations = new Map(Object.entries(entry.event.generations));
          head.current = entry.event.current;
        }
      }
      applyGeneration(head, entry);
      head.sequence = entry.sequence;
      head.hash = digest(entry);
    }
  }
  return head;
}

/** Every entry, in order, after a full check. Read-only. */
export async function readReceiptJournal(root: string, size = SHARD_SIZE): Promise<ReceiptEntry[]> {
  const directory = resolve(root);
  await verifyReceiptJournal(directory, size);
  const entries: ReceiptEntry[] = [];
  for (const shard of await shards(directory)) {
    for (const name of await listOrEmpty(join(directory, shard))) {
      if (ENTRY_FILE.test(name)) entries.push(ReceiptEntrySchema.parse(JSON.parse(await readFile(join(directory, shard, name), "utf8"))));
    }
  }
  return entries.sort((a, b) => a.sequence - b.sequence);
}

/** What a send's receipt is told, beside the words themselves. */
export interface SendReceipt {
  channel: SendChannel;
  actor: ReceiptActor;
  /** The ids this send follows from: a relay's steers, a note's queueing. */
  relates?: readonly string[];
}

export interface SendHandle {
  messageId: string;
  settle(result: "sent" | "failed", error?: unknown): void;
}

/** An event whose `generation` the journal fills in when it is appended. */
type Draft =
  | ReceiptEvent
  | (Omit<Extract<ReceiptEvent, { kind: "send-attempt" }>, "generation"> & { generationOf: string | null })
  | (Omit<Extract<ReceiptEvent, { kind: "note-queued" }>, "generation"> & { generationOf: string | null })
  | (Omit<Extract<ReceiptEvent, { kind: "mate-actions" }>, "generation"> & { generationOf: string | null });

export interface ReceiptJournalOptions {
  /** The first mate the config names now; "" when none. */
  currentMate?: () => Promise<string>;
  now?: () => Date;
  /** Where a receipt the chain refuses is kept, best effort. */
  fallbackFile?: string;
  /** Entries per shard; smaller only in tests. */
  shardSize?: number;
}

export class ReceiptJournal {
  readonly root: string;
  private readonly shardSize: number;
  private head: JournalHead | null = null;
  private started = false;
  private readonly processId = randomUUID();
  private queue: Promise<void> = Promise.resolve();
  private readonly uncertain: Array<Extract<ReceiptEvent, { kind: "uncertainty" }>> = [];
  private droppedUncertainties = 0;

  constructor(root: string, private readonly options: ReceiptJournalOptions = {}) {
    this.root = resolve(root);
    this.shardSize = options.shardSize ?? SHARD_SIZE;
    // A shard of one would have room for its checkpoint and nothing else.
    if (!Number.isInteger(this.shardSize) || this.shardSize < 2) throw new Error("A receipt shard holds at least two entries.");
  }

  private now(): Date { return (this.options.now ?? (() => new Date()))(); }

  /**
   * Queues an event, to be appended after everything queued before it. Never throws and never waits:
   * the live operation it describes has already happened or is about to, whatever becomes of this.
   */
  record(draft: Draft): void {
    const at = this.now().toISOString();
    // The first mate at the time of the event, asked now rather than when the queue reaches it.
    const mate = "generationOf" in draft && draft.generationOf === null ? this.askCurrentMate() : Promise.resolve(null);
    this.queue = this.queue.then(() => this.appendDraft(draft, at, mate)).catch((error: unknown) => this.lose(draft, at, error));
  }

  private askCurrentMate(): Promise<string> {
    try {
      return (this.options.currentMate?.() ?? Promise.resolve("")).then((id) => id.trim(), () => "");
    } catch {
      return Promise.resolve("");
    }
  }

  /** Resolves once everything queued so far has been appended or given up as uncertain. */
  settled(): Promise<void> { return this.queue; }

  /** Opens a send's receipt: the attempt is recorded now, its result when `settle` is called. */
  beginSend(input: SendReceipt & { recipient: string; text: string; messageId?: string; carried?: boolean; attachments?: number; mateRecipient?: boolean }): SendHandle {
    const attemptId = randomUUID();
    const messageId = input.messageId ?? `firstmate-${input.channel}-${randomUUID()}`;
    this.record({
      kind: "send-attempt", attemptId, messageId, carried: input.carried ?? true, channel: input.channel, actor: input.actor,
      recipient: input.recipient, generationOf: input.mateRecipient === true ? input.recipient : null,
      contentSha256: sha256(input.text), contentBytes: Buffer.byteLength(input.text), attachments: input.attachments ?? 0,
      relates: [...(input.relates ?? [])].slice(0, 100),
    });
    let settled = false;
    return {
      messageId,
      settle: (result, error) => {
        if (settled) return;
        settled = true;
        this.record({ kind: "send-result", attemptId, messageId, result, error: result === "failed" ? errorText(error) : null });
      },
    };
  }

  private async appendDraft(draft: Draft, at: string, currentMate: Promise<string | null>): Promise<void> {
    await serialized(this.root, async () => {
      const head = await this.loadOnce();
      if (!this.started) {
        await this.write(head, { kind: "journal-start", processId: this.processId, nativeFinishes: "excluded-uncertain" }, at);
        this.started = true;
      }
      while (this.uncertain.length > 0) {
        await this.write(head, this.uncertain[0]!, this.uncertain[0]!.at);
        this.uncertain.shift();
      }
      if (this.droppedUncertainties > 0) {
        await this.write(head, { kind: "uncertainty", reason: "recording-failed", lost: "uncertainties", at,
          detail: { count: String(this.droppedUncertainties) }, error: "More receipts failed than the journal holds in memory." }, at);
        this.droppedUncertainties = 0;
      }
      await this.write(head, await this.resolve(head, draft, at, await currentMate), at);
    });
  }

  /** Fills in a draft's generation, recording a first-mate change found in the config first. */
  private async resolve(head: JournalHead, draft: Draft, at: string, currentMate: string | null): Promise<ReceiptEvent> {
    if (!("generationOf" in draft)) return draft;
    const { generationOf, ...event } = draft;
    // A send to a first mate belongs to that first mate's generation; anything else to the one at the helm then.
    const mate = generationOf ?? currentMate ?? "";
    if (mate === "") return { ...event, generation: null } as ReceiptEvent;
    const known = generationOf !== null ? head.generations.has(mate) : head.current?.agentId === mate;
    if (!known) await this.write(head, { kind: "generation", change: "observed", agentId: mate, previousAgentId: head.current?.agentId ?? "" }, at);
    return { ...event, generation: { agentId: mate, sequence: head.generations.get(mate)! } } as ReceiptEvent;
  }

  private async loadOnce(): Promise<JournalHead> {
    if (this.head === null) {
      await mkdir(this.root, { recursive: true });
      this.head = await loadHead(this.root, "newest", this.shardSize);
    }
    return this.head;
  }

  private async write(head: JournalHead, event: ReceiptEvent, at: string): Promise<void> {
    if (opensShard(head.sequence + 1, this.shardSize) && event.kind !== "checkpoint") await this.write(head, checkpointOf(head), at);
    const entry = ReceiptEntrySchema.parse({ version: 1, sequence: head.sequence + 1, previous: head.hash, at, event });
    const directory = join(this.root, shardOf(entry.sequence, this.shardSize));
    await mkdir(directory, { recursive: true });
    try {
      await publish(join(directory, fileOf(entry.sequence)), entry);
    } catch (error) {
      // Another writer got there first: forget what this process knew, and let the next append re-read it.
      if ((error as NodeJS.ErrnoException).code === "EEXIST") this.head = null;
      throw error;
    }
    applyGeneration(head, entry);
    head.sequence = entry.sequence;
    head.hash = digest(entry);
  }

  /** A receipt that could not be appended: kept for the next append, logged, and never thrown. */
  private lose(draft: Draft, at: string, error: unknown): void {
    const reason = errorText(error);
    console.error(`[firstmate] receipt journal could not record ${draft.kind}; recorded as uncertain:`, reason);
    const detail: Record<string, string> = {};
    for (const key of ["messageId", "attemptId", "noteId", "actionId", "path", "agentId", "mateAgentId", "childAgentId", "channel", "recipient"] as const) {
      const value = (draft as Record<string, unknown>)[key];
      if (typeof value === "string") detail[key] = value;
    }
    const uncertainty = { kind: "uncertainty" as const, reason: "recording-failed" as const, lost: draft.kind, detail, error: reason, at };
    if (draft.kind === "uncertainty") return;
    if (error instanceof ReceiptJournalError) {
      // The chain itself is refused; nothing more will be appended to it until someone repairs it.
      const file = this.options.fallbackFile;
      if (file !== undefined) void appendFile(file, `${JSON.stringify(uncertainty)}\n`, "utf8").catch(() => {});
      return;
    }
    if (this.uncertain.length < MAX_PENDING_UNCERTAINTIES) this.uncertain.push(uncertainty);
    else this.droppedUncertainties++;
  }
}

// ---------------------------------------------------------------------------
// The plugin's own journal, when the switch is on
// ---------------------------------------------------------------------------

let shared: ReceiptJournal | null = null;

/** The directory the plugin's journal lives in. */
export function receiptJournalRoot(): string {
  return join(pluginDir(), "receipts");
}

/** The plugin's journal, or null when the switch is off — in which case callers do exactly what they did before. */
export function receiptJournal(): ReceiptJournal | null {
  if (!receiptJournalEnabled()) return null;
  const root = resolve(receiptJournalRoot());
  if (shared === null || shared.root !== root) {
    shared = new ReceiptJournal(root, {
      currentMate: async () => (await readFirstmateConfig()).mateAgentId,
      fallbackFile: join(pluginDir(), "receipt-uncertainties.jsonl"),
    });
  }
  return shared;
}

/** A first mate took or left the helm. */
export function recordGeneration(change: "launch" | "restart" | "adopt" | "release" | "handover", agentId: string, previousAgentId: string): void {
  receiptJournal()?.record({ kind: "generation", change, agentId, previousAgentId });
}

/** An id for a send that has none of its own, when the journal is on; undefined, and no change, when off. */
export function receiptMessageId(channel: SendChannel): string | undefined {
  return receiptJournal() === null ? undefined : `firstmate-${channel}-${randomUUID()}`;
}

/** Who did a write, and as part of what. */
export interface RecordOrigin {
  actionId: string;
  actor: ReceiptActor;
  reason: string;
}

export function newAction(reason: string, actor: ReceiptActor = "plugin"): RecordOrigin {
  return { actionId: `firstmate-action-${randomUUID()}`, actor, reason };
}

async function contentState(path: string): Promise<z.infer<typeof ContentState>> {
  try { return sha256(await readFile(path)); }
  catch (error) { return (error as NodeJS.ErrnoException).code === "ENOENT" ? "absent" : "unknown"; }
}

/**
 * Runs a write into the home — `path` is the file relative to it, as the ledger names it — and, when the journal is on, records the file's content hash before and after
 * it. Off, it is `write()` and nothing else. The write's own result and errors are passed on untouched; a
 * hash that cannot be read is "unknown", never a failure. `after` is the hash of what was written when the
 * caller knows it, so a write landing just after this one is not mistaken for it.
 *
 * Returns whatever `write` does; a write that reports `false` (it wrote nothing) is not recorded.
 */
export async function observedWrite<T>(
  target: { absolute: string; path: string },
  origin: RecordOrigin | (() => RecordOrigin),
  write: () => Promise<T>,
  known: { before?: string | null; after?: string | null } = {},
): Promise<T> {
  const journal = receiptJournal();
  if (journal === null) return write();
  const { absolute, path } = target;
  const before = known.before === undefined ? await contentState(absolute) : known.before === null ? "absent" : sha256(known.before);
  const result = await write();
  if (result === false) return result;
  const after = known.after === undefined ? await contentState(absolute) : known.after === null ? "absent" : sha256(known.after);
  if (before !== after) {
    const { actionId, actor, reason } = typeof origin === "function" ? origin() : origin;
    journal.record({ kind: "record-revision", path: path.replace(/\\/g, "/"), before, after, actionId, actor, reason });
  }
  return result;
}
