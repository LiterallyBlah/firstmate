import { expect, it } from "vitest";
import { linuxSupervisionProcessIdentity, WINDOWS_IDENTITY_TIMEOUT_MS, windowsSupervisionProcessIdentity } from "./supervision-process";
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
it("probes Windows identity through .NET directly, under the unchanged 5 s deadline, and maps its output", async () => {
  const calls: { args: string[]; options: Options }[] = [];
  const answer = (stdout: string) => async (_file: string, args: string[], options: Options) => { calls.push({ args, options }); return { stdout }; };
  expect(await windowsSupervisionProcessIdentity(123, answer("alive:639286302159116241\r\n"))).toEqual({ state: "alive", start: "639286302159116241" });
  expect(calls[0]!.args.at(-1)).toContain("[System.Diagnostics.Process]::GetProcessById(123)");
  expect(calls[0]!.args.at(-1)).not.toContain("Get-Process");
  expect(calls[0]!.options).toMatchObject({ timeout: 5000, windowsHide: true });
  expect(WINDOWS_IDENTITY_TIMEOUT_MS).toBe(5000);
  expect(await windowsSupervisionProcessIdentity(123, answer("dead"))).toEqual({ state: "dead" });
  for (const stdout of ["unknown", "", "alive:", "alive:12x", "dead alive:1"]) expect(await windowsSupervisionProcessIdentity(123, answer(stdout))).toEqual({ state: "unknown" });
  expect(await windowsSupervisionProcessIdentity(0, answer("alive:1"))).toEqual({ state: "unknown" });
});
it("a slow first (cold) Windows probe is unknown and never retried; the warm-up pays the cold start instead", async () => {
  // Model of the CI runner: the first PowerShell start takes coldMs, warming the machine only if it is allowed to
  // finish; a start killed at its deadline leaves it cold. Measured first-child times: 5309 ms (red), 3280 ms (green).
  const runner = (coldMs: number) => {
    let warm = false; const timeouts: number[] = [];
    const run = async (_file: string, _args: string[], options: Options) => {
      timeouts.push(options.timeout);
      if (!warm) { if (coldMs > options.timeout) throw Object.assign(new Error("fixture timed out"), { killed: true, signal: "SIGTERM" }); warm = true; }
      return { stdout: "alive:42" };
    };
    return { run, timeouts };
  };
  const red = runner(5309);
  expect(await windowsSupervisionProcessIdentity(77, red.run)).toEqual({ state: "unknown" }); // The CI failure: UNSUPPORTED.
  expect(red.timeouts).toEqual([5000]); // One bounded attempt; no hidden retry or longer deadline.
  const warmed = runner(5309);
  expect(await warmWindowsIdentityProbe(warmed.run)).toBe("alive:42");
  expect(await windowsSupervisionProcessIdentity(77, warmed.run)).toEqual({ state: "alive", start: "42" });
  expect(warmed.timeouts).toEqual([WARMUP_TIMEOUT_MS, 5000]);
  const slowest = runner(WARMUP_TIMEOUT_MS + 1); // A warm-up that cannot finish fails loudly rather than hiding.
  await expect(warmWindowsIdentityProbe(slowest.run)).rejects.toThrow("fixture timed out");
  expect(await windowsSupervisionProcessIdentity(77, slowest.run)).toEqual({ state: "unknown" });
});
