import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PluginHookContext, PluginLifecycleEvents, PluginLifecycleRegistration } from "@getpaseo/plugin/server";
import { ATTENTION_STATES, type AttentionEvent } from "../shared/attention";
import { FirstmateConfigSchema, type Fleet, type FleetCard } from "../shared/fleet";
import type { RemoteSnapshot } from "../shared/remotes";
import { AttentionObserver, attentionEnabled, OBSERVATION_MS } from "./attention";
import { attentionActions, attentionKey, attentionStates, cardKey, workerKey } from "./attention-projection";
import { attentionReport, parseAttentionLog, remoteReceiptActions } from "./attention-report";
import { registerReceiptObservers } from "./receipt-observers";
import { buildCards } from "./fleet";
import { parseBacklog } from "./backlog";
import { sendWithoutInterrupting } from "./send";
import type { PaseoApi, TimelineItem } from "./host-types";

const config = () => FirstmateConfigSchema.parse({ home: join(process.env.PASEO_HOME!, "home"), mateAgentId: "mate" });
const agent = (id = "worker") => ({ id, workspaceId: "workspace", parentAgentId: "predecessor", provider: "codex", cwd: "/work", title: null });
const end = (id = "worker", outcome: "completed" | "failed" | "canceled" = "completed"): PluginLifecycleEvents["agent.turn_ended"] => ({
  agent: agent(id), turnId: "turn", timeline: [], outcome: outcome === "failed" ? { kind: outcome, error: { message: "not retained" } } :
    outcome === "canceled" ? { kind: outcome, reason: "not retained" } : { kind: outcome },
});
const tool = (callId = "call", target = "worker"): TimelineItem => ({ type: "tool_call", callId, name: "mcp__paseo__send_agent_prompt", status: "completed", error: null,
  detail: { type: "unknown", input: { agentId: target, prompt: "PRIVATE PROMPT" }, output: { success: true } } });
const disposals: Array<() => void> = [];
afterEach(() => { disposals.splice(0).forEach(dispose => dispose()); vi.restoreAllMocks(); vi.useRealTimers(); });

function harness(enabled = true, append?: (path: string, line: string) => Promise<void>) {
  const events: AttentionEvent[] = [];
  let now = 1000;
  const readConfig = vi.fn(async () => config());
  const send = vi.fn(async () => {});
  const refresh = vi.fn(async () => ({ agent: { labels: { "firstmate.role": "crew" } } }));
  const refetch = vi.fn(async () => ({ gap: false, reset: false, staleCursor: false, error: null,
    entries: [{ turnId: "turn", item: tool() }] }));
  const paseo = { agents: { ref: () => ({ refresh, send, timeline: { refetch } }) } } as unknown as PaseoApi;
  const context = { paseo } as PluginHookContext;
  const handlers = new Map<string, (event: never, context: PluginHookContext) => unknown>();
  const server = { on: (name: string, handler: (event: never, context: PluginHookContext) => unknown) => {
    handlers.set(name, handler); return () => handlers.delete(name);
  } } as unknown as PluginLifecycleRegistration;
  const observer = new AttentionObserver(readConfig, { enabled: () => enabled, now: () => now,
    append: append ?? (async (_path, line) => { events.push(JSON.parse(line)); }) });
  const sample = vi.fn(async () => fleet([]));
  disposals.push(observer.register(server, sample));
  disposals.push(registerReceiptObservers(server, readConfig, observer.ended));
  const emit = <Name extends keyof PluginLifecycleEvents>(name: Name, event: PluginLifecycleEvents[Name]) => handlers.get(name)?.(event as never, context);
  return { observer, events, emit, setTime: (time: number) => { now = time; }, readConfig, refresh, refetch, paseo, send, sample, handlers };
}
function fleet(cards: FleetCard[]): Fleet {
  return { home: config().home, mate: { id: "mate" }, cards, warnings: [] } as unknown as Fleet;
}
function catalog(status = "running", permission: string | null = null, online = true): RemoteSnapshot {
  return { version: 1, localServerId: "local", syncedAt: null, syncError: null, hosts: [{
    serverId: "remote", label: "not retained", online, checkedAt: new Date(1000).toISOString(), error: null,
    projects: [], workspaces: [], providers: [], clockSkew: { seconds: 600, measuredAt: "unknown", agentId: "clock" },
    workers: [{ id: "worker", name: "not retained", status, updatedAt: "2099-01-01T00:00:00Z", permissions: permission ? 1 : 0,
      output: "PRIVATE OUTPUT", pendingPermissions: permission ? [{ id: permission, tool: "PRIVATE TOOL" }] : [] }],
  }] };
}

