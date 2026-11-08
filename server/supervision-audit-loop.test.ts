import { randomUUID } from "node:crypto";
import { cp, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { SupervisionStore, canonicalProjectionBytes } from "./supervision-store";
import { canonical } from "./submissions";
import { SupervisionEvents } from "./supervision-events";
import { scope } from "../test/supervision-fixture";

// The recovery heartbeat on a journal that keeps growing: the workflow clock's own inbox writes
// land between beats, so the warm-read fingerprint always moves. Before the fix every such beat
// paid a full historical replay (~150 s at 17k events on the owner's journal).
let root: string, home: string, store: SupervisionStore, events: SupervisionEvents, now: number;
const processIdentity = async () => ({ state: "alive" as const, start: "isolated-fixture-process" });
const page = (n: number) => join(store.root, "transactions", String(n).padStart(12, "0"));
const file = (sequence: number, suffix: string) => join(store.root, "transactions",
  ...(sequence > 256 ? [String(Math.floor((sequence - 1) / 256)).padStart(12, "0")] : []), `${String(sequence).padStart(12, "0")}.${suffix}.json`);
const scanFull = () => vi.spyOn(store as unknown as { scanFull: () => Promise<unknown> }, "scanFull");
const beat = async () => { now += 60_000; return store.recoveryPass("heartbeat", async status => status); };
/** One routine inbox write, as the live clock commits between beats: a catalog source flips between
 * a late successful read (coverage unknown) and a fetch-failed gap. */
let flip = 0;
async function inboxWrite() {
  const agent = `worker-${flip % 4}`;
  if (Math.floor(flip++ / 4) % 2) await events.recordGap("catalog", agent, null, ["fetch-failed"]);
  else await events.admit({ agentId: agent, kind: "catalog", turnId: null, outcome: null, permissionId: null, sourceKind: "catalog",
    sourceKey: agent, epoch: null, cursor: null, maxSeq: null, gaps: [], coverage: "unknown", payload: { status: "idle" } });
}
async function grow(count: number) {
  const owners = Array.from({ length: 4 }, () => ({ id: randomUUID(), version: 0 }));
  for (let n = 0; n < count; n++) {
    const owner = owners[n % owners.length]!, value = { ...scope(store.homeId), kind: "project" as const, id: owner.id, version: ++owner.version };
    await store.transact([{ kind: "scope", id: owner.id, version: owner.version - 1 }], randomUUID(), [{ kind: "scope", value }]);
  }
}
// One 600-transaction journal (two full pages and part of a third), copied for each test.
let template: string;
const open = async (from: string) => {
  root = join(process.env.PASEO_HOME!, randomUUID()); home = join(from, "home"); // Same home: same journal namespace.
  await cp(from, root, { recursive: true });
  store = new SupervisionStore(root, home, { writable: true, processIdentity });
  await store.acquireCoordinator(); events = new SupervisionEvents(store);
};
beforeAll(async () => {
  template = join(process.env.PASEO_HOME!, randomUUID()); root = template; home = join(root, "home");
  store = new SupervisionStore(root, home, { writable: true, processIdentity });
  await store.initialize(); await store.acquireCoordinator(); await store.enableLongLived();
  await grow(600); await store.releaseCoordinator();
}, 300_000);
beforeEach(async () => {
  await open(template);
  now = Date.now(); vi.spyOn(Date, "now").mockImplementation(() => now);
}, 120_000);
afterEach(() => { vi.restoreAllMocks(); });

describe("recovery heartbeat audit on a growing journal", { timeout: 120_000 }, () => {
  it("audits only what each beat appended; full replays only at start, the hourly backstop and restart", async () => {
    expect((await beat()).freshness).toBe("current"); // First beat: full audit.
    const scan = scanFull();
    for (let n = 0; n < 59; n++) {
      await inboxWrite(); await inboxWrite();
      const status = await beat();
      expect(status.freshness).toBe("current"); expect(status.sequence).toBe((await store.read()).sequence);
    }
    expect(scan, "a growing journal replayed full history on a routine beat").not.toHaveBeenCalled();
    expect(store.auditCounts).toMatchObject({ full: 1, incremental: 59 });
    await inboxWrite(); now += 60 * 60_000; await beat();
    expect(scan).toHaveBeenCalledTimes(1); expect(store.auditCounts.full).toBe(2);
    await store.recoveryPass("restart", async status => status); expect(scan).toHaveBeenCalledTimes(2);
  });
  it("crosses a page boundary incrementally and still pins the page it closed", async () => {
    await beat(); // Head 600 (+ coordinator claims), inside page 2.
    await grow(200); expect((await beat()).freshness).toBe("current"); // Page 2 closes, page 3 opens.
    expect(store.auditCounts).toMatchObject({ full: 1, incremental: 1 });
    const event = file(700, "event"), bytes = await readFile(event, "utf8");
    // In place edits never change a full page's directory; rename-over does.
    await writeFile(`${event}.swap`, bytes.replace(/"requestId":"[^"]+"/, `"requestId":"${randomUUID()}"`)); await rename(`${event}.swap`, event);
    await grow(1); expect((await beat()).freshness).toBe("held");
    expect(store.auditCounts.full).toBe(2);
  });
  it("an unchanged beat stays free, and a recovery action forces only the incremental audit", async () => {
    await beat();
    const scan = scanFull();
    expect((await beat()).freshness).toBe("current"); expect(store.auditCounts.unchanged).toBe(1);
    await store.recoveryPass("heartbeat", async () => { await Promise.all([store.audit(), store.auditRecoveryAction()]); });
    expect(scan).not.toHaveBeenCalled(); expect(store.auditCounts.incremental).toBe(1);
    await store.audit(); expect(scan).toHaveBeenCalledTimes(1); // An explicit audit outside a pass is always full.
  }, 120_000);
});

it("sizes the projection exactly as its whole canonical text, across writes", async () => {
  type Sized = { frames: Map<string, unknown>; ownership: unknown[]; transactions: unknown[] };
  const scanOf = () => (store as unknown as { cached: { scan: Sized } }).cached.scan;
  const whole = (scan: Sized, history: boolean) => Buffer.byteLength(canonical({ frames: [...scan.frames], ownership: scan.ownership,
    ...(history ? { historyIndex: scan.transactions } : {}) }));
  for (let n = 0; n < 6; n++) {
    await inboxWrite(); await store.read();
    const scan = scanOf();
    for (const history of [true, false]) expect(canonicalProjectionBytes(scan.frames, scan.ownership, history ? scan.transactions : null)).toBe(whole(scan, history));
  }
  expect(canonicalProjectionBytes(new Map(), [], [])).toBe(Buffer.byteLength(canonical({ frames: [], ownership: [], historyIndex: [] })));
  expect(canonicalProjectionBytes(new Map([["ké", { v: "☃" }]]), [{ a: 1 }], null)).toBe(Buffer.byteLength(canonical({ frames: [["ké", { v: "☃" }]], ownership: [{ a: 1 }] })));
}, 120_000);

describe("the incremental audit still catches a damaged journal", { timeout: 120_000 }, () => {
  beforeEach(async () => { await beat(); await inboxWrite(); }, 120_000);
  const held = async () => { const status = await beat(); expect(status.freshness).toBe("held"); expect(store.auditCounts.full).toBe(2); return status; };
  it("tampered: a closed page's event replaced", async () => {
    const event = file(400, "event"), bytes = await readFile(event, "utf8");
    await writeFile(`${event}.swap`, bytes.replace(`"sequence":400`, `"sequence":400 `)); await rename(`${event}.swap`, event);
    await held();
  });
  it("tampered: an event edited in place in the page still filling at the audited head", async () => {
    await writeFile(file(560, "event"), "{tampered");
    await held();
  });
  it("tampered: an unpaged early event edited in place", async () => {
    await writeFile(file(3, "tip"), "{tampered");
    await held();
  });
  it("tampered: an event appended since the last audit", async () => {
    const sequence = (await store.read()).sequence, event = file(sequence, "event");
    await writeFile(event, (await readFile(event, "utf8")).replace(/"requestHash":"[0-9a-f]{64}"/, `"requestHash":"${"0".repeat(64)}"`));
    await held();
  });
  it("tampered: an evidence blob replaced", async () => {
    await events.admit({ agentId: "worker-blob", kind: "catalog", turnId: null, outcome: null, permissionId: null, sourceKind: "catalog",
      sourceKey: "blob", epoch: null, cursor: null, maxSeq: null, gaps: [], coverage: "unknown", payload: { status: "idle" } });
    await beat();
    const blob = (await store.read()).versions.find(v => v.kind === "blob")!.id, path = join(store.root, "blobs", blob);
    await writeFile(`${path}.swap`, "other evidence"); await rename(`${path}.swap`, path);
    await held();
  });
  it("truncated: the audited head's files removed", async () => {
    const head = (await store.read()).sequence - 1; // Audited before this beat's write.
    for (const suffix of ["event", "tip", "publication"]) await rm(file(head, suffix));
    await held();
  });
  it("truncated: a whole closed page removed", async () => {
    await rm(page(1), { recursive: true });
    await held();
  });
  it("reordered: two closed-page events swapped", async () => {
    const a = file(270, "event"), b = file(271, "event");
    await rename(a, `${a}.x`); await rename(b, a); await rename(`${a}.x`, b);
    await held();
  });
  it("reordered: two unpaged events swapped", async () => {
    const a = file(10, "event"), b = file(11, "event");
    await rename(a, `${a}.x`); await rename(b, a); await rename(`${a}.x`, b);
    await held();
  });
  it("an in-place edit invisible to directory stats is caught by the hourly backstop", async () => {
    const event = file(300, "event"), bytes = await readFile(event);
    const touched = Buffer.from(bytes.toString("utf8").replace(`"sequence":300`, `"sequence":301`));
    await writeFile(event, touched);
    expect((await beat()).freshness).toBe("current"); // A full page's directory does not move for an in-place write.
    await inboxWrite(); now += 60 * 60_000;
    await held();
  });
  it("after a failed audit every later beat audits in full until it passes", async () => {
    const event = file(400, "event"), bytes = await readFile(event);
    await writeFile(`${event}.swap`, "{tampered"); await rename(`${event}.swap`, event);
    await held();
    await inboxWrite().catch(() => undefined);
    expect((await beat()).freshness).toBe("held"); expect(store.auditCounts.full).toBe(3);
    await writeFile(`${event}.swap`, bytes); await rename(`${event}.swap`, event);
    expect((await beat()).freshness).toBe("current"); expect(store.auditCounts.full).toBe(4);
    await inboxWrite(); expect((await beat()).freshness).toBe("current"); expect(store.auditCounts).toMatchObject({ full: 4, incremental: 1 });
  });
});
