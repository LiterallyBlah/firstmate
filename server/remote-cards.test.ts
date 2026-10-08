import { describe, expect, it } from "vitest";

import { CREW_LABELS, type AgentSummary } from "../shared/fleet";
import type { RemoteHost, RemoteSnapshot, RemoteWorker } from "../shared/remotes";
import { parseBacklog } from "./backlog";
import { buildCards } from "./fleet";
import { buildRemoteCards, remoteColumn, remoteReport, remoteTaskQueries, resolveHost, workerReport } from "./remote-cards";

function worker(overrides: Partial<RemoteWorker> = {}): RemoteWorker {
  return { id: "w-light-1", name: "Fix login", status: "idle", updatedAt: "2026-10-08T10:00:00.000Z", permissions: 0, output: "", ...overrides };
}

function host(overrides: Partial<RemoteHost> = {}): RemoteHost {
  return {
    serverId: "srv_light",
    label: "Light",
    online: true,
    checkedAt: "2026-10-08T10:00:00.000Z",
    error: null,
    projects: [],
    workspaces: [],
    providers: [],
    workers: [],
    ...overrides,
  };
}

function snapshot(hosts: RemoteHost[]): RemoteSnapshot {
  return { version: 1, localServerId: "srv_here", syncedAt: "2026-10-08T09:00:00.000Z", syncError: null, hosts };
}

function localAgent(): AgentSummary {
  return {
    id: "local-1",
    workspaceId: "w1",
    title: "Local login",
    provider: "claude",
    model: "sonnet",
    status: "running",
    cwd: "/wt",
    pendingPermissions: 0,
    requiresAttention: false,
    lastError: null,
    updatedAt: "2026-10-08T10:00:00.000Z",
    labels: { [CREW_LABELS.role]: CREW_LABELS.crewRole, [CREW_LABELS.task]: "fix-login" },
  };
}

describe("resolveHost", () => {
  const hosts = snapshot([host(), host({ serverId: "srv_dark", label: "Dark Star" })]);

  it("matches a serverId, a label, or both together, case aside", () => {
    expect(resolveHost("srv_light", hosts)).toMatchObject({ kind: "remote", host: { serverId: "srv_light" } });
    expect(resolveHost("light", hosts)).toMatchObject({ kind: "remote", host: { serverId: "srv_light" } });
    expect(resolveHost("Light srv_light", hosts)).toMatchObject({ kind: "remote", host: { serverId: "srv_light" } });
    expect(resolveHost("Dark Star (srv_dark)", hosts)).toMatchObject({ kind: "remote", host: { serverId: "srv_dark" } });
    expect(resolveHost("the Dark Star box", hosts)).toMatchObject({ kind: "remote", host: { serverId: "srv_dark" } });
  });

  it("names this machine local, and never guesses an unknown or ambiguous host", () => {
    expect(resolveHost("srv_here", hosts)).toEqual({ kind: "local" });
    expect(resolveHost("Atlas srv_here", hosts)).toEqual({ kind: "local" });
    expect(resolveHost("Shadow", hosts)).toEqual({ kind: "unknown" });
    expect(resolveHost("Light", snapshot([host(), host({ serverId: "srv_other" })]))).toEqual({ kind: "unknown" });
    expect(resolveHost("Light", null)).toEqual({ kind: "unknown" });
  });
});

describe("remoteReport", () => {
  it("reads the status line of the worker's closing message", () => {
    expect(remoteReport("[User] go\n\nAll green.\n\ndone: PR https://github.com/o/r/pull/9")).toEqual({
      state: "done",
      text: "PR https://github.com/o/r/pull/9",
    });
    expect(remoteReport(JSON.stringify("[User] go\n\nblocked: needs a token"))).toEqual({ state: "blocked", text: "needs a token" });
  });

  it("never takes a status word from a prompt or reasoning that came after the reply", () => {
    expect(remoteReport("done: PR one\n\n[User] reply with done: when finished")).toBeNull();
    expect(remoteReport("done: PR one\n\n[Thought] failed: maybe")).toBeNull();
    expect(remoteReport("")).toBeNull();
  });
});

