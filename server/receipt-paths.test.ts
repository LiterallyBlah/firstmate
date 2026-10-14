/**
 * Every send path, with the receipt journal off and on: off, exactly the calls the plugin made before it
 * existed and no file; on, the same calls plus a `messageId`, and a receipt for each.
 */
import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { CREW_LABELS, WATCH_MESSAGE_ID_PREFIX } from "../shared/fleet";
import { readFirstmateConfig, updateFirstmateConfig } from "./config";
import { CaptainSteers, registerSteerRelay, steerCrew } from "./crew";
import type { PaseoApi } from "./host-types";
import { adoptMate, askMate, compactMate, flushMateNotes, launchMate, queueMateNote, releaseMate, restartMate } from "./mate";
import { pageTimeline, registerReceiptObservers } from "./receipt-observers";
import { RECEIPT_JOURNAL_ENV, readReceiptJournal, receiptJournal, receiptJournalRoot, sha256, type ReceiptEntry, type ReceiptEvent } from "./receipts";
import { deliverToMate } from "./watch-service";

let paseoHome = "";
const previousHome = process.env.PASEO_HOME;
const previousSwitch = process.env[RECEIPT_JOURNAL_ENV];

beforeEach(async () => {
  paseoHome = await mkdtemp(join(tmpdir(), "firstmate-receipt-paths-"));
  process.env.PASEO_HOME = paseoHome;
  delete process.env[RECEIPT_JOURNAL_ENV];
});

afterEach(async () => {
  await receiptJournal()?.settled();
  if (previousHome === undefined) delete process.env.PASEO_HOME;
  else process.env.PASEO_HOME = previousHome;
  if (previousSwitch === undefined) delete process.env[RECEIPT_JOURNAL_ENV];
  else process.env[RECEIPT_JOURNAL_ENV] = previousSwitch;
  await rm(paseoHome, { recursive: true, force: true });
});

function agent(id: string, labels: Record<string, string> = {}, status = "idle") {
  return {
    id, provider: "claude", model: null, status, currentModeId: null, thinkingOptionId: null, archivedAt: null,
    labels, pendingPermissions: [], workspaceId: "wks", cwd: "/tmp", title: id, updatedAt: "2026-10-14T00:00:00.000Z",
  };
}

type Sent = { agentId: string; args: unknown[] };

/** Just enough of Paseo: agents to refresh, sends to record (or refuse), and a timeline to page. */
function fakePaseo(agents: Record<string, ReturnType<typeof agent>>) {
  const sent: Sent[] = [];
  const refetched: Array<{ agentId: string; options: unknown }> = [];
  const state = { failSends: false };
  const page = (cursor: unknown) => ({
    agent: null, direction: cursor ? "before" : "tail", projection: "projected", epoch: "e1", reset: false,
    staleCursor: false, gap: cursor !== undefined, hasOlder: cursor === undefined, hasNewer: false,
    window: { minSeq: 1, maxSeq: 9, nextSeq: 10 },
    startCursor: { epoch: "e1", seq: cursor ? 1 : 5 }, endCursor: { epoch: "e1", seq: cursor ? 4 : 9 }, error: null,
    entries: [{ provider: "claude", item: { type: "user_message", text: "hi", clientMessageId: "firstmate-mate-ask-1" }, turnId: "t1",
      timestamp: "2026-10-14T00:00:00.000Z", seqStart: 5, seqEnd: 5, sourceSeqRanges: [], collapsed: [] }],
  });
  const paseo = {
    agents: {
      ref(id: string) {
        return {
          async refresh() {
            const found = agents[id];
            if (found === undefined) throw new Error(`Agent not found: ${id}`);
            return { agent: found };
          },
          async send(...args: unknown[]) {
            if (state.failSends) throw new Error("daemon unreachable");
            sent.push({ agentId: id, args });
          },
          async archive() {
            const found = agents[id];
            if (found !== undefined) (found as { archivedAt: string | null }).archivedAt = "2026-10-14T00:00:00.000Z";
          },
          timeline: {
            async refetch(options: { cursor?: unknown }) {
              refetched.push({ agentId: id, options });
              return page(options.cursor);
            },
          },
        };
      },
      async list() {
        return { entries: [], pageInfo: { nextCursor: null } };
      },
    },
    workspaces: {
      ref: () => ({ refresh: async () => null }),
      async open(cwd: string) {
        return {
          id: "wks",
          agents: {
            async create(input: { agentId: string }) {
              agents[input.agentId] = { ...agent(input.agentId, { [CREW_LABELS.role]: CREW_LABELS.mateRole }), cwd };
              return { id: input.agentId };
            },
          },
        };
      },
    },
  } as unknown as PaseoApi;
  return { paseo, sent, refetched, state };
}

