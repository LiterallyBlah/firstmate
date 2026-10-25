/** Bounded failure observations for named Windows CI cases. Inert unless FIRSTMATE_CI_DIAGNOSTICS names a capture
 * directory (the CI check job sets it; local runs write nothing). Observations never change an assertion, a
 * deadline, a fixture home or concurrency. Every write is accounted in serialized UTF-8 bytes before it happens,
 * under a per-process ledger; snapshots read at most a bounded number of entries and bytes. Ported from the
 * reviewed S04 diagnostic library (data/fm-ss-s04-prep/diagnostic-correction-evidence-v3).
 */
import { createHash } from "node:crypto";
import { closeSync, mkdirSync, opendirSync, openSync, readFileSync, readSync, statSync, writeFileSync } from "node:fs";
import { availableParallelism } from "node:os";
import { join, resolve } from "node:path";

const root = process.env.FIRSTMATE_CI_DIAGNOSTICS ? resolve(process.env.FIRSTMATE_CI_DIAGNOSTICS) : null;
export const diagnosticsEnabled = root !== null;
const utf8 = (text: string) => Buffer.byteLength(text, "utf8");
const MIN_RECORD = 256, BUDGET = 4 * 1024 * 1024, SUMMARY_RESERVE = 4096;

/** Serialized UTF-8 bytes <= room; over budget, a JSON-text prefix inside an explicit truncation wrapper. */
export function serializeBounded(value: unknown, room: number): { text: string; bytes: number; truncated: boolean; originalBytes: number } | null {
  const full = JSON.stringify(value) ?? "null", originalBytes = utf8(full);
  if (originalBytes <= room) return { text: full, bytes: originalBytes, truncated: false, originalBytes };
  const wrap = (n: number) => { let head = full.slice(0, n); if (/[\ud800-\udbff]$/.test(head)) head = head.slice(0, -1);
    return JSON.stringify({ truncated: true, originalBytes, keptChars: head.length, head }); };
  if (room < MIN_RECORD || utf8(wrap(0)) > room) return null;
  let lo = 0, hi = full.length;
  while (lo < hi) { const mid = Math.ceil((lo + hi) / 2); if (utf8(wrap(mid)) <= room) lo = mid; else hi = mid - 1; }
  const text = wrap(lo);
  return { text, bytes: utf8(text), truncated: true, originalBytes };
}

let used = 0, sequence = 0;
const refused: string[] = [], records: { name: string; bytes: number; truncated: boolean }[] = [];
/** One bounded record per call; nothing is written after the ledger is exhausted. */
export function capture(name: string, value: unknown): boolean {
  if (!root) return false;
  const out = serializeBounded(value, BUDGET - SUMMARY_RESERVE - used);
  if (!out) { if (refused.length < 64) refused.push(name); return false; }
  mkdirSync(root, { recursive: true });
  writeFileSync(join(root, `${name}-${process.pid}-${++sequence}.json`), out.text, { flag: "wx" });
  used += out.bytes; records.push({ name, bytes: out.bytes, truncated: out.truncated });
  return true;
}
let identityWritten = false;
/** Runtime, dependency and concurrency identity, once per worker process. */
export function captureIdentity(): void {
  if (!root || identityWritten) return;
  identityWritten = true;
  let lockfileSha256: string | null = null, vitest: string | null = null;
  try { lockfileSha256 = createHash("sha256").update(readFileSync("package-lock.json")).digest("hex"); } catch { /* recorded as null */ }
  try { vitest = (JSON.parse(readFileSync("node_modules/vitest/package.json", "utf8")) as { version?: string }).version ?? null; } catch { /* null */ }
  const parallelism = availableParallelism();
  capture("identity", { node: process.version, execPath: process.execPath, platform: process.platform, arch: process.arch, vitest, lockfileSha256,
    availableParallelism: parallelism, vitestDefaultMaxWorkers: Math.max(parallelism - 1, 1), poolId: process.env.VITEST_POOL_ID ?? null,
    workerId: process.env.VITEST_WORKER_ID ?? null, githubSha: process.env.GITHUB_SHA ?? null, githubRef: process.env.GITHUB_REF ?? null,
    runnerOs: process.env.RUNNER_OS ?? null, runId: process.env.GITHUB_RUN_ID ?? null });
}
/** Identity, then the ledger summary for this process (bounded by its own reserve). Called from afterAll, outside timed paths. */
export function captureLedger(label: string): void {
  if (!root) return;
  captureIdentity();
  const out = serializeBounded({ label, budget: BUDGET, used, records: records.slice(0, 32), recordsOmitted: Math.max(0, records.length - 32), refused }, SUMMARY_RESERVE);
  if (out) { mkdirSync(root, { recursive: true }); writeFileSync(join(root, `${label}.ledger-${process.pid}.json`), out.text, { flag: "wx" }); }
}

