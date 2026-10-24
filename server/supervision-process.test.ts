import { expect, it } from "vitest";
import { linuxSupervisionProcessIdentity } from "./supervision-process";

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