/** A lifecycle registration whose hooks the test fires by hand. */
function fakeServer() {
  const handlers = new Map<string, Array<(event: unknown, context: unknown) => unknown>>();
  return {
    server: {
      on(name: string, handler: (event: unknown, context: unknown) => unknown) {
        handlers.set(name, [...(handlers.get(name) ?? []), handler]);
        return () => {};
      },
    } as never,
    async fire(name: string, event: unknown, context: unknown) {
      for (const handler of handlers.get(name) ?? []) await handler(event, context);
    },
  };
}

const crew = agent("crew-1", { [CREW_LABELS.role]: CREW_LABELS.crewRole });
const mate = agent("mate", { [CREW_LABELS.role]: CREW_LABELS.mateRole });

async function everyPath(paseo: PaseoApi) {
  await updateFirstmateConfig({ mateAgentId: "mate" });
  await steerCrew(paseo, new CaptainSteers(), "crew-1", "use pnpm");
  await askMate(paseo, { text: " what is in flight? " });
  await compactMate(paseo);
  await queueMateNote(paseo, "<firstmate-board>note</firstmate-board>");
  await flushMateNotes(paseo);
  await deliverToMate(paseo, await readFirstmateConfig(), "<firstmate-watch name=\"pr\" ran=\"x\">\nout\n</firstmate-watch>");
  await receiptJournal()?.settled();
}

const journalEntries = async () => readReceiptJournal(receiptJournalRoot());
const events = <K extends ReceiptEvent["kind"]>(entries: ReceiptEntry[], kind: K) =>
  entries.flatMap((entry) => (entry.event.kind === kind ? [entry.event as Extract<ReceiptEvent, { kind: K }>] : []));
const optionsOf = (send: Sent) => (send.args[1] ?? {}) as Record<string, unknown>;

describe("with the switch off", () => {
  it("sends exactly what the plugin sent before, and writes no journal", async () => {
    const { paseo, sent } = fakePaseo({ "crew-1": crew, mate });
    await everyPath(paseo);
    const noteId = sent[3]!.args[1] as { messageId: string };
    expect(sent.map((send) => ({ agentId: send.agentId, args: send.args.map((arg) => (arg && typeof arg === "object" && "messageId" in arg ? { ...arg, messageId: "<id>" } : arg)) }))).toEqual([
      { agentId: "crew-1", args: ["use pnpm", { activeTurnBehavior: "steer" }] },
      { agentId: "mate", args: ["what is in flight?", { activeTurnBehavior: "steer" }] },
      { agentId: "mate", args: ["/compact"] },
      { agentId: "mate", args: ["<firstmate-board>note</firstmate-board>", { messageId: "<id>", activeTurnBehavior: "steer" }] },
      { agentId: "mate", args: ["<firstmate-watch name=\"pr\" ran=\"x\">\nout\n</firstmate-watch>", { messageId: "<id>", activeTurnBehavior: "steer" }] },
    ]);
    // The ids that were there before are still the plugin's own, as they were.
    expect(noteId.messageId).toMatch(/^firstmate-note-/);
    expect(optionsOf(sent[4]!).messageId).toMatch(new RegExp(`^${WATCH_MESSAGE_ID_PREFIX}`));
    expect(await readdir(join(paseoHome, "plugin-data", "firstmate"))).toEqual(["config.json"]);
  });

  it("refuses the timeline RPC", async () => {
    const { paseo, refetched } = fakePaseo({ mate });
    await updateFirstmateConfig({ mateAgentId: "mate" });
    await expect(pageTimeline(paseo, await readFirstmateConfig(), { agentId: "mate", direction: "tail", limit: 10, projection: "projected" })).rejects.toThrow("receipt journal is off");
    expect(refetched).toEqual([]);
  });
});

