import { describe, expect, it } from "vitest";

import { CREW_LABELS, type AgentSummary, type BacklogItem, type ColumnId, type CrewReportSummary } from "../shared/fleet";
import { parseBacklog } from "./backlog";
import { waitTarget } from "./crew-report";
import { backlogColumn, backlogPlacement, buildCards, closingText, crewColumn, crewPlacement } from "./fleet";
import type { TimelineItem } from "./host-types";

function agent(overrides: Partial<AgentSummary> = {}): AgentSummary {
  return {
    id: "a1",
    workspaceId: "w1",
    title: "Fix login",
    provider: "claude",
    model: "sonnet",
    status: "idle",
    cwd: "/wt/fix-login",
    pendingPermissions: 0,
    requiresAttention: false,
    lastError: null,
    updatedAt: "2026-09-22T10:00:00.000Z",
    labels: { [CREW_LABELS.role]: CREW_LABELS.crewRole, [CREW_LABELS.task]: "fix-login" },
    ...overrides,
  };
}

/** Every status line a stopped worker can end on, with where it goes and the note its chip says. */
const STOPPED: ReadonlyArray<[CrewReportSummary | null, ColumnId, string | undefined]> = [
  [null, "idle", undefined],
  [{ state: "done", text: "PR https://github.com/o/r/pull/1" }, "ready", undefined],
  [{ state: "resolved", text: "nothing to change" }, "ready", undefined],
  [{ state: "failed", text: "tests red" }, "failed", undefined],
  [{ state: "blocked", text: "no access to the repo" }, "blocked", undefined],
  [{ state: "needs-decision", text: "A or B?" }, "blocked", undefined],
  [{ state: "working", text: "" }, "idle", "stalled"],
  [{ state: "working", text: "implementing the parser" }, "idle", "stalled"],
  [{ state: "working", text: "waiting for the Browser gate" }, "working", "waiting"],
  [{ state: "working", text: "tests running in the background" }, "working", "waiting"],
  [{ state: "working", text: "the watcher wakes me when CI finishes" }, "working", "waiting"],
  [{ state: "working", text: "waiting for the captain's go-ahead" }, "blocked", undefined],
  [{ state: "working", text: "waiting for the first mate to merge" }, "ready", undefined],
  [{ state: "paused", text: "waiting for another worker's gate" }, "working", "waiting"],
  [{ state: "paused", text: "until 14:00, when the quota resets" }, "working", "waiting"],
  [{ state: "paused", text: "on hold" }, "parked", undefined],
  [{ state: "paused", text: "" }, "parked", undefined],
  [{ state: "paused", text: "waiting on the captain's decision" }, "blocked", undefined],
  [{ state: "paused", text: "waiting on the first mate" }, "ready", undefined],
];

describe("crewPlacement", () => {
  it("lets what Paseo knows win while the agent is busy or stuck, whatever the status line", () => {
    for (const [report] of STOPPED) {
      expect(crewPlacement(agent({ pendingPermissions: 1, status: "running" }), report)).toEqual({ column: "blocked" });
      expect(crewPlacement(agent({ pendingPermissions: 1 }), report)).toEqual({ column: "blocked" });
      expect(crewPlacement(agent({ status: "error" }), report)).toEqual({ column: "failed" });
      expect(crewPlacement(agent({ status: "running" }), report)).toEqual({ column: "working" });
      expect(crewPlacement(agent({ status: "initializing" }), report)).toEqual({ column: "working" });
    }
  });

  it("files a stopped crewmate by its status line: Working while it waits on something outside it, Ready once done, Idle when stalled", () => {
    for (const [report, column, note] of STOPPED) {
      const expected = note === undefined ? { column } : { column, note };
      expect([report, crewPlacement(agent(), report)]).toEqual([report, expected]);
      expect([report, crewPlacement(agent({ status: "closed" }), report)]).toEqual([report, expected]);
      expect(crewColumn(agent(), report)).toBe(column);
    }
  });
});

describe("waitTarget", () => {
  it("tells a wait on something outside from one on the captain or the first mate, and from no wait at all", () => {
    expect(waitTarget("waiting for the Browser gate")).toBe("outside");
    expect(waitTarget("pending review on #12")).toBe("outside");
    expect(waitTarget("blocked on the API worker's PR")).toBe("outside");
    expect(waitTarget("awaiting your answer")).toBe("captain");
    expect(waitTarget("awaiting approval to land")).toBe("captain");
    expect(waitTarget("waiting for the first-mate to land it")).toBe("first-mate");
    expect(waitTarget("writing the tests")).toBeNull();
    expect(waitTarget("")).toBeNull();
  });
});

