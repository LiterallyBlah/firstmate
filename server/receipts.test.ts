import { appendFile, cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { FirstmateConfigSchema } from "../shared/fleet";
import { readTextFile, replaceTextIfUnchanged, writeTextFile } from "./files";
import { prepareHome } from "./home";
import {
  RECEIPT_JOURNAL_ENV, ReceiptJournal, newAction, observedWrite, readReceiptJournal, receiptJournal,
  receiptJournalEnabled, receiptJournalRoot, sha256, verifyReceiptJournal, type ReceiptEntry, type ReceiptEvent,
} from "./receipts";
import { canonical, digest } from "./submissions";

let scratch = "";
const previousHome = process.env.PASEO_HOME;
const previousSwitch = process.env[RECEIPT_JOURNAL_ENV];

beforeEach(async () => {
  scratch = await mkdtemp(join(tmpdir(), "firstmate-receipts-"));
  process.env.PASEO_HOME = join(scratch, "paseo");
  delete process.env[RECEIPT_JOURNAL_ENV];
});

afterEach(async () => {
  await receiptJournal()?.settled();
  if (previousHome === undefined) delete process.env.PASEO_HOME;
  else process.env.PASEO_HOME = previousHome;
  if (previousSwitch === undefined) delete process.env[RECEIPT_JOURNAL_ENV];
  else process.env[RECEIPT_JOURNAL_ENV] = previousSwitch;
  await rm(scratch, { recursive: true, force: true });
});

const crewSend = (text: string): Parameters<ReceiptJournal["beginSend"]>[0] => ({ channel: "crew-steer", actor: "captain", recipient: "crew-1", text });
const kinds = (entries: ReceiptEntry[]) => entries.map((entry) => entry.event.kind);

describe("the switch", () => {
  it("is off unless explicitly on", () => {
    expect(receiptJournalEnabled({})).toBe(false);
    for (const value of ["", "0", "false", "off", "no", "maybe"]) expect(receiptJournalEnabled({ [RECEIPT_JOURNAL_ENV]: value })).toBe(false);
    for (const value of ["1", "true", "ON", " yes "]) expect(receiptJournalEnabled({ [RECEIPT_JOURNAL_ENV]: value })).toBe(true);
    expect(receiptJournal()).toBeNull();
  });
});

describe("the journal", () => {
  it("appends hash-linked, canonical entries, opening every shard with a checkpoint", async () => {
    const root = join(scratch, "journal");
    const journal = new ReceiptJournal(root, { shardSize: 3 });
    for (let n = 0; n < 3; n++) journal.beginSend(crewSend(`steer ${n}`)).settle("sent");
    await journal.settled();

    const entries = await readReceiptJournal(root, 3);
    expect(kinds(entries)).toEqual(["checkpoint", "journal-start", "send-attempt", "checkpoint", "send-result", "send-attempt",
      "checkpoint", "send-result", "send-attempt", "checkpoint", "send-result"]);
    entries.forEach((entry, index) => {
      expect(entry.sequence).toBe(index + 1);
      expect(entry.previous).toBe(index === 0 ? null : digest(entries[index - 1]));
    });
    expect(await readdir(root)).toEqual(["000000", "000001", "000002", "000003"]);
    const raw = await readFile(join(root, "000000", "00000001.json"), "utf8");
    expect(raw).toBe(`${canonical(entries[0])}\n`);
    expect(await verifyReceiptJournal(root, 3)).toEqual({ entries: 11, head: digest(entries.at(-1)), generations: 0 });

    // The receipt binds the content by hash and size, never the words themselves.
    const attempt = entries[2]!.event as Extract<ReceiptEvent, { kind: "send-attempt" }>;
    expect(attempt).toMatchObject({ channel: "crew-steer", actor: "captain", recipient: "crew-1", carried: true, contentSha256: sha256("steer 0"), contentBytes: 7 });
    expect(JSON.stringify(entries)).not.toContain("steer 0");
    expect(entries[4]!.event).toMatchObject({ kind: "send-result", attemptId: attempt.attemptId, messageId: attempt.messageId, result: "sent", error: null });
  });

  it("says when a send's id does not travel with it, as for a remote worker", async () => {
    const root = join(scratch, "journal");
    const journal = new ReceiptJournal(root);
    const handle = journal.beginSend({ channel: "remote-steer", actor: "captain", recipient: "srv_1/agent-1", text: "go", carried: false });
    handle.settle("sent");
    handle.settle("failed", new Error("settled twice")); // Only the first result counts.
    await journal.settled();
    const entries = await readReceiptJournal(root);
    expect(entries.map((entry) => entry.event)).toMatchObject([
      { kind: "checkpoint" }, { kind: "journal-start" },
      { kind: "send-attempt", channel: "remote-steer", recipient: "srv_1/agent-1", carried: false, messageId: handle.messageId },
      { kind: "send-result", result: "sent" },
    ]);
  });

  it("continues one chain across processes, each announcing itself", async () => {
    const root = join(scratch, "journal");
    const first = new ReceiptJournal(root, { shardSize: 4 });
    first.beginSend(crewSend("a")).settle("sent");
    await first.settled();
    const second = new ReceiptJournal(root, { shardSize: 4 });
    second.beginSend(crewSend("b")).settle("failed", new Error("daemon down"));
    await second.settled();
    const entries = await readReceiptJournal(root, 4);
    expect(entries.filter((entry) => entry.event.kind === "journal-start")).toHaveLength(2);
    expect(entries.at(-1)!.event).toMatchObject({ kind: "send-result", result: "failed", error: "daemon down" });
  });

  describe("fails closed", () => {
    let valid = "";
    beforeEach(async () => {
      valid = join(scratch, "valid");
      const journal = new ReceiptJournal(valid, { shardSize: 3 });
      for (let n = 0; n < 3; n++) journal.beginSend(crewSend(`steer ${n}`)).settle("sent");
      await journal.settled();
    });
    const file = (root: string, sequence: number) => join(root, String(Math.floor((sequence - 1) / 3)).padStart(6, "0"), `${String(sequence).padStart(8, "0")}.json`);
    async function damaged(change: (root: string) => Promise<void>): Promise<string> {
      const root = join(scratch, `case-${Math.random().toString(36).slice(2)}`);
      await cp(valid, root, { recursive: true });
      await change(root);
      return root;
    }
    async function rewrite(root: string, sequence: number, edit: (entry: Record<string, any>) => void, form: "canonical" | "pretty" = "canonical") {
      const entry = JSON.parse(await readFile(file(root, sequence), "utf8"));
      edit(entry);
      await writeFile(file(root, sequence), form === "canonical" ? `${canonical(entry)}\n` : JSON.stringify(entry, null, 2));
    }

    it.each([
      ["JOURNAL_NOT_CANONICAL", (root: string) => rewrite(root, 3, () => {}, "pretty")],
      ["JOURNAL_LINK_BROKEN", (root: string) => rewrite(root, 3, (entry) => { entry.event.contentBytes = 99; })],
      ["JOURNAL_ENTRY_INVALID", (root: string) => rewrite(root, 3, (entry) => { entry.event.extra = "x"; })],
      ["JOURNAL_ENTRY_INVALID", (root: string) => rewrite(root, 5, (entry) => { entry.event.kind = "send-maybe"; })],
      ["JOURNAL_ENTRY_INVALID", (root: string) => writeFile(file(root, 2), "{not json")],
      ["JOURNAL_SEQUENCE_MISMATCH", (root: string) => rewrite(root, 11, (entry) => { entry.sequence = 12; })],
      ["JOURNAL_SEQUENCE_GAP", (root: string) => rm(file(root, 5))],
      ["JOURNAL_SHARD_INCOMPLETE", (root: string) => rm(join(root, "000001"), { recursive: true }).then(() => mkdir(join(root, "000001")))],
      ["JOURNAL_SHARD_GAP", (root: string) => rm(join(root, "000002"), { recursive: true })],
      ["JOURNAL_UNEXPECTED_FILE", (root: string) => writeFile(join(root, "000000", "notes.txt"), "hi")],
      ["JOURNAL_UNEXPECTED_FILE", (root: string) => writeFile(join(root, "README"), "hi")],
    ])("%s", async (code, change) => {
      const root = await damaged(change);
      await expect(verifyReceiptJournal(root, 3)).rejects.toMatchObject({ name: "ReceiptJournalError", code });
    });

    it("refuses a checkpoint that does not match the generations before it, or one out of place", async () => {
      const chain = async (events: ReceiptEvent[]) => {
        const root = join(scratch, `chain-${Math.random().toString(36).slice(2)}`);
        let previous: string | null = null;
        for (const [index, event] of events.entries()) {
          const entry = { version: 1, sequence: index + 1, previous, at: "2026-10-14T00:00:00.000Z", event };
          const shard = join(root, String(Math.floor(index / 2)).padStart(6, "0"));
          await mkdir(shard, { recursive: true });
          await writeFile(join(shard, `${String(index + 1).padStart(8, "0")}.json`), `${canonical(entry)}\n`);
          previous = digest(entry);
        }
        return root;
      };
      const generation: ReceiptEvent = { kind: "generation", change: "launch", agentId: "mate-1", previousAgentId: "" };
      const empty: ReceiptEvent = { kind: "checkpoint", generations: {}, current: null };
      const right: ReceiptEvent = { kind: "checkpoint", generations: { "mate-1": 2 }, current: { agentId: "mate-1", sequence: 2 } };
      await expect(verifyReceiptJournal(await chain([empty, generation, right]), 2)).resolves.toMatchObject({ entries: 3, generations: 1 });
      await expect(verifyReceiptJournal(await chain([empty, generation, empty]), 2)).rejects.toMatchObject({ code: "JOURNAL_CHECKPOINT_MISMATCH" });
      await expect(verifyReceiptJournal(await chain([empty, empty]), 2)).rejects.toMatchObject({ code: "JOURNAL_CHECKPOINT_MISPLACED" });
      await expect(verifyReceiptJournal(await chain([generation]), 2)).rejects.toMatchObject({ code: "JOURNAL_CHECKPOINT_MISPLACED" });
    });

    it("appends nothing to a broken chain, never throws, and keeps the lost receipt beside it", async () => {
      const root = await damaged((root) => rewrite(root, 11, (entry) => { entry.previous = "0".repeat(64); }));
      const before = await readdir(join(root, "000003"));
      const fallback = join(scratch, "uncertain.jsonl");
      const journal = new ReceiptJournal(root, { shardSize: 3, fallbackFile: fallback });
      const handle = journal.beginSend(crewSend("after the damage"));
      expect(handle.messageId).toMatch(/^firstmate-crew-steer-/);
      handle.settle("sent");
      await journal.settled();
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(await readdir(join(root, "000003"))).toEqual(before);
      const lost = (await readFile(fallback, "utf8")).trim().split("\n").map((line) => JSON.parse(line));
      expect(lost.map((entry) => entry.lost)).toEqual(["send-attempt", "send-result"]);
      expect(lost[0]).toMatchObject({ kind: "uncertainty", reason: "recording-failed", detail: { messageId: handle.messageId, channel: "crew-steer" } });
      expect(lost[0].error).toContain("JOURNAL_LINK_BROKEN");
    });
  });

  it("records a receipt it could not write as an uncertainty at the next append that succeeds", async () => {
    const root = join(scratch, "journal");
    // A file where the journal's directory should be: every write fails until it is gone.
    await writeFile(root, "in the way");
    const journal = new ReceiptJournal(root);
    const lost = journal.beginSend(crewSend("lost"));
    lost.settle("sent");
    await journal.settled();
    await rm(root);
    journal.beginSend(crewSend("kept")).settle("sent");
    await journal.settled();
    const entries = await readReceiptJournal(root);
    expect(kinds(entries)).toEqual(["checkpoint", "journal-start", "uncertainty", "uncertainty", "send-attempt", "send-result"]);
    expect(entries[2]!.event).toMatchObject({ lost: "send-attempt", detail: { messageId: lost.messageId, recipient: "crew-1" } });
    expect(entries[3]!.event).toMatchObject({ lost: "send-result", detail: { messageId: lost.messageId } });
  });
});

describe("the generation ledger", () => {
  it("attributes each receipt to the first mate of its time, noticing changes it did not make", async () => {
    const root = join(scratch, "journal");
    let mate = "";
    const journal = new ReceiptJournal(root, { shardSize: 4, currentMate: async () => mate });
    const send = (input: Partial<Parameters<ReceiptJournal["beginSend"]>[0]> = {}) => journal.beginSend({ ...crewSend("x"), ...input }).settle("sent");

    send(); // No first mate yet.
    mate = "mate-a";
    journal.record({ kind: "generation", change: "launch", agentId: "mate-a", previousAgentId: "" });
    send({ channel: "mate-opening", recipient: "mate-a", mateRecipient: true });
    send();
    mate = "mate-b"; // Changed outside the plugin's own lifecycle calls, as the role helper can.
    send();
    send({ channel: "watch-flush", recipient: "mate-a", mateRecipient: true }); // A late send to the old one is still its own.
    journal.record({ kind: "generation", change: "restart", agentId: "mate-c", previousAgentId: "mate-b" });
    mate = "mate-c";
    send();
    journal.record({ kind: "generation", change: "release", agentId: "", previousAgentId: "mate-c" });
    mate = "";
    send();
    await journal.settled();

    const entries = await readReceiptJournal(root, 4);
    const generations = entries.filter((entry) => entry.event.kind === "generation");
    expect(generations.map((entry) => entry.event)).toEqual([
      { kind: "generation", change: "launch", agentId: "mate-a", previousAgentId: "" },
      { kind: "generation", change: "observed", agentId: "mate-b", previousAgentId: "mate-a" },
      { kind: "generation", change: "restart", agentId: "mate-c", previousAgentId: "mate-b" },
      { kind: "generation", change: "release", agentId: "", previousAgentId: "mate-c" },
    ]);
    const seq = (agentId: string) => generations.find((entry) => (entry.event as { agentId: string }).agentId === agentId)!.sequence;
    const attempts = entries.flatMap((entry) => (entry.event.kind === "send-attempt" ? [entry.event.generation] : []));
    expect(attempts).toEqual([
      null,
      { agentId: "mate-a", sequence: seq("mate-a") },
      { agentId: "mate-a", sequence: seq("mate-a") },
      { agentId: "mate-b", sequence: seq("mate-b") },
      { agentId: "mate-a", sequence: seq("mate-a") },
      { agentId: "mate-c", sequence: seq("mate-c") },
      null,
    ]);

    // A later process reads only the newest shard, and its checkpoint still knows every first mate.
    const later = new ReceiptJournal(root, { shardSize: 4, currentMate: async () => "" });
    later.beginSend({ ...crewSend("y"), recipient: "mate-a", mateRecipient: true }).settle("sent");
    await later.settled();
    const after = await readReceiptJournal(root, 4);
    expect(after.filter((entry) => entry.event.kind === "generation")).toHaveLength(4);
    expect(after.filter((entry) => entry.event.kind === "send-attempt").at(-1)!.event).toMatchObject({ generation: { agentId: "mate-a", sequence: seq("mate-a") } });
  });
});

describe("the record ledger", () => {
  const home = () => join(scratch, "home");
  const records = async () => (await readReceiptJournal(receiptJournalRoot())).flatMap((entry) => (entry.event.kind === "record-revision" ? [entry.event] : []));

  it("is only the write while the switch is off", async () => {
    await mkdir(home(), { recursive: true });
    let wrote = 0;
    expect(await observedWrite({ absolute: join(home(), "a.md"), path: "a.md" }, newAction("test"), async () => { wrote++; return "done"; })).toBe("done");
    expect(wrote).toBe(1);
    await writeTextFile(home(), { path: "data/b.md", content: "b", expectedHash: null, force: false });
    await expect(readdir(join(scratch, "paseo"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("binds each write's before and after hashes to the action that made it", async () => {
    process.env[RECEIPT_JOURNAL_ENV] = "1";
    await mkdir(join(home(), "data"), { recursive: true });
    const save = newAction("files.save", "captain");
    await writeTextFile(home(), { path: "data/backlog.md", content: "one\n", expectedHash: null, force: false }, { origin: save });
    const opened = await readTextFile(home(), "data/backlog.md");
    await writeTextFile(home(), { path: "data/backlog.md", content: "two\n", expectedHash: opened.hash, force: false }, { origin: save });
    await writeTextFile(home(), { path: "data/backlog.md", content: "two\n", expectedHash: (await readTextFile(home(), "data/backlog.md")).hash, force: true }); // Unchanged: no revision.
    const removal = newAction("suggestion.remove", "captain");
    await replaceTextIfUnchanged(home(), "data/backlog.md", "two\n", "three\n", { origin: removal });
    await expect(replaceTextIfUnchanged(home(), "data/backlog.md", "stale\n", "four\n", { origin: removal })).rejects.toThrow("changed since it was read");
    await expect(observedWrite({ absolute: join(home(), "x"), path: "x" }, removal, async () => { throw new Error("disk full"); })).rejects.toThrow("disk full");
    await receiptJournal()!.settled();

    expect(await records()).toEqual([
      { kind: "record-revision", path: "data/backlog.md", before: "absent", after: sha256("one\n"), actionId: save.actionId, actor: "captain", reason: "files.save" },
      { kind: "record-revision", path: "data/backlog.md", before: sha256("one\n"), after: sha256("two\n"), actionId: save.actionId, actor: "captain", reason: "files.save" },
      { kind: "record-revision", path: "data/backlog.md", before: sha256("two\n"), after: sha256("three\n"), actionId: removal.actionId, actor: "captain", reason: "suggestion.remove" },
    ]);
  });

  it("leaves a prepared home byte for byte as it was, and records what preparing it changed", async () => {
    const config = FirstmateConfigSchema.parse({});
    const snapshot = async (root: string) => {
      const files: Record<string, string> = {};
      const walk = async (directory: string, prefix: string): Promise<void> => {
        for (const entry of await readdir(directory, { withFileTypes: true })) {
          if (entry.isDirectory()) await walk(join(directory, entry.name), `${prefix}${entry.name}/`);
          else files[`${prefix}${entry.name}`] = (await readFile(join(directory, entry.name), "utf8")).replaceAll(root, "<home>").replaceAll(JSON.stringify(root).slice(1, -1), "<home>");
        }
      };
      await walk(root, "");
      return files;
    };
    const off = join(scratch, "home-off");
    await prepareHome(off, config);
    process.env[RECEIPT_JOURNAL_ENV] = "1";
    const on = join(scratch, "home-on");
    await prepareHome(on, config);
    await receiptJournal()!.settled();
    expect(await snapshot(on)).toEqual(await snapshot(off));

    const first = await records();
    expect(first.length).toBeGreaterThan(5);
    expect(new Set(first.map((record) => record.actionId)).size).toBe(1);
    expect(first.find((record) => record.path === "data/backlog.md")).toMatchObject({ before: "absent", actor: "plugin", reason: "prepare-home" });
    expect(first.find((record) => record.path === "AGENTS.md")).toMatchObject({ before: "absent", after: sha256(await readFile(join(on, "AGENTS.md"))) });

    // A second preparation changes nothing, so it records nothing; the captain's edit is theirs, not the plugin's.
    await appendFile(join(on, "data", "captain.md"), "\nAlways use pnpm.\n");
    await prepareHome(on, config);
    await receiptJournal()!.settled();
    expect(await records()).toHaveLength(first.length);
  });
});
