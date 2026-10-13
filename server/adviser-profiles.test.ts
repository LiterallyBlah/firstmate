import { expect, it } from "vitest";
import { availableAdviserProfiles, requireQualifiedAdviserProfile } from "./adviser-profiles";

it("offers no unqualified profile, including plan or a caller claiming qualification", () => {
  expect(availableAdviserProfiles()).toEqual([]);
  for (const provider of ["claude", "codex", "muse", "omp", "opencode", "qualified"]) {
    expect(() => requireQualifiedAdviserProfile({ provider, model: "default", modeId: "plan", runtimeFingerprint: "qualified" }))
      .toThrow("no runtime profile has passed");
  }
});