describe("workerReport", () => {
  it("prefers the worker's last message alone where the poll keeps one", () => {
    expect(workerReport(worker({ output: "done: from the tail", lastMessage: "All set.\nblocked: needs a key" }))).toEqual({
      state: "blocked",
      text: "needs a key",
    });
    expect(workerReport(worker({ output: "done: from the tail" }))).toEqual({ state: "done", text: "from the tail" });
  });
});

describe("remoteColumn", () => {
  it("files every status the way a local crewmate's is filed", () => {
    expect(remoteColumn(worker({ status: "running" }), { state: "done", text: "" })).toBe("working");
    expect(remoteColumn(worker({ status: "initializing" }), null)).toBe("working");
    expect(remoteColumn(worker({ status: "running", permissions: 1 }), null)).toBe("blocked");
    expect(remoteColumn(worker({ status: "error" }), null)).toBe("failed");
    expect(remoteColumn(worker(), { state: "blocked", text: "" })).toBe("blocked");
    expect(remoteColumn(worker(), { state: "needs-decision", text: "" })).toBe("blocked");
    expect(remoteColumn(worker(), { state: "paused", text: "" })).toBe("parked");
    expect(remoteColumn(worker(), { state: "failed", text: "" })).toBe("failed");
    expect(remoteColumn(worker(), { state: "done", text: "" })).toBe("idle");
    expect(remoteColumn(worker(), { state: "resolved", text: "" })).toBe("idle");
    expect(remoteColumn(worker(), { state: "working", text: "" })).toBe("idle");
    expect(remoteColumn(worker(), null)).toBe("idle");
    expect(remoteColumn(worker({ status: "closed" }), null)).toBe("idle");
    // The detailed list counts even where an older poll's count did not.
    expect(remoteColumn(worker({ pendingPermissions: [{ id: "p1", tool: "Bash" }] }), null)).toBe("blocked");
  });
});

describe("buildRemoteCards", () => {
  it("joins a line to its worker by agent id, a prefix of it, or the task label, in both spellings", () => {
    const backlog = parseBacklog(`## In flight
- [ ] by-id - Found by id (host: srv_light) (agent: w-light-1)
- [ ] by-prefix - Found by prefix (on-host: Light srv_light) (agent: w-light-2-long)
- [ ] by-task - Found by task (on-host: Light)
`);
    const cards = buildRemoteCards(
      backlog,
      snapshot([
        host({
          workers: [
            worker({ status: "running" }),
            worker({ id: "w-light-2-long-uuid", name: "-", permissions: 2 }),
            worker({ id: "w-light-3", name: "Task worker", task: "by-task", output: "paused: waiting on CI" }),
          ],
        }),
      ]),
    );
    const byKey = new Map(cards.map((card) => [card.key, card]));
    expect(cards).toHaveLength(3);
    expect(byKey.get("remote:srv_light:agent:w-light-1")).toMatchObject({
      column: "working",
      title: "Found by id",
      taskId: "by-id",
      agent: null,
      remote: { serverId: "srv_light", host: "Light", online: true, worker: { id: "w-light-1", status: "running" } },
    });
    expect(byKey.get("remote:srv_light:agent:w-light-2-long-uuid")).toMatchObject({
      column: "blocked",
      title: "Found by prefix",
      remote: { worker: { pendingPermissions: 2 } },
    });
    expect(byKey.get("remote:srv_light:agent:w-light-3")).toMatchObject({
      column: "parked",
      title: "Found by task",
      report: { state: "paused", text: "waiting on CI" },
    });
  });

  it("gives a worker with no line its own card, and a line with no worker its section's column", () => {
    const backlog = parseBacklog(`## In flight
- [ ] lost - Nobody found (host: Light)
## Queued
- [ ] later - Not started (host: Light)
## Done
- [x] shipped - Landed https://github.com/o/r/pull/3 (host: Light) (agent: w-light-1) (merged 2026-10-01)
`);
    const cards = buildRemoteCards(
      backlog,
      snapshot([host({ online: false, workers: [worker({ name: "Stray", output: "[User] go\n\nfailed: tests red" })] })]),
    );
    expect(cards.map((card) => [card.key, card.column, card.title])).toEqual([
      ["remote:srv_light:agent:w-light-1", "failed", "Stray"],
      ["remote:srv_light:backlog:in-flight:lost:0", "idle", "Nobody found"],
      ["remote:srv_light:backlog:queued:later:1", "queued", "Not started"],
      ["remote:srv_light:backlog:done:shipped:2", "done", "Landed"],
    ]);
    expect(cards[0]?.remote).toMatchObject({ online: false, worker: { id: "w-light-1" } });
  });

  it("keys by host, so one task id here and on two hosts makes three cards that never join across", () => {
    const backlog = parseBacklog(`## In flight
- [ ] fix-login - Here (project: web)
- [ ] fix-login - On Light (host: srv_light)
- [ ] fix-login - On Dark (host: srv_dark)
`);
    const sameId = worker({ id: "same-id", task: "fix-login", status: "running" });
    const cards = buildCards(
      backlog,
      [{ agent: localAgent(), report: null }],
      snapshot([host({ workers: [sameId] }), host({ serverId: "srv_dark", label: "Dark", workers: [{ ...sameId, status: "error" }] })]),
    );
    expect(cards.map((card) => [card.key, card.title, card.column])).toEqual([
      ["agent:local-1", "Here", "working"],
      ["remote:srv_light:agent:same-id", "On Light", "working"],
      ["remote:srv_dark:agent:same-id", "On Dark", "failed"],
    ]);
    expect(new Set(cards.map((card) => card.key)).size).toBe(cards.length);
  });
});