describe("detached attention observation", () => {
  it("is off by default, with no extra hooks, reads, writes or sampling", async () => {
    expect(attentionEnabled({})).toBe(false);
    expect(attentionEnabled({ FIRSTMATE_ATTENTION_OBSERVE: "false" })).toBe(false);
    expect(attentionEnabled({ FIRSTMATE_ATTENTION_OBSERVE: "1" })).toBe(true);
    const h = harness(false);
    h.emit("agent.turn_ended", end()); h.observer.catalog(catalog()); h.observer.fleet(fleet([]));
    await h.observer.settled();
    expect(h.handlers.size).toBe(1); expect(h.events).toEqual([]);
    expect(h.readConfig).not.toHaveBeenCalled(); expect(h.refresh).not.toHaveBeenCalled();
    expect(h.sample).not.toHaveBeenCalled();
  });

  it("records local permissions and every worker outcome at hook receipt time, including predecessor crew", async () => {
    const h = harness();
    h.emit("agent.permission_requested", { agent: agent(), request: { id: "permit", provider: "codex", name: "secret", kind: "tool", description: "PRIVATE" } });
    h.setTime(2000);
    h.emit("agent.permission_resolved", { agent: agent(), requestId: "permit", resolution: { behavior: "allow", updatedInput: { secret: "PRIVATE" } } });
    for (const outcome of ["completed", "failed", "canceled"] as const) h.emit("agent.turn_ended", end("worker", outcome));
    await h.observer.settled();
    expect(h.events.filter(event => event.kind === "worker-ended").map(event => event.outcome)).toEqual(["completed", "failed", "canceled"]);
    expect(h.events.find(event => event.kind === "permission-requested")).toMatchObject({ at: 1000, source: "hook", subject: workerKey("worker") });
    const report = attentionReport(h.events);
    expect(report.permissions.exactWait).toMatchObject({ count: 1, medianMs: 1000 });
    expect(JSON.stringify(h.events)).not.toContain("PRIVATE");
  });

  it("records lead start/end/outcome and cancellation association without naming a cause", async () => {
    const h = harness();
    h.emit("agent.turn_started", { agent: agent("mate"), turnId: "turn" });
    h.setTime(2000); h.emit("agent.turn_ended", end());
    h.setTime(3000); h.emit("agent.turn_ended", end("mate", "canceled"));
    await h.observer.settled();
    const finished = h.events.find(event => event.kind === "worker-ended")!;
    expect(h.events.find(event => event.kind === "lead-ended")).toMatchObject({ outcome: "canceled", associatedEvent: finished.id });
    expect(attentionReport(h.events).leadTurns[0]).toMatchObject({ durationMs: 2000, associatedEvent: finished.id });
    expect(JSON.stringify(h.events)).not.toContain("cause");
  });

  it("ignores inspectors/unrelated sessions and leaves missing starts unpaired", async () => {
    const h = harness(); h.refresh.mockResolvedValue({ agent: { labels: { "firstmate.role": "watch-inspector" } } });
    h.emit("agent.turn_ended", end("inspector")); h.emit("agent.turn_ended", end("mate", "failed"));
    await h.observer.settled();
    expect(h.events.some(event => event.kind === "worker-ended")).toBe(false);
    expect(attentionReport(h.events).leadTurns[0]).toMatchObject({ durationMs: null, outcome: "failed" });
  });

  it("reuses the turn timeline for targeted actions, deduplicates calls and never reads another timeline", async () => {
    const h = harness();
    h.emit("agent.turn_ended", end());
    h.setTime(2000); h.emit("agent.turn_started", { agent: agent("mate"), turnId: "turn" });
    h.setTime(4000); h.emit("agent.turn_ended", { ...end("mate"), timeline: [tool()] });
    h.setTime(5000); h.emit("agent.turn_ended", { ...end("mate"), timeline: [tool()] });
    await h.observer.settled();
    expect(h.events.filter(event => event.kind === "action")).toHaveLength(1);
    expect(attentionReport(h.events).incidents[0]).toMatchObject({ actionLatency: { minMs: 1000, maxMs: 3000 } });
    expect(JSON.stringify(h.events)).not.toContain("PRIVATE");
    expect(attentionActions([{ ...tool(), detail: { type: "unknown", input: { agentId: "worker" }, output: { isError: true } } } as TimelineItem])).toEqual([]);
  });

  it("never makes a blocked/failed observation delay or alter delivery", async () => {
    let release!: () => void;
    const held = new Promise<void>(resolve => { release = resolve; });
    const h = harness(true, async () => { await held; throw Error("PRIVATE failure"); });
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const result = h.emit("agent.turn_ended", end());
    await result;
    await sendWithoutInterrupting(h.paseo, "mate", "hello");
    expect(h.send).toHaveBeenCalledWith("hello", { activeTurnBehavior: "steer" });
    release(); await h.observer.settled();
    expect(log).toHaveBeenCalled(); expect(JSON.stringify(log.mock.calls)).not.toContain("PRIVATE");
  });

  it("appends to only attention.jsonl and resumes with a new observation boundary", async () => {
    const home = config().home;
    await mkdir(join(home, "data", "metrics"), { recursive: true });
    const launch = join(home, "data", "metrics", "launches.jsonl");
    await writeFile(launch, "launch fixture\n");
    const h = harness();
    const observer = new AttentionObserver(async () => config(), { enabled: () => true });
    observer.ended(end("mate"), { paseo: h.paseo }); await observer.settled();
    const path = join(home, "data", "metrics", "attention.jsonl"), before = await readFile(path, "utf8");
    const resumed = new AttentionObserver(async () => config(), { enabled: () => true });
    resumed.ended(end("mate"), { paseo: h.paseo }); await resumed.settled();
    expect((await readFile(path, "utf8")).startsWith(before)).toBe(true);
    expect(await readFile(launch, "utf8")).toBe("launch fixture\n");
    expect((await readdir(join(home, "data", "metrics"))).sort()).toEqual(["attention.jsonl", "launches.jsonl"]);
  });

  it("honors the persisted 14-day window across restarts", async () => {
    const home = join(config().home, "expired"), path = join(home, "data", "metrics", "attention.jsonl");
    await mkdir(join(home, "data", "metrics"), { recursive: true });
    const original = JSON.stringify({ version: 1, kind: "start", at: 1 }) + "\n";
    await writeFile(path, original);
    const h = harness();
    const observer = new AttentionObserver(async () => ({ ...config(), home }), { enabled: () => true, now: () => OBSERVATION_MS + 2 });
    observer.ended(end("mate"), { paseo: h.paseo }); await observer.settled();
    expect(await readFile(path, "utf8")).toBe(original);
  });

  it("records loss boundaries and refuses pairing through a failed append", async () => {
    const records: AttentionEvent[] = [];
    const h = harness(true, async (_path, line) => {
      const event = JSON.parse(line) as AttentionEvent;
      if (event.kind === "permission-requested") throw Error("disk unavailable");
      records.push(event);
    });
    vi.spyOn(console, "error").mockImplementation(() => {});
    h.emit("agent.permission_requested", { agent: agent(), request: { id: "p", name: "tool", provider: "codex", kind: "tool" } });
    h.setTime(2000); h.emit("agent.permission_resolved", { agent: agent(), requestId: "p", resolution: { behavior: "deny" } });
    await h.observer.settled();
    expect(records.find(event => event.kind === "gap")?.reason).toBe("recording-failed");
    expect(attentionReport(records).permissions.pairs).toEqual([]);
    expect(attentionReport(records).unpaired.some(event => event.kind === "permission-resolved")).toBe(true);
  });

  it("bounds the queue and records overflow as a continuity break", async () => {
    const h = harness(); vi.spyOn(console, "error").mockImplementation(() => {});
    for (let i = 0; i < 300; i++) h.emit("agent.turn_ended", end());
    await h.observer.settled();
    expect(h.events.some(event => event.reason === "queue-overflow")).toBe(true);
    expect(h.events.filter(event => event.kind === "worker-ended").length).toBeLessThan(256);
  });

  it("does not attribute historical hook tools to the current turn", async () => {
    const h = harness();
    h.refetch.mockResolvedValue({ gap: false, reset: false, staleCursor: false, error: null, entries: [{ turnId: "old-turn", item: tool() }] });
    h.emit("agent.turn_ended", end());
    h.setTime(2000); h.emit("agent.turn_started", { agent: agent("mate"), turnId: "turn" });
    h.setTime(3000); h.emit("agent.turn_ended", { ...end("mate"), timeline: [tool()] });
    await h.observer.settled();
    expect(h.events.find(event => event.kind === "action")?.actionSince).toBeNull();
    expect(attentionReport(h.events).incidents[0]?.actionLatency).toBeNull();
  });

  it("binds crew creation to queued task identity and retains recent calls in long histories", () => {
    const created: TimelineItem = { type: "tool_call", callId: "create", name: "mcp__paseo__create_agent", status: "completed", error: null,
      detail: { type: "unknown", input: { labels: { "firstmate.role": "crew", "firstmate.task": "next", "firstmate.project": "p" } }, output: { agentId: "new-worker" } } };
    const actions = attentionActions([...Array.from({ length: 510 }, (_, index) => tool(`old-${index}`)), created]);
    expect(actions).toHaveLength(500);
    expect(actions.at(-1)).toMatchObject({ tool: "create_agent", subject: attentionKey("task", "local", "p", "next") });
  });

  it("keeps missing catalog permission IDs and fleet read failures as gaps, not resolutions or exits", async () => {
    const h = harness();
    const cards = buildCards(parseBacklog("## Queued\n- [ ] held - Held (hold: approval)"), []);
    h.observer.fleet(fleet(cards), 1000); h.observer.catalog(catalog("idle", "permit")); await h.observer.settled();
    h.setTime(2000);
    h.observer.fleet({ ...fleet([]), warnings: ["unavailable"] }, 2000);
    const unknown = catalog("idle"); unknown.hosts[0]!.workers[0]!.permissions = 1;
    h.observer.catalog(unknown); await h.observer.settled();
    expect(h.events.filter(event => event.kind === "state-exit" || event.kind === "permission-resolved")).toEqual([]);
    expect(h.events.filter(event => event.kind === "gap").map(event => event.reason)).toEqual(["fleet-unavailable", "remote-unavailable"]);
  });

  it("samples the existing fleet compiler with the UI closed and stops its timer on disposal", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    const h = harness();
    h.emit("agent.turn_started", { agent: agent("mate"), turnId: "turn" }); await h.observer.settled();
    await vi.advanceTimersByTimeAsync(60_000); await h.observer.settled();
    expect(h.sample).toHaveBeenCalledTimes(1);
    disposals.splice(0).forEach(dispose => dispose());
    await vi.advanceTimersByTimeAsync(60_000);
    expect(h.sample).toHaveBeenCalledTimes(1);
  });
});

