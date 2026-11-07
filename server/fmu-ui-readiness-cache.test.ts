import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { ReportCache, crewPlacement, summarizeAgent } from "./fleet";
import { NeedsYouService, withScopedNeedsYou } from "./needs-you-service";
import { SupervisionStore } from "./supervision-store";
import type { PaseoAgent, PaseoApi } from "./host-types";

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });
const agent = (updatedAt = "one", status = "idle") => ({ id: "crew", updatedAt, status, pendingPermissions: [], labels: {} }) as unknown as PaseoAgent;
function deferred<T>() { let resolve!: (value: T) => void, reject!: (error: Error) => void; const promise = new Promise<T>((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; }
const page = (text: string) => ({ entries: [{ item: { type: "assistant_message", text } }] });
const api = (read: any) => ({ agents: { ref: () => ({ timeline: { refetch: read } }) } }) as unknown as PaseoApi;

it("coalesces concurrent and later pending polls, then accepts late settlement without another native read", async () => {
  vi.useFakeTimers(); const cache = new ReportCache(), pending = deferred<any>(), read = vi.fn(() => pending.promise), paseo = api(read);
  const requests = Array.from({ length: 10 }, () => cache.reportFor(paseo, agent()));
  await vi.advanceTimersByTimeAsync(5_001);
  expect(await Promise.all(requests)).toEqual(Array(10).fill({ report: null, state: "pending" })); expect(read).toHaveBeenCalledTimes(1);
  const next = cache.reportFor(paseo, agent()); await vi.advanceTimersByTimeAsync(5_001);
  expect(await next).toMatchObject({ state: "pending" }); expect(read).toHaveBeenCalledTimes(1);
  pending.resolve(page("done: late known report")); await vi.advanceTimersByTimeAsync(60_000);
  expect(await cache.reportFor(paseo, agent())).toEqual({ report: { state: "done", text: "late known report" }, state: "current" });
  expect(read).toHaveBeenCalledTimes(1); expect(vi.getTimerCount()).toBe(0);
});
it("retains a known report through bounded failure cooldown, then recovers without permanent failure caching", async () => {
  vi.useFakeTimers(); const cache = new ReportCache(), read = vi.fn().mockResolvedValueOnce(page("done: known"))
    .mockRejectedValueOnce(new Error("Provider unavailable")).mockResolvedValueOnce(page("blocked: needs input")), paseo = api(read);
  expect((await cache.reportFor(paseo, agent())).state).toBe("current");
  expect(await cache.reportFor(paseo, agent("two"))).toEqual({ report: { state: "done", text: "known" }, state: "unavailable" });
  for (let i = 0; i < 8; i++) await cache.reportFor(paseo, agent("two")); expect(read).toHaveBeenCalledTimes(2);
  const running = agent("three", "running"); const retained = await cache.reportFor(paseo, running);
  expect(crewPlacement(summarizeAgent(running), retained.report).column).toBe("working"); expect(read).toHaveBeenCalledTimes(2);
  await vi.advanceTimersByTimeAsync(30_001);
  expect(await cache.reportFor(paseo, agent("two"))).toEqual({ report: { state: "blocked", text: "needs input" }, state: "current" });
  expect(read).toHaveBeenCalledTimes(3);
});
it("does not let an old pending version overwrite a new observation or reinsert a removed crew report", async () => {
  vi.useFakeTimers(); const cache = new ReportCache(), first = deferred<any>(), next = deferred<any>();
  const read = vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(next.promise).mockResolvedValue(page("done: current")), paseo = api(read);
  const one = cache.reportFor(paseo, agent()), two = cache.reportFor(paseo, agent("two"));
  first.resolve(page("done: obsolete")); await vi.advanceTimersByTimeAsync(0);
  expect(await one).toEqual({ report: null, state: "pending" }); expect(await two).toEqual({ report: null, state: "pending" }); expect(read).toHaveBeenCalledTimes(1);
  const newer = cache.reportFor(paseo, agent("two")); cache.retain(new Set());
  next.resolve(page("done: removed")); await vi.advanceTimersByTimeAsync(0); await newer;
  expect(await cache.reportFor(paseo, agent("two"))).toEqual({ report: { state: "done", text: "current" }, state: "current" });
  expect(read).toHaveBeenCalledTimes(3);
});
it("backs off repeated provider failures across updatedAt changes, caps retries, and resets after success", async () => {
  vi.useFakeTimers(); vi.spyOn(console, "error").mockImplementation(() => {});
  const cache = new ReportCache(), read = vi.fn().mockRejectedValue(new Error("Provider unavailable")), paseo = api(read);
  await cache.reportFor(paseo, agent());
  for (let n = 0; n < 10; n++) await cache.reportFor(paseo, agent(`noise-${n}`));
  expect(read).toHaveBeenCalledTimes(1);
  for (const [n, delay] of [30_000, 60_000, 120_000, 240_000, 300_000].entries()) {
    await vi.advanceTimersByTimeAsync(delay - 1); await cache.reportFor(paseo, agent(`before-${n}`));
    expect(read).toHaveBeenCalledTimes(n + 1);
    await vi.advanceTimersByTimeAsync(1); await cache.reportFor(paseo, agent(`retry-${n}`));
    expect(read).toHaveBeenCalledTimes(n + 2);
  }
  read.mockResolvedValue(page("done: recovered")); await vi.advanceTimersByTimeAsync(300_000);
  expect((await cache.reportFor(paseo, agent("recovered"))).state).toBe("current");
  read.mockRejectedValue(new Error("Provider unavailable")); await cache.reportFor(paseo, agent("new failure"));
  const calls = read.mock.calls.length; await vi.advanceTimersByTimeAsync(30_000); await cache.reportFor(paseo, agent("retry"));
  expect(read).toHaveBeenCalledTimes(calls + 1);
});
it.each([true, false])("never reopens an unchanged closed agent after a %s successful read; reopening permits recovery", async success => {
  vi.useFakeTimers(); vi.spyOn(console, "error").mockImplementation(() => {});
  const cache = new ReportCache(), read = success ? vi.fn().mockResolvedValue(page("done: closed")) : vi.fn().mockRejectedValue(new Error("Timeout")), paseo = api(read);
  await cache.reportFor(paseo, agent("closed", "closed"));
  for (let n = 0; n < 10; n++) { await vi.advanceTimersByTimeAsync(3600_000); await cache.reportFor(paseo, agent(`closed-${n}`, "closed")); }
  expect(read).toHaveBeenCalledTimes(1);
  read.mockResolvedValue(page("done: reopened"));
  expect((await cache.reportFor(paseo, agent("open"))).state).toBe("current"); expect(read).toHaveBeenCalledTimes(2);
});
it("bridges only a service-read current canonical ledger, retaining legacy answers and rejecting forged/different-home bridges", async () => {
  const home = join(process.env.PASEO_HOME!, "identity"), other = join(process.env.PASEO_HOME!, "other");
  await mkdir(join(home, "data"), { recursive: true }); await mkdir(other);
  await writeFile(join(home, "data/backlog.md"), "# Backlog\n## In flight\n## Queued\n- [ ] decide - Decide (hold: Which?)\n## Done\n");
  const service = new NeedsYouService({ root: join(home, "ledgers"), home: async () => home, catalog: async () => null, enabled: () => true, stableMs: 0 });
  const store = new SupervisionStore(join(home, "scoped"), home, { writable: true }); await store.initialize();
  try {
    await service.read(); const snapshot = await service.read(), status = await store.read();
    const bridge = await service.homeBridge(snapshot, join(home, "."));
    const combined = withScopedNeedsYou(snapshot, status, bridge);
    expect(combined.homeId).toBe(snapshot.homeId); expect(combined.requests).toEqual(snapshot.requests); expect(combined.scopedComplete).toBe(true);
    expect(() => withScopedNeedsYou(snapshot, status)).toThrow("homes differ");
    expect(() => withScopedNeedsYou(snapshot, status, { ...bridge! })).toThrow("homes differ");
    expect(() => withScopedNeedsYou(snapshot, { ...status, homeId: other }, bridge)).toThrow("homes differ");
    await expect(service.homeBridge(snapshot, other)).rejects.toThrow("home changed");
    await expect(service.homeBridge({ ...snapshot, homeId: "forged" }, home)).rejects.toThrow("current durable home");
    const request = combined.requests[0]!;
    const answered = await service.mutate({ homeId: combined.homeId!, id: request.id, revision: request.revision }, { kind: "answer", submissionId: "retained-answer", outcome: "accepted" });
    expect(answered.homeId).toBe(snapshot.homeId); expect(answered.requests[0]).toMatchObject({ id: request.id, state: "answer-sent" });
    expect(withScopedNeedsYou(answered, status, await service.homeBridge(answered, home)).pendingAnswerCount).toBe(1);
  } finally { await service.stop(); }
});
