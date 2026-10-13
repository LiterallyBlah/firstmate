import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FirstmateConfigSchema } from "../shared/fleet";
import { BOARD_REVIEW_ROUTING, type ManagedWatch } from "../shared/watch-routing";
import type { PaseoApi, TimelineItem } from "./host-types";
import { oneAtATime } from "./mate";
import { WatchInspections, INSPECTION_TIMEOUT_MS, parseInspectionResult, inspectionResultText, timelineHasMessage } from "./watch-inspections";
import type { TimelinePage } from "./host-types";

const directories: string[] = [];
afterEach(async () => { for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true }); });
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "firstmate-inspections-")); directories.push(root);
  let config = FirstmateConfigSchema.parse({ home: join(root, "home"), mateAgentId: "mate" });
  let clock = Date.now(); let readOnly = true; let createFailure: string | null = null; let ackLost = false;
  type Agent = { id: string; provider: string; model: string; status: string; currentModeId: string; thinkingOptionId: string;
    workspaceId: string; archivedAt: string | null; labels: Record<string, string>; pendingPermissions: { id: string }[]; lastError: string | null; cwd: string };
  const agents = new Map<string, Agent>(); const timelines = new Map<string, TimelineItem[]>();
  const mate: Agent = { id: "mate", provider: "codex", model: "model", status: "idle", currentModeId: "danger-full-access",
    thinkingOptionId: "xhigh", workspaceId: "home", archivedAt: null, labels: {}, pendingPermissions: [], lastError: null, cwd: config.home };
  agents.set(mate.id, mate); timelines.set(mate.id, []);
  const created: any[] = []; const sent: any[] = []; const archived: string[] = []; const denied: any[] = [];
  const children = vi.fn(async () => []);
  const api = {
    providers: { listModels: async () => ({ models: [{ id: "model", thinkingOptions: ["medium", "high", "xhigh"].map((id) => ({ id, label: id })) }] }),
      listModes: async () => ({ modes: readOnly ? [{ id: "read-only", label: "Read only" }] : [] }) },
    workspaces: { open: async (cwd: string) => ({ id: "inspection-workspace", agents: { create: async (input: any) => {
      created.push(input); if (createFailure) throw new Error(createFailure);
      const id = input.agentId; agents.set(id, { ...mate, id, cwd, workspaceId: "inspection-workspace", status: "idle",
        thinkingOptionId: input.config.thinkingOptionId, currentModeId: input.config.modeId, labels: input.labels }); timelines.set(id, []);
      return { id };
    } } }) },
    agents: { ref: (id: string) => ({ refresh: async () => {
      const agent = agents.get(id); if (!agent) throw new Error("Agent not found"); return { agent };
    }, send: async (text: string, options: any) => {
      // The daemon's message receipt deduplicates the stable message ID.
      const items = timelines.get(id)!;
      if (!items.some((item) => item.type === "user_message" && item.clientMessageId === options.messageId)) {
        items.push({ type: "user_message", text, clientMessageId: options.messageId } as TimelineItem);
        sent.push({ id, text, options }); agents.get(id)!.status = "running";
      }
      if (ackLost && id === config.mateAgentId) { ackLost = false; throw new Error("Acknowledgement lost"); }
    }, archive: async () => { agents.get(id)!.archivedAt = "archived"; archived.push(id); },
    respondToPermission: async (input: any) => { denied.push(input); agents.get(id)!.pendingPermissions = []; },
    timeline: { refetch: async () => ({ entries: (timelines.get(id) ?? []).map((item) => ({ item })), error: null }) } }) },
  } as unknown as PaseoApi;
  const options = { root, paseo: () => api, config: async () => config, snapshot: async () => ({ cards: [{ key: "crew:a", status: "idle" }] }), now: () => clock, children };
  let runner = new WatchInspections(options);
  const finish = (id: string, outcome = "no-change", findings: any[] = []) => {
    agents.get(id)!.status = "idle";
    const result = { version: 1, runId: id, outcome, summary: "Review completed", findings };
    timelines.get(id)!.push({ type: "assistant_message", text: JSON.stringify(result) } as TimelineItem); return result;
  };
  const finding = { kind: "stall", subject: "crew:a", evidence: "Worker is idle with unfinished work", recommendation: "Review the stalled task" };
  const watch: ManagedWatch = { name: "board-review", schedule: "*/10 * * * *", prompt: "Inspect the board", enabled: true, ...BOARD_REVIEW_ROUTING };
  return { root, api, agents, timelines, mate, created, sent, archived, denied, children, watch, finish, finding,
    get runner() { return runner; }, get config() { return config; }, set config(value) { config = value; },
    set clock(value: number) { clock = value; }, set readOnly(value: boolean) { readOnly = value; },
    set createFailure(value: string) { createFailure = value; }, set ackLost(value: boolean) { ackLost = value; },
    reload() { runner = new WatchInspections(options); } };
}