describe("catalog and fleet samples", () => {
  it("records status and permission transitions with poll/skew bounds, without trusting updatedAt", async () => {
    const h = harness(); h.observer.catalog(catalog()); await h.observer.settled();
    h.setTime(61000); h.observer.catalog(catalog("idle", "permit")); await h.observer.settled();
    h.setTime(121000); h.observer.catalog(catalog("running")); await h.observer.settled();
    expect(h.events.filter(event => event.kind === "remote-status")).toHaveLength(3);
    expect(h.events.find(event => event.kind === "permission-requested")).toMatchObject({ since: 1000, pollMs: 60000, clockSkewSeconds: 600, baseline: false });
    expect(attentionReport(h.events).permissions.pairs[0]?.latency).toEqual({ minMs: 0, maxMs: 120000, observedMs: 60000 });
    expect(JSON.stringify(h.events)).not.toContain("PRIVATE"); expect(JSON.stringify(h.events)).not.toContain("2099");
  });

  it("reports baseline, offline and missing-worker permissions as censored or unpaired, never zero latency", async () => {
    const h = harness(); h.observer.catalog(catalog("idle", "permit")); await h.observer.settled();
    h.setTime(2000); h.observer.catalog(catalog("idle")); await h.observer.settled();
    expect(attentionReport(h.events).permissions.pairs[0]?.latency.maxMs).toBeNull();
    h.setTime(3000); h.observer.catalog(catalog("idle", "again")); await h.observer.settled();
    h.setTime(4000); h.observer.catalog(catalog("idle", null, false)); await h.observer.settled();
    h.setTime(5000); h.observer.catalog(catalog("idle")); await h.observer.settled();
    expect(attentionReport(h.events).unpaired.some(event => event.kind === "permission-requested")).toBe(true);
    expect(h.events.filter(event => event.kind === "permission-resolved")).toHaveLength(1);
    h.setTime(6000); const missing = catalog(); missing.hosts[0]!.workers = []; h.observer.catalog(missing); await h.observer.settled();
    expect(h.events.at(-1)?.reason).toBe("subject-missing");
  });

  it("derives every actionable category from the existing compiled cards", async () => {
    const cards = buildCards(parseBacklog("## Queued\n- [ ] next - Next (project: p) (blocked-by: prior)\n- [ ] held - Held (hold: approval)\n## Done\n- [x] prior - Prior (project: p)"), []);
    const ready = { ...cards[0]!, key: "ready", taskId: "ready", column: "ready", backlog: null } as FleetCard;
    const failure = { ...ready, key: "failed", taskId: "failed", column: "failed" } as FleetCard;
    const followed = { ...ready, key: "followed", taskId: "followed", column: "blocked", remote: {
      serverId: "remote", host: "remote", online: true, clockSkewSeconds: null, worker: {
        id: "followed", name: "followed", status: "idle", updatedAt: "", pendingPermissions: 1, permissionDetails: [], recentTools: [], followed: true,
      },
    } } as FleetCard;
    cards.push(ready, failure, followed);
    expect(new Set(cards.flatMap(card => attentionStates(card, cards)))).toEqual(new Set(ATTENTION_STATES));
    const h = harness(); h.observer.fleet(fleet(cards)); await h.observer.settled();
    h.setTime(2000); h.observer.fleet(fleet(cards)); await h.observer.settled();
    expect(h.events.filter(event => event.kind === "state-enter")).toHaveLength(8);
    h.setTime(3000); h.observer.fleet(fleet([])); await h.observer.settled();
    expect(h.events.filter(event => event.kind === "state-exit")).toHaveLength(8);
    expect(attentionReport(h.events).incidents.every(event => event.actionLatency === null && event.residenceMs === 2000)).toBe(true);
    const ambiguous = [...cards, { ...cards.find(card => card.taskId === "prior")! }];
    expect(attentionStates(cards[0]!, ambiguous)).not.toContain("dependencies-met");
    const explicitlyLocal = { ...cards[0]!, backlog: { ...cards[0]!.backlog!, host: "this-machine-server-id" } };
    expect(cardKey(explicitlyLocal)).toBe(cardKey(cards[0]!));
  });
});

