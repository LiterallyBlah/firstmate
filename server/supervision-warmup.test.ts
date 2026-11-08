// CI flake: a suite's coordinator claim on a loaded windows-latest runner got "Cannot verify this process start
// identity" when the product's bounded probe ran out. The suite warm-up now hands its own long-bounded, real probe
// answer to the process-lifetime cache, so later claims never depend on the runner's speed.
import { expect, it } from "vitest";
import { supervisionProcessIdentity } from "./supervision-process";
import { WARMUP_TIMEOUT_MS, warmWindowsIdentityProbe } from "../test/supervision-warmup";

it.runIf(process.platform === "win32")("the suite warm-up primes this process's verified start identity", async () => {
  const warmed = await warmWindowsIdentityProbe();
  expect(warmed).toMatch(/^alive:[0-9]+$/);
  // A probe that would now fail is never consulted for this process again.
  await expect(supervisionProcessIdentity(process.pid, { probe: async () => ({ state: "unknown" }) })).resolves.toEqual({ state: "alive", start: warmed.slice(6) });
}, WARMUP_TIMEOUT_MS + 10000);

it("a stand-in probe answer is never cached as this process's identity", async () => {
  await warmWindowsIdentityProbe(async () => ({ stdout: "alive:42\r\n" }));
  const probed: number[] = [];
  const answer = await supervisionProcessIdentity(process.pid, { probe: async pid => { probed.push(pid); return { state: "alive", start: "real" }; } });
  if (process.platform !== "win32") expect(answer).toEqual({ state: "alive", start: "real" });
  expect(answer).not.toEqual({ state: "alive", start: "42" });
});
