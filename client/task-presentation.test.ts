import { describe, expect, it } from "vitest";
import { COLUMN_IDS, type FleetCard, type CrewReportSummary } from "../shared/fleet";
import type { NeedsYouRequest, NeedsYouSnapshot } from "../shared/needs-you";
import { displaySettings } from "../shared/settings";
import { DEFAULT_TASK_LAYOUT, moveTaskColumn, orderedTaskColumns, taskLayoutSettings } from "../shared/task-layout";
import { activeDecisions, presentedTasks, requestForCard, taskPresentation, taskSourceKey, waitingOver30Minutes } from "./task-presentation";
import { attentionSnapshot } from "../test/attention-deck-fixture";
import { planDecisionNeed } from "../test/plan-decision-fixture";

it("shares one due plan item with the drawer and keeps future decisions out of List/Board", () => {
  const snapshot = { ...attentionSnapshot([]), actionCount: 1, planNow: [planDecisionNeed()], comingUp: [{ ...planDecisionNeed(), node: "future" }] };
  expect(activeDecisions(snapshot).map(r => r.source.title)).toEqual(["Spoiler and foreshadowing checks"]);
  expect(snapshot.actionCount).toBe(1);
  expect(snapshot.requests).toEqual([]); // No ledger request was invented.
  const planCard = card({ taskId: "checks", project: null, backlog: { ...card().backlog!, id: "checks", project: null } });
  expect(taskPresentation(planCard, snapshot).group).toBe("needs-you");
  expect(presentedTasks([planCard], snapshot)).toEqual([]);
});

