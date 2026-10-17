import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, readdir, rm, symlink, utimes, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FirstmateConfigSchema } from "../shared/fleet";
import { prepareHome } from "./home";
import { readTemplate, TEMPLATES } from "./templates";

vi.setConfig({ testTimeout: 30000, hookTimeout: 30000 });
const execute = promisify(execFile);
const hash = (text: string) => createHash("sha256").update(text).digest("hex");
const stamp = "2026-10-17T10:00:00.000Z";
let scratch: string, home: string;
async function put(path: string, text: string | Buffer) {
  const target = join(home, path);
  await mkdir(resolve(target, ".."), { recursive: true });
  await writeFile(target, text);
  await utimes(target, new Date(stamp), new Date(stamp));
}
async function run(...args: string[]) {
  const result = await execute(process.execPath, [join(home, "tools/recall.mjs"), ...args], {
    cwd: scratch, env: { ...process.env, FIRSTMATE_HOME: join(scratch, "decoy"), PASEO_HOME: join(scratch, "daemon") },
    windowsHide: true, timeout: 25000, maxBuffer: 8 * 1024 * 1024,
  });
  return { ...result, value: JSON.parse(result.stdout) };
}
const rebuild = () => run("rebuild");
const catalog = async (): Promise<any[]> => (await readFile(join(home, "recall/catalog.jsonl"), "utf8")).trim().split("\n").filter(Boolean).map(line => JSON.parse(line));
const find = async (query: string) => (await run("search", query)).value;
beforeEach(async () => {
  const local = resolve(".local"); await mkdir(local, { recursive: true });
  scratch = await mkdtemp(join(local, "recall-test-")); home = join(scratch, "home");
  await put("tools/recall.mjs", await readTemplate(TEMPLATES.recallHelper));
  await put("data/task/brief.md", "# Brief\r\n\r\n## 2026-10-16 Rendering\r\nUse café pixels for the mast.\r\n");
  await put("recall/backlog/2026-10-17T0900.md", "## In flight\n- [ ] task — Mast (project: firstmate) (note: pending a branch)\n## Done\n- [x] rolled — Old outcome (project: firstmate) (note: shipped abc1234)\n");
});
afterEach(async () => { await rm(scratch, { recursive: true, force: true }); });

