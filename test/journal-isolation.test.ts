import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { fileURLToPath, URL } from "node:url";
import { promisify } from "node:util";
import { expect, it } from "vitest";

import { writeTextFile } from "../server/files";
import { readReceiptJournal, receiptJournal, receiptJournalRoot, recordGeneration } from "../server/receipts";

// Capture at import time: a beforeEach hook would be too late for module-level work.
const importedHome = process.env.PASEO_HOME;
const importedSwitch = process.env.FIRSTMATE_RECEIPT_JOURNAL;
const importedJournalRoot = receiptJournalRoot();

it("keeps receipt writes in a disposable home", async () => {
  expect(importedSwitch).toBe("0");
  expect(importedHome).toBeDefined();
  expect(dirname(importedHome!)).toBe(tmpdir());
  expect(basename(importedHome!)).toMatch(/^firstmate-tests-/);
  expect(importedJournalRoot).toBe(join(importedHome!, "plugin-data", "firstmate", "receipts"));
  expect(receiptJournal()).toBeNull();

  const home = join(importedHome!, "home");
  await mkdir(home);
  const save = (content: string) => writeTextFile(home, {
    path: "probe.md", content, expectedModifiedMs: null, force: true,
  });
  await save("journal off");
  recordGeneration("adopt", "mate", "");
  await expect(stat(importedJournalRoot)).rejects.toMatchObject({ code: "ENOENT" });

  // Even explicit opt-in stays inside the setup's temporary home. Exercise both
  // file receipts and fake mate generations, the paths that polluted the daemon.
  process.env.FIRSTMATE_RECEIPT_JOURNAL = "1";
  const journal = receiptJournal()!;
  try {
    await save("journal on");
    recordGeneration("adopt", "replacement", "mate");
    await journal.settled();
    const entries = await readReceiptJournal(importedJournalRoot);
    expect(entries.map((entry) => entry.event.kind)).toContain("record-revision");
    expect(entries.map((entry) => entry.event)).toContainEqual({
      kind: "generation", change: "adopt", agentId: "replacement", previousAgentId: "mate",
    });
  } finally {
    await journal.settled();
    process.env.FIRSTMATE_RECEIPT_JOURNAL = "0";
  }
});

async function snapshot(root: string) {
  return Promise.all(["", ...(await readdir(root, { recursive: true })).sort()].map(async (path) => {
    const absolute = join(root, path);
    const info = await stat(absolute);
    return { path, modified: info.mtimeMs, content: info.isFile() ? (await readFile(absolute)).toString("base64") : null };
  }));
}

it("leaves the inherited journal untouched when the test runner starts with journaling enabled", async () => {
  // A stand-in for the live daemon; this regression must never use the real one.
  const scratch = await mkdtemp(join(tmpdir(), "firstmate-ambient-"));
  const ambientHome = join(scratch, "home");
  try {
    const plugin = join(ambientHome, "plugin-data", "firstmate");
    const journal = join(plugin, "receipts");
    await mkdir(journal, { recursive: true });
    await writeFile(join(journal, "sentinel"), "existing journal must not change\n");
    await writeFile(join(plugin, "receipt-uncertainties.jsonl"), "existing uncertainties\n");
    const before = await snapshot(ambientHome);
    const vitest = join(dirname(fileURLToPath(import.meta.resolve("vitest/package.json"))), "vitest.mjs");
    const report = join(scratch, "report.json");
    await promisify(execFile)(process.execPath, [
      vitest, "run", "test/journal-isolation.test.ts", "--maxWorkers=1", "--reporter=json",
      "--outputFile", report,
      "--testNamePattern=^keeps receipt writes in a disposable home$",
    ], {
      cwd: fileURLToPath(new URL("../", import.meta.url)),
      env: { ...process.env, FIRSTMATE_RECEIPT_JOURNAL: "1", PASEO_HOME: ambientHome },
      windowsHide: true,
      timeout: 30_000,
    });
    // A renamed filter must fail the guard rather than silently skip the probe.
    expect(JSON.parse(await readFile(report, "utf8")).numPassedTests).toBe(1);
    expect(await snapshot(ambientHome)).toEqual(before);
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
}, 40_000);
