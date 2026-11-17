/**
 * Paseo 0.16's `agent.turn_ended` carries no history (`timeline: []`, the compatibility array), so the captain-steer
 * relay and the optional observers read the ended turn back with `readEndedTurn`. These hold the read to the turn
 * that ended — never a newer one, never a guess — and the relay to leaving the captain's words pending whenever the
 * turn could not be read whole.
 */
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { readFirstmateConfig, updateFirstmateConfig } from "./config";
import { CaptainSteers, registerSteerRelay } from "./crew";
import type { PaseoApi, TimelinePage } from "./host-types";
import { readEndedTurn, TURN_READ_PAGES } from "./turn-timeline";
import { turnPage } from "../test/turn-page";

vi.mock("./cli", () => ({ stopAgent: async () => undefined }));

const user = (text: string, clientMessageId?: string) => ({ type: "user_message", text, ...(clientMessageId ? { clientMessageId } : {}) });
const reply = (text: string) => ({ type: "assistant_message", text });
const cursor = (seq: number) => ({ epoch: "epoch-1", seq });

/** A timeline answering pages in order; each call's options are kept. */
function timeline(pages: Array<TimelinePage | Error>) {
  const calls: unknown[] = [];
  const refetch = vi.fn(async (options: unknown) => {
    calls.push(options);
    const next = pages.shift();
    if (next === undefined) throw new Error("no more pages");
    if (next instanceof Error) throw next;
    return next;
  });
  return { calls, refetch, paseo: (refresh = async () => ({ agent: { id: "w", title: "W", archivedAt: null, labels: { "firstmate.role": "crew" } } })) =>
    ({ agents: { ref: () => ({ refresh, send: async () => undefined, timeline: { refetch } }) } }) as unknown as PaseoApi };
}

describe("readEndedTurn", () => {
  it("asks for the latest whole turn and keeps only the ended turn's entries", async () => {
    const t = timeline([turnPage("w", "t1", [user("hi"), reply("done: ok")])]);
    expect(await readEndedTurn(t.paseo(), "w", "t1")).toMatchObject({ complete: true, turnId: "t1", items: [user("hi"), reply("done: ok")] });
    expect(t.calls).toEqual([{ direction: "tail", limit: 1, wholeTurns: true, projection: "projected" }]);
  });

  it("a whole long turn is read whole, however far past the limit it runs", async () => {
    const items = [user("go"), ...Array.from({ length: 900 }, (_, i) => reply(`step ${i}`))];
    const read = await readEndedTurn(timeline([turnPage("w", "t1", items)]).paseo(), "w", "t1");
    expect(read.complete && read.items).toHaveLength(901);
  });

  it("walks back past a newer turn that began before the read, on the same epoch", async () => {
    const newer = turnPage("w", "t2", [user("next")], { hasOlder: true, startCursor: cursor(10) });
    const ended = turnPage("w", "t1", [user("hi"), reply("answer")]);
    const t = timeline([newer, ended]);
    expect(await readEndedTurn(t.paseo(), "w", "t1")).toMatchObject({ complete: true, items: [user("hi"), reply("answer")] });
    expect(t.calls[1]).toEqual({ direction: "before", cursor: cursor(10), limit: 1, wholeTurns: true, projection: "projected" });
  });

  it("is incomplete, with why, rather than empty", async () => {
    const page = (extra: Partial<TimelinePage>) => turnPage("w", "t1", [user("hi")], extra);
    const cases: Array<[string, string | null, Array<TimelinePage | Error>]> = [
      ["no-turn-id", null, []],
      ["fetch-failed", "t1", [new Error("offline")]],
      ["page-error", "t1", [page({ error: "boom" })]],
      ["page-error", "t1", [turnPage("someone-else", "t1", [user("hi")])]],
      ["page-gap", "t1", [page({ gap: true })]],
      ["page-gap", "t1", [page({ reset: true })]],
      ["page-gap", "t1", [page({ staleCursor: true })]],
      ["epoch-changed", "t1", [turnPage("w", "t2", [], { hasOlder: true, startCursor: cursor(3) }), page({ epoch: "epoch-2" })]],
      ["not-found", "t1", [turnPage("w", "t2", [user("other")])]],
      // A turn whose entries carry no id cannot be told from the turns around it.
      ["not-found", "t1", [turnPage("w", null, [user("hi"), reply("answer")])]],
      ["not-found", "t1", Array.from({ length: TURN_READ_PAGES }, () => turnPage("w", "t9", [user("x")], { hasOlder: true, startCursor: cursor(2) }))],
    ];
    for (const [reason, turnId, pages] of cases) {
      expect(await readEndedTurn(timeline(pages).paseo(), "w", turnId), reason).toEqual({ complete: false, reason });
    }
  });
});

