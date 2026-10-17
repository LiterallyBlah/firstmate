import { randomUUID } from "node:crypto";
import { appendFile, mkdir, open } from "node:fs/promises";
import { join } from "node:path";
import type { PluginLifecycleEvents, PluginLifecycleRegistration, PluginHookContext } from "@getpaseo/plugin/server";
import type { AttentionEvent, AttentionInput, AttentionState } from "../shared/attention";
import { CREW_LABELS, type FirstmateConfig, type Fleet } from "../shared/fleet";
import type { RemoteSnapshot } from "../shared/remotes";
import { resolveHome } from "./config";
import type { PaseoApi } from "./host-types";
import { attentionActions, attentionKey, attentionStates, cardKey, workerKey } from "./attention-projection";

export const ATTENTION_ENV = "FIRSTMATE_ATTENTION_OBSERVE";
export const attentionEnabled = (env: NodeJS.ProcessEnv = process.env) => /^(1|true|yes|on)$/i.test((env[ATTENTION_ENV] ?? "").trim());
const MAX_PENDING = 256;
export const OBSERVATION_MS = 14 * 24 * 60 * 60 * 1000;
const warn = () => console.error("[firstmate] attention observation lost data; delivery is unaffected");
type End = PluginLifecycleEvents["agent.turn_ended"];
type Context = Pick<PluginHookContext, "paseo">;
type SeenRemote = { at: number; sampleStart: number | null; status: string; permissions: Set<string> };

/** A bounded, detached queue. No hook, catalog poll or send awaits its filesystem or SDK reads. */
export class AttentionObserver {
  private pending: Array<() => Promise<void>> = [];
  private running: Promise<void> | null = null;
  private scheduled = false;
  private stopped = false;
  private expiresAt = Infinity;
  private lost: AttentionInput["reason"] | null = null;
  private home = "";
  private lead = "";
  private run = randomUUID();
  private latest: { id: string; at: number } | null = null;
  private turns = new Map<string, number>();
  private calls = new Set<string>();
  private states = new Map<string, { subject: string; state: AttentionState }>();
  private fleetAt: number | null = null;
  private remote = new Map<string, SeenRemote>();
  private paseo: PaseoApi | null = null;
  private timer: ReturnType<typeof setInterval> | undefined;