function card(extra: Partial<FleetCard> = {}): FleetCard {
  return {
    key: "worker:one",
    taskId: "task",
    title: "Task",
    project: "project",
    kind: "builder",
    column: "working",
    agent: null,
    report: null,
    url: null,
    backlog: {
      id: "task",
      title: "Task",
      project: "project",
      section: "in-flight",
      kind: "builder",
      mode: null,
      agentId: null,
      hold: null,
      blockedBy: null,
      since: null,
      url: null,
      reportPath: null,
      outcome: null,
    },
    ...extra,
  };
}
function request(c = card(), state: NeedsYouRequest["state"] = "new"): NeedsYouRequest {
  return {
    id: "request",
    state,
    generation: 1,
    revision: 3,
    detectedAt: 10,
    updatedAt: 10,
    baseline: false,
    originalAsk: "Approve?",
    seenAt: null,
    seenRevision: null,
    snoozedUntil: 10000,
    submissions: [],
    resolution: null,
    source: {
      key: taskSourceKey(c)!,
      taskId: c.taskId!,
      hostId: c.remote?.serverId ?? "local",
      project: c.project,
      title: "Recorded title",
      ask: "Approve the current question?",
      url: null,
      reportPath: null,
      gateToken: null,
      section: "in-flight",
      disposition: "open",
      blockedBy: null,
    },
  };
}
function snapshot(requests = [request()]): NeedsYouSnapshot {
  return {
    homeId: "home",
    version: 3,
    actionCount: requests.filter((r) => r.state === "new" || r.state === "seen").length,
    newCount: requests.filter((r) => r.state === "new").length,
    pendingAnswerCount: 0,
    snoozedCount: 0,
    freshness: { status: "fresh", asOf: 10, checkedAt: 10, problems: [] },
    requests,
    parked: [],
    delivery: "off",
  };
}
const reports: Array<CrewReportSummary["state"] | null> = [
  null,
  "working",
  "needs-decision",
  "blocked",
  "paused",
  "done",
  "failed",
  "resolved",
];
const worker = {
  id: "remote",
  name: "Remote",
  status: "running",
  updatedAt: "2026-10-19",
  pendingPermissions: 0,
  permissionDetails: [],
  recentTools: [],
  followed: false,
};
describe.each(COLUMN_IDS)("presentation over legacy %s", (column) => {
  it.each(reports)("ledger wins over report %s for local, remote, followed and absent workers", (reportState) => {
    for (const kind of ["local", "remote", "followed", "none"]) {
      const c = card({ column, report: reportState ? { state: reportState, text: "Exact worker report" } : null });
      if (kind === "local")
        c.agent = {
          id: "local-worker",
          title: "Worker",
          status: "error",
          pendingPermissions: 1,
          requiresAttention: false,
          lastError: "Exact error",
          provider: "provider",
          model: "model",
          updatedAt: "2026-10-19",
          workspaceId: "workspace",
          cwd: "/home",
          labels: {},
        };
      if (kind === "remote" || kind === "followed")
        c.remote = {
          host: "Remote",
          serverId: "remote-host",
          online: false,
          clockSkewSeconds: null,
          worker: { ...worker, followed: kind === "followed" },
        };
      const before = structuredClone(c),
        gate = request(c);
      expect(taskPresentation(c, snapshot([gate]))).toMatchObject({
        group: "needs-you",
        line: gate.source.ask,
        request: { revision: 3 },
      });
      expect(taskPresentation(c, snapshot())).not.toHaveProperty("group", "done");
      expect(taskPresentation(c).group).not.toBe("needs-you");
      expect(c).toEqual(before);
      c.backlog!.section = "done";
      c.backlog!.outcome = "Merged and verified";
      expect(taskPresentation(c, snapshot([gate]))).toMatchObject({ group: "done", line: "Merged and verified" });
    }
  });
});
it("keeps failures, permissions and worker finishes with the first mate, with the worker status in the summary", () => {
  expect(
    taskPresentation(card({ column: "failed", report: { state: "failed", text: "exit 137" } })),
  ).toMatchObject({ group: "in-hand", owner: "first-mate", line: "Handling a failure: exit 137" });
  expect(taskPresentation(card({ column: "ready" }))).toMatchObject({
    group: "in-hand",
    line: "With the first mate for review",
  });
  expect(
    taskPresentation(
      card({
        remote: {
          host: "Remote",
          serverId: "remote",
          online: true,
          clockSkewSeconds: null,
          worker: { ...worker, pendingPermissions: 1 },
        },
      }),
    ),
  ).toMatchObject({ group: "in-hand", owner: "first-mate", line: "Answering a permission: a tool is waiting for approval" });
});
it("maps structural deferral and snooze to Later, pending answers to In hand, and resolved gates back to task ownership", () => {
  const c = card();
  c.backlog!.blockedBy = "dependency";
  c.backlog!.hold = "Later question";
  expect(taskPresentation(c)).toMatchObject({ group: "later", line: "After dependency" });
  c.backlog!.blockedBy = null;
  c.backlog!.kind = "captain";
  c.backlog!.hold = null;
  expect(taskPresentation(c).group).toBe("later");
  c.backlog!.kind = "builder";
  for (const state of ["snoozed", "answer-sent", "delivery-uncertain", "resolved"] as const)
    expect(taskPresentation(c, snapshot([request(c, state)])).group).toBe(state === "snoozed" ? "later" : "in-hand");
});
it("keeps every lifecycle note subordinate to ledger ownership and out of the captain queue", () => {
  for (const note of [undefined, "waiting", "stalled", "no worker seen"] as const) {
    const c = card({ ...(note ? { note } : {}), report: { state: "working", text: "Raw lifecycle prose" } });
    expect(taskPresentation(c).group).toBe("in-hand");
    expect(taskPresentation(c).line).toContain("Raw lifecycle prose");
    expect(taskPresentation(c, snapshot([request(c)]))).toMatchObject({
      group: "needs-you",
      line: "Approve the current question?",
    });
    expect(taskPresentation(c, snapshot([request(c, "snoozed")])).group).toBe("later");
    expect(taskPresentation(c, snapshot([request(c, "answer-sent")]))).toMatchObject({
      group: "in-hand",
      owner: "first-mate",
    });
  }
  expect(
    taskPresentation(card({ note: "waiting", report: { state: "blocked", text: "Waiting for a known job" } })),
  ).toMatchObject({ owner: "worker", line: "Waiting: Waiting for a known job" });
  expect(
    taskPresentation(card({ note: "waiting", report: { state: "paused", text: "Waiting for a known job" } })),
  ).toMatchObject({ owner: "worker" });
});
it("shows all completed outcomes newest first without changing in-hand order or treating a worker finish as Done", () => {
  const older = card({ key: "old" }),
    newer = card({ key: "new" }),
    undated = card({ key: "undated" });
  for (const c of [older, newer, undated]) c.backlog!.section = "done";
  older.backlog!.outcome = "Merged 2026-10-01";
  newer.backlog!.outcome = "Merged 2026-10-19";
  const first = card({ key: "first", column: "done" }),
    second = card({ key: "second" });
  const tasks = presentedTasks([older, first, undated, newer, second]);
  expect(tasks.filter((task) => task.summary.group === "in-hand").map((task) => task.card.key)).toEqual([
    "first",
    "second",
  ]);
  expect(tasks.filter((task) => task.summary.group === "done").map((task) => task.card.key)).toEqual([
    "new",
    "old",
    "undated",
  ]);
});
it("has one unfiltered queue, deduplicates multiple card representations, and keeps remote/project identities apart", () => {
  const c = card(),
    gate = request(c),
    data = snapshot([gate]);
  expect(presentedTasks([c, { ...c, key: "second-worker" }], data)).toEqual([]);
  expect(activeDecisions(data)).toEqual([gate]);
  expect(activeDecisions({ ...data, freshness: { ...data.freshness, status: "stale" } })).toEqual([gate]);
  expect(
    requestForCard({ ...c, project: "other", backlog: { ...c.backlog!, project: "other" } }, data),
  ).toBeUndefined();
  expect(
    requestForCard(
      { ...c, remote: { host: "Remote", serverId: "remote", online: true, clockSkewSeconds: null, worker: null } },
      data,
    ),
  ).toBeUndefined();
  expect(
    activeDecisions(
      snapshot([
        { ...gate, id: "seen", state: "seen", detectedAt: 0 },
        { ...gate, id: "z" },
        { ...gate, id: "a" },
      ]),
    ).map((r) => r.id),
  ).toEqual(["a", "z", "seen"]);
});
it("preserves legacy settings through switching and gives the new layout independent versioned defaults", () => {
  const saved = {
    columnOrder: ["done", "blocked", "working"],
    collapsedColumns: ["blocked", "ready"],
    crewView: "board",
    hostTab: "remote",
    density: "compact",
  };
  const legacy = displaySettings.schema.parse(saved),
    before = structuredClone(legacy);
  expect(taskLayoutSettings.id).not.toBe(displaySettings.id);
  expect(taskLayoutSettings.version).toBe(1);
  expect(DEFAULT_TASK_LAYOUT).toMatchObject({ mode: "summary", collapsed: ["later", "done"], laterCollapsed: true });
  const changed = taskLayoutSettings.schema.parse({
    ...DEFAULT_TASK_LAYOUT,
    mode: "detailed",
    collapsed: ["needs-you"],
  });
  expect(taskLayoutSettings.schema.parse({ ...changed, mode: "summary" }).collapsed).toEqual(["needs-you"]);
  expect(displaySettings.schema.parse(legacy)).toEqual(before);
  expect(legacy.collapsedColumns).toEqual(["blocked", "ready"]);
});
it("pins Needs you, normalizes duplicate/unknown saved columns and only reorders the other three", () => {
  expect(orderedTaskColumns(["done", "blocked", "done", "needs-you"])).toEqual([
    "needs-you",
    "done",
    "in-hand",
    "later",
  ]);
  expect(moveTaskColumn(DEFAULT_TASK_LAYOUT.order, "needs-you", 1)).toEqual(DEFAULT_TASK_LAYOUT.order);
  expect(moveTaskColumn(DEFAULT_TASK_LAYOUT.order, "in-hand", -1)).toEqual(DEFAULT_TASK_LAYOUT.order);
  expect(moveTaskColumn(DEFAULT_TASK_LAYOUT.order, "later", -1)).toEqual(["needs-you", "later", "in-hand", "done"]);
});

