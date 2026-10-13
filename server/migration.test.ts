import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as configModule from "./config";
import * as daemonSession from "./daemon-session";
import { readFirstmateConfig, resolveHome, updateFirstmateConfig } from "./config";
import {
  adoptMate,
  askMate,
  compactMate,
  launchMate,
  queueMateNote,
  releaseMate,
  restartMate,
  flushMateNotes,
} from "./mate";
import { cancelMigration, handoffExcerpt, migrateMate } from "./migration";
import { deliverToMate } from "./watch-service";
import type { PaseoAgent, PaseoApi, TimelineItem } from "./host-types";

let home: string;
const previousHome = process.env.PASEO_HOME;
beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), "fm-migration-"));
  process.env.PASEO_HOME = home;
  await updateFirstmateConfig({ mateAgentId: "old" });
});
afterEach(async () => {
  vi.restoreAllMocks();
  if (previousHome === undefined) delete process.env.PASEO_HOME;
  else process.env.PASEO_HOME = previousHome;
  await rm(home, { recursive: true, force: true });
});
const target = { provider: "codex/new", modeId: "safe", thinkingOptionId: "high" };
function fake() {
  const agents: Record<string, PaseoAgent> = {
    old: {
      id: "old",
      provider: "claude",
      model: "opus",
      status: "idle",
      pendingPermissions: [],
      archivedAt: null,
      updatedAt: "1",
      labels: {},
      workspaceId: "workspace",
      title: "First mate",
    } as unknown as PaseoAgent,
  };
  const timelines: Record<string, TimelineItem[]> = {
    old: [
      { type: "user_message", text: "Wait for PR checks before merging." } as TimelineItem,
      { type: "assistant_message", text: "Crew abc is still working. {{title}}" } as TimelineItem,
    ],
  };
  const calls: string[] = [];
  const inputs: Array<Record<string, unknown>> = [];
  const sent: Array<{ id: string; text: string; messageId?: string | undefined }> = [];
  const behavior = {
    createError: false,
    createAckLost: false,
    archiveError: false,
    archiveAckLost: false,
    sendError: false,
    sendAckLost: false,
    afterCreate: async () => {},
    afterArchive: async () => {},
  };
  const history = vi.spyOn(daemonSession, "sendSessionRequest").mockImplementation(async (message) => {
    const parentId = (message.filter as { labels: Record<string, string> }).labels["paseo.parent-agent-id"];
    return {
      entries: Object.values(agents)
        .filter((agent) => agent.labels["paseo.parent-agent-id"] === parentId && agent.archivedAt === null)
        .map((agent) => ({ agent })),
      pageInfo: { nextCursor: null, prevCursor: null, hasMore: false },
    };
  });
  const paseo = {
    providers: {
      listAvailable: async () => ({ providers: [{ provider: "codex", available: true }] }),
      listModels: async () => ({
        models: [{ id: "new", label: "New", thinkingOptions: [{ id: "high", label: "High" }] }],
      }),
      listModes: async () => ({ modes: [{ id: "safe", label: "Safe" }] }),
    },
    agents: {
      list: async () => ({
        entries: Object.values(agents)
          .filter((agent) => agent.provider !== "removed-provider")
          .map((agent) => ({ agent })),
        pageInfo: {},
      }),
      ref: (id: string) => ({
        refresh: async () => {
          if (!agents[id]) throw new Error("Agent not found");
          return { agent: agents[id] };
        },
        archive: async () => {
          calls.push(`archive:${id}`);
          if (behavior.archiveError) throw new Error("archive failed");
          agents[id]!.archivedAt = "now";
          await behavior.afterArchive();
          if (behavior.archiveAckLost) {
            behavior.archiveAckLost = false;
            throw new Error("archive response lost");
          }
        },
        timeline: { refetch: async () => ({ entries: (timelines[id] ?? []).map((item) => ({ item })), error: null }) },
        send: async (text: string, options: { messageId?: string }) => {
          expect((await readFirstmateConfig()).mateAgentId).toBe(id);
          calls.push(`send:${id}`);
          if (behavior.sendError) throw new Error("send failed");
          sent.push({ id, text, messageId: options.messageId });
          (timelines[id] ??= []).push({
            type: "user_message",
            text,
            clientMessageId: options.messageId,
          } as TimelineItem);
          if (behavior.sendAckLost) {
            behavior.sendAckLost = false;
            throw new Error("send response lost");
          }
        },
      }),
    },
    workspaces: {
      ref: () => ({ refresh: async () => null }),
      open: async () => ({
        id: "workspace",
        agents: {
          create: async (input: { agentId: string; config: Record<string, string> }) => {
            calls.push("create");
            inputs.push(input);
            if (behavior.createError) throw new Error("creation failed");
            agents[input.agentId] = {
              ...agents.old!,
              id: input.agentId,
              provider: "codex",
              model: "new",
              archivedAt: null,
              labels: { "firstmate.role": "first-mate" },
            };
            await behavior.afterCreate();
            if (behavior.createAckLost) {
              behavior.createAckLost = false;
              throw new Error("creation response lost");
            }
            return { id: input.agentId };
          },
        },
      }),
    },
  } as unknown as PaseoApi;
  return { paseo, agents, calls, inputs, sent, behavior, timelines, history };
}