  constructor(private readonly config: () => Promise<FirstmateConfig>, private readonly options: {
    enabled?: () => boolean;
    now?: () => number;
    append?: (path: string, line: string) => Promise<void>;
  } = {}) {}
  private enabled() { return !this.stopped && this.now() < this.expiresAt && (this.options.enabled ?? attentionEnabled)(); }
  private now() { return (this.options.now ?? Date.now)(); }
  remember(paseo: PaseoApi) { if (this.enabled()) this.paseo = paseo; }
  private enqueue(job: () => Promise<void>) {
    if (!this.enabled()) return;
    if (this.pending.length >= MAX_PENDING) {
      if (this.lost !== "queue-overflow") setImmediate(warn);
      this.lost = "queue-overflow";
      const at = this.now();
      // Drop the backlog as one explicit continuity break, not an invisible hole between two pairs.
      this.pending = [async () => { await this.prepare(await this.config(), at); }];
      return;
    }
    this.pending.push(job);
    if (this.scheduled || this.running) return;
    this.scheduled = true;
    setImmediate(() => {
      this.scheduled = false;
      this.running = this.drain().finally(() => { this.running = null; });
    });
  }
  private async drain() {
    while (this.pending.length) {
      const job = this.pending.shift()!;
      try { await job(); } catch { this.lost = "recording-failed"; warn(); }
    }
  }
  /** Tests and teardown only; never awaited by delivery. */
  async settled() {
    while (this.scheduled || this.running) {
      if (this.running) await this.running;
      else await new Promise<void>(resolve => setImmediate(resolve));
    }
  }
  private reset() {
    this.latest = null; this.turns.clear(); this.calls.clear(); this.states.clear();
    this.remote.clear(); this.fleetAt = null;
  }
  private async prepare(config: FirstmateConfig, at: number) {
    if (!config.mateAgentId.trim()) return false;
    const home = resolveHome(config), lead = attentionKey(config.mateAgentId.trim());
    if (home !== this.home || lead !== this.lead) {
      // One 14-day campaign per log, preserved over process restarts. Never truncate or rotate it.
      let first = at;
      if (!this.options.append) {
        try {
          const file = await open(join(home, "data", "metrics", "attention.jsonl"), "r");
          try {
            const bytes = Buffer.alloc(4096), { bytesRead } = await file.read(bytes, 0, bytes.length, 0);
            const opening = JSON.parse(bytes.subarray(0, bytesRead).toString("utf8").split("\n")[0]!);
            if (opening.version !== 1 || opening.kind !== "start" || !Number.isFinite(opening.at)) throw Error();
            first = opening.at;
          } finally { await file.close(); }
        } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
      }
      this.expiresAt = first + OBSERVATION_MS;
      if (at >= this.expiresAt) return false;
      this.home = home; this.lead = lead; this.run = randomUUID(); this.reset();
      try { await this.write({ kind: "start", at, source: "observer" }); }
      catch (error) { this.home = ""; throw error; }
    }
    if (this.lost) {
      const reason = this.lost;
      await this.write({ kind: "gap", at, source: "observer", reason });
      this.lost = null; this.reset();
    }
    return at < this.expiresAt;
  }
  private async write(input: AttentionInput) {
    const event: AttentionEvent = { ...input, version: 1, run: this.run, id: randomUUID(), lead: this.lead };
    const path = join(this.home, "data", "metrics", "attention.jsonl");
    if (this.options.append) await this.options.append(path, JSON.stringify(event) + "\n");
    else {
      await mkdir(join(this.home, "data", "metrics"), { recursive: true });
      await appendFile(path, JSON.stringify(event) + "\n", { mode: 0o600 });
    }
    if (!["start", "gap"].includes(input.kind) &&
      (!this.latest || input.at >= this.latest.at)) this.latest = { id: event.id, at: input.at };
  }
  private async role(event: { agent: { id: string; parentAgentId: string | null } }, config: FirstmateConfig, context: Context) {
    if (event.agent.id === config.mateAgentId.trim()) return "lead";
    // Hooks omit labels. Refresh only the emitting session to include predecessor-owned and hand-started crew.
    const found = await context.paseo.agents.ref(event.agent.id).refresh();
    if (!found?.agent) throw new Error("Observation could not resolve the emitting session");
    return found.agent.labels[CREW_LABELS.role] === CREW_LABELS.crewRole ? "crew" : null;
  }
  private hook<Name extends "agent.turn_started" | "agent.permission_requested" | "agent.permission_resolved" | "agent.turn_ended">(
    name: Name, event: PluginLifecycleEvents[Name], context: Context,
  ) {
    if (!this.enabled()) return;
    const at = this.now(); this.remember(context.paseo);
    this.enqueue(async () => {
      const config = await this.config(); if (!await this.prepare(config, at)) return;
      const role = await this.role(event, config, context);
      if (!role) return;
      const subject = workerKey(event.agent.id);
      if (name === "agent.turn_started") {
        if (role !== "lead") return;
        const turn = (event as PluginLifecycleEvents["agent.turn_started"]).turnId;
        this.turns.set(turn ?? "unknown", at);
        await this.write({ kind: "lead-started", at, source: "hook", turn: turn ? attentionKey(turn) : null });
      } else if (name === "agent.turn_ended") {
        const ended = event as End, turn = ended.turnId ? attentionKey(ended.turnId) : null;
        if (role === "crew") {
          await this.write({ kind: "worker-ended", at, source: "hook", subject, turn, outcome: ended.outcome.kind });
          return;
        }
        const since = this.turns.get(ended.turnId ?? "unknown") ?? null;
        this.turns.delete(ended.turnId ?? "unknown");
        await this.write({ kind: "lead-ended", at, source: "hook", turn, outcome: ended.outcome.kind,
          ...(ended.outcome.kind === "canceled" ? { associatedEvent: this.latest && this.latest.at <= at ? this.latest.id : null } : {}) });
        const actions = attentionActions(ended.timeline);
        // Hook timelines include earlier turns. Reuse the collector's exact call/turn binding rule
        // against a bounded SDK page; no transcript is retained and missing coverage stays unknown.
        const page = actions.length && ended.turnId ? await context.paseo.agents.ref(event.agent.id).timeline.refetch({
          direction: "tail", limit: 200, projection: "projected",
        }).catch(() => { warn(); return null; }) : null;
        const binding = (action: { call: string; subject: string; tool: string }) => `${action.call}:${action.subject}:${action.tool}`;
        const currentCalls = new Set(page && !page.gap && !page.reset && !page.staleCursor && !page.error ?
          page.entries.filter(entry => entry.turnId === ended.turnId && entry.item.type === "tool_call")
            .flatMap(entry => attentionActions([entry.item]).map(binding)) : []);
        for (const action of actions) {
          if (this.calls.has(action.call)) continue;
          this.calls.add(action.call);
          await this.write({ kind: "action", at, source: "hook", turn, ...action, actionSince: currentCalls.has(binding(action)) ? since : null });
        }
      } else if (role === "crew") {
        const requested = name === "agent.permission_requested";
        const request = requested ? (event as PluginLifecycleEvents["agent.permission_requested"]).request.id :
          (event as PluginLifecycleEvents["agent.permission_resolved"]).requestId;
        await this.write({ kind: requested ? "permission-requested" : "permission-resolved", at, source: "hook", subject, request: attentionKey(request) });
      }
    });
  }
  /** Called by the existing receipt observer; the hook itself only queues work. */
  ended = (event: End, context: Context) => this.hook("agent.turn_ended", event, context);