/** Phases kept in memory (no I/O in the measured path), flushed once by the caller. */
export function phaseRecorder(limit = 64) {
  const phases: { label: string; ms: number }[] = []; let t0 = performance.now();
  return { start() { phases.length = 0; t0 = performance.now(); },
    mark(label: string) { if (phases.length < limit) phases.push({ label, ms: performance.now() - t0 }); },
    flush(name: string, extra: Record<string, unknown> = {}) { if (phases.length) capture(name, { phases, last: phases.at(-1), totalMs: performance.now() - t0, ...extra }); phases.length = 0; } };
}

/** Physically bounded read: at most max + 1 bytes; `over` proves excess without reading further. */
function readBounded(path: string, max: number): { text: string; over: boolean } {
  const fd = openSync(path, "r"), buffer = Buffer.alloc(max + 1);
  try { let n = 0; while (n < buffer.length) { const r = readSync(fd, buffer, n, buffer.length - n, null); if (!r) break; n += r; }
    return { text: buffer.subarray(0, Math.min(n, max)).toString("utf8"), over: n > max }; }
  finally { closeSync(fd); }
}
export function boundedText(path: string, max = 262144): string | { missing: true } | { overLimit: true; limitBytes: number } | { error: string } {
  try { const r = readBounded(path, max); return r.over ? { overLimit: true, limitBytes: max } : r.text; }
  catch (e) { return (e as { code?: string }).code === "ENOENT" ? { missing: true } : { error: String(e).slice(0, 300) }; }
}
/** Bounded snapshot: a global entry budget across recursion, bounded enumeration, and actual returned-byte limits. */
export function boundedTree(path: string, { maxEntries = 200, maxDepth = 4, maxFileBytes = 65536, maxTotalBytes = 2 * 1024 * 1024 } = {}) {
  const counters = { visited: 0, omittedEntries: 0, dirsCut: 0, omittedDepth: 0, unreadFiles: 0, overLimitReads: 0, textBytes: 0, errors: 0 };
  let missing = false;
  const list = (p: string, limit: number) => { const dir = opendirSync(p), names: string[] = [];
    try { for (let e = dir.readSync(); e && names.length < limit; e = dir.readSync()) names.push(e.name); } finally { dir.closeSync(); } return names; };
  const walk = (p: string, depth: number): unknown => {
    const remaining = Math.max(0, maxEntries - counters.visited);
    let names: string[];
    try { names = list(p, remaining + 1); }
    catch (error) { if (depth === 0 && (error as { code?: string }).code === "ENOENT") { missing = true; return []; } counters.errors++; return { error: String(error).slice(0, 300) }; }
    if (names.length > remaining) { counters.dirsCut++; names = names.slice(0, remaining); }
    const kept: unknown[] = [], sorted = names.sort();
    for (let i = 0; i < sorted.length; i++) {
      if (counters.visited >= maxEntries) { counters.omittedEntries += sorted.length - i; break; }
      const name = sorted[i]!, full = join(p, name);
      counters.visited++;
      let info;
      try { const s = statSync(full); info = { dir: s.isDirectory(), size: s.size }; } catch (error) { counters.errors++; kept.push({ name, error: String(error).slice(0, 300) }); continue; }
      if (info.dir) { if (depth >= maxDepth) { counters.omittedDepth++; kept.push({ name, dir: true, omitted: "depth" }); } else kept.push({ name, dir: true, children: walk(full, depth + 1) }); continue; }
      const allowance = Math.min(maxFileBytes, maxTotalBytes - counters.textBytes);
      if (!(info.size <= allowance)) { counters.unreadFiles++; kept.push({ name, bytes: info.size, text: null }); continue; }
      let r;
      try { r = readBounded(full, allowance); } catch (error) { counters.errors++; kept.push({ name, bytes: info.size, text: null, error: String(error).slice(0, 300) }); continue; }
      if (r.over || utf8(r.text) > allowance) { counters.overLimitReads++; kept.push({ name, bytes: info.size, text: null, refused: "over-limit" }); continue; }
      counters.textBytes += utf8(r.text); kept.push({ name, bytes: info.size, text: r.text });
    }
    return kept;
  };
  const tree = walk(path, 0);
  return { tree, missing, ...counters, limits: { maxEntries, maxDepth, maxFileBytes, maxTotalBytes } };
}
/** Times one awaited operation and records its outcome; returns its value or rethrows its original error unchanged. */
export async function observed<T>(name: string, extra: Record<string, unknown>, work: Promise<T>): Promise<T> {
  const start = performance.now();
  try { const value = await work; capture(name, { ...extra, ms: performance.now() - start, ok: true }); return value; }
  catch (error) {
    capture(name, { ...extra, ms: performance.now() - start, ok: false, code: (error as { code?: unknown }).code ?? null, error: String((error as Error)?.message ?? error).slice(0, 1024) });
    throw error;
  }
}