describe("followed sessions and permission detail", () => {
  it("marks a followed session, joins it only by agent id, and carries what each permission asks", () => {
    const backlog = parseBacklog(`## In flight
- [ ] mine - My own session (host: Light) (agent: own-session)
- [ ] by-task - Not for a followed session (host: Light)
`);
    const cards = buildRemoteCards(
      backlog,
      snapshot([
        host({
          workers: [
            worker({
              id: "own-session",
              name: "Captain's session",
              followed: true,
              task: "by-task",
              pendingPermissions: [{ id: "p1", tool: "Bash", description: "rm -rf build" }],
            }),
            worker({ id: "other", name: "Followed, no line", followed: true, updatedAt: "2026-10-08T09:00:00.000Z" }),
          ],
        }),
      ]),
    );
    expect(cards.map((card) => [card.key, card.title, card.column])).toEqual([
      ["remote:srv_light:agent:own-session", "My own session", "blocked"],
      ["remote:srv_light:agent:other", "Followed, no line", "idle"],
      ["remote:srv_light:backlog:in-flight:by-task:1", "Not for a followed session", "idle"],
    ]);
    expect(cards[0]?.remote?.worker).toEqual({
      id: "own-session",
      name: "Captain's session",
      status: "idle",
      updatedAt: "2026-10-08T10:00:00.000Z",
      pendingPermissions: 1,
      permissionDetails: [{ id: "p1", tool: "Bash", description: "rm -rf build" }],
      followed: true,
    });
    expect(cards[2]?.remote?.worker).toBeNull();
  });
});

describe("remoteTaskQueries", () => {
  it("asks only for unfinished tasks on that host whose worker is not known yet", () => {
    const backlog = parseBacklog(`## In flight
- [ ] known-id - x (host: Light) (agent: w-light-1)
- [ ] known-task - x (host: srv_light)
- [ ] unknown - x (on-host: Light srv_light)
- [ ] elsewhere - x (host: Dark)
- [ ] local - x
## Done
- [x] finished - x (host: Light)
`);
    expect(remoteTaskQueries(backlog, host({ workers: [worker(), worker({ id: "w-2", task: "known-task" })] }), "srv_here")).toEqual([
      "unknown",
    ]);
  });
});