  register(server: PluginLifecycleRegistration, sample: (paseo: PaseoApi, config: FirstmateConfig) => Promise<Fleet>) {
    if (!this.enabled()) return () => {};
    const off = [
      server.on("agent.turn_started", (event, context) => this.hook("agent.turn_started", event, context)),
      server.on("agent.permission_requested", (event, context) => this.hook("agent.permission_requested", event, context)),
      server.on("agent.permission_resolved", (event, context) => this.hook("agent.permission_resolved", event, context)),
    ];
    // Reuse the board compiler once a minute, including with the UI closed. No watch is run or changed.
    let sampling = false;
    this.timer = setInterval(() => {
      if (!this.enabled() || !this.paseo || sampling) return;
      sampling = true;
      const sampleStart = this.now();
      void this.config().then(config => sample(this.paseo!, config)).then(fleet => this.fleet(fleet, sampleStart))
        .catch(() => { this.lost = "fleet-unavailable"; warn(); }).finally(() => { sampling = false; });
    }, 60_000);
    this.timer.unref?.();
    return () => { off.forEach(dispose => dispose()); clearInterval(this.timer); this.stopped = true; };
  }

  fleet(fleet: Fleet, sampleStart: number | null = null) {
    if (!this.enabled()) return;
    const at = this.now();
    this.enqueue(async () => {
      const config = await this.config(); if (!await this.prepare(config, at)) return;
      if (fleet.home !== this.home || fleet.mate?.id !== config.mateAgentId.trim()) return;
      if (sampleStart !== null && this.fleetAt !== null && sampleStart < this.fleetAt) return;
      if (fleet.warnings.length || fleet.cards.some(card => card.remote && (!card.remote.online || card.remote.worker?.status === "unavailable"))) {
        await this.write({ kind: "gap", at, source: "fleet", reason: "fleet-unavailable" });
        this.states.clear(); this.fleetAt = null; return;
      }
      const next = new Map<string, { subject: string; state: AttentionState }>();
      for (const card of fleet.cards) {
        if (card.remote && (!card.remote.online || card.remote.worker?.status === "unavailable")) continue;
        const subject = cardKey(card);
        for (const state of attentionStates(card, fleet.cards)) next.set(`${subject}:${state}`, { subject, state });
      }
      for (const [key, value] of next) if (!this.states.has(key)) await this.write({
        kind: "state-enter", at, source: "fleet", ...value, since: this.fleetAt, baseline: this.fleetAt === null,
      });
      for (const [key, value] of this.states) if (!next.has(key)) await this.write({ kind: "state-exit", at, source: "fleet", ...value });
      this.states = next; this.fleetAt = sampleStart;
    });
  }