function child(state: ReturnType<typeof fake>, id: string, parent: string, workspaceId = "workspace") {
  state.agents[id] = {
    ...state.agents.old!,
    id,
    workspaceId,
    labels: { "paseo.parent-agent-id": parent, "firstmate.role": "crew" },
  };
}

async function archiveFixture(operation: "migration" | "cancellation") {
  const state = fake();
  let rootId = "old";
  if (operation === "cancellation") {
    state.behavior.archiveError = true;
    await expect(migrateMate(state.paseo, { sourceId: "old", target })).rejects.toThrow();
    rootId = (await readFirstmateConfig()).migration!.agentId;
    state.behavior.archiveError = false;
  }
  const perform = () =>
    operation === "migration"
      ? migrateMate(state.paseo, { sourceId: "old", target })
      : cancelMigration(state.paseo, "old");
  return { state, rootId, perform };
}

describe.each(["migration", "cancellation"] as const)("complete archive inventory for %s", (operation) => {
  it("sees a hidden intermediate child on a later history page and preserves its running descendant", async () => {
    const { state, rootId, perform } = await archiveFixture(operation);
    child(state, "separate-workspace-child", rootId, "other-workspace");
    child(state, "hidden-parent", rootId);
    state.agents["hidden-parent"]!.provider = "removed-provider";
    child(state, "running-grandchild", "hidden-parent");
    state.agents["running-grandchild"]!.status = "running";
    // Faithful to Paseo: visible inventory omits the intermediate; archive still recurses through it.
    const visible = await state.paseo.agents.list();
    expect(visible.entries.some(({ agent }) => agent.id === "hidden-parent")).toBe(false);
    expect(visible.entries.some(({ agent }) => agent.id === "running-grandchild")).toBe(true);
    state.behavior.afterArchive = async () => {
      for (const id of ["hidden-parent", "running-grandchild"]) {
        state.agents[id]!.archivedAt = "now";
        state.agents[id]!.status = "closed";
      }
    };
    state.history.mockClear().mockImplementation(async (message) => {
      const cursor = (message.page as { cursor?: string }).cursor;
      return {
        entries: [{ agent: state.agents[cursor === undefined ? "separate-workspace-child" : "hidden-parent"] }],
        pageInfo: {
          prevCursor: cursor ?? null,
          hasMore: cursor === undefined,
          nextCursor: cursor === undefined ? "next" : null,
        },
      };
    });
    const saved = await readFirstmateConfig();
    const calls = [...state.calls];
    await expect(perform()).rejects.toThrow("archive child sessions");
    expect(state.history).toHaveBeenCalledTimes(2);
    expect(state.history.mock.calls.map(([message]) => message)).toEqual([
      {
        type: "fetch_agent_history_request",
        filter: { labels: { "paseo.parent-agent-id": rootId }, includeArchived: false },
        sort: [{ key: "created_at", direction: "asc" }],
        page: { limit: 200 },
      },
      {
        type: "fetch_agent_history_request",
        filter: { labels: { "paseo.parent-agent-id": rootId }, includeArchived: false },
        sort: [{ key: "created_at", direction: "asc" }],
        page: { limit: 200, cursor: "next" },
      },
    ]);
    expect(state.calls).toEqual(calls);
    expect(state.sent).toEqual([]);
    expect(Object.values(state.agents).every((agent) => agent.archivedAt === null)).toBe(true);
    expect(state.agents["running-grandchild"]!.status).toBe("running");
    expect(await readFirstmateConfig()).toEqual(saved);
  });

  it.each([
    "request failure",
    "malformed entries",
    "missing page metadata",
    "missing continuation",
    "uncertain final page",
    "empty continuation",
    "repeated cursor",
    "repeated session",
    "wrong page",
    "response error",
  ])("refuses archival on %s instead of falling back to a visible listing", async (failure) => {
    const { state, rootId, perform } = await archiveFixture(operation);
    child(state, "safe-child", rootId, "other-workspace");
    state.history.mockClear().mockImplementation(async (message) => {
      const cursor = (message.page as { cursor?: string }).cursor;
      const agent = { ...state.agents["safe-child"]!, id: cursor === undefined ? "page-one" : "page-two" };
      const response: Record<string, unknown> = {
        entries: [{ agent }],
        pageInfo: { prevCursor: cursor ?? null, hasMore: false, nextCursor: null },
      };
      switch (failure) {
        case "request failure":
          throw new Error("History timed out");
        case "malformed entries":
          response.entries = [{ agent: { id: "unknown" } }];
          break;
        case "missing page metadata":
          delete response.pageInfo;
          break;
        case "missing continuation":
          response.pageInfo = { prevCursor: null, hasMore: true, nextCursor: null };
          break;
        case "uncertain final page":
          response.pageInfo = { prevCursor: null, hasMore: false, nextCursor: "unexpected" };
          break;
        case "empty continuation":
          response.entries = [];
          response.pageInfo = { prevCursor: null, hasMore: true, nextCursor: "next" };
          break;
        case "repeated cursor":
          response.pageInfo = { prevCursor: cursor ?? null, hasMore: true, nextCursor: "next" };
          break;
        case "repeated session":
          agent.id = "same";
          response.pageInfo = {
            prevCursor: cursor ?? null,
            hasMore: cursor === undefined,
            nextCursor: cursor === undefined ? "next" : null,
          };
          break;
        case "wrong page":
          response.pageInfo = { prevCursor: "other", hasMore: false, nextCursor: null };
          break;
        case "response error":
          response.error = "History unavailable";
          break;
      }
      return response;
    });
    const saved = await readFirstmateConfig();
    const calls = [...state.calls];
    await expect(perform()).rejects.toThrow("Cannot verify the complete archive inventory");
    expect(state.calls).toEqual(calls);
    expect(Object.values(state.agents).every((agent) => agent.archivedAt === null)).toBe(true);
    expect(await readFirstmateConfig()).toEqual(saved);
  });
});