describe("optional record recall", () => {
  it("packages the helper and guide without building an index, snapshots or another watch", async () => {
    const installed = join(scratch, "installed");
    await prepareHome(installed, FirstmateConfigSchema.parse({}));
    expect(await readFile(join(installed, "tools/recall.mjs"), "utf8")).toBe(await readTemplate(TEMPLATES.recallHelper));
    expect(await readFile(join(installed, "data/recall.md"), "utf8")).toContain("adoption pending");
    await expect(readdir(join(installed, "recall"))).rejects.toMatchObject({ code: "ENOENT" });
    expect(await readdir(join(installed, "watches"))).not.toContain("launch-metrics.mjs");
  });

  it("rebuilds byte-identically with stable IDs, exact source/unit digests and explicit metadata", async () => {
    await rebuild(); const before = await readFile(join(home, "recall/catalog.jsonl"), "utf8");
    expect((await rebuild()).value.snapshotsCreated).toBe(0);
    expect(await readFile(join(home, "recall/catalog.jsonl"), "utf8")).toBe(before);
    const rows = await catalog(), unit = rows.find(r => r.title === "2026-10-16 Rendering");
    expect(unit).toMatchObject({ kind: "brief", task: "task", project: "firstmate", date: "2026-10-16", dateBasis: "entry-date", path: "data/task/brief.md", anchor: "L3-L4" });
    expect(unit.sha256).toBe(hash("## 2026-10-16 Rendering\r\nUse café pixels for the mast.\r\n"));
    expect(unit.sources).toEqual([{ path: "data/task/brief.md", sha256: hash(await readFile(join(home, "data/task/brief.md"), "utf8")) }]);
    expect(unit.projectSource).toMatchObject({ path: "recall/backlog/2026-10-17T0900.md", anchor: "L2-L2" });
    expect(rows.every(r => r.description.length <= 200 && r.id.length === 24)).toBe(true);
    expect((await run("show", unit.id)).value).toMatchObject({ text: "## 2026-10-16 Rendering\r\nUse café pixels for the mast.\r\n", truncated: false });
  });

  it("keeps all backlog lines as dated history, including rolled-off outcomes, and leaves snapshots untouched", async () => {
    await put("data/backlog.md", "## Done\n- [x] newer — Current item\n");
    const bytes = await readFile(join(home, "recall/backlog/2026-10-17T0900.md"));
    await rebuild();
    const result = await find("rolled"), hit = result.hits[0];
    expect(hit).toMatchObject({ kind: "ledger-history", task: "rolled", dateBasis: "snapshot-filename-UTC", date: "2026-10-17T09:00:00.000Z" });
    expect(hit.warning).toBe("history as of 2026-10-17T09:00:00.000Z — check Paseo and the backlog for now");
    expect(hit.commitWarning).toContain("data/learnings.md");
    expect(result.historyGap).toContain("before 2026-10-17T09:00:00.000Z");
    expect((await catalog()).filter(r => r.kind === "ledger-history")).toHaveLength(2);
    expect((await find("task")).hits.some((r: any) => r.kind === "ledger-history")).toBe(true);
    expect(await readdir(join(home, "recall/backlog"))).toEqual(["2026-10-17T0900.md"]);
    expect(await readFile(join(home, "recall/backlog/2026-10-17T0900.md"))).toEqual(bytes);
    expect(await readFile(join(home, "data/backlog.md"), "utf8")).toContain("newer");
  });

  it("labels policy, dated learnings, status and handoff excerpts without granting current authority", async () => {
    await put("data/captain.md", "# Orders\n- 2026-10-10: mastword landing only for release blue\n  Deploy still needs GO.\n- 2026-10-12: mastword blue superseded by green\n");
    await put("data/learnings.md", "# Learnings\n- 2026-10-11: mastword notebook\n  - A continued nested detail\n- 2026-10-12: separate lesson\n## 2026-10-13 mastword installation\nRecorded install only.\n");
    await put("data/handoffs/old.md", "# mastword handoff\nQuoted conversation excerpt\n");
    await put("data/task/status-report.md", "# mastword status\nWas ready at that time.\n");
    await put("data/handover-2026-10-17.md", "# Historical mastword handover\nAn excerpt.\n");
    await put("data/status.md", "# Historical mastword status\nA root status report.\n");
    await rebuild(); const rows = await catalog();
    expect(rows.filter(r => r.kind === "policy")).toHaveLength(2);
    expect(rows.filter(r => r.kind === "learning")).toHaveLength(3);
    expect(rows.filter(r => r.kind === "handoff")).toHaveLength(4);
    expect(rows.find(r => r.path === "data/handoffs/old.md")).toMatchObject({ task: null, project: null, date: stamp, dateBasis: "source-mtime" });
    const result = await find("mastword");
    expect(result.notice).toContain("grants no authority");
    expect(result.privacy).toContain("model provider");
    expect(result.hits.every((hit: any) => hit.warning.startsWith("history as of "))).toBe(true);
  });

  it("omits changed/deleted sources, refuses their old IDs and drops them on rebuild", async () => {
    await rebuild(); const old = (await catalog()).filter(r => r.path === "data/task/brief.md");
    const before = await readFile(join(home, "recall/catalog.jsonl"), "utf8");
    await put("data/task/brief.md", "# Entirely different\nreplacement-only\n");
    expect(await find("café")).toMatchObject({ staleOmitted: 2, hits: [] });
    await expect(run("show", old[1].id)).rejects.toMatchObject({ stderr: expect.stringContaining("source-stale-or-deleted") });
    expect(await readFile(join(home, "recall/catalog.jsonl"), "utf8")).toBe(before);
    await rm(join(home, "data/task/brief.md"));
    expect((await find("café")).hits).toEqual([]);
    await rebuild(); expect((await catalog()).some(r => r.path === "data/task/brief.md")).toBe(false);
  });

  it("pairs real item-thread message/reply files, handles missing/changed replies and keeps identity metadata", async () => {
    const key = JSON.stringify(["task", ["local"], "firstmate", "task"]), base = `data/item-threads/${hash(key)}`;
    const thread = { key, title: "Discussion", messages: [{ id: "msg1", kind: "discuss", text: "mastword question", createdAt: stamp, delivery: "uncertain", reply: "IGNORED stored projection" }] };
    await put(`${base}/thread.json`, JSON.stringify(thread));
    await rebuild(); let row = (await catalog()).find(r => r.kind === "thread");
    expect(row).toMatchObject({ task: "task", project: "firstmate", anchor: "message:msg1", date: stamp, dateBasis: "message-createdAt" });
    expect(JSON.parse((await run("show", row.id)).value.text)).toEqual({ message: "mastword question", delivery: "uncertain", reply: null });
    await put(`${base}/msg1.reply.md`, "The mastword answer");
    expect((await find("mastword")).hits).toEqual([]); // Arrival invalidates the formerly absent reply.
    await rebuild(); row = (await catalog()).find(r => r.kind === "thread");
    expect(row.sources).toHaveLength(2);
    expect(JSON.parse((await run("show", row.id)).value.text).reply).toBe("The mastword answer");
    await rm(join(home, base, "msg1.reply.md"));
    await expect(run("show", row.id)).rejects.toMatchObject({ stderr: expect.stringContaining("source-stale-or-deleted") });
  });

  it("bounds search and show JSON including escaping and truncation; hashes cover full units", async () => {
    for (let i = 0; i < 25; i++) await put(`data/sample-${i}/report.md`, `# needle${i} needle\n${'"\\ café '.repeat(600)}\n`);
    await rebuild(); const result = await run("search", "needle");
    expect(result.stdout.length).toBeLessThanOrEqual(4000);
    expect(result.value.hits.length).toBeGreaterThan(0);
    expect(result.value.hits.length).toBeLessThanOrEqual(8);
    const show = await run("show", result.value.hits[0].id);
    expect(show.stdout.length).toBeLessThanOrEqual(4000);
    expect(show.value.truncated).toBe(true);
    expect(show.value.sha256).not.toBe(hash(show.value.text));
    expect(await find("zzunfindablefictionzz")).toMatchObject({ hits: [] });
  });

  it("ranks exact rare terms deterministically and ignores headings inside code fences", async () => {
    await put("data/task/report.md", "# Zebrastone\nThe zebrastone repair.\n```md\n## Not a section\n```\n## Common\nrepair\n");
    await rebuild(); const a = await run("search", "zebrastone repair"), b = await run("search", "zebrastone repair");
    expect(a.stdout).toBe(b.stdout);
    expect(a.value.hits[0].title).toBe("Zebrastone");
    expect((await catalog()).some(r => r.title === "Not a section")).toBe(false);
  });

  it("reads baseline same-minute snapshot suffixes and collapses identical history hits without deleting catalog rows", async () => {
    const text = "## Done\n- [x] repeated — original (project: firstmate)\n";
    await put("recall/backlog/2026-10-17T1000.md", text);
    await put(`recall/backlog/2026-10-17T1000-${hash(text + "\n")}.md`, text + "\n");
    await rebuild();
    expect((await catalog()).filter(r => r.task === "repeated")).toHaveLength(2);
    expect((await find("repeated")).hits).toHaveLength(1);
    await put(`recall/backlog/2026-10-17T1001-${"a".repeat(64)}.md`, text);
    await expect(rebuild()).rejects.toMatchObject({ stderr: expect.stringContaining("snapshot-digest-mismatch") });
  });

  it("keeps private fixtures, nested probes, arbitrary JSON and outside-home decoys out of the corpus", async () => {
    const privatePaths = ["data/task/evidence/probes.md", "data/task/probes.md", "data/task/evaluation-protocol.md", "data/task/launches/1.json",
      "data/metrics/private.md", "data/remote-action-receipts/private.md", "data/.hidden/report.md", "projects/private.md", "uploads/private.md",
      "logs/private.md", "data/projects.md", "data/remote-hosts.json", "data/watch-requests/private.md", "data/status-probes.md",
      "data/evidence/report.md", "data/task/.private.md"];
    for (const path of privatePaths) await put(path, "PRIVATE_SENTINEL synthetic fixture, never an actual home record");
    const outside = join(scratch, "decoy"); await mkdir(outside); await writeFile(join(outside, "sentinel"), "untouched");
    await rebuild(); expect((await find("PRIVATE_SENTINEL")).hits).toEqual([]);
    expect(await readFile(join(home, "recall/catalog.jsonl"), "utf8")).not.toContain("PRIVATE_SENTINEL");
    for (const path of privatePaths) expect(await readFile(join(home, path), "utf8")).toContain("PRIVATE_SENTINEL");
    expect(await readdir(outside)).toEqual(["sentinel"]);
    await expect(run("show", "../../decoy/sentinel")).rejects.toMatchObject({ stderr: expect.stringContaining("invalid-id") });
  });

  it("refuses linked output/source directories and never touches their targets", async () => {
    const outside = join(scratch, "outside"); await mkdir(outside); await writeFile(join(outside, "sentinel"), "untouched");
    await symlink(outside, join(home, "data/linktask"), process.platform === "win32" ? "junction" : "dir");
    await rebuild(); // Directory enumeration never follows junctions/symlinks.
    await rm(join(home, "recall/catalog.jsonl"));
    await symlink(outside, join(home, "recall/catalog.jsonl"), process.platform === "win32" ? "junction" : "dir");
    await expect(rebuild()).rejects.toMatchObject({ stderr: expect.stringContaining("linked-path-refused") });
    expect(await readdir(outside)).toEqual(["sentinel"]);
  });

  it("fails closed on invalid UTF-8, oversize inputs and corrupt catalogs without replacing a valid catalog", async () => {
    await rebuild(); const before = await readFile(join(home, "recall/catalog.jsonl"), "utf8");
    await put("data/task/bad.md", Buffer.from([0xff])); await expect(rebuild()).rejects.toMatchObject({ code: 1 });
    expect(await readFile(join(home, "recall/catalog.jsonl"), "utf8")).toBe(before);
    await put("data/task/bad.md", Buffer.alloc(2 * 1024 * 1024 + 1, 65));
    await expect(rebuild()).rejects.toMatchObject({ stderr: expect.stringContaining("source-size-or-type-refused") });
    await rm(join(home, "data/task/bad.md"));
    await writeFile(join(home, "recall/catalog.jsonl"), before.trimEnd());
    await expect(run("search", "mast")).rejects.toMatchObject({ stderr: expect.stringContaining("incomplete-catalog") });
  });

  it("states the pre-snapshot gap and refuses an existing rebuild lock without breaking it", async () => {
    await rm(join(home, "recall/backlog"), { recursive: true });
    expect((await rebuild()).value.historyGap).toContain("No backlog snapshots indexed");
    const before = await readFile(join(home, "recall/catalog.jsonl"), "utf8");
    await put("recall/rebuild.lock", String(process.pid));
    await expect(rebuild()).rejects.toMatchObject({ stderr: expect.stringContaining("rebuild-locked") });
    expect(await readFile(join(home, "recall/rebuild.lock"), "utf8")).toBe(String(process.pid));
    expect(await readFile(join(home, "recall/catalog.jsonl"), "utf8")).toBe(before);
  });

  it("supports ordinary Unicode/spaced Markdown names and stable project provenance across agreeing snapshots", async () => {
    await put("data/task/café notes.md", "# Sailcloth\nA source with a spaced Unicode filename.\n");
    await rebuild();
    const row = (await catalog()).find(r => r.path === "data/task/café notes.md");
    await put("recall/backlog/2026-10-17T1000.md", "## In flight\n- [ ] task — Mast (project: firstmate) (note: still pending)\n");
    const result = await find("Sailcloth");
    expect(result.hits[0]).toMatchObject({ id: row.id, project: "firstmate", projectSource: { path: "recall/backlog/2026-10-17T0900.md" } });
    expect(result.staleOmitted).toBe(0);
  });
});
