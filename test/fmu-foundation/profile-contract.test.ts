import { describe, expect, it } from "vitest";
const modulePath = "../../shared/supervisor-profile";
const catalog = [{ provider: "codex/gpt-6.1-sol", label: "Sol", modes: [{ id: "full-access", label: "Full access" }], thinking: [{ id: "high", label: "High" }, { id: "xhigh", label: "Extra high" }] }];
const profile = { provider: "codex/gpt-6.1-sol", modeId: "full-access", thinkingOptionId: "high" };
describe("frozen stage 1 Supervisor profile contract (A2/A4)", () => {
  it("pins explicit high and refuses omitted reasoning or catalog mismatch", async () => {
    const { profileProblem } = await import(modulePath);
    expect(profileProblem(profile, catalog)).toBeNull();
    expect(profileProblem({ ...profile, thinkingOptionId: undefined }, catalog)).toMatch(/reasoning/i);
    for (const invalid of [{ ...profile, provider: "codex/missing" }, { ...profile, modeId: "auto" }, { ...profile, thinkingOptionId: "low" }]) expect(profileProblem(invalid, catalog)).toBeTruthy();
  });
  it("full access cannot qualify an observer; qualified synthetic read-only retains independent choice", async () => {
    const { profileProblem } = await import(modulePath);
    expect(profileProblem(profile, catalog, true)).toMatch(/read.only/i);
    const ro = [{ ...catalog[0], modes: [{ id: "read-only", label: "Read only" }] }];
    expect(profileProblem({ ...profile, modeId: "read-only" }, ro, true)).toBeNull();
  });
});