describe("provider migration", () => {
  it("prepares without a prompt, retires the old mate, then sends the bounded handoff and preserves records", async () => {
    const state = fake();
    const result = await migrateMate(state.paseo, { sourceId: "old", target });
    expect(state.calls).toEqual(["create", "archive:old", `send:${result.agentId}`]);
    expect(state.inputs[0]).not.toHaveProperty("prompt");
    expect(state.inputs[0]).not.toHaveProperty("parent");
    expect(state.agents[result.agentId]!.labels["paseo.parent-agent-id"]).toBeUndefined();
    expect(state.agents[result.agentId]!.archivedAt).toBeNull();
    expect(state.inputs[0]).toMatchObject({ agentId: result.agentId, idempotencyKey: result.agentId, config: target });
    expect(state.sent[0]?.text).toContain("Wait for PR checks before merging.");
    expect(state.sent[0]?.text).toContain("{{title}}");
    expect(state.sent[0]?.text).toContain("No native conversation state");
    expect(state.sent[0]?.text.length).toBeLessThan(40000);
    const config = await readFirstmateConfig();
    expect(config).toMatchObject({ mateAgentId: result.agentId, migration: null, previousMateIds: ["old"] });
    await expect(readFile(join(resolveHome(config), "data", "captain.md"), "utf8")).resolves.toBeTruthy();
    await expect(readFile(join(resolveHome(config), `data/handoffs/${result.agentId}.md`), "utf8")).resolves.toContain(
      "heartbeat",
    );
  });

  it("refuses same-workspace descendants without retiring the mate or any children", async () => {
    const state = fake();
    child(state, "child", "old");
    child(state, "grandchild", "child");
    child(state, "separate", "old", "other-workspace");
    await expect(migrateMate(state.paseo, { sourceId: "old", target })).rejects.toThrow("archive child sessions");
    expect(state.calls).toEqual([]);
    expect(Object.values(state.agents).every((agent) => agent.archivedAt === null)).toBe(true);
    expect(await readFirstmateConfig()).toMatchObject({ mateAgentId: "old", migration: null });
  });

  it("refuses a child added during preparation and preserves separate-workspace crew on recovery", async () => {
    const state = fake();
    child(state, "separate", "old", "other-workspace");
    state.behavior.afterCreate = async () => {
      child(state, "late-child", "old");
    };
    await expect(migrateMate(state.paseo, { sourceId: "old", target })).rejects.toThrow("archive child sessions");
    expect(Object.values(state.agents).every((agent) => agent.archivedAt === null)).toBe(true);
    state.agents["late-child"]!.labels = {};
    const result = await migrateMate(state.paseo, { sourceId: "old" });
    expect(state.agents.separate!.archivedAt).toBeNull();
    expect(state.agents[result.agentId]!.archivedAt).toBeNull();
    expect(state.inputs).toHaveLength(1);
  });

  it("refuses a replacement linked into the source's archive cascade", async () => {
    const state = fake();
    state.behavior.afterCreate = async () => {
      const replacement = Object.values(state.agents).find((agent) => agent.id !== "old")!;
      replacement.labels["paseo.parent-agent-id"] = "old";
    };
    await expect(migrateMate(state.paseo, { sourceId: "old", target })).rejects.toThrow("replacement has a parent");
    expect(state.calls).toEqual(["create"]);
    expect(Object.values(state.agents).every((agent) => agent.archivedAt === null)).toBe(true);
  });

  it("refuses cancellation that would archive a prepared replacement's children", async () => {
    const state = fake();
    state.behavior.archiveError = true;
    await expect(migrateMate(state.paseo, { sourceId: "old", target })).rejects.toThrow();
    const replacementId = (await readFirstmateConfig()).migration!.agentId;
    child(state, "external-child", replacementId);
    state.behavior.archiveError = false;
    const previousCalls = [...state.calls];
    await expect(cancelMigration(state.paseo, "old")).rejects.toThrow("archive child sessions");
    expect(state.calls).toEqual(previousCalls);
    expect(Object.values(state.agents).every((agent) => agent.archivedAt === null)).toBe(true);
  });

  it("checks replacement survival after retirement before assigning the role or sending", async () => {
    const state = fake();
    state.behavior.afterArchive = async () => {
      Object.values(state.agents).forEach((agent) => {
        agent.archivedAt = "now";
      });
    };
    await expect(migrateMate(state.paseo, { sourceId: "old", target })).rejects.toThrow("archived during retirement");
    expect(state.sent).toEqual([]);
    expect(await readFirstmateConfig()).toMatchObject({ mateAgentId: "old", migration: expect.any(Object) });
    await expect(migrateMate(state.paseo, { sourceId: "old" })).rejects.toThrow("cannot be recreated");
    expect(state.inputs).toHaveLength(1);
  });

  it.each(["provider", "modeId", "thinkingOptionId"])(
    "rejects an invalid %s without changing either session",
    async (field) => {
      const state = fake();
      await expect(
        migrateMate(state.paseo, { sourceId: "old", target: { ...target, [field]: "invalid" } }),
      ).rejects.toThrow(/not available|not offered/);
      expect(state.calls).toEqual([]);
      expect((await readFirstmateConfig()).migration).toBeNull();
    },
  );

  it.each(["running", "initializing", "permission"])("refuses %s before creation", async (status) => {
    const state = fake();
    if (status === "permission") state.agents.old!.pendingPermissions = [{}] as PaseoAgent["pendingPermissions"];
    else state.agents.old!.status = status as PaseoAgent["status"];
    await expect(migrateMate(state.paseo, { sourceId: "old", target })).rejects.toThrow("idle");
    expect(state.calls).toEqual([]);
  });

  it("retains the current mate after failed creation and recovers with the recorded identity", async () => {
    const state = fake();
    state.behavior.createError = true;
    await expect(migrateMate(state.paseo, { sourceId: "old", target })).rejects.toThrow("saved migration");
    const config = await readFirstmateConfig();
    expect(config.mateAgentId).toBe("old");
    expect(state.agents.old!.archivedAt).toBeNull();
    state.behavior.createError = false;
    await expect(migrateMate(state.paseo, { sourceId: "old" })).resolves.toMatchObject({
      agentId: config.migration!.agentId,
    });
    expect(state.inputs[0]?.agentId).toBe(state.inputs[1]?.agentId);
  });

  it("can cancel before retirement, but never resurrects a retired source", async () => {
    const state = fake();
    state.behavior.archiveError = true;
    await expect(migrateMate(state.paseo, { sourceId: "old", target })).rejects.toThrow();
    const prepared = (await readFirstmateConfig()).migration!.agentId;
    state.behavior.archiveError = false;
    await cancelMigration(state.paseo, "old");
    expect(state.agents[prepared]!.archivedAt).not.toBeNull();
    expect(state.agents.old!.archivedAt).toBeNull();
    expect(await readFirstmateConfig()).toMatchObject({ mateAgentId: "old", migration: null });
    state.behavior.sendError = true;
    await expect(migrateMate(state.paseo, { sourceId: "old", target })).rejects.toThrow();
    await expect(cancelMigration(state.paseo, "old")).rejects.toThrow("already retired");
  });

  it.each(["createAckLost", "archiveError", "archiveAckLost", "sendError", "sendAckLost"] as const)(
    "recovers %s without duplicate creation or handoff",
    async (failure) => {
      const state = fake();
      state.behavior[failure] = true;
      await expect(migrateMate(state.paseo, { sourceId: "old", target })).rejects.toThrow("Handover paused");
      expect((await readFirstmateConfig()).migration).not.toBeNull();
      if (failure.startsWith("archive")) expect(state.sent).toHaveLength(0);
      state.behavior[failure] = false;
      await migrateMate(state.paseo, { sourceId: "old" });
      expect(state.inputs).toHaveLength(1);
      expect(state.sent).toHaveLength(1);
      expect((await readFirstmateConfig()).migration).toBeNull();
    },
  );

  it("keeps recovery after a config write fails following retirement", async () => {
    const state = fake();
    const original = configModule.updateFirstmateConfig;
    let failed = false;
    vi.spyOn(configModule, "updateFirstmateConfig").mockImplementation(async (patch) => {
      if (patch.mateAgentId && !failed) {
        failed = true;
        throw new Error("disk full");
      }
      return original(patch);
    });
    await expect(migrateMate(state.paseo, { sourceId: "old", target })).rejects.toThrow("disk full");
    expect(state.sent).toHaveLength(0);
    await migrateMate(state.paseo, { sourceId: "old" });
    expect(state.inputs).toHaveLength(1);
    expect(state.sent).toHaveLength(1);
  });

  it("rechecks a source that became busy and captures new context when recovery resumes", async () => {
    const state = fake();
    state.behavior.afterCreate = async () => {
      state.agents.old!.status = "running";
    };
    await expect(migrateMate(state.paseo, { sourceId: "old", target })).rejects.toThrow("became busy");
    expect(state.agents.old!.archivedAt).toBeNull();
    state.agents.old!.status = "idle";
    state.agents.old!.updatedAt = "2";
    state.timelines.old!.push({ type: "user_message", text: "New decision after the paused handover" } as TimelineItem);
    await migrateMate(state.paseo, { sourceId: "old" });
    expect(state.sent[0]?.text).toContain("New decision");
  });

  it("serializes duplicate migrations and routes overlapping captain, watch and crew messages to the new mate", async () => {
    const state = fake();
    let resume: () => void = () => {};
    let created: () => void = () => {};
    const creating = new Promise<void>((resolve) => {
      created = resolve;
    });
    state.behavior.afterCreate = async () => {
      created();
      await new Promise<void>((resolve) => {
        resume = resolve;
      });
    };
    const first = migrateMate(state.paseo, { sourceId: "old", target });
    await creating;
    const duplicate = migrateMate(state.paseo, { sourceId: "old", target }).catch((error: unknown) => error);
    const captain = askMate(state.paseo, { text: "Captain message" });
    const watch = deliverToMate(state.paseo, await readFirstmateConfig(), "Watch result", readFirstmateConfig);
    const crew = queueMateNote(state.paseo, "Crew result");
    resume();
    const result = await first;
    expect(String(await duplicate)).toContain("changed");
    await Promise.all([captain, watch, crew]);
    expect(state.inputs).toHaveLength(1);
    expect(state.sent.every((entry) => entry.id === result.agentId)).toBe(true);
    expect(state.sent.map((entry) => entry.text)).toEqual(
      expect.arrayContaining(["Captain message", "Watch result", "Crew result"]),
    );
  });

  it("keeps crew notes and watches pending across a failed handover and blocks other lifecycle changes", async () => {
    const state = fake();
    state.behavior.createError = true;
    await expect(migrateMate(state.paseo, { sourceId: "old", target })).rejects.toThrow();
    await queueMateNote(state.paseo, "Remote and local crew continue");
    expect(await deliverToMate(state.paseo, await readFirstmateConfig(), "Watch result", readFirstmateConfig)).toBe(
      "wait",
    );
    for (const action of [
      () => releaseMate(),
      () => restartMate(state.paseo),
      () => compactMate(state.paseo),
      () => launchMate(state.paseo, { provider: target.provider, modeId: "" }),
      () => adoptMate(state.paseo, "old"),
    ]) {
      await expect(action()).rejects.toThrow("recovery");
    }
    expect((await readFirstmateConfig()).mateNotes).toHaveLength(1);
    state.behavior.createError = false;
    await migrateMate(state.paseo, { sourceId: "old" });
    await flushMateNotes(state.paseo);
    expect(state.sent.at(-1)?.text).toBe("Remote and local crew continue");
    expect((await readFirstmateConfig()).mateNotes).toEqual([]);
  });
});

