import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { CREW_LABELS } from "../shared/fleet";
import { readFirstmateConfig, resolveHome, updateFirstmateConfig } from "./config";
import type { PaseoApi } from "./host-types";
import { adoptMate, askMate, commandText, compactMate, launchMate, releaseMate, restartMate, restartNote } from "./mate";
import { TEMPLATES, readTemplate, withoutNotes } from "./templates";

let paseoHome = "";
const previousHome = process.env.PASEO_HOME;

beforeEach(async () => {
  paseoHome = await mkdtemp(join(tmpdir(), "firstmate-mate-"));
  process.env.PASEO_HOME = paseoHome;
});

afterEach(async () => {
  if (previousHome === undefined) delete process.env.PASEO_HOME;
  else process.env.PASEO_HOME = previousHome;
  await rm(paseoHome, { recursive: true, force: true });
});

interface Snapshot {
  id: string;
  provider: string;
  model: string | null;
  status: string;
  currentModeId: string | null;
  thinkingOptionId?: string | null;
  archivedAt: string | null;
  labels?: Record<string, string>;
  workspaceId?: string;
  cwd?: string;
  pendingPermissions?: unknown[];
}

/** Just enough of Paseo for the first mate's lifecycle, recording what was asked of it in order. */
function fakePaseo(agents: Record<string, Snapshot>) {
  const calls: string[] = [];
  const sent: Array<{ agentId: string; text: string; options?: Record<string, unknown> | undefined }> = [];
  const created: Array<{ agentId: string; idempotencyKey: string; config: Record<string, unknown>; title?: string; labels?: Record<string, string>; prompt?: string }> = [];
  const paseo = {
    agents: {
      ref(id: string) {
        return {
          async refresh() {
            const agent = agents[id];
            if (agent === undefined) throw new Error(`Agent not found: ${id}`);
            return { agent };
          },
          async archive() {
            calls.push(`archive ${id}`);
            const agent = agents[id];
            if (agent !== undefined) agent.archivedAt = "2026-09-23T12:00:00.000Z";
          },
          async send(text: string, options?: Record<string, unknown>) {
            if (text !== "/compact" && options?.messageId === `firstmate-opening-${id}`) {
              expect(await readFirstmateConfig()).toMatchObject({ mateAgentId: id, mateLaunch: { agentId: id, state: "sending" } });
            }
            calls.push(`send ${id} ${text}`);
            sent.push({ agentId: id, text, options });
          },
        };
      },
    },
    workspaces: {
      // Naming the home's workspace is `home-name.test.ts`'s business; here it finds nothing to name.
      ref() {
        return { refresh: async () => null };
      },
      async open(cwd: string) {
        calls.push(`open ${cwd}`);
        return {
          id: "wks_home",
          agents: {
            async create(input: (typeof created)[number]) {
              calls.push("create");
              created.push(input);
              expect(input.prompt).toBeUndefined();
              expect(await readFirstmateConfig()).toMatchObject({ mateAgentId: "", mateLaunch: { agentId: input.agentId, state: "prepared" } });
              agents[input.agentId] = { ...oldMate, id: input.agentId, status: "idle", workspaceId: "wks_home", cwd, pendingPermissions: [] };
              return { id: input.agentId };
            },
          },
        };
      },
    },
  } as unknown as PaseoApi;
  return { paseo, calls, created, sent };
}

const oldMate: Snapshot = {
  id: "old-mate",
  provider: "claude",
  model: "claude-opus-5-5",
  status: "running",
  currentModeId: "bypassPermissions",
  thinkingOptionId: "high",
  archivedAt: null,
};

it.each(["watch-inspector", "topic-adviser"])("refuses to adopt %s as a supervisor", async role => {
  const { paseo, calls } = fakePaseo({ inspector: { ...oldMate, id: "inspector", labels: { "firstmate.role": role } } });
  await expect(adoptMate(paseo, "inspector")).rejects.toThrow("cannot take the first-mate role");
  expect(calls).toEqual([]); expect((await readFirstmateConfig()).mateAgentId).toBe("");
});

