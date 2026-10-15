/**
 * The captain's conversation with a worker, relayed to the first mate one burst at a time: every exchange
 * with one worker until it goes quiet is one note, so a five-message chat costs one first-mate turn.
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { CAPTAIN_STEER_MESSAGE_ID_PREFIX, CREW_LABELS } from "../shared/fleet";
import { readFirstmateConfig, updateFirstmateConfig } from "./config";
import { CaptainSteers, registerSteerRelay, relayExchange, relayNote, relayText, steerCrew } from "./crew";
import type { PaseoApi } from "./host-types";
import { BURST_MAX_MS, BURST_QUIET_MS, extendBurstNote, flushMateNotes, queueBurstNote, queueMateNote } from "./mate";

let paseoHome = "";
const previousHome = process.env.PASEO_HOME;

beforeEach(async () => {
  paseoHome = await mkdtemp(join(tmpdir(), "firstmate-burst-notes-"));
  process.env.PASEO_HOME = paseoHome;
});

afterEach(async () => {
  if (previousHome === undefined) delete process.env.PASEO_HOME;
  else process.env.PASEO_HOME = previousHome;
  await rm(paseoHome, { recursive: true, force: true });
});

function agent(id: string, labels: Record<string, string>) {
  return {
    id, provider: "claude", model: null, status: "idle", currentModeId: null, thinkingOptionId: null, archivedAt: null,
    labels, pendingPermissions: [], workspaceId: "wks", cwd: "/tmp", title: id, updatedAt: "2026-10-15T00:00:00.000Z",
  };
}

type Sent = { agentId: string; text: string; options: Record<string, unknown> };

function fakePaseo() {
  const agents: Record<string, ReturnType<typeof agent>> = {
    "crew-1": agent("crew-1", { [CREW_LABELS.role]: CREW_LABELS.crewRole }),
    "crew-2": agent("crew-2", { [CREW_LABELS.role]: CREW_LABELS.crewRole }),
    mate: agent("mate", { [CREW_LABELS.role]: CREW_LABELS.mateRole }),
  };
  const sent: Sent[] = [];
  const paseo = {
    agents: {
      ref: (id: string) => ({
        async refresh() {
          const found = agents[id];
          if (found === undefined) throw new Error(`Agent not found: ${id}`);
          return { agent: found };
        },
        async send(text: string, options: Record<string, unknown>) {
          sent.push({ agentId: id, text, options });
        },
      }),
    },
  } as unknown as PaseoApi;
  return { paseo, sent, toMate: () => sent.filter((send) => send.agentId === "mate") };
}

function fakeServer() {
  const handlers: Array<(event: unknown, context: unknown) => unknown> = [];
  return {
    server: { on: (_name: string, handler: (event: unknown, context: unknown) => unknown) => (handlers.push(handler), () => {}) } as never,
    async turnEnded(paseo: PaseoApi, agentId: string, said: string, answer: string) {
      for (const handler of handlers) {
        await handler({
          agent: { id: agentId, title: `Task ${agentId}` }, turnId: "t", outcome: { kind: "completed" },
          timeline: [{ type: "user_message", text: said }, { type: "assistant_message", text: answer }],
        }, { paseo });
      }
    },
  };
}

const later = (ms: number) => () => Date.now() + ms;

describe("the steer relay", () => {
  it("relays a burst of exchanges with one worker as one note, once the conversation is quiet", async () => {
    const { paseo, toMate } = fakePaseo();
    await updateFirstmateConfig({ mateAgentId: "mate" });
    const steers = new CaptainSteers();
    const hooks = fakeServer();
    registerSteerRelay(hooks.server, steers);

    for (const [said, answer] of [["use pnpm", "switched to pnpm"], ["and skip e2e", "skipped"], ["thanks", "working: tests"]] as const) {
      await steerCrew(paseo, steers, "crew-1", said);
      await hooks.turnEnded(paseo, "crew-1", said, answer);
    }
    await flushMateNotes(paseo);
    expect(toMate()).toEqual([]);
    expect((await readFirstmateConfig()).mateNotes).toHaveLength(1);

    await flushMateNotes(paseo, later(BURST_QUIET_MS + 1));
    const notes = toMate();
    expect(notes).toHaveLength(1);
    const text = notes[0]!.text;
    expect(text.match(/<firstmate-board>/g)).toHaveLength(1);
    expect(text.match(/<captain-message>/g)).toHaveLength(3);
    expect(text.indexOf("use pnpm")).toBeLessThan(text.indexOf("and skip e2e"));
    expect(text.indexOf("and skip e2e")).toBeLessThan(text.indexOf("thanks"));
    expect(text).toContain("<agent-response>\nworking: tests\n</agent-response>");
    expect((await readFirstmateConfig()).mateNotes).toEqual([]);
  });

  it("keeps each worker's burst in its own note", async () => {
    const { paseo, toMate } = fakePaseo();
    await updateFirstmateConfig({ mateAgentId: "mate" });
    const steers = new CaptainSteers();
    const hooks = fakeServer();
    registerSteerRelay(hooks.server, steers);
    await steerCrew(paseo, steers, "crew-1", "one");
    await hooks.turnEnded(paseo, "crew-1", "one", "ok one");
    await steerCrew(paseo, steers, "crew-2", "two");
    await hooks.turnEnded(paseo, "crew-2", "two", "ok two");

    // One note per idle turn, as before: each goes on its own flush.
    await flushMateNotes(paseo, later(BURST_QUIET_MS + 1));
    await flushMateNotes(paseo, later(BURST_QUIET_MS + 1));
    expect(toMate().map((note) => /crewmate (\S+)/.exec(note.text)?.[1])).toEqual(["crew-1", "crew-2"]);
  });

  it("tags every steer as the captain's", async () => {
    const { paseo, sent } = fakePaseo();
    await steerCrew(paseo, new CaptainSteers(), "crew-1", "hi");
    expect(String(sent[0]!.options.messageId)).toMatch(new RegExp(`^${CAPTAIN_STEER_MESSAGE_ID_PREFIX}`));
  });
});

describe("queueBurstNote", () => {
  const render = async (parts: readonly string[]) => parts.join(" | ");

  it("starts a new note once the last one stopped holding, so a part never joins a note a send may have taken", async () => {
    const { paseo } = fakePaseo();
    let now = Date.parse("2026-10-15T10:00:00.000Z");
    const clock = () => now;
    await queueBurstNote(paseo, { key: "w", part: "a", render }, { source: "steer-relay", relates: ["s1"] }, clock);
    now += BURST_QUIET_MS - 1;
    await queueBurstNote(paseo, { key: "w", part: "b", render }, { source: "steer-relay", relates: ["s2"] }, clock);
    now += BURST_QUIET_MS + 1;
    await queueBurstNote(paseo, { key: "w", part: "c", render }, { source: "steer-relay", relates: [] }, clock);
    const notes = (await readFirstmateConfig()).mateNotes;
    expect(notes.map((note) => note.text)).toEqual(["a | b", "c"]);
    expect(notes[0]!.burst?.relates).toEqual(["s1", "s2"]);
  });

  it("holds for the quiet period after the latest exchange or steer, and never past the maximum", async () => {
    const { paseo } = fakePaseo();
    const start = Date.parse("2026-10-15T10:00:00.000Z");
    let now = start;
    const clock = () => now;
    await queueBurstNote(paseo, { key: "w", part: "a", render }, { source: "steer-relay", relates: [] }, clock);
    const hold = async () => Date.parse((await readFirstmateConfig()).mateNotes[0]!.burst!.holdUntil);
    expect(await hold()).toBe(start + BURST_QUIET_MS);
    now += 60_000;
    await extendBurstNote("w", clock);
    expect(await hold()).toBe(now + BURST_QUIET_MS);
    await extendBurstNote("other", clock);
    expect(await hold()).toBe(now + BURST_QUIET_MS);
    for (let step = 0; step < 10; step++) {
      now += 60_000;
      await extendBurstNote("w", clock);
    }
    expect(await hold()).toBe(start + BURST_MAX_MS);
  });

  it("lets a note that is not a burst go at once, past a burst that is still holding", async () => {
    const { paseo, toMate } = fakePaseo();
    await updateFirstmateConfig({ mateAgentId: "mate" });
    await queueBurstNote(paseo, { key: "w", part: "held", render }, { source: "steer-relay", relates: [] });
    await queueMateNote(paseo, "<firstmate-board>now</firstmate-board>");
    expect(toMate().map((note) => note.text)).toEqual(["<firstmate-board>now</firstmate-board>"]);
    expect((await readFirstmateConfig()).mateNotes.map((note) => note.text)).toEqual(["held"]);
  });
});

describe("relayNote", () => {
  it("puts every exchange of a burst in one envelope, and reads as before for one", async () => {
    const first = await relayExchange(["use pnpm"], "switched");
    const second = await relayExchange(["skip e2e"], null);
    const note = await relayNote({ id: "a1", title: "Fix login" }, [first, second]);
    expect(note).toBe(
      "<firstmate-board>\n" +
        "The captain spoke to crewmate a1 (Fix login) directly from the FirstMate board. Their words are authoritative: reconcile the brief and the backlog with them.\n" +
        "<captain-message>\nuse pnpm\n</captain-message>\n<agent-response>\nswitched\n</agent-response>\n" +
        "<captain-message>\nskip e2e\n</captain-message>\n<agent-response>\n(it ended the turn without a message)\n</agent-response>\n" +
        "</firstmate-board>",
    );
    expect(await relayText({ id: "a1", title: "Fix login" }, ["use pnpm"], "switched")).toBe(
      "<firstmate-board>\n" +
        "The captain spoke to crewmate a1 (Fix login) directly from the FirstMate board. Their words are authoritative: reconcile the brief and the backlog with them.\n" +
        "<captain-message>\nuse pnpm\n</captain-message>\n<agent-response>\nswitched\n</agent-response>\n" +
        "</firstmate-board>",
    );
  });
});
