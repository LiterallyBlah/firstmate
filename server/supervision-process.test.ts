import { expect, it } from "vitest";
import { linuxSupervisionProcessIdentity, primeSupervisionSelfIdentity, supervisionProcessIdentity, SUPERVISION_IDENTITY_REPROBE_THROTTLE_MS, WINDOWS_IDENTITY_BUDGET_MS, WINDOWS_IDENTITY_TIMEOUT_MS, windowsSupervisionProcessIdentity, type ProcessIdentity } from "./supervision-process";
import { WARMUP_TIMEOUT_MS, warmWindowsIdentityProbe } from "../test/supervision-warmup";

const missing = () => Object.assign(new Error("fixture missing file"), { code: "ENOENT" });
const stat = (state = "S") => `123 (fixture process) ${[state, ...Array(18).fill("0"), "12345"].join(" ")}`;
it("classifies missing PID stat as dead", async () => {
  expect(await linuxSupervisionProcessIdentity(123, async () => { throw missing(); })).toEqual({ state: "dead" });
});
it("keeps missing boot identity unknown even when PID stat is readable", async () => {
  expect(await linuxSupervisionProcessIdentity(123, async path => {
    if (path.endsWith("/stat")) return stat(); throw missing();
  })).toEqual({ state: "unknown" });
});
it("keeps denied PID stat unknown", async () => {
  expect(await linuxSupervisionProcessIdentity(123, async () => { throw Object.assign(new Error("fixture denied"), { code: "EACCES" }); })).toEqual({ state: "unknown" });
});
it("binds a readable PID to boot identity/start ticks and distinguishes zombie termination", async () => {
  const read = (state: string) => async (path: string) => path.endsWith("/stat") ? stat(state) : "boot-identity\n";
  expect(await linuxSupervisionProcessIdentity(123, read("S"))).toEqual({ state: "alive", start: "boot-identity:12345" });
  expect(await linuxSupervisionProcessIdentity(123, read("Z"))).toEqual({ state: "dead" });
});

