import { expect, it } from "vitest";
import { SupervisorInspectionProfileSchema, inspectionProfileAvailability } from "./supervisor-inspection";
it("an inspector captures its independent read-only profile and finite cumulative limits, with no General reference", () => {
  const value = { format: "firstmate.supervisor-inspection-profile/1", homeId: "home", hostId: "local", watch: "backup", definitionDigest: "a".repeat(64), generation: 1,
    profile: { provider: "synthetic/observer", modeId: "read-only", thinkingOptionId: "high" }, catalogDigest: "b".repeat(64), limits: { sessions: 2, turns: 4 },
    isolation: "independent-parentless-restricted-tools", provenance: "client UI (unverified)" };
  const captured = SupervisorInspectionProfileSchema.parse(value); value.profile.thinkingOptionId = "xhigh";
  expect(captured.profile.thinkingOptionId).toBe("high");
  expect(SupervisorInspectionProfileSchema.safeParse({ ...value, profile: { ...value.profile, modeId: "full-access" } }).success).toBe(false);
  expect(SupervisorInspectionProfileSchema.safeParse({ ...value, limits: { sessions: 0, turns: 0 } }).success).toBe(false);
});
it("the current execution-only catalog visibly refuses standalone observation; a synthetic read-only catalog is contract evidence only", () => {
  const profile = { provider: "codex/gpt-6.1-sol", modeId: "full-access", thinkingOptionId: "high" },
    catalog = [{ provider: profile.provider, label: "Sol", modes: [{ id: "full-access", label: "Full access" }], thinking: [{ id: "high", label: "High" }] }];
  expect(inspectionProfileAvailability(profile, catalog)).toMatchObject({ available: false, reason: expect.stringMatching(/read.only/) });
  expect(inspectionProfileAvailability({ ...profile, modeId: "read-only" }, [{ ...catalog[0]!, modes: [{ id: "read-only", label: "Read only" }] }])).toMatchObject({ available: true, qualification: expect.stringContaining("contract only") });
});