  /** Only fresh completed polls, never cached reads. Local observation bounds do not trust remote clocks. */
  catalog(snapshot: RemoteSnapshot) {
    if (!this.enabled()) return;
    // RemoteService replaces host records, but mutates the snapshot's host array between polls.
    snapshot = { ...snapshot, hosts: [...snapshot.hosts] };
    const at = this.now();
    this.enqueue(async () => {
      if (!await this.prepare(await this.config(), at)) return;
      const observedHosts = new Set<string>();
      for (const host of snapshot.hosts) {
        const prefix = attentionKey(host.serverId);
        observedHosts.add(prefix);
        if (!host.online) {
          await this.write({ kind: "gap", at, source: "catalog", subject: prefix, reason: "remote-unavailable" });
          for (const key of this.remote.keys()) if (key.startsWith(prefix + ":")) this.remote.delete(key);
          continue;
        }
        const seen = new Set<string>();
        for (const worker of host.workers) {
          const subject = workerKey(worker.id, host.serverId), key = `${prefix}:${subject}`;
          seen.add(key);
          const old = this.remote.get(key);
          if (worker.status === "unavailable" || worker.permissions !== (worker.pendingPermissions?.length ?? 0)) {
            await this.write({ kind: "gap", at, source: "catalog", subject, reason: "remote-unavailable" });
            this.remote.delete(key); continue;
          }
          const common = { at, source: "catalog" as const, subject, since: old?.sampleStart ?? null,
            baseline: !old || old.sampleStart === null, pollMs: old ? at - old.at : null, clockSkewSeconds: host.clockSkew?.seconds ?? null };
          const status = ["initializing", "running", "idle", "error", "closed", "archived"].includes(worker.status) ? worker.status : "unknown";
          if (!old || old.status !== status) await this.write({ kind: "remote-status", ...common, status });
          const permissions = new Set((worker.pendingPermissions ?? []).map(permission => attentionKey(permission.id)));
          for (const request of permissions) if (!old?.permissions.has(request)) await this.write({ kind: "permission-requested", ...common, request });
          for (const request of old?.permissions ?? []) if (!permissions.has(request)) await this.write({ kind: "permission-resolved", ...common, request });
          const sampleStart = Date.parse(host.checkedAt ?? "");
          this.remote.set(key, { at, sampleStart: Number.isFinite(sampleStart) && sampleStart <= at ? sampleStart : null, status, permissions });
        }
        for (const key of this.remote.keys()) if (key.startsWith(prefix + ":") && !seen.has(key)) {
          await this.write({ kind: "gap", at, source: "catalog", subject: key.slice(prefix.length + 1), reason: "subject-missing" });
          this.remote.delete(key);
        }
      }
      for (const key of this.remote.keys()) if (!observedHosts.has(key.split(":")[0]!)) {
        await this.write({ kind: "gap", at, source: "catalog", subject: key.split(":")[1]!, reason: "subject-missing" });
        this.remote.delete(key);
      }
    });
  }
}