describe("isolated inspection lifecycle", () => {
  it("creates a separate, parentless read-only session at medium with no supervisor charter or notifications", async () => {
    const f = await fixture(); await f.runner.start(f.watch.name, f.watch.prompt, f.watch);
    expect(f.created).toHaveLength(1); const created = f.created[0];
    expect(created.prompt).toBeUndefined(); expect(created.parent).toBeUndefined();
    expect(created.config).toMatchObject({ provider: "codex/model", thinkingOptionId: "medium", modeId: "read-only", mcpServers: { paseo: { type: "stdio" } } });
    expect(created.labels).toMatchObject({ "firstmate.role": "watch-inspector" });
    expect(created.labels["firstmate.task"]).toBeUndefined(); expect(f.mate.thinkingOptionId).toBe("xhigh");
    const inspector = f.agents.get(created.agentId)!; expect(inspector.workspaceId).not.toBe(f.mate.workspaceId);
    expect(inspector.cwd.startsWith(f.config.home)).toBe(false);
    expect(await readFile(join(inspector.cwd, "AGENTS.md"), "utf8")).toContain("inspection authority only");
    expect(f.sent[0].text).not.toContain("Dispatching a crewmate");
  });
  it("finishes no-change silently, archives only the inspector and retains evidence across reload", async () => {
    const f = await fixture(); await f.runner.start(f.watch.name, f.watch.prompt, f.watch); const id = f.created[0].agentId;
    f.finish(id); await f.runner.reconcile(); f.reload(); await f.runner.reconcile();
    expect(f.sent.filter((entry) => entry.id === "mate")).toHaveLength(0); expect(f.archived).toEqual([id]);
    const history = await f.runner.history(f.watch.name); expect(history.runs[0]).toMatchObject({ status: "completed", delivery: "suppressed", cleanup: "archived", agentId: id });
    expect(JSON.parse(await readFile(join(f.root, "runs", id, "result.json"), "utf8")).report.outcome).toBe("no-change");
  });
  it("persists actionable results until the mate is idle and retargets after a handover", async () => {
    const f = await fixture(); await f.runner.start(f.watch.name, f.watch.prompt, f.watch); const id = f.created[0].agentId;
    f.finish(id, "actionable", [f.finding]); f.mate.status = "running"; await f.runner.reconcile();
    expect((await f.runner.history(f.watch.name)).runs[0]?.delivery).toBe("pending");
    f.agents.set("replacement", { ...f.mate, id: "replacement", status: "idle" }); f.timelines.set("replacement", []);
    f.config = { ...f.config, mateAgentId: "replacement" }; f.reload(); await f.runner.reconcile();
    expect(f.sent.filter((entry) => entry.id === "mate")).toEqual([]);
    expect(f.sent.find((entry) => entry.id === "replacement")?.options.messageId).toBe(`firstmate-watch-result-${id}`);
  });
  it("re-reads the current mate inside the non-reentrant lifecycle gate", async () => {
    const f = await fixture(); await f.runner.start(f.watch.name, f.watch.prompt, f.watch); const id = f.created[0].agentId; f.finish(id, "actionable", [f.finding]);
    let release!: () => void; let entered!: () => void;
    const began = new Promise<void>((done) => { entered = done; });
    const gate = oneAtATime(async () => { entered(); await new Promise<void>((done) => { release = done; });
      f.config = { ...f.config, mateAgentId: "replacement" }; f.agents.set("replacement", { ...f.mate, id: "replacement" }); f.timelines.set("replacement", []); });
    await began; const pending = f.runner.reconcile(); release(); await gate; await pending;
    expect(f.sent.at(-1)?.id).toBe("replacement");
  });
  it.each(["migration", "launch"])("does not launch during %s, and queues results without sending during recovery", async state => {
    const f = await fixture(); await f.runner.start(f.watch.name, f.watch.prompt, f.watch); const id = f.created[0].agentId; f.finish(id, "actionable", [f.finding]);
    f.config = state === "migration"
      ? { ...f.config, migration: { sourceId: "mate", sourceRevision: "now", agentId: crypto.randomUUID(), target: { provider: "other/model", modeId: "", thinkingOptionId: "" }, prompt: "handoff", handoffPath: "data/handoff.md" } }
      : { ...f.config, mateLaunch: { agentId: "mate", home: f.config.home, target: { provider: "codex/model", modeId: "", thinkingOptionId: "" }, prompt: "opening", state: "sending" } };
    expect(await f.runner.start("second", "Inspect", f.watch)).toBe(false); await f.runner.reconcile();
    expect((await f.runner.history(f.watch.name)).runs[0]?.delivery).toBe("pending"); expect(f.sent.filter((entry) => entry.id === "mate")).toEqual([]);
  });
  it("inherits the live thinking option only at launch", async () => {
    const f = await fixture(); await f.runner.start("inherit", "Inspect", { ...f.watch, newSessionReasoning: "inherit" });
    expect(f.created[0].config.thinkingOptionId).toBe("xhigh"); f.mate.thinkingOptionId = "high";
    expect(f.created[0].config.thinkingOptionId).toBe("xhigh");
  });
  it.each(["unsupported-thinking", "no-read-only", "creation", "malformed", "canceled", "permission", "missing", "timeout"])("escalates %s while retaining status", async (scenario) => {
    const f = await fixture(); if (scenario === "no-read-only") f.readOnly = false; if (scenario === "creation") f.createFailure = "Provider could not create";
    await f.runner.start(f.watch.name, f.watch.prompt, { ...f.watch, notificationPolicy: "never", ...(scenario === "unsupported-thinking" ? { newSessionReasoning: "not-offered" } : {}) });
    const id = f.created[0]?.agentId;
    if (id) {
      if (scenario === "malformed") { f.agents.get(id)!.status = "idle"; f.timelines.get(id)!.push({ type: "assistant_message", text: "done: fine" } as TimelineItem); }
      if (scenario === "canceled") f.runner.endedTurn(id, { kind: "canceled", reason: "Stopped", timeline: [] });
      if (scenario === "permission") f.agents.get(id)!.pendingPermissions = [{ id: "request" }];
      if (scenario === "missing") f.agents.delete(id);
      if (scenario === "timeout") f.clock = Date.now() + INSPECTION_TIMEOUT_MS + 1000;
    }
    await f.runner.reconcile(); const result = (await f.runner.history(f.watch.name)).runs[0]!;
    expect(result.status).toBe("failed"); expect(result.delivery).toBe("sent"); expect(result.report).toContain("error");
    expect(f.sent.filter((entry) => entry.id === "mate")).toHaveLength(1);
    if (scenario === "permission") expect(f.denied[0].response.behavior).toBe("deny");
  });
  it("supports always and never for successful results", async () => {
    for (const notificationPolicy of ["always", "never"] as const) {
      const f = await fixture(); await f.runner.start(f.watch.name, f.watch.prompt, { ...f.watch, notificationPolicy });
      f.finish(f.created[0].agentId, notificationPolicy === "always" ? "no-change" : "actionable", notificationPolicy === "always" ? [] : [f.finding]); await f.runner.reconcile();
      expect(f.sent.filter((entry) => entry.id === "mate")).toHaveLength(notificationPolicy === "always" ? 1 : 0);
    }
  });
  it("prevents overlapping runs and duplicate inputs across reload", async () => {
    const f = await fixture(); await f.runner.queueInput(f.watch.name, f.watch.prompt, f.watch, undefined, "2026-10-10T12:00");
    await f.runner.queueInput(f.watch.name, f.watch.prompt, f.watch, undefined, "2026-10-10T12:00");
    await f.runner.drainInputs(); f.reload(); await f.runner.drainInputs();
    expect(await f.runner.start(f.watch.name, f.watch.prompt, f.watch)).toBe(false); expect(f.created).toHaveLength(1);
  });
  it("deduplicates unchanged findings but reports a recurrence after a no-change run", async () => {
    const f = await fixture();
    for (const outcome of ["actionable", "actionable", "no-change", "actionable"]) {
      f.mate.status = "idle"; await f.runner.start(f.watch.name, f.watch.prompt, f.watch);
      f.finish(f.created.at(-1).agentId, outcome, outcome === "actionable" ? [f.finding] : []); await f.runner.reconcile();
    }
    expect(f.sent.filter((entry) => entry.id === "mate")).toHaveLength(2);
  });
  it("reconciles an acknowledged send whose reply was lost, even after mate replacement", async () => {
    const f = await fixture(); await f.runner.start(f.watch.name, f.watch.prompt, f.watch); f.finish(f.created[0].agentId, "actionable", [f.finding]); f.ackLost = true;
    await f.runner.reconcile(); expect((await f.runner.history(f.watch.name)).runs[0]?.delivery).toBe("pending");
    f.config = { ...f.config, mateAgentId: "replacement" }; f.agents.set("replacement", { ...f.mate, id: "replacement", status: "idle" }); f.timelines.set("replacement", []);
    f.reload(); await f.runner.reconcile(); expect(f.sent.filter((entry) => entry.id === "replacement")).toEqual([]);
    expect((await f.runner.history(f.watch.name)).runs[0]?.delivery).toBe("sent");
  });
  it("keeps cleanup errors visible and refuses to archive descendants or recreate an inspector", async () => {
    const f = await fixture(); await f.runner.start(f.watch.name, f.watch.prompt, f.watch); const id = f.created[0].agentId; f.finish(id);
    f.children.mockResolvedValue([{ id: "child" }] as never); await f.runner.reconcile();
    expect(f.archived).toEqual([]); expect((await f.runner.history(f.watch.name)).runs[0]?.report).toContain("descendants");
    expect(await f.runner.start(f.watch.name, f.watch.prompt, f.watch)).toBe(false);
    f.children.mockResolvedValue([]); await f.runner.reconcile(); expect(f.archived).toEqual([id]);
  });
  it("finishes a run with its captured policy while future definitions change", async () => {
    const f = await fixture(); await f.runner.start(f.watch.name, f.watch.prompt, f.watch); f.watch.notificationPolicy = "always";
    f.finish(f.created[0].agentId); await f.runner.reconcile(); expect(f.sent.filter((entry) => entry.id === "mate")).toEqual([]);
  });
});