describe("with the switch on", () => {
  beforeEach(() => {
    process.env[RECEIPT_JOURNAL_ENV] = "1";
  });

  it("gives every send an original message id, and records who sent what to whom, how it went, under which first mate", async () => {
    const off = fakePaseo({ "crew-1": crew, mate });
    delete process.env[RECEIPT_JOURNAL_ENV];
    await everyPath(off.paseo);
    process.env[RECEIPT_JOURNAL_ENV] = "1";
    await rm(join(paseoHome, "plugin-data"), { recursive: true, force: true });

    const { paseo, sent } = fakePaseo({ "crew-1": crew, mate });
    await everyPath(paseo);

    // Only the message id differs from the switch off: the words, the recipients and the delivery are the same.
    const withoutIds = (sends: Sent[]) => sends.map((send) => ({ ...send, args: send.args.map((arg) => (arg && typeof arg === "object" ? { ...arg, messageId: undefined } : arg)) }));
    expect(withoutIds(sent)).toEqual(withoutIds(off.sent).map((send) => (send.args[0] === "/compact" ? { ...send, args: ["/compact", { messageId: undefined }] } : send)));
    const ids = sent.map((send) => optionsOf(send).messageId as string);
    expect(ids[0]).toMatch(/^firstmate-crew-steer-/);
    expect(ids[1]).toMatch(/^firstmate-mate-ask-/);
    expect(ids[2]).toMatch(/^firstmate-mate-compact-/);
    expect(ids[3]).toMatch(/^firstmate-note-/);
    expect(ids[4]).toMatch(new RegExp(`^${WATCH_MESSAGE_ID_PREFIX}`));

    const entries = await journalEntries();
    const attempts = events(entries, "send-attempt");
    const results = events(entries, "send-result");
    expect(attempts.map((attempt) => [attempt.channel, attempt.actor, attempt.recipient, attempt.messageId])).toEqual([
      ["crew-steer", "captain", "crew-1", ids[0]],
      ["mate-ask", "captain", "mate", ids[1]],
      ["mate-compact", "captain", "mate", ids[2]],
      ["mate-note", "plugin", "mate", ids[3]],
      ["watch-flush", "plugin", "mate", ids[4]],
    ]);
    expect(attempts[1]!.contentSha256).toBe(sha256("what is in flight?"));
    expect(results.map((result) => [result.attemptId, result.result])).toEqual(attempts.map((attempt) => [attempt.attemptId, "sent"]));
    // The first mate was found in the config, and every receipt is its generation's.
    const [generation] = entries.filter((entry) => entry.event.kind === "generation");
    expect(generation!.event).toEqual({ kind: "generation", change: "observed", agentId: "mate", previousAgentId: "" });
    expect(new Set(attempts.map((attempt) => JSON.stringify(attempt.generation)))).toEqual(new Set([JSON.stringify({ agentId: "mate", sequence: generation!.sequence })]));
    expect(events(entries, "note-queued")).toEqual([]); // A note queued without a source says nothing new.
  });

  it("records a failed send and passes its error on untouched", async () => {
    const { paseo, state } = fakePaseo({ "crew-1": crew, mate });
    state.failSends = true;
    const steers = new CaptainSteers();
    await expect(steerCrew(paseo, steers, "crew-1", "use pnpm")).rejects.toThrow("daemon unreachable");
    expect(steers.take("crew-1", ["use pnpm"])).toBeNull();
    await receiptJournal()!.settled();
    const [attempt] = events(await journalEntries(), "send-attempt");
    expect(events(await journalEntries(), "send-result")).toEqual([
      { kind: "send-result", attemptId: attempt!.attemptId, messageId: attempt!.messageId, result: "failed", error: "daemon unreachable" },
    ]);
  });

  it("never lets a journal that cannot be written stop a send", async () => {
    const { paseo, sent } = fakePaseo({ "crew-1": crew, mate });
    await updateFirstmateConfig({ mateAgentId: "mate" });
    await writeFile(receiptJournalRoot(), "not a directory");
    await steerCrew(paseo, new CaptainSteers(), "crew-1", "use pnpm");
    await receiptJournal()!.settled();
    expect(sent).toHaveLength(1);
    await rm(receiptJournalRoot());
    await askMate(paseo, { text: "still there?" });
    await receiptJournal()!.settled();
    const entries = await journalEntries();
    expect(events(entries, "uncertainty").map((event) => [event.lost, event.detail.messageId])).toEqual([
      ["send-attempt", optionsOf(sent[0]!).messageId],
      ["send-result", optionsOf(sent[0]!).messageId],
    ]);
    expect(events(entries, "send-attempt").map((attempt) => attempt.channel)).toEqual(["mate-ask"]);
  });

  it("binds a board steer to the turn that read it and to the note that relays it", async () => {
    const { paseo, sent } = fakePaseo({ "crew-1": crew, mate });
    await updateFirstmateConfig({ mateAgentId: "mate" });
    const steers = new CaptainSteers();
    const hooks = fakeServer();
    registerSteerRelay(hooks.server, steers);
    await steerCrew(paseo, steers, "crew-1", "use pnpm");
    const steerId = optionsOf(sent[0]!).messageId as string;
    await hooks.fire("agent.turn_ended", {
      agent: { id: "crew-1", title: "Fix login", parentAgentId: "mate" }, turnId: "turn-9", outcome: { kind: "completed" },
      timeline: [{ type: "user_message", text: "use pnpm", clientMessageId: steerId }, { type: "assistant_message", text: "done: switched" }],
    }, { paseo });
    await receiptJournal()!.settled();

    const entries = await journalEntries();
    expect(events(entries, "steer-read")).toEqual([{ kind: "steer-read", messageId: steerId, crewAgentId: "crew-1", turnId: "turn-9", clientMessageIdSeen: true }]);
    const [queued] = events(entries, "note-queued");
    expect(queued).toMatchObject({ source: "steer-relay", relates: [steerId], generation: { agentId: "mate" } });
    expect(sent[1]).toMatchObject({ agentId: "mate", args: [expect.stringContaining("<firstmate-board>"), { messageId: queued!.noteId }] });
    expect(events(entries, "send-attempt").map((attempt) => [attempt.channel, attempt.messageId])).toEqual([["crew-steer", steerId], ["mate-note", queued!.noteId]]);
  });

  it("records a launch and a restart, and the opening each sends under its own id", async () => {
    const { paseo, sent } = fakePaseo({});
    const first = await launchMate(paseo, { provider: "claude", modeId: "" });
    const second = await restartMate(paseo);
    await receiptJournal()!.settled();
    const entries = await journalEntries();
    const generations = entries.filter((entry) => entry.event.kind === "generation");
    expect(generations.map((entry) => entry.event)).toEqual([
      { kind: "generation", change: "launch", agentId: first.agentId, previousAgentId: "" },
      { kind: "generation", change: "restart", agentId: second.agentId, previousAgentId: first.agentId },
    ]);
    expect(sent.map((send) => [send.agentId, optionsOf(send).messageId])).toEqual([
      [first.agentId, `firstmate-opening-${first.agentId}`],
      [second.agentId, `firstmate-opening-${second.agentId}`],
    ]);
    expect(events(entries, "send-attempt").map((attempt) => [attempt.channel, attempt.messageId, attempt.generation?.sequence])).toEqual([
      ["mate-opening", `firstmate-opening-${first.agentId}`, generations[0]!.sequence],
      ["mate-opening", `firstmate-opening-${second.agentId}`, generations[1]!.sequence],
    ]);
  });

  it("records each change of first mate in the generation ledger", async () => {
    const { paseo } = fakePaseo({ mate, other: agent("other") });
    await adoptMate(paseo, "mate");
    await releaseMate();
    await adoptMate(paseo, "other");
    await receiptJournal()!.settled();
    expect(events(await journalEntries(), "generation")).toEqual([
      { kind: "generation", change: "adopt", agentId: "mate", previousAgentId: "" },
      { kind: "generation", change: "release", agentId: "", previousAgentId: "mate" },
      { kind: "generation", change: "adopt", agentId: "other", previousAgentId: "" },
    ]);
  });

  it("observes the first mate's own Paseo actions, and marks a crewmate's finish as uncertain", async () => {
    await updateFirstmateConfig({ mateAgentId: "mate" });
    const hooks = fakeServer();
    registerReceiptObservers(hooks.server, readFirstmateConfig);
    const call = (callId: string, name: string, status = "completed") => ({ type: "tool_call", callId, name, status, error: null, detail: { type: "unknown", input: { callId }, output: null } });
    await hooks.fire("agent.turn_ended", {
      agent: { id: "mate", parentAgentId: null }, turnId: "t1", outcome: { kind: "completed" },
      timeline: [call("c1", "mcp__paseo__create_agent"), call("c2", "Bash"), call("c3", "paseo.send_agent_prompt", "failed"), call("c4", "mcp__paseo__archive_agent")],
    }, {});
    await hooks.fire("agent.turn_ended", { agent: { id: "crew-1", parentAgentId: "mate" }, turnId: "t2", outcome: { kind: "completed" }, timeline: [] }, {});
    await hooks.fire("agent.turn_ended", { agent: { id: "stranger", parentAgentId: null }, turnId: "t3", outcome: { kind: "completed" }, timeline: [call("c9", "mcp__paseo__create_agent")] }, {});
    await receiptJournal()!.settled();

    const entries = await journalEntries();
    const [actions] = events(entries, "mate-actions");
    expect(actions).toMatchObject({ mateAgentId: "mate", turnId: "t1", outcome: "completed", source: "turn_ended", generation: { agentId: "mate" } });
    expect(actions!.actions.map((action) => [action.callId, action.name, action.status])).toEqual([
      ["c1", "mcp__paseo__create_agent", "completed"], ["c3", "paseo.send_agent_prompt", "failed"], ["c4", "mcp__paseo__archive_agent", "completed"],
    ]);
    expect(events(entries, "native-finish")).toEqual([{
      kind: "native-finish", childAgentId: "crew-1", parentAgentId: "mate", turnId: "t2", outcome: "completed",
      certainty: "uncertain", reason: "paseo-system-envelope-not-recorded",
    }]);
    expect(events(entries, "mate-actions")).toHaveLength(1);
  });

  it("pages a first mate's or crewmate's timeline through the cursor, with its proof of completeness, and changes nothing", async () => {
    const { paseo, sent, refetched } = fakePaseo({ mate, "crew-1": crew, stranger: agent("stranger"), old: agent("old", { [CREW_LABELS.role]: CREW_LABELS.mateRole }) });
    await updateFirstmateConfig({ mateAgentId: "mate", previousMateIds: ["older"] });
    const config = await readFirstmateConfig();

    const tail = await pageTimeline(paseo, config, { agentId: "mate", direction: "tail", limit: 50, projection: "projected" });
    expect(tail).toMatchObject({ role: "first-mate", gap: false, staleCursor: false, hasOlder: true, hasNewer: false, startCursor: { epoch: "e1", seq: 5 } });
    expect(tail.entries).toEqual([{ seqStart: 5, seqEnd: 5, turnId: "t1", timestamp: "2026-10-14T00:00:00.000Z", item: { type: "user_message", text: "hi", clientMessageId: "firstmate-mate-ask-1" } }]);
    const older = await pageTimeline(paseo, config, { agentId: "crew-1", direction: "before", cursor: tail.startCursor!, limit: 50, projection: "projected" });
    expect(older).toMatchObject({ role: "crew", gap: true, hasOlder: false });
    expect(refetched).toEqual([
      { agentId: "mate", options: { direction: "tail", limit: 50, projection: "projected" } },
      { agentId: "crew-1", options: { direction: "before", limit: 50, projection: "projected", cursor: { epoch: "e1", seq: 5 } } },
    ]);
    expect((await pageTimeline(paseo, config, { agentId: "old", direction: "tail", limit: 1, projection: "canonical" })).role).toBe("former-first-mate");
    expect((await pageTimeline(paseo, config, { agentId: "older", direction: "tail", limit: 1, projection: "projected" })).role).toBe("former-first-mate");
    await expect(pageTimeline(paseo, config, { agentId: "stranger", direction: "tail", limit: 1, projection: "projected" })).rejects.toThrow("neither a first mate nor one of the crew");
    await expect(pageTimeline(paseo, config, { agentId: "ghost", direction: "tail", limit: 1, projection: "projected" })).rejects.toThrow("neither a first mate");

    expect(sent).toEqual([]);
    await receiptJournal()!.settled();
    await expect(readdir(receiptJournalRoot())).rejects.toMatchObject({ code: "ENOENT" });
  });
});
