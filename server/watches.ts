/**
 * The watch runner: runs the scripts in the home's `watches/` folder on their schedules while the
 * daemon is up, and sends the first mate whatever they print.
 *
 * Paseo's own schedules always prompt an agent, and most runs of a watch should cost nothing, so the
 * plugin keeps its own clock: a timer on each minute's boundary that runs every enabled, valid watch
 * whose schedule (`watch-schedule.ts`) matches that minute. A run prints nothing — the usual case —
 * and nothing happens. A run that prints something is queued, and the queue goes to the first mate in
 * one message once it is idle: `<firstmate-watch>` blocks one after another, one per run, each holding
 * everything that run printed, and nothing of the plugin's — how the output is to be read, and what in it is quoted from
 * others, is for the script to say. While it is mid-turn, or while there is no first mate at all,
 * the ordinary queue waits, at most `MAX_QUEUED` long, the oldest dropped first and the drop counted in the
 * next message, as a `<firstmate-watch-dropped count="N"/>` ahead of its blocks.
 *
 * Guardrails: a run has `WATCH_TIMEOUT_MS`; its output is clipped to `MAX_OUTPUT_CHARS`, with a
 * marker; a watch still running when it is due again is not started twice; and a watch that fails —
 * a non-zero exit, a timeout, a script that will not start — is reported once, with the end of its
 * stderr, and not again until a run succeeds.
 *
 * A script runs in the home with the daemon's environment and these:
 *
 *     FIRSTMATE_HOME         the first mate's home
 *     FIRSTMATE_BACKLOG      <home>/data/backlog.md
 *     FIRSTMATE_WATCH_NAME   the script's file name
 *     FIRSTMATE_WATCH_STATE  a directory of its own to remember what it last saw, kept across runs:
 *                            $PASEO_HOME/plugin-data/firstmate/watch-state/<name>/
 *
 * What the board shows of each watch and the queue itself are kept in
 * `$PASEO_HOME/plugin-data/firstmate/watches.json`, so a plugin reload neither loses an output a
 * watch has already moved past nor forgets that a failure was reported.
 */