describe("restartMate", () => {
  it("archives the old first mate before starting one set up the same way", async () => {
    await updateFirstmateConfig({ mateAgentId: "old-mate", mateProvider: "claude/claude-sonnet-5", mateModeId: "" });
    const { paseo, calls, created, sent } = fakePaseo({ "old-mate": { ...oldMate, status: "idle" } });

    const result = await restartMate(paseo);
    expect(result).toEqual({ agentId: created[0]!.agentId, workspaceId: "wks_home" });

    expect(calls[0]).toBe("archive old-mate");
    expect(calls.at(-1)).toMatch(/^send /);
    // The live agent's setup wins over the config's: it may have been changed in its own tab.
    expect(created[0]).toMatchObject({
      config: { provider: "claude/claude-opus-5-5", modeId: "bypassPermissions", thinkingOptionId: "high" },
      labels: { [CREW_LABELS.role]: CREW_LABELS.mateRole },
    });
    expect(sent[0]!.text).toBe(`${withoutNotes(await readTemplate(TEMPLATES.opening))}\n\n${await restartNote()}`);
    expect(await readFirstmateConfig()).toMatchObject({
      mateAgentId: result.agentId,
      mateLaunch: null,
      mateProvider: "claude/claude-opus-5-5",
      mateModeId: "bypassPermissions",
    });
  });

  it("refuses a first mate in the middle of a turn, and touches nothing", async () => {
    await updateFirstmateConfig({ mateAgentId: "old-mate" });
    const { paseo, calls } = fakePaseo({ "old-mate": { ...oldMate, status: "running" } });
    await expect(restartMate(paseo)).rejects.toThrow("in the middle of a turn");
    expect(calls).toEqual([]);
    expect((await readFirstmateConfig()).mateAgentId).toBe("old-mate");
  });

  it("says so when there is no first mate to restart", async () => {
    const { paseo, calls } = fakePaseo({});
    await expect(restartMate(paseo)).rejects.toThrow("There is no first mate yet");
    expect(calls).toEqual([]);
  });
});

describe("changing the first mate", () => {
  const other: Snapshot = { ...oldMate, id: "other", status: "idle" };

  it("refuses an adoption that lands while a launch is starting a first mate", async () => {
    const { paseo, created } = fakePaseo({ other: { ...other } });
    const results = await Promise.allSettled([
      launchMate(paseo, { provider: "claude/claude-sonnet-5", modeId: "" }),
      adoptMate(paseo, "other"),
    ]);
    expect(results.map((result) => result.status)).toEqual(["fulfilled", "rejected"]);
    expect(String((results[1] as PromiseRejectedResult).reason)).toMatch(/already aboard/);
    expect(created).toHaveLength(1);
    expect((await readFirstmateConfig()).mateAgentId).toBe(created[0]!.agentId);
  });

  it("applies a release that lands during a restart after it, not before", async () => {
    await updateFirstmateConfig({ mateAgentId: "old-mate" });
    const { paseo } = fakePaseo({ "old-mate": { ...oldMate, status: "idle" } });
    await Promise.all([restartMate(paseo), releaseMate()]);
    expect((await readFirstmateConfig()).mateAgentId).toBe("");
  });

  it("adopts an agent when the configured first mate is gone", async () => {
    await updateFirstmateConfig({ mateAgentId: "old-mate" });
    const { paseo } = fakePaseo({ other: { ...other } });
    await expect(adoptMate(paseo, "other")).resolves.toMatchObject({ mateAgentId: "other" });
  });

  it("a scoped supervisor remains a guest and cannot be adopted as the global mate", async () => {
    const { paseo, sent } = fakePaseo({ supervisor: { ...other, id: "supervisor", labels: { "firstmate.role": "plan-supervisor" } } });
    await expect(adoptMate(paseo, "supervisor")).rejects.toThrow(/scoped supervisors/);
    expect((await readFirstmateConfig()).mateAgentId).toBe(""); expect(sent).toEqual([]);
  });
});