describe("the captain-steer relay on an empty hook timeline", () => {
  let relay!: (event: unknown, context: { paseo: PaseoApi }) => Promise<void>;
  let steers: CaptainSteers;
  const ended = (turnId: string | null, kind = "completed") =>
    ({ agent: { id: "w", title: "W" }, turnId, outcome: kind === "canceled" ? { kind, reason: "steered" } : { kind }, timeline: [] });
  const notes = async () => (await readFirstmateConfig()).mateNotes;

  beforeEach(async () => {
    const home = join(process.env.PASEO_HOME!, "home");
    await mkdir(join(home, "data"), { recursive: true });
    await updateFirstmateConfig({ home, mateAgentId: "", migration: null, mateLaunch: null, mateNotes: [] });
    await updateFirstmateConfig({ mateAgentId: "mate" });
    steers = new CaptainSteers();
    registerSteerRelay({ on: (_name: string, h: typeof relay) => { relay = h; return () => undefined; } } as never, steers);
  });

  it("relays the steer from the turn read back, with that turn's own closing reply", async () => {
    steers.record("w", "use pnpm", "firstmate-crew-steer-1");
    const t = timeline([turnPage("w", "t1", [user("use pnpm", "firstmate-crew-steer-1"), reply("switched\ndone: pnpm")])]);
    await relay(ended("t1"), { paseo: t.paseo() });
    const [note] = await notes();
    expect(note?.text).toContain("use pnpm");
    expect(note?.text).toContain("done: pnpm");
    expect(steers.hasPending("w")).toBe(false);
  });

  it("reads nothing while no steer is pending, and never for a cancelled turn", async () => {
    const t = timeline([]);
    await relay(ended("t1"), { paseo: t.paseo() });
    steers.record("w", "use pnpm");
    await relay(ended("t1", "canceled"), { paseo: t.paseo() });
    expect(t.refetch).not.toHaveBeenCalled();
    expect(steers.hasPending("w")).toBe(true);
  });

  it("keeps the steer pending when the turn cannot be read, and relays it once from the turn that does read it", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    steers.record("w", "use pnpm");
    // A turn with no id, a failed read, a gap, and a turn that ran before the steer joined: none consumes it.
    await relay(ended(null), { paseo: timeline([]).paseo() });
    await relay(ended("t0"), { paseo: timeline([new Error("offline")]).paseo() });
    await relay(ended("t0"), { paseo: timeline([turnPage("w", "t0", [user("earlier")], { gap: true })]).paseo() });
    await relay(ended("t0"), { paseo: timeline([turnPage("w", "t0", [user("earlier"), reply("old answer")])]).paseo() });
    expect(steers.hasPending("w")).toBe(true);
    expect(await notes()).toEqual([]);
    // The turn the steer started ends after another began: read back, it is relayed once.
    const t = timeline([turnPage("w", "t2", [user("later")], { hasOlder: true, startCursor: cursor(7) }), turnPage("w", "t1", [user("use pnpm"), reply("switched")])]);
    await relay(ended("t1"), { paseo: t.paseo() });
    expect(await notes()).toHaveLength(1);
    expect((await notes())[0]!.text).toContain("switched");
    expect((await notes())[0]!.text).not.toContain("old answer");
    expect(steers.hasPending("w")).toBe(false);
    // The same turn ending again (a repeated hook) has nothing left to relay.
    await relay(ended("t1"), { paseo: timeline([turnPage("w", "t1", [user("use pnpm"), reply("switched")])]).paseo() });
    expect(await notes()).toHaveLength(1);
    expect(error).toHaveBeenCalledWith(expect.stringContaining("stay pending"));
    error.mockRestore();
  });

  it("a repeated message is consumed by the turn that read it, and the next one waits for its own turn", async () => {
    steers.record("w", "again");
    steers.record("w", "other");
    await relay(ended("t1"), { paseo: timeline([turnPage("w", "t1", [user("again"), reply("first")])]).paseo() });
    expect(steers.hasPending("w")).toBe(true);
    steers.record("w", "again");
    await relay(ended("t2"), { paseo: timeline([turnPage("w", "t2", [user("again"), user("other"), reply("second")])]).paseo() });
    expect(steers.hasPending("w")).toBe(false);
    // Both exchanges join the one burst note.
    const [note] = await notes();
    expect(note?.text).toContain("first");
    expect(note?.text).toContain("second");
  });

  it("a steer sent while the ended turn is being read waits for its own turn, even with the same words", async () => {
    // The review's race: the read awaits, the captain sends again, and the earlier turn must not take the later steer.
    let resolveRead!: (page: TimelinePage) => void;
    const held = new Promise<TimelinePage>((resolve) => { resolveRead = resolve; });
    const refetch = vi.fn(() => held);
    const paseo = { agents: { ref: () => ({ refresh: async () => ({ agent: { id: "w", title: "W", archivedAt: null, labels: { "firstmate.role": "crew" } } }),
      send: async () => undefined, timeline: { refetch } }) } } as unknown as PaseoApi;
    steers.record("w", "again", "firstmate-crew-steer-1");
    const first = relay(ended("t1"), { paseo });
    steers.record("w", "again", "firstmate-crew-steer-2");
    resolveRead(turnPage("w", "t1", [user("again", "firstmate-crew-steer-1"), reply("first answer")]));
    await first;
    expect(steers.hasPending("w")).toBe(true);
    expect((await notes())[0]!.text.match(/again/g)).toHaveLength(1);
    // The later steer is taken by the turn that carries its id, and its answer joins the burst.
    await relay(ended("t2"), { paseo: timeline([turnPage("w", "t2", [user("again", "firstmate-crew-steer-2"), reply("second answer")])]).paseo() });
    expect(steers.hasPending("w")).toBe(false);
    expect((await notes())[0]!.text).toContain("second answer");
  });

  it("matches one steer to one message by its id, and the id-less fallback never takes a captain's tagged message", async () => {
    steers.record("w", "again", "firstmate-crew-steer-1");
    steers.record("w", "again", "firstmate-crew-steer-2");
    steers.record("w", "again"); // an older caller's steer, without an id
    // The turn read the second tagged steer only: the first waits, and so does the id-less one, whose words
    // appear only inside a message that belongs to a tagged steer.
    await relay(ended("t1"), { paseo: timeline([turnPage("w", "t1", [user("again", "firstmate-crew-steer-2"), reply("ok")])]).paseo() });
    expect(steers.snapshot("w").map((steer) => steer.messageId)).toEqual(["firstmate-crew-steer-1", undefined]);
    // A message without a captain-steer id reads the id-less steer, once; a matching text never stands in for an id.
    await relay(ended("t2"), { paseo: timeline([turnPage("w", "t2", [user("again", "firstmate-mate-ask-9"), user("again"), reply("ok")])]).paseo() });
    expect(steers.snapshot("w").map((steer) => steer.messageId)).toEqual(["firstmate-crew-steer-1"]);
  });


  /** A crewmate whose timeline answers every read with one held page, released by the returned function. */
  function heldRead() {
    let release!: (page: TimelinePage) => void;
    const held = new Promise<TimelinePage>((resolve) => { release = resolve; });
    const paseo = { agents: { ref: () => ({ refresh: async () => ({ agent: { id: "w", title: "W", archivedAt: null, labels: { "firstmate.role": "crew" } } }),
      send: async () => undefined, timeline: { refetch: () => held } }) } } as unknown as PaseoApi;
    return { paseo, release };
  }

  it("two end callbacks for one turn, both reading before either resolves, relay the exchange once", async () => {
    steers.record("w", "use pnpm", "firstmate-crew-steer-1");
    const { paseo, release } = heldRead();
    const first = relay(ended("t1"), { paseo }), second = relay(ended("t1"), { paseo });
    release(turnPage("w", "t1", [user("use pnpm", "firstmate-crew-steer-1"), reply("switched")]));
    await Promise.all([first, second]);
    const relayed = await notes();
    expect(relayed).toHaveLength(1);
    expect(relayed[0]!.text.match(/use pnpm/g)).toHaveLength(1);
    expect(relayed[0]!.text.match(/switched/g)).toHaveLength(1);
    expect(steers.hasPending("w")).toBe(false);
  });

  it("a steer taken back while its turn is being read is neither relayed nor revived", async () => {
    steers.record("w", "use pnpm", "firstmate-crew-steer-1");
    const { paseo, release } = heldRead();
    const ending = relay(ended("t1"), { paseo });
    steers.forget("w", "use pnpm");
    release(turnPage("w", "t1", [user("use pnpm", "firstmate-crew-steer-1"), reply("switched")]));
    await ending;
    expect(await notes()).toEqual([]);
    expect(steers.hasPending("w")).toBe(false);
  });

});