import { randomUUID } from "node:crypto";
import { mkdir, readdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { z } from "zod";

import type { WatchResult, WatchSummary } from "../shared/fleet";
import { WATCH_MESSAGE_ID_PREFIX } from "../shared/fleet";
import { watchRouting, type ManagedWatch } from "../shared/watch-routing";
import { serialized } from "./serialize";
import { digest } from "./submissions";
import { CutoverRefusal, itemFingerprint, type CutoverGate, type GateItem } from "./supervision-gate";
import { TEMPLATES, message } from "./templates";
import { BUILT_IN_WATCHES, builtInStates, listWatches, seedWatches, type WatchFile } from "./watch-files";
import { runWatchScript, type RunResult } from "./watch-run";
import { isDue } from "./watch-schedule";

export const WATCH_TIMEOUT_MS = 2 * 60 * 1000;
/** The most of one run's output sent to the first mate. */
export const MAX_OUTPUT_CHARS = 16000;
/** The most of a failed run's stderr sent, from its end. */
export const MAX_ERROR_CHARS = 1500;
/** Pending outputs per home. Held and in-flight rows share this capacity and cannot be evicted. */
export const MAX_QUEUED = 20;
/**
 * The most one catch-up message may hold, tags and all. Past it the oldest blocks go whole — never one
 * cut in the middle — and are counted in the dropped tag; the newest block always goes.
 */
export const MAX_MESSAGE_CHARS = 32000;
const MINUTE_MS = 60 * 1000;
/**
 * After the first mate's turn ends, when to try the queue: its snapshot can still say running for a
 * moment, and a turn it starts straight away — a crewmate's finish note — has to be waited out, not
 * interrupted. The minute's tick catches anything later.
 */
export const AFTER_TURN_DELAYS_MS: readonly number[] = [1000, 5000, 15000];

interface WatchRecord {
  lastRunAt: string | null;
  lastResult: WatchResult;
  lastOutput: string | null;
  lastOutputAt: string | null;
  lastError: string | null;
  /** Failing since a failure that has been reported; cleared by a run that succeeds. */
  failing: boolean;
}

/** One thing waiting to be told to the first mate. */
export interface QueuedNote {
  name: string;
  ran: string;
  kind: "output" | "failed";
  /** The output, or for a failure the end of stderr. */
  text: string;
  /** For a failure, what went wrong. */
  reason?: string;
  /** Immutable home/occurrence identity, shared by every ordinary and held row. */
  ownership?: { owner: string; id: string; occurrence?: string };
  /** A refusal changes admission, never the queue or lifetime of the output. */
  hold?: { plan: string; stage: string; reason: string };
  /** Write-ahead reservation: unknown outcomes never enter automatic admission again. */
  delivery?: { state: "uncertain" | "accepted"; recipient: string; messageId: string; claim: string | null };
}

const OwnershipSchema = z.object({ owner: z.string().regex(/^[0-9a-f]{64}$/), id: z.string(), occurrence: z.string().optional() }).strict();
const HoldSchema = z.object({ plan: z.string().regex(/^[a-z0-9][a-z0-9-]*$/), stage: z.string(), reason: z.string() }).strict();
const DeliverySchema = z.object({ state: z.enum(["uncertain", "accepted"]), recipient: z.string(), messageId: z.string(), claim: z.string().nullable() }).strict();
export const watchOwner = (gate: CutoverGate) => digest(process.platform === "win32" ? gate.root.toLowerCase() : gate.root);
const bareNote = ({ ownership: _ownership, hold: _hold, delivery: _delivery, ...note }: QueuedNote): QueuedNote => note;
function watchMessageId(note: QueuedNote, owner: string, occurrence?: string): string {
  const identity = bareNote(note);
  if (occurrence) identity.ran = occurrence; // Timer retries within a due minute keep one identity.
  const hash = digest({ owner, note: identity }).slice(0, 32);
  return `${WATCH_MESSAGE_ID_PREFIX}${hash.slice(0, 8)}-${hash.slice(8, 12)}-${hash.slice(12, 16)}-${hash.slice(16, 20)}-${hash.slice(20)}`;
}
const occurrenceOrder = (a: { ran: string; key: string }, b: { ran: string; key: string }) =>
  Date.parse(a.ran) - Date.parse(b.ran) || a.key.localeCompare(b.key);
export interface WatchDelivery { owner: string; recipient: string; messageId?: string }

interface RunnerState {
  watches: Record<string, WatchRecord>;
  queue: QueuedNote[];
  /** Outputs dropped from a full queue since the last delivery. */
  dropped: number;
}

/** Whether the note reached the first mate, or has to wait for it — busy, or not there. */
export type DeliveryOutcome = "sent" | "wait";

export interface WatchRunnerOptions {
  /** The first mate's home, or null while no launch has prepared one. */
  home: () => Promise<string | null>;
  /** Names the captain has switched off. */
  disabled: () => Promise<readonly string[]>;
  /** Sends the note, or says to wait: while the first mate is mid-turn, or while there is none. */
  deliver: (text: string, expected?: WatchDelivery) => Promise<DeliveryOutcome>;
  /** Persist isolated-session inputs before removing them from the script's delivery path. */
  routeNote?: (note: QueuedNote) => Promise<boolean>;
  canRun?: (name: string) => Promise<boolean>;
  /** S07 cutover gate for enqueue and send admission, with the configured recipient; none while unhomed. */
  gate?: () => Promise<{ gate: CutoverGate; recipient: string } | null>;
  /** The runner's own file, `watches.json`. */
  stateFile: string;
  /** Where each script's `FIRSTMATE_WATCH_STATE` directory goes. */
  scriptStateRoot: string;
  now?: () => Date;
  run?: typeof runWatchScript;
  timeoutMs?: number;
  env?: NodeJS.ProcessEnv;
}

const BLANK: WatchRecord = {
  lastRunAt: null,
  lastResult: "never",
  lastOutput: null,
  lastOutputAt: null,
  lastError: null,
  failing: false,
};

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** An instant as the note writes it: UTC to the second. */
function stamp(at: Date): string {
  return at.toISOString().replace(/\.\d{3}Z$/, "Z");
}

/** Output cut to `max` characters, with a marker saying how much was left out. */
export function clip(text: string, max: number, cutAlready = false): string {
  if (text.length <= max && !cutAlready) return text;
  const kept = text.slice(0, max).trimEnd();
  const more = text.length - kept.length;
  return `${kept}\n[output truncated${more > 0 && !cutAlready ? `; ${more} more characters` : ""}]`;
}

/** The end of `text`, at most `max` characters. */
function tail(text: string, max: number): string {
  const trimmed = text.trim();
  return trimmed.length <= max ? trimmed : `…${trimmed.slice(trimmed.length - max)}`;
}

/**
 * What a script prints cannot open or close a tag of any kind: not its own block, not a dropped count,
 * and not another envelope the first mate is told to trust — `<firstmate-board>`, `<paseo-system>`, or
 * whatever comes next. Every `<` that begins something tag-shaped becomes `&lt;`; any other `<` stays.
 */
export function quoted(text: string): string {
  return text.replace(/<(?=\/?[A-Za-z][\w.:-]*(?:[\s/>]|$))/g, "&lt;");
}

/**
 * The whole message for a batch: the blocks one after another, oldest first, and nothing else —
 * `<firstmate-watch-dropped count="N"/>` first when older ones were dropped (`templates/messages/watch-*.md`).
 */
export async function watchNote(notes: readonly QueuedNote[], dropped: number): Promise<string> {
  return compose(await Promise.all(notes.map(block)), dropped);
}

/** One note as its block. */
function block(note: QueuedNote): Promise<string> {
  return note.kind === "output"
    ? message(TEMPLATES.watchOutput, { name: note.name, ran: note.ran, output: quoted(note.text) })
    : message(TEMPLATES.watchFailed, {
        name: note.name,
        ran: note.ran,
        // An attribute's value, so it cannot hold the quote that ends it.
        reason: (note.reason ?? "it failed").replace(/"/g, "'"),
        stderr: note.text === "" ? "(nothing on stderr)" : quoted(note.text),
      });
}

async function compose(blocks: readonly string[], dropped: number): Promise<string> {
  const head = dropped > 0 ? [await message(TEMPLATES.watchDropped, { count: String(dropped) })] : [];
  return [...head, ...blocks].join("\n\n");
}

/**
 * The message for a batch within `max` characters: as many of the newest blocks as fit, oldest dropped
 * first and counted with `dropped` in the tag. The newest block always goes, so a message is never empty.
 */
export async function fitWatchNote(
  notes: readonly QueuedNote[],
  dropped: number,
  max: number = MAX_MESSAGE_CHARS,
): Promise<{ text: string; sent: QueuedNote[]; cut: QueuedNote[] }> {
  const blocks = await Promise.all(notes.map(block));
  for (let cut = 0; cut < notes.length; cut += 1) {
    const text = await compose(blocks.slice(cut), dropped + cut);
    if (text.length <= max || cut === notes.length - 1) {
      return { text, sent: notes.slice(cut), cut: notes.slice(0, cut) };
    }
  }
  return { text: await compose([], dropped), sent: [], cut: [] };
}

/** What went wrong with a run, in a few words, or null when it succeeded. */
function failureReason(result: RunResult, timeoutMs: number): string | null {
  if (result.spawnError !== null) return `it could not start: ${result.spawnError}`;
  if (result.timedOut) return `it ran longer than ${Math.round(timeoutMs / 1000)} seconds and was stopped`;
  if (result.code === null) return "it was killed by a signal";
  if (result.code !== 0) return `it exited with code ${result.code}`;
  return null;
}

export class WatchRunner {
  private state: RunnerState | null = null;
  private loading: Promise<RunnerState> | null = null;
  private readonly running = new Set<string>();
  private readonly producing = new Map<string, string | null>();
  private readonly aborter = new AbortController();
  private flushing: Promise<void> = Promise.resolve();
  private readonly afterTurn = new Set<NodeJS.Timeout>();
  private timer: NodeJS.Timeout | undefined;
  private readonly now: () => Date;
  private readonly run: typeof runWatchScript;
  private readonly timeoutMs: number;

  constructor(private readonly options: WatchRunnerOptions) {
    this.now = options.now ?? (() => new Date());
    this.run = options.run ?? runWatchScript;
    this.timeoutMs = options.timeoutMs ?? WATCH_TIMEOUT_MS;
  }

  /** Ticks on every minute's boundary until the returned function — or `stop` — is called. */
  start(): () => void {
    const next = () => {
      const target = (Math.floor(Date.now() / MINUTE_MS) + 1) * MINUTE_MS;
      this.timer = setTimeout(() => {
        if (this.aborter.signal.aborted) return;
        // A timer can fire a hair early; a late one (the Mac asleep) checks the minute it woke in.
        const at = new Date(Math.max(Date.now(), target));
        void this.tick(at).catch((error: unknown) => console.error("[firstmate] a watch tick failed:", error));
        next();
      }, target - Date.now() + 50);
    };
    next();
    return () => this.stop();
  }

  /** No more ticks; running scripts are stopped, and nothing is started after this, even by a tick under way. */
  stop(): void {
    clearTimeout(this.timer);
    this.afterTurn.forEach((timer) => clearTimeout(timer));
    this.afterTurn.clear();
    this.aborter.abort();
  }

  /** Runs every watch due in the minute `at` falls in, then tries to deliver what is queued. */
  async tick(at: Date = this.now()): Promise<void> {
    const home = await this.options.home();
    if (home === null) return;
    await seedWatches(home).catch((error: unknown) => {
      console.error("[firstmate] could not write the built-in watches:", error);
    });
    const [watches, disabled] = await Promise.all([listWatches(home), this.options.disabled()]);
    const off = new Set(disabled);
    const due = watches.filter(
      (watch) => watch.schedule !== null && !off.has(watch.name) && !this.running.has(watch.name) && isDue(watch.schedule, at),
    );
    // The plugin may have stopped while this tick read the folder and the config.
    if (this.aborter.signal.aborted) return;
    await Promise.all(due.map((watch) => this.runOne(home, watch, at)));
    await this.flush();
  }

  /** Runs one watch now and records what came of it. Refused while that watch is already running. */
  async runOne(home: string, watch: WatchFile, at: Date = this.now()): Promise<void> {
    if (this.running.has(watch.name) || this.aborter.signal.aborted) return;
    this.running.add(watch.name);
    let producerGate: CutoverGate | undefined;
    try {
      if (this.options.canRun && !(await this.options.canRun(watch.name))) return;
      const entry = await this.options.gate?.();
      producerGate = entry?.gate;
      const reserve = () => serialized(`${this.options.stateFile}.queue`, async () => {
        await this.refresh();
        const state = await this.load(), owner = producerGate ? watchOwner(producerGate) : null;
        const pending = state.queue.filter(note => !note.ownership || note.ownership.owner === owner);
        if (pending.some(note => note.name === watch.name && (note.hold || note.delivery))) return false;
        const guarding = pending.some(note => note.hold || note.delivery) ||
          !!(producerGate && (await producerGate.armed() || (await producerGate.targets()).length));
        const reserved = [...this.producing.values()].filter(value => value === owner).length;
        if (guarding && pending.length + reserved >= MAX_QUEUED) await this.capacityRefusal(producerGate, watch.name);
        this.producing.set(watch.name, owner); return true;
      });
      if (!(await (producerGate ? producerGate.run(reserve) : reserve()))) return;
      const stateDirectory = join(this.options.scriptStateRoot, watch.name);
      await mkdir(stateDirectory, { recursive: true });
      const result = await this.run(watch.path, {
        cwd: home,
        env: {
          ...(this.options.env ?? process.env),
          FIRSTMATE_HOME: home,
          FIRSTMATE_BACKLOG: join(home, "data", "backlog.md"),
          FIRSTMATE_WATCH_NAME: watch.name,
          FIRSTMATE_WATCH_STATE: stateDirectory,
        },
        timeoutMs: this.timeoutMs,
        // Bytes, a little over the characters sent, so the marker can say something was cut.
        maxOutputBytes: MAX_OUTPUT_CHARS * 4,
        maxErrorBytes: MAX_ERROR_CHARS * 4,
        signal: this.aborter.signal,
      });
      if (this.aborter.signal.aborted) return;
      await this.record(watch.name, stamp(at), result, producerGate);
    } finally {
      this.producing.delete(watch.name);
      this.running.delete(watch.name);
    }
  }

  /**
   * Routing happens before, and outside, the cutover gate (R12O N1): `routeNote` can take the inspection lock, which
   * leads to the lifecycle lock, whose holders take the gate. Only the watch queue's insert and persist run under the
   * gate, so a freeze's inventory either includes them or follows them. One watch never records two runs at once
   * (`running`), so the note decided from the state read before the gate still matches the state written under it.
   */
  private async record(name: string, ran: string, result: RunResult, producerGate?: CutoverGate): Promise<void> {
    const reason = failureReason(result, this.timeoutMs);
    const stderr = tail(result.stderr, MAX_ERROR_CHARS);
    const output = result.stdout.trim();
    const text = reason === null && output !== "" ? clip(output, MAX_OUTPUT_CHARS, result.truncated) : null;
    const note: QueuedNote | null = reason !== null
      ? ((await this.load()).watches[name] ?? BLANK).failing ? null : { name, ran, kind: "failed", reason, text: stderr }
      : text === null ? null : { name, ran, kind: "output", text };
    const routed = note !== null && !!(await this.options.routeNote?.(note));
    await this.gated(async gate => {
      const state = await this.load();
      const previous = state.watches[name] ?? BLANK;
      const refusal = note !== null && !routed ? await this.enqueue(state, note, gate, undefined, true) : undefined;
      if (reason !== null) {
        state.watches[name] = {
          ...previous,
          lastRunAt: ran,
          lastResult: "failed",
          lastError: stderr === "" ? reason : `${reason}\n${stderr}`,
          failing: true,
        };
      } else if (text === null) {
        state.watches[name] = { ...previous, lastRunAt: ran, lastResult: "silent", lastError: null, failing: false };
      } else {
        state.watches[name] = {
          lastRunAt: ran,
          lastResult: "queued",
          lastOutput: text,
          lastOutputAt: ran,
          lastError: null,
          failing: false,
        };
      }
      await this.persist(!!gate);
      if (refusal) throw refusal;
    }, producerGate);
  }

  /** Current-session prompt watches use the existing execution queue, with no second result notification. */
  async enqueuePrompt(name: string, text: string, at: Date): Promise<void> {
    return serialized(`${this.options.stateFile}.prompts`, () => this.gated(async gate => {
      const state = await this.load();
      const ran = stamp(at);
      const occurrence = `${name}@${ran.slice(0, 16)}`;
      const owner = gate ? watchOwner(gate) : undefined;
      const existing = state.queue.find(note => note.ownership?.owner === owner &&
        (note.ownership?.occurrence === occurrence || (note.name === name && note.ran.slice(0, 16) === ran.slice(0, 16))));
      if (existing?.hold) throw this.heldRefusal(existing);
      const previous = state.watches[name];
      if (previous?.lastRunAt?.slice(0, 16) === ran.slice(0, 16) || state.queue.some(note => note.name === name && !note.hold && note.ownership?.owner === owner)) return;
      const refusal = await this.enqueue(state, { name, ran, kind: "output", text }, gate, occurrence);
      state.watches[name] = { ...BLANK, lastRunAt: ran, lastResult: "queued", lastOutput: text, lastOutputAt: ran };
      await this.persist(!!gate);
      if (refusal) throw refusal;
    }));
  }

  /** Queue enqueues run inside the cutover gate, so a freeze's inventory either includes them or follows them. */
  private async gated<T>(work: (gate?: CutoverGate) => Promise<T>, captured?: CutoverGate): Promise<T> {
    const mutate = (gate?: CutoverGate) => serialized(`${this.options.stateFile}.queue`, async () => {
      await this.refresh(); return work(gate);
    });
    if (captured) return captured.run(() => mutate(captured));
    const entry = await this.options.gate?.();
    return entry ? entry.gate.run(() => mutate(entry.gate)) : mutate();
  }

  /** The persisted queue, including protected rows, for the cutover's source-ID/payload inventory. */
  async queued(): Promise<QueuedNote[]> {
    return serialized(`${this.options.stateFile}.queue`, async () => {
      await this.refresh(); return structuredClone((await this.load()).queue);
    });
  }

  /** Read-only held projection of the ordinary queue; there is no secondary delivery store. */
  async held() {
    return (await this.queued()).filter(note => note.hold).map(note => ({
      ...note.hold!, owner: note.ownership!.owner, note: bareNote(note), occurrence: note.ownership?.occurrence,
    })).sort((a, b) => occurrenceOrder({ ran: a.note.ran, key: a.note.name }, { ran: b.note.ran, key: b.note.name }));
  }

  /** Puts back an entry a released cutover archived, exactly, unless one with its identity is already queued. */
  async restoreQueued(entry: QueuedNote): Promise<"restored" | "present"> {
    return serialized(`${this.options.stateFile}.queue`, async () => {
      await this.refresh();
      const state = await this.load(), item = watchItem(entry);
      if (state.queue.some(note => itemFingerprint(watchItem(note)) === itemFingerprint(item))) return "present";
      if (state.queue.some(note => watchItem(note).id === item.id)) throw new Error("Archived watch identity has a different queued payload; reconcile it explicitly.");
      const current = await this.options.gate?.();
      await this.makeRoom(state, entry.ownership?.owner ?? (current ? watchOwner(current.gate) : undefined), entry.name);
      state.queue.push(structuredClone(entry));
      await this.persist(true);
      return "restored";
    });
  }

  /** Compare-by-identity/payload removal for a published cutover disposition. Never sends anything. */
  async removeQueued(id: string, payloadHash: string): Promise<"removed" | "absent" | "mismatch"> {
    return serialized(`${this.options.stateFile}.queue`, async () => {
      await this.refresh();
      const state = await this.load();
      const same = state.queue.filter((note) => watchItem(note).id === id);
      if (same.length === 0) return "absent";
      const exact = same.find((note) => watchItem(note).payloadHash === payloadHash);
      if (!exact) return "mismatch";
      state.queue = state.queue.filter((note) => note !== exact);
      await this.persist(true);
      return "removed";
    });
  }

  async promptSummary(watch: ManagedWatch): Promise<WatchSummary> {
    const state = await this.load(); const record = state.watches[watch.name] ?? BLANK;
    return { name: watch.name, schedule: watch.schedule, enabled: watch.enabled, invalid: null, running: false,
      ...record, lastResult: shownResult(record, state.queue, watch.name), builtIn: false, outdated: false,
      routing: watchRouting(watch), managed: true, prompt: watch.prompt };
  }

  /** A route edit must not start an inspector while the same watch's earlier current-session note waits. */
  async pendingDelivery(name: string): Promise<boolean> {
    return (await this.queued()).some(note => note.name === name);
  }

  private heldRefusal(note: QueuedNote): CutoverRefusal {
    return new CutoverRefusal(note.hold!.plan, note.hold!.stage, `${note.hold!.reason} Output retained durably in the watch queue, held for reconciliation.`);
  }

  private async recordCapacity(gate: CutoverGate | undefined, name: string): Promise<string> {
    const reason = `Watch retention capacity (${MAX_QUEUED}) reached; further production of ${name} is paused. Reconcile queued output before retrying.`;
    if (gate) await gate.refusal({ source: "watch", id: `retention-capacity:${name}`, payloadHash: digest({ owner: watchOwner(gate), name, limit: MAX_QUEUED }) }, reason);
    return reason;
  }

  private async capacityRefusal(gate: CutoverGate | undefined, name: string): Promise<never> {
    throw new CutoverRefusal("watch-retention", "capacity", await this.recordCapacity(gate, name));
  }

  private async enqueue(state: RunnerState, note: QueuedNote, gate?: CutoverGate, occurrence?: string, produced = false): Promise<CutoverRefusal | undefined> {
    const owner = gate ? watchOwner(gate) : undefined;
    if (owner) note.ownership = { owner, id: watchMessageId(note, owner, occurrence), ...(occurrence ? { occurrence } : {}) };
    const overflow = await this.makeRoom(state, owner, note.name, gate, produced);
    state.queue.push(note);
    if (gate) {
      let verdict: Awaited<ReturnType<CutoverGate["verdict"]>>;
      try { verdict = await gate.verdict(watchItem(note), "enqueue"); }
      catch (error) {
        note.hold = { plan: "watch-admission", stage: "unreadable", reason: `Admission could not be read: ${describe(error)}. Reconcile this output explicitly.` };
        await this.persist(true); throw error;
      }
      if (!verdict.admit) {
        note.hold = { plan: verdict.plan, stage: verdict.stage, reason: verdict.reason };
        await this.persist(true); // The output is authoritative; diagnostics cannot precede its durability.
        await gate.refusal(watchItem(note), verdict.reason);
      }
    }
    if (overflow) { await this.persist(true); await this.recordCapacity(gate, note.name); }
    return note.hold ? this.heldRefusal(note) : undefined;
  }

  private async makeRoom(state: RunnerState, owner: string | undefined, name: string, gate?: CutoverGate, produced = false): Promise<boolean> {
    const sameHome = (queued: QueuedNote) => !queued.ownership || queued.ownership.owner === owner;
    while (state.queue.filter(sameHome).length >= MAX_QUEUED) {
      const oldest = state.queue.findIndex(queued => sameHome(queued) && !queued.hold && !queued.delivery);
      if (oldest < 0) {
        if (!produced) await this.capacityRefusal(gate, name);
        // Finite producers already running before arming may have advanced their baselines.
        return true;
      }
      state.queue.splice(oldest, 1); state.dropped++;
    }
    return false;
  }

  /**
   * Sends everything queued as one message, if the first mate can take it. One flush at a time, so two
   * triggers landing together — a run finishing as the first mate's turn ends — cannot send it twice.
   */
  flush(): Promise<void> {
    const run = this.flushing.then(() => this.flushOnce());
    this.flushing = run.catch(() => undefined);
    return run;
  }

  /**
   * The first mate has just ended a turn: try the queue a few times over the next seconds rather than
   * once now. Every try asks whether it is mid-turn — a newer turn may already have started, and a
   * message sent into it could replace it where the provider cannot steer.
   */
  flushAfterTurn(delays: readonly number[] = AFTER_TURN_DELAYS_MS): void {
    delays.forEach((delay) => {
      const timer = setTimeout(() => {
        this.afterTurn.delete(timer);
        if (this.aborter.signal.aborted) return;
        void this.flush().catch((error: unknown) => {
          console.error("[firstmate] could not send the watches' output after the first mate's turn:", error);
        });
      }, delay);
      this.afterTurn.add(timer);
    });
  }

  private async flushOnce(): Promise<void> {
    if (this.aborter.signal.aborted) return;
    const entry = await this.options.gate?.(), state = await this.load();
    let claim: string | null = null;
    const completed: string[] = [];
    let selected: { note: Awaited<ReturnType<typeof fitWatchNote>>; messageId: string; dropped: number } | undefined;
    const prepare = () => serialized(`${this.options.stateFile}.queue`, async () => {
      await this.refresh();
      // All queue entries use the same write-ahead reservation and S07 result.
      let reconciled = false;
      const owner = entry ? watchOwner(entry.gate) : undefined;
      const sameOccurrence = (a: QueuedNote, b: QueuedNote) => (a.ownership?.owner ?? owner) === (b.ownership?.owner ?? owner) &&
        itemFingerprint(watchItem(a)) === itemFingerprint(watchItem(b));
      // A noncompliant old writer may have copied the same occurrence without its reservation.
      // That copy inherits uncertainty, never permission for a new native attempt.
      for (const pending of state.queue.filter(note => note.delivery)) for (const queued of state.queue) {
        if (!queued.delivery && sameOccurrence(pending, queued)) {
          queued.delivery = { ...pending.delivery! };
          if (!queued.ownership && pending.ownership) queued.ownership = { ...pending.ownership };
          if (!queued.hold && pending.hold) queued.hold = { ...pending.hold };
          reconciled = true;
        }
      }
      for (const queued of [...state.queue]) {
        if (!queued.delivery || (queued.ownership && queued.ownership.owner !== (entry && watchOwner(entry.gate)))) continue;
        const receipt = entry && queued.delivery.claim ? await entry.gate.readClaim(queued.delivery.claim) : null;
        const exact = receipt?.claim.recipient === queued.delivery.recipient &&
          receipt.claim.items.some(item => itemFingerprint(item) === itemFingerprint(watchItem(queued)));
        const outcome = exact ? receipt!.result?.outcome : undefined;
        if (queued.delivery.state === "accepted" || outcome === "accepted") {
          if (queued.delivery.claim) completed.push(queued.delivery.claim);
          state.queue = state.queue.filter(note => note !== queued);
          this.markDelivered(state, queued); reconciled = true;
        } else if (outcome === "failed") {
          if (queued.delivery.claim) completed.push(queued.delivery.claim);
          delete queued.delivery; reconciled = true;
        }
        // Missing, crashed and uncertain receipts stay pending for explicit reconciliation.
      }
      if (reconciled) await this.persist(true);
      const candidates: QueuedNote[] = [];
      let heldChanged = false;
      for (const queued of state.queue) {
        if (queued.delivery || (queued.ownership && queued.ownership.owner !== (entry && watchOwner(entry.gate)))) continue;
        if (!queued.hold && entry) {
          const verdict = await entry.gate.verdict(watchItem(queued), "send");
          if (!verdict.admit) {
            const owner = watchOwner(entry.gate);
            queued.ownership ??= { owner, id: watchMessageId(queued, owner) };
            queued.hold = { plan: verdict.plan, stage: verdict.stage, reason: verdict.reason };
            await entry.gate.refusal(watchItem(queued), verdict.reason); heldChanged = true;
          }
        }
        if (queued.hold && (!entry || !await entry.gate.sidecar(queued.hold.plan, "aborted"))) {
          const target = entry && (await entry.gate.targets()).find(target => target.plan === queued.hold!.plan);
          if (!target || target.damaged || !target.drains.has(itemFingerprint(watchItem(queued)))) continue;
        }
        if (!candidates.some(candidate => sameOccurrence(candidate, queued))) candidates.push(queued);
      }
      if (heldChanged) await this.persist(true);
      const ordered = !!entry && (!!await entry.gate.armed() || (await entry.gate.targets()).length > 0);
      if (ordered) candidates.sort((a, b) => occurrenceOrder({ ran: a.ran, key: a.ownership?.id ?? watchItem(a).id }, { ran: b.ran, key: b.ownership?.id ?? watchItem(b).id }));
      const confirm = async (items: GateItem[]): Promise<GateItem[]> => {
        const admitted = new Set(items.map(itemFingerprint));
        const ready = candidates.filter(note => state.queue.includes(note) && admitted.has(itemFingerprint(watchItem(note))));
        if (!ready.length && (!state.dropped || state.queue.length)) return [];
        // Armed turns admit one occurrence, oldest first, with its immutable native ID.
        // Default unarmed batching/fitting and dropped-count behavior stay unchanged.
        const note = await fitWatchNote(ordered ? ready.slice(0, 1) : ready, state.dropped);
        if (entry) for (const queued of note.sent) queued.ownership ??= { owner: watchOwner(entry.gate), id: watchMessageId(queued, watchOwner(entry.gate)) };
        const messageId = note.sent[0]?.ownership?.id ?? watchMessageId(note.sent[0] ?? { name: "dropped", ran: "", kind: "output", text: note.text }, entry ? watchOwner(entry.gate) : "");
        selected = { note, messageId, dropped: state.dropped };
        for (const queued of note.sent) queued.delivery = { state: "uncertain", recipient: entry?.recipient ?? "", messageId, claim: null };
        await this.persist(true); // A crash from here cannot cause automatic native replay.
        return note.sent.map(watchItem);
      };
      if (entry) {
        const admission = await entry.gate.claimHeld(candidates.map(watchItem), entry.recipient, confirm);
        claim = admission.claim;
      } else await confirm(candidates.map(watchItem));
      if (selected) {
        for (const queued of selected.note.sent) queued.delivery!.claim = claim;
        await this.persist(true);
      }
    });
    try { if (entry) await entry.gate.run(prepare); else await prepare(); }
    catch (error) {
      await entry?.gate.settle(claim, "failed", "Queue reservation failed before native delivery.", true);
      throw error;
    }
    for (const id of completed) await entry?.gate.prune(id);
    if (!selected) return;
    const { note, messageId, dropped } = selected;
    let outcome: DeliveryOutcome;
    try {
      outcome = await this.options.deliver(note.text, entry ? { owner: watchOwner(entry.gate), recipient: entry.recipient, messageId } : undefined);
    } catch (error) {
      await entry?.gate.settle(claim, "uncertain", String(error), true);
      console.error("[firstmate] could not send the watches' output to the first mate:", error); return;
    }
    await entry?.gate.settle(claim, outcome === "sent" ? "accepted" : "failed", "", true);
    await this.gated(async () => {
      const owner = entry ? watchOwner(entry.gate) : undefined;
      const current = state.queue.filter(queued => (queued.ownership?.owner ?? owner) === owner &&
        ((!queued.delivery && outcome === "sent") || (queued.delivery?.claim === claim && queued.delivery.messageId === messageId)) &&
        note.sent.some(sent => itemFingerprint(watchItem(sent)) === itemFingerprint(watchItem(queued))));
      if (outcome !== "sent") {
        for (const queued of current) delete queued.delivery;
      } else {
        for (const queued of current) { if (queued.delivery) queued.delivery.state = "accepted"; this.markDelivered(state, queued); }
        state.queue = state.queue.filter(queued => !current.includes(queued) && !note.cut.some(cut => itemFingerprint(watchItem(cut)) === itemFingerprint(watchItem(queued))));
        state.dropped = Math.max(0, state.dropped - dropped);
        for (const queued of note.cut) {
          const record = state.watches[queued.name];
          if (record?.lastOutputAt === queued.ran) record.lastResult = "dropped";
        }
      }
      await this.persist(true);
    }, entry?.gate);
    await entry?.gate.prune(claim);
  }

  private markDelivered(state: RunnerState, queued: QueuedNote): void {
    const record = state.watches[queued.name];
    if (!record?.lastRunAt || record.lastRunAt <= queued.ran) {
      state.watches[queued.name] = { ...BLANK, lastRunAt: queued.ran, lastResult: queued.kind === "failed" ? "failed" : "delivered",
        lastOutput: queued.text, lastOutputAt: queued.ran, lastError: queued.reason ?? null, failing: queued.kind === "failed" };
    }
  }

  /** Every watch in the home as the board draws it. */
  async summaries(): Promise<WatchSummary[]> {
    const home = await this.options.home();
    if (home === null) return [];
    const [watches, disabled, builtIns, state] = await Promise.all([
      listWatches(home),
      this.options.disabled(),
      builtInStates(home),
      this.load(),
    ]);
    const off = new Set(disabled);
    return watches.map((watch) => {
      const record = state.watches[watch.name] ?? BLANK;
      return {
        name: watch.name,
        schedule: watch.scheduleText,
        enabled: !off.has(watch.name),
        invalid: watch.invalid,
        running: this.running.has(watch.name),
        lastRunAt: record.lastRunAt,
        lastResult: watch.invalid === null ? shownResult(record, state.queue, watch.name) : "invalid",
        lastOutput: record.lastOutput,
        lastOutputAt: record.lastOutputAt,
        lastError: record.lastError,
        builtIn: BUILT_IN_WATCHES.some((builtIn) => builtIn.name === watch.name),
        outdated: builtIns.get(watch.name)?.outdated ?? false,
      };
    });
  }

  private load(): Promise<RunnerState> {
    if (this.state !== null) return Promise.resolve(this.state);
    this.loading ??= readState(this.options.stateFile).then((state) => {
      this.state = state;
      return state;
    });
    return this.loading;
  }

  /** Called under the queue lock: a reloaded writer must see another runner's durable reservation. */
  private async refresh(): Promise<void> {
    const state = await this.load();
    Object.assign(state, await readState(this.options.stateFile));
  }

  private persist(strict = false): Promise<void> {
    const state = this.state;
    if (state === null) return Promise.resolve();
    const path = this.options.stateFile;
    return serialized(path, async () => {
      await mkdir(dirname(path), { recursive: true });
      const temporary = `${path}.${randomUUID()}.tmp`;
      await writeFile(temporary, `${JSON.stringify(state, null, 2)}\n`, "utf8");
      await rename(temporary, path);
    }).catch((error: unknown) => {
      console.error(`[firstmate] could not save ${path}:`, error);
      if (strict) throw error;
    });
  }
}

/** The immutable watch payload; routing/hold/reservation metadata cannot change a delivery's identity. */
export function watchItem(note: QueuedNote): GateItem {
  return { source: "watch", id: `${note.name}@${note.ran}#${note.kind}`, payloadHash: digest(bareNote(note)), text: `${note.name} ${note.text}` };
}

/**
 * What the card says of a watch's last run, read against the queue rather than trusted from the record.
 * A run that printed nothing after one whose output is still waiting shows that output as waiting, not
 * "nothing new"; and output recorded as waiting that has left the queue without being sent — pushed out
 * of a full queue — shows as dropped, since nothing of it is left to send.
 */
function shownResult(record: WatchRecord, queue: readonly QueuedNote[], name: string): WatchResult {
  const waiting = queue.some((note) => note.name === name && note.kind === "output");
  if (record.lastResult === "silent" && waiting) return "queued";
  if (record.lastResult === "queued" && !waiting) return "dropped";
  return record.lastResult;
}

const RESULTS: ReadonlySet<string> = new Set<WatchResult>([
  "never",
  "silent",
  "queued",
  "delivered",
  "dropped",
  "failed",
  "invalid",
]);

function asString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

/** Legacy fields remain lenient; unreadable state and damaged protected rows must never reset delivery history. */
export async function readState(path: string): Promise<RunnerState> {
  // Earlier unactivated revisions used a second store. Never silently forget such evidence or replay it.
  try {
    if ((await readdir(`${path}.held`)).some(name => name.endsWith(".json")))
      throw new Error("Legacy watch spool requires explicit reconciliation before using the single queue.");
  } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  let raw: unknown;
  try {
    raw = JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    return { watches: {}, queue: [], dropped: 0 };
  }
  const object = (raw ?? {}) as { watches?: unknown; queue?: unknown; dropped?: unknown };
  const watches: Record<string, WatchRecord> = {};
  if (typeof object.watches === "object" && object.watches !== null) {
    for (const [name, value] of Object.entries(object.watches as Record<string, Record<string, unknown>>)) {
      const result = asString(value.lastResult);
      watches[name] = {
        lastRunAt: asString(value.lastRunAt),
        lastResult: result !== null && RESULTS.has(result) ? (result as WatchResult) : "never",
        lastOutput: asString(value.lastOutput),
        lastOutputAt: asString(value.lastOutputAt),
        lastError: asString(value.lastError),
        failing: value.failing === true,
      };
    }
  }
  const queue: QueuedNote[] = Array.isArray(object.queue)
    ? (object.queue as Array<Record<string, unknown>>).flatMap((entry) => {
        const name = asString(entry.name);
        const ran = asString(entry.ran);
        const text = asString(entry.text);
        const kind = entry.kind === "failed" ? "failed" : entry.kind === "output" ? "output" : null;
        if (name === null || ran === null || text === null || kind === null) {
          if (entry.ownership !== undefined || entry.hold !== undefined || entry.delivery !== undefined)
            throw new Error("Queued watch provenance has a damaged payload; reconcile it explicitly.");
          return [];
        }
        const reason = asString(entry.reason);
        const note: QueuedNote = { name, ran, kind, text, ...(reason === null ? {} : { reason }) };
        if (entry.retained !== undefined) throw new Error("Legacy retained watch provenance requires explicit reconciliation before this queue can be used.");
        if (entry.ownership !== undefined) {
          const ownership = OwnershipSchema.parse(entry.ownership);
          note.ownership = { owner: ownership.owner, id: ownership.id, ...(ownership.occurrence ? { occurrence: ownership.occurrence } : {}) };
          if (ownership.id !== watchMessageId(note, ownership.owner, ownership.occurrence)) throw new Error("Queued watch provenance does not match its payload.");
        }
        if (entry.hold !== undefined) {
          note.hold = HoldSchema.parse(entry.hold);
          if (!note.ownership) throw new Error("Held watch provenance is missing.");
        }
        if (entry.delivery !== undefined) note.delivery = DeliverySchema.parse(entry.delivery);
        return [note];
      })
    : [];
  const dropped = typeof object.dropped === "number" && object.dropped > 0 ? Math.floor(object.dropped) : 0;
  return { watches, queue, dropped };
}