describe("reserved launch recovery", () => {
  it("retries a lost creation reply with the same durable ID and never prompts before identity", async () => {
    const state = fakePaseo({});
    const open = state.paseo.workspaces.open.bind(state.paseo.workspaces);
    let first = true;
    state.paseo.workspaces.open = async (...args) => {
      const workspace = await open(...args); const create = workspace.agents.create;
      workspace.agents.create = async input => {
        const agent = await create(input);
        if (first) { first = false; throw new Error("creation reply lost"); }
        return agent;
      };
      return workspace;
    };
    await expect(launchMate(state.paseo, { provider: "claude", modeId: "plan" })).rejects.toThrow("creation reply lost");
    const reserved = (await readFirstmateConfig()).mateLaunch!;
    expect(state.sent).toEqual([]);
    const result = await launchMate(state.paseo, { provider: "different", modeId: "" });
    expect(result.agentId).toBe(reserved.agentId);
    expect(state.created.map(input => input.idempotencyKey)).toEqual([reserved.agentId, reserved.agentId]);
    expect(state.created[1]!.config.provider).toBe("claude");
    expect(state.sent).toHaveLength(1);
  });

  it("keeps an uncertain opening after a lost send reply and refuses automatic replay", async () => {
    const state = fakePaseo({}); const ref = state.paseo.agents.ref.bind(state.paseo.agents);
    state.paseo.agents.ref = id => {
      const handle = ref(id); const send = handle.send;
      handle.send = async (...args) => { await send(...args); throw new Error("send reply lost"); };
      return handle;
    };
    await expect(launchMate(state.paseo, { provider: "claude", modeId: "" })).rejects.toThrow("send reply lost");
    const pending = await readFirstmateConfig();
    expect(pending.mateLaunch).toMatchObject({ agentId: pending.mateAgentId, state: "sending" });
    await expect(launchMate(state.paseo, { provider: "claude", modeId: "" })).rejects.toThrow("Opening delivery is uncertain");
    await expect(askMate(state.paseo, { text: "another prompt" })).rejects.toThrow("launch needs recovery");
    expect(state.sent).toHaveLength(1);
    await releaseMate(); expect(await readFirstmateConfig()).toMatchObject({ mateAgentId: "", mateLaunch: null });
  });

  it("refuses an unexpected creation identity before granting authority or sending", async () => {
    const state = fakePaseo({}); const open = state.paseo.workspaces.open.bind(state.paseo.workspaces);
    state.paseo.workspaces.open = async (...args) => {
      const workspace = await open(...args); const create = workspace.agents.create;
      workspace.agents.create = async input => ({ ...await create(input), id: "unexpected" });
      return workspace;
    };
    await expect(launchMate(state.paseo, { provider: "claude", modeId: "" })).rejects.toThrow("different identity");
    expect(state.sent).toEqual([]); expect((await readFirstmateConfig()).mateAgentId).toBe("");
  });
});

/** Writes the captain's own `data/opening.md` into the home the next launch uses. */
async function writeOpening(markdown: string): Promise<void> {
  const data = join(resolveHome(await readFirstmateConfig()), "data");
  await mkdir(data, { recursive: true });
  await writeFile(join(data, "opening.md"), markdown, "utf8");
}

describe("the opening", () => {
  it("launches with the captain's opening, leaving out its notes", async () => {
    await writeOpening("<!-- A note to myself. -->\n\nAhoy, first mate. Read AGENTS.md and take the helm.\n");
    const { paseo, sent } = fakePaseo({});
    await launchMate(paseo, { provider: "claude/claude-sonnet-5", modeId: "" });
    expect(sent[0]?.text).toBe("Ahoy, first mate. Read AGENTS.md and take the helm.");
  });

  it("restarts with the captain's opening and then the note about the first mate before", async () => {
    await writeOpening("Olá, imediato. Leia o AGENTS.md e assuma o leme.");
    await updateFirstmateConfig({ mateAgentId: "old-mate" });
    const { paseo, sent } = fakePaseo({ "old-mate": { ...oldMate, status: "idle" } });
    await restartMate(paseo);
    expect(sent[0]?.text).toBe(`Olá, imediato. Leia o AGENTS.md e assuma o leme.\n\n${await restartNote()}`);
  });
});

describe("commandText", () => {
  it("words Bearings and Ahoy as plain requests, with what followed the command", async () => {
    expect(await commandText("bearings", "")).toBe("Bearings, please.");
    expect(await commandText("bearings", " file include PRs ")).toBe("Bearings, please — file include PRs.");
    expect(await commandText("ahoy", "  ")).toBe("Ahoy!");
    expect(await commandText("ahoy", "and the deploy?")).toBe("Ahoy! and the deploy?");
  });
});