describe("backlogColumn", () => {
  const item = (overrides: Partial<BacklogItem>): BacklogItem => ({
    section: "queued",
    id: "x",
    title: "X",
    project: null,
    kind: null,
    mode: null,
    agentId: null,
    hold: null,
    blockedBy: null,
    since: null,
    url: null,
    reportPath: null,
    outcome: null,
    ...overrides,
  });

  it("puts a captain's hold with the blocked work and everything else where its section says", () => {
    expect(backlogColumn(item({ kind: "captain" }))).toBe("blocked");
    expect(backlogColumn(item({ hold: "which?" }))).toBe("blocked");
    expect(backlogColumn(item({}))).toBe("queued");
    expect(backlogColumn(item({ section: "done" }))).toBe("done");
  });

  it("puts in-flight work with no worker in Working, noted, unless the captain holds it", () => {
    expect(backlogPlacement(item({ section: "in-flight" }))).toEqual({ column: "working", note: "no worker seen" });
    expect(backlogPlacement(item({ section: "in-flight", agentId: "someone-else" }))).toEqual({
      column: "working",
      note: "no worker seen",
    });
    expect(backlogPlacement(item({ section: "in-flight", hold: "merge it?" }))).toEqual({ column: "blocked" });
    expect(backlogPlacement(item({ section: "done", hold: "merge it?" }))).toEqual({ column: "done" });
  });
});

describe("buildCards", () => {
  it("does not join a remote backlog entry to a local agent with the same task id", () => {
    const remote = parseBacklog("## In flight\n- [ ] fix-login - Remote login task (host: srv_remote)");
    expect(buildCards(remote, [{ agent: agent(), report: null }])).toMatchObject([
      { key: "agent:a1", title: "Fix login", backlog: null },
      { key: "remote:?srv_remote:backlog:in-flight:fix-login:0", agent: null, remote: { serverId: null, host: "srv_remote" } },
    ]);
  });

  it("treats a line naming this machine's own serverId as local work", () => {
    const local = parseBacklog("## In flight\n- [ ] fix-login - Fix the login (host: srv_here)");
    const snapshot = { version: 1 as const, localServerId: "srv_here", syncedAt: null, syncError: null, hosts: [] };
    const cards = buildCards(local, [{ agent: agent(), report: null }], snapshot);
    expect(cards).toMatchObject([{ key: "agent:a1", title: "Fix the login" }]);
    expect(cards[0]).not.toHaveProperty("remote");
  });

  const backlog = parseBacklog(`## In flight
- [ ] fix-login - Fix the login (project: web) (kind: ship)
- [ ] by-id - Found by agent id (agent: a2)
- [ ] orphan - Nobody on it
## Queued
- [ ] next - Next thing
## Done
- [x] fix-login - An older task with the same id https://github.com/o/r/pull/1 (merged 2026-09-01)
`);

  it("joins a crewmate to its item by task label or recorded agent id, and keeps the rest", () => {
    const cards = buildCards(backlog, [
      { agent: agent(), report: { state: "done", text: "PR https://github.com/o/r/pull/42" } },
      { agent: agent({ id: "a2", labels: { [CREW_LABELS.role]: CREW_LABELS.crewRole } }), report: null },
      { agent: agent({ id: "a3", title: "Stray", labels: { [CREW_LABELS.role]: CREW_LABELS.crewRole } }), report: null },
    ]);
    const byKey = new Map(cards.map((card) => [card.key, card]));

    expect(byKey.get("agent:a1")).toMatchObject({
      column: "ready",
      title: "Fix the login",
      project: "web",
      url: "https://github.com/o/r/pull/42",
    });
    expect(byKey.get("agent:a2")).toMatchObject({ taskId: "by-id", title: "Found by agent id" });
    expect(byKey.get("agent:a3")).toMatchObject({ taskId: null, title: "Stray", backlog: null });
    expect(cards.filter((card) => card.agent === null).map((card) => [card.taskId, card.column, card.note])).toEqual([
      ["orphan", "working", "no worker seen"],
      ["next", "queued", undefined],
      ["fix-login", "done", undefined],
    ]);
  });

  it("carries the placement's note onto a crewmate's card, and none where its status says enough", () => {
    const cards = buildCards(backlog, [
      { agent: agent(), report: { state: "working", text: "waiting for the Browser gate" } },
      { agent: agent({ id: "a2", labels: { [CREW_LABELS.role]: CREW_LABELS.crewRole } }), report: { state: "working", text: "writing tests" } },
      { agent: agent({ id: "a3", status: "running", labels: { [CREW_LABELS.role]: CREW_LABELS.crewRole } }), report: null },
    ]);
    const byKey = new Map(cards.map((card) => [card.key, card]));
    expect(byKey.get("agent:a1")).toMatchObject({ column: "working", note: "waiting" });
    expect(byKey.get("agent:a2")).toMatchObject({ column: "idle", note: "stalled" });
    expect(byKey.get("agent:a3")).toMatchObject({ column: "working" });
    expect(byKey.get("agent:a3")).not.toHaveProperty("note");
  });
});

describe("closingText", () => {
  it("joins the assistant messages that end the timeline, skipping late notices", () => {
    const items = [
      { type: "user_message", text: "go" },
      { type: "assistant_message", text: "earlier" },
      { type: "tool_call", callId: "c", name: "Bash", detail: { type: "shell", command: "ls" }, status: "completed", error: null },
      { type: "assistant_message", text: "All green.\n\ndo" },
      { type: "assistant_message", text: "ne: PR https://x/1" },
      { type: "notification", level: "info", message: "later" },
    ] as TimelineItem[];
    expect(closingText(items)).toBe("All green.\n\ndone: PR https://x/1");
    expect(closingText([{ type: "user_message", text: "hi" }] as TimelineItem[])).toBeNull();
  });
});