type Options = { windowsHide: boolean; timeout: number; maxBuffer: number };
const noSleep = { sleep: async (_ms: number) => {} };
it("probes Windows identity through .NET directly, one 12 s deadline, and maps its output without retrying a definitive answer", async () => {
  const calls: { args: string[]; options: Options }[] = [];
  const answer = (stdout: string) => async (_file: string, args: string[], options: Options) => { calls.push({ args, options }); return { stdout }; };
  expect(await windowsSupervisionProcessIdentity(123, answer("alive:639286302159116241\r\n"))).toEqual({ state: "alive", start: "639286302159116241" });
  expect(calls).toHaveLength(1); // alive is definitive: no retry.
  expect(calls[0]!.args.at(-1)).toContain("[System.Diagnostics.Process]::GetProcessById(123)");
  expect(calls[0]!.args.at(-1)).not.toContain("Get-Process");
  expect(calls[0]!.options).toMatchObject({ timeout: 12000, windowsHide: true });
  expect(WINDOWS_IDENTITY_TIMEOUT_MS).toBe(12000);
  expect(WINDOWS_IDENTITY_BUDGET_MS).toBe(12000);
  expect(await windowsSupervisionProcessIdentity(123, answer("dead"))).toEqual({ state: "dead" });
  expect(calls).toHaveLength(2); // dead is definitive too.
  for (const stdout of ["unknown", "", "alive:", "alive:12x", "dead alive:1"]) expect(await windowsSupervisionProcessIdentity(123, answer(stdout), noSleep)).toEqual({ state: "unknown" });
  expect(await windowsSupervisionProcessIdentity(0, answer("alive:1"))).toEqual({ state: "unknown" });
});
it("a slow first (cold) Windows probe finishes inside the single longer deadline; the warm-up still pays the cold start up front", async () => {
  // Model of the CI runner: the first PowerShell start takes coldMs, warming the machine only if it is allowed to
  // finish; a start killed at its deadline leaves it cold. Measured first-child times: 5309 ms (red), 3280 ms (green).
  // The old one-shot 5 s probe returned unknown for the red case — the CI failure: UNSUPPORTED.
  const runner = (coldMs: number) => {
    let warm = false, now = 0; const timeouts: number[] = [], delays: number[] = [];
    const run = async (_file: string, _args: string[], options: Options) => {
      timeouts.push(options.timeout);
      if (!warm) { if (coldMs > options.timeout) { now += options.timeout; throw Object.assign(new Error("fixture timed out"), { killed: true, signal: "SIGTERM" }); } now += coldMs; warm = true; }
      return { stdout: "alive:42" };
    };
    const clock = { now: () => now, sleep: async (ms: number) => { delays.push(ms); now += ms; } };
    return { run, timeouts, delays, clock };
  };
  const red = runner(5309);
  expect(await windowsSupervisionProcessIdentity(77, red.run, red.clock)).toEqual({ state: "alive", start: "42" });
  expect(red.timeouts).toEqual([12000]); // One attempt, never killed mid-start: no wasted deadline, no retry needed.
  expect(red.delays).toEqual([]);
  const warmed = runner(5309);
  expect(await warmWindowsIdentityProbe(warmed.run)).toBe("alive:42");
  expect(await windowsSupervisionProcessIdentity(77, warmed.run, warmed.clock)).toEqual({ state: "alive", start: "42" });
  expect(warmed.timeouts).toEqual([WARMUP_TIMEOUT_MS, 12000]);
  const slowest = runner(WARMUP_TIMEOUT_MS + 1); // A warm-up that cannot finish fails loudly rather than hiding.
  await expect(warmWindowsIdentityProbe(slowest.run)).rejects.toThrow("fixture timed out");
  expect(await windowsSupervisionProcessIdentity(77, slowest.run, slowest.clock)).toEqual({ state: "unknown" });
  expect(slowest.timeouts).toEqual([WARMUP_TIMEOUT_MS, 12000]); // A timed-out attempt is not retried: the budget is spent.
});
it("one quick retry covers a fast failure inside the same 12 s budget, including unknown turning dead", async () => {
  let thrown = 0, now = 0; const delays: number[] = [], timeouts: number[] = [];
  const clock = { now: () => now, sleep: async (ms: number) => { delays.push(ms); now += ms; } };
  const flakyThrow = async (_file: string, _args: string[], options: Options) => { timeouts.push(options.timeout); now += 10; if (thrown++ < 1) throw new Error("fixture spawn hiccup"); return { stdout: "alive:7" }; };
  expect(await windowsSupervisionProcessIdentity(77, flakyThrow, clock)).toEqual({ state: "alive", start: "7" });
  expect(thrown).toBe(2);
  expect(timeouts).toEqual([12000, 12000 - 10 - 250]); // The retry spends only what the budget has left.
  expect(delays).toEqual([250]);
  let answered = 0; now = 0;
  const flakyAnswer = async () => ({ stdout: answered++ < 1 ? "unknown" : "dead" }); // A process exiting mid-read.
  expect(await windowsSupervisionProcessIdentity(77, flakyAnswer, clock)).toEqual({ state: "dead" });
  expect(answered).toBe(2);
});
it("gives up unknown inside the 12 s budget when the Windows probe times out, with no second attempt", async () => {
  let now = 0; const timeouts: number[] = [], delays: number[] = [];
  const run = async (_file: string, _args: string[], options: Options) => { timeouts.push(options.timeout); now += options.timeout; throw Object.assign(new Error("fixture timed out"), { killed: true, signal: "SIGTERM" }); };
  const clock = { now: () => now, sleep: async (ms: number) => { delays.push(ms); now += ms; } };
  expect(await windowsSupervisionProcessIdentity(77, run, clock)).toEqual({ state: "unknown" });
  expect(timeouts).toEqual([12000]);
  expect(delays).toEqual([]);
  expect(now).toBeLessThanOrEqual(WINDOWS_IDENTITY_BUDGET_MS); // Two probes per claim stay well under the 30 s RPC limit.
});
it("caches this process's verified identity for its lifetime and throttles re-probes after an unknown", async () => {
  // Last in this file on purpose: the self cache is module-scope and outlives the test.
  let now = 0; const clock = { now: () => now };
  const calls: number[] = [];
  let selfAnswer: ProcessIdentity = { state: "unknown" };
  const probe = async (pid: number): Promise<ProcessIdentity> => { calls.push(pid); return pid === process.pid ? selfAnswer : { state: "unknown" }; };
  // An unknown result is not cached as an identity, but spawning is throttled so a failed claim
  // does not repay the full probe cost on every 1 s tick; the answer stays unknown (fail closed).
  expect(await supervisionProcessIdentity(424242, { probe, ...clock })).toEqual({ state: "unknown" });
  expect(await supervisionProcessIdentity(424242, { probe, ...clock })).toEqual({ state: "unknown" });
  expect(calls).toEqual([424242]);
  now += SUPERVISION_IDENTITY_REPROBE_THROTTLE_MS;
  expect(await supervisionProcessIdentity(424242, { probe, ...clock })).toEqual({ state: "unknown" });
  expect(calls).toEqual([424242, 424242]);
  // Self: an unknown first probe is never remembered as verified; after the throttle a fresh probe can verify.
  expect(await primeSupervisionSelfIdentity({ probe, ...clock })).toEqual({ state: "unknown" });
  selfAnswer = { state: "alive", start: "self-start-1" };
  now += SUPERVISION_IDENTITY_REPROBE_THROTTLE_MS;
  expect(await supervisionProcessIdentity(process.pid, { probe, ...clock })).toEqual({ state: "alive", start: "self-start-1" });
  const probed = calls.length;
  // From then on the self identity is served from cache: no OS probe at all, inside any lock.
  expect(await supervisionProcessIdentity(process.pid, { probe, ...clock })).toEqual({ state: "alive", start: "self-start-1" });
  expect(await primeSupervisionSelfIdentity({ probe, ...clock })).toEqual({ state: "alive", start: "self-start-1" });
  expect(calls).toHaveLength(probed);
});