describe("compactMate", () => {
  it("sends /compact to an idle first mate and refuses one mid-turn", async () => {
    await updateFirstmateConfig({ mateAgentId: "old-mate" });
    const idle = fakePaseo({ "old-mate": { ...oldMate, status: "idle" } });
    await expect(compactMate(idle.paseo)).resolves.toBe("old-mate");
    expect(idle.calls).toEqual(["send old-mate /compact"]);

    const busy = fakePaseo({ "old-mate": { ...oldMate, status: "running" } });
    await expect(compactMate(busy.paseo)).rejects.toThrow("in the middle of a turn");
    expect(busy.calls).toEqual([]);
  });
});

describe("askMate", () => {
  it("checks mate existence and migration before starting a guarded delivery", async () => {
    const { paseo, sent } = fakePaseo({ "old-mate": { ...oldMate, status: "idle" } });
    let prepared = 0;
    const beforeSend = async () => { prepared++; };
    await expect(askMate(paseo, { text: "install identified revision" }, beforeSend)).rejects.toThrow("no first mate");
    expect(prepared).toBe(0);
    await updateFirstmateConfig({ mateAgentId: "old-mate", migration: {
      sourceId: "old-mate", sourceRevision: "revision", agentId: "replacement",
      target: { provider: "codex", modeId: "", thinkingOptionId: "" }, prompt: "handover", handoffPath: "data/handoff.md",
    } });
    await expect(askMate(paseo, { text: "install identified revision" }, beforeSend)).rejects.toThrow("handover needs recovery");
    expect(prepared).toBe(0);
    expect(sent).toEqual([]);
    await updateFirstmateConfig({ migration: null });
    await askMate(paseo, { text: "install identified revision" }, beforeSend);
    expect(prepared).toBe(1);
    expect(sent).toHaveLength(1);
  });
  it("sends the words alone, without interrupting, when nothing is attached", async () => {
    await updateFirstmateConfig({ mateAgentId: "old-mate" });
    const { paseo, sent } = fakePaseo({ "old-mate": { ...oldMate, status: "idle" } });
    await expect(askMate(paseo, { text: "  fix the login  " })).resolves.toBe("old-mate");
    expect(sent).toEqual([{ agentId: "old-mate", text: "fix the login", options: { activeTurnBehavior: "steer" } }]);
  });

  it("sends images as images and files as Paseo uploads, the way Paseo's composer does", async () => {
    await updateFirstmateConfig({ mateAgentId: "old-mate" });
    const { paseo, sent } = fakePaseo({ "old-mate": { ...oldMate, status: "idle" } });
    const png = { data: Buffer.from("png bytes").toString("base64"), mimeType: "image/png" };
    const notes = { fileName: "notes.txt", mimeType: "text/plain", data: Buffer.from("hello").toString("base64") };

    await askMate(paseo, { text: "", images: [png], files: [notes] });

    expect(sent).toHaveLength(1);
    const options = sent[0]?.options ?? {};
    expect(sent[0]?.text).toBe("");
    expect(options.images).toEqual([png]);
    expect(options.activeTurnBehavior).toBe("steer");
    const [upload] = options.attachments as Array<Record<string, unknown>>;
    expect(upload).toMatchObject({ type: "uploaded_file", fileName: "notes.txt", mimeType: "text/plain", size: 5 });
    expect(String(upload?.path)).toBe(join(paseoHome, "uploads", String(upload?.id), "notes.txt"));
    await expect(readFile(String(upload?.path), "utf8")).resolves.toBe("hello");
  });

  it("sends with the chat's message id, which the timeline keeps as the message's clientMessageId", async () => {
    await updateFirstmateConfig({ mateAgentId: "old-mate" });
    const { paseo, sent } = fakePaseo({ "old-mate": { ...oldMate, status: "idle" } });
    const png = { data: Buffer.from("png bytes").toString("base64"), mimeType: "image/png" };
    await askMate(paseo, { text: "this trail", images: [png], messageId: "firstmate-captain-abc-1" });
    expect(sent[0]?.options).toMatchObject({ images: [png], messageId: "firstmate-captain-abc-1" });
  });

  it("writes nothing when there is no first mate to send to", async () => {
    const { paseo, sent } = fakePaseo({});
    const notes = { fileName: "notes.txt", mimeType: "text/plain", data: "aGVsbG8=" };
    await expect(askMate(paseo, { text: "hi", files: [notes] })).rejects.toThrow();
    expect(sent).toEqual([]);
    await expect(readdir(join(paseoHome, "uploads"))).rejects.toThrow("ENOENT");
  });
});
