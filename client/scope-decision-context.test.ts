import { expect, it } from "vitest";
import { attentionSnapshot } from "../test/attention-deck-fixture";
import { scopeDecisionContext } from "./scope-decision-context";

it("uses the exact decision owner's project/plan names, with plain fallbacks for missing membership", () => {
  const snapshot = { ...attentionSnapshot([]), scopeDirectory: [
    { id: "project", kind: "project" as const, title: "Starpath", projectIds: ["starpath"], projectNames: ["Starpath"], planId: null },
    { id: "other", kind: "project" as const, title: "Other project", projectIds: ["other"], projectNames: ["Other project"], planId: null },
    { id: "plan", kind: "plan" as const, title: "Reader update", projectIds: ["starpath"], projectNames: ["Starpath"], planId: "reader-update" },
  ] };
  expect(scopeDecisionContext(snapshot, "plan")).toEqual({ recipient: "Reader update", breadcrumb: "Starpath · Reader update" });
  expect(scopeDecisionContext(snapshot, "missing")).toEqual({ recipient: "Plan conversation", breadcrumb: "Plan conversation" });
  expect(scopeDecisionContext(snapshot, "missing", true).breadcrumb).toBe("Routine checks");
});