it("bounds projected context including oversized tools, quotes historical text and excludes private reasoning", () => {
  const excerpt = handoffExcerpt([
    { type: "reasoning", text: "Private thought" } as TimelineItem,
    { type: "user_message", text: "a".repeat(50000) } as TimelineItem,
    { type: "assistant_message", text: "Latest decision" } as TimelineItem,
  ]);
  expect(excerpt.length).toBeLessThanOrEqual(20000);
  expect(excerpt).toContain("Latest decision");
  expect(excerpt).not.toContain("Private thought");
  excerpt.split("\n").forEach((line) => expect(() => JSON.parse(line)).not.toThrow());
});

/** The review's deterministic offline reproduction, using an explicitly selected installed daemon. */
it.runIf(process.env.FM_TEST_SERVER_DIR !== undefined).each(["migration", "cancellation"] as const)(
  "offline Paseo methods: %s refuses the hidden-child cascade",
  async (operation) => {
    const daemonRoot = process.env.FM_TEST_SERVER_DIR!;
    const { Session } = await import(/* @vite-ignore */ pathToFileURL(join(daemonRoot, "session.js")).href);
    const { AgentManager } = await import(
      /* @vite-ignore */ pathToFileURL(join(daemonRoot, "agent/agent-manager.js")).href
    );
    const { state, rootId, perform } = await archiveFixture(operation);
    child(state, "hidden-parent", rootId);
    state.agents["hidden-parent"]!.provider = "removed-provider";
    child(state, "live-grandchild", "hidden-parent");
    state.agents["live-grandchild"]!.status = "running";
    const registry = { list: async () => Object.values(state.agents), get: async (id: string) => state.agents[id] };
    const runtime = { has: (id: string) => id !== "hidden-parent" && !!state.agents[id] };
    const view = {
      agentManager: { listAgents: () => Object.values(state.agents).filter((agent) => runtime.has(agent.id)) },
      buildAgentPayload: async (agent: PaseoAgent) => agent,
      agentStorage: registry,
      providerSnapshotManager: { listRegisteredProviderIds: () => ["claude", "codex"] },
      buildStoredAgentPayload: (record: PaseoAgent) => record,
      isProviderVisibleToClient: () => true,
    };
    state.paseo.agents.list = (async (options) => ({
      entries: (await Session.prototype.listAgentPayloads.call(view, options?.filter)).map((agent: PaseoAgent) => ({
        agent,
      })),
      pageInfo: {},
    })) as PaseoApi["agents"]["list"];
    const visible = await state.paseo.agents.list();
    expect(visible.entries.some(({ agent }) => agent.id === "hidden-parent")).toBe(false);
    state.history.mockImplementation(async (message) => ({
      entries: (
        await Session.prototype.listAgentPayloads.call(view, {
          ...(message.filter as Record<string, unknown>),
          includeUnavailablePersisted: true,
        })
      ).map((agent: PaseoAgent) => ({ agent })),
      pageInfo: { nextCursor: null, prevCursor: null, hasMore: false },
    }));
    const archived: string[] = [];
    const manager = {
      registry,
      agents: runtime,
      clients: new Map(),
      requireRegistry: () => registry,
      runLifecycleMutation: (_id: string, action: () => Promise<unknown>) => action(),
      archiveAgentUnlocked: async (id: string) => {
        archived.push(id);
        state.agents[id]!.archivedAt = "now";
        await manager.cascadeArchiveChildren.call(manager, id);
      },
      persistArchivedRecord: async (record: PaseoAgent) => {
        archived.push(record.id);
        record.archivedAt = "now";
        return record;
      },
      syncNativeArchiveState: AgentManager.prototype.syncNativeArchiveState,
      discardRetainedAgentState: () => {},
      dispatchStoredAgentState: () => {},
      fireAgentArchived: async () => {},
      cascadeArchiveChildren: AgentManager.prototype.cascadeArchiveChildren,
      archiveSnapshotUnlocked: AgentManager.prototype.archiveSnapshotUnlocked,
    };
    state.behavior.afterArchive = () => manager.cascadeArchiveChildren.call(manager, rootId);
    const saved = await readFirstmateConfig();
    await expect(perform()).rejects.toThrow("archive child sessions");
    expect(archived).toEqual([]);
    expect(Object.values(state.agents).every((agent) => agent.archivedAt === null)).toBe(true);
    expect(state.agents["live-grandchild"]!.status).toBe("running");
    expect(await readFirstmateConfig()).toEqual(saved);
  },
);