it("rejects inconsistent, wrong-run and unstructured results", () => {
  const runId = crypto.randomUUID();
  for (const text of ["done: complete", JSON.stringify({ version: 1, runId, outcome: "actionable", summary: "fine", findings: [] }),
    JSON.stringify({ version: 1, runId: crypto.randomUUID(), outcome: "no-change", summary: "fine", findings: [] })]) {
    expect(() => parseInspectionResult(text, runId)).toThrow();
  }
});

describe("inspector message boundaries and delivery receipts", () => {
  const entries = (items: { item: Record<string, unknown>; turnId?: string }[]) => items as TimelinePage["entries"];
  const prompt = { item: { type: "user_message", clientMessageId: "saved", text: "inspect" }, turnId: "own-turn" };
  it("joins chunks only when their explicit message and turn IDs match", () => {
    expect(inspectionResultText(entries([prompt,
      { item: { type: "assistant_message", messageId: "prior", text: "Explanation" }, turnId: "own-turn" },
      { item: { type: "assistant_message", messageId: "json", text: '{"result":' }, turnId: "own-turn" },
      { item: { type: "assistant_message", messageId: "json", text: 'true}' }, turnId: "own-turn" },
    ]), "saved")).toBe('{"result":true}');
    expect(inspectionResultText(entries([prompt,
      { item: { type: "assistant_message", text: "prior reply" } },
      { item: { type: "assistant_message", text: "final reply" } },
    ]), "saved")).toBe("final reply");
  });
  it("refuses another user's prompt or a result from a different turn", () => {
    expect(() => inspectionResultText(entries([prompt, { item: { type: "user_message", text: "manual turn" } },
      { item: { type: "assistant_message", text: "result" } }]), "saved")).toThrow("another prompt");
    expect(() => inspectionResultText(entries([prompt, { item: { type: "assistant_message", text: "result" }, turnId: "other" }]), "saved")).toThrow("different turn");
  });
  it("searches older pages when an acknowledgement is outside the latest 200 entries", async () => {
    const refetch = vi.fn().mockResolvedValueOnce({ entries: [{ item: { type: "assistant_message" } }], hasOlder: true, startCursor: { seq: 201 } })
      .mockResolvedValueOnce({ entries: [{ item: { type: "user_message", clientMessageId: "receipt" } }], hasOlder: false });
    const api = { agents: { ref: () => ({ timeline: { refetch } }) } } as unknown as PaseoApi;
    expect(await timelineHasMessage(api, "old-mate", "receipt")).toBe(true);
    expect(refetch.mock.calls[1]?.[0]).toMatchObject({ direction: "before", cursor: { seq: 201 } });
  });
  it.each([{ error: "gone" }, { staleCursor: true }, { gap: {} }, { entries: [], hasOlder: true }])("keeps uncertain receipts pending for %j", async (page) => {
    const api = { agents: { ref: () => ({ timeline: { refetch: async () => ({ entries: [], ...page }) } }) } } as unknown as PaseoApi;
    await expect(timelineHasMessage(api, "old-mate", "receipt")).rejects.toThrow();
  });
});