it("counts observable waits over 30 minutes, correcting remote time and excluding work and offline feeds", () => {
  const now = Date.parse("2026-10-19T12:00:00Z");
  const c = card({ column: "ready", remote: { serverId: "r", host: "Remote", online: true, clockSkewSeconds: 3600,
    worker: { ...worker, status: "idle", updatedAt: "2026-10-19T12:29:00Z" } } });
  const entries = () => presentedTasks([c]);
  expect(waitingOver30Minutes(entries(), now)).toBe(1);
  c.remote!.worker!.updatedAt = "2026-10-19T12:30:00Z";
  expect(waitingOver30Minutes(entries(), now)).toBe(0);
  c.remote!.worker!.updatedAt = "2026-10-19T12:29:00Z";
  c.remote!.worker!.status = "running";
  expect(waitingOver30Minutes(entries(), now)).toBe(0);
  c.remote!.worker!.status = "idle"; c.remote!.online = false;
  expect(waitingOver30Minutes(entries(), now)).toBe(0);
});
it("never claims an unreadable hold is with the first mate", () => {
  const c = card(); c.backlog!.hold = "Choose the release";
  expect(taskPresentation(c)).toMatchObject({ owner: "unknown", reason: "unknown", line: "Decision unavailable: Choose the release" });
});