describe("fixture report", () => {
  it("reuses paired remote helper receipts only for the same lead, host and target", () => {
    const base = { version: 1 as const, run: "run", lead: attentionKey("mate"), source: "catalog" as const, subject: workerKey("worker", "remote") };
    const events: AttentionEvent[] = [{ ...base, id: "event", at: 100, kind: "remote-status", status: "idle", since: 50 },
      { ...base, id: "end", at: 500, kind: "remote-status", status: "running", since: 400 }];
    const receipt = { version: 1, requestId: "request", action: "steer", actorId: "mate", targetId: "worker", serverId: "remote" };
    const pair = [{ ...receipt, at: new Date(200).toISOString(), phase: "started" }, { ...receipt, at: new Date(300).toISOString(), phase: "succeeded" }];
    const imported = remoteReceiptActions(events, pair);
    const report = attentionReport([...events, ...imported.actions].sort((a, b) => a.at - b.at));
    expect(report.incidents[0]).toMatchObject({ actionSource: "receipt", actionLatency: { minMs: 100, maxMs: 250 } });
    expect(remoteReceiptActions(events, [pair[1]]).unpaired).toBe(1);
    expect(remoteReceiptActions(events, [pair[0]]).unpaired).toBe(1);
    expect(remoteReceiptActions(events, [{ ...pair[0], actorId: null }, { ...pair[1], actorId: null }]).actions).toEqual([]);
    const other = remoteReceiptActions(events, pair.map(row => ({ ...row, actorId: "captain" })));
    expect(attentionReport([...events, ...other.actions].sort((a, b) => a.at - b.at)).incidents[0]?.action).toBeNull();
  });

  it("reports paired/unpaired events, upper bounds, lead outcomes and malformed-log gaps", () => {
    const event = (kind: AttentionEvent["kind"], at: number, fields: Partial<AttentionEvent> = {}): AttentionEvent => ({
      version: 1, run: "run", id: `${kind}-${at}`, at, kind, lead: "lead", subject: "worker", source: "hook", ...fields,
    });
    const log = [event("permission-requested", 100, { request: "p" }), event("permission-resolved", 200, { request: "p" }),
      event("permission-resolved", 300, { request: "orphan" }), event("state-enter", 400, { state: "ready", source: "fleet", since: 350 }),
      event("lead-started", 500, { turn: "turn" }), event("lead-ended", 900, { turn: "turn", outcome: "completed" }),
      event("action", 900, { actionSince: 500, call: "call" }), event("state-exit", 1000, { state: "ready" }),
      event("worker-ended", 1100, { outcome: "failed" })].map(value => JSON.stringify(value)).join("\n");
    const parsed = parseAttentionLog("\uFEFF" + log), report = attentionReport(parsed.events);
    expect(parsed.invalidLines).toEqual([]);
    expect(report.permissions.exactWait).toMatchObject({ count: 1, medianMs: 100 });
    expect(report.byCategory.find(row => row.category === "ready")).toMatchObject({ pairedActions: 1, actionUpperBound: { p95Ms: 550 } });
    expect(report.byCategory.find(row => row.category === "worker-failed")).toMatchObject({ unpairedActions: 1, actionUpperBound: { count: 0, medianMs: null } });
    expect(report.unpaired).toContainEqual({ event: "permission-resolved-300", kind: "permission-resolved", reason: "no-request-in-continuous-observation" });
    const broken = parseAttentionLog([JSON.stringify(event("permission-requested", 1, { request: "p" })), "{partial", JSON.stringify(event("permission-resolved", 2, { request: "p" }))].join("\n"));
    expect(broken.invalidLines).toEqual([2]);
    expect(attentionReport(broken.events, broken.invalidLines).permissions.pairs).toEqual([]);
  });

  it("does not attribute an action in an overlapping lead turn or join across reloads", () => {
    const base = { version: 1 as const, run: "one", lead: "lead", source: "hook" as const, subject: "worker" };
    const events: AttentionEvent[] = [{ ...base, id: "event", kind: "worker-ended", at: 100, outcome: "completed" },
      { ...base, id: "action", kind: "action", at: 200, actionSince: 50 },
      { ...base, run: "two", id: "later", kind: "action", at: 400, actionSince: 300 }];
    expect(attentionReport(events).incidents[0]?.actionLatency).toBeNull();
    expect(attentionKey("one")).not.toBe(attentionKey("two"));
  });
});
