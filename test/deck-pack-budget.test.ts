import { expect, it } from "vitest";
import { PACK_BYTES_MAX } from "../server/deck-settings";
import { packBudgetWarning } from "./deck-pack-budget";

it("warns above 80%, including at the accepted cap, without rejecting the pack", () => {
  expect(PACK_BYTES_MAX).toBe(2_000_000);
  expect(packBudgetWarning("fixture", 1_599_999)).toBeNull();
  expect(packBudgetWarning("fixture", 1_600_000)).toBeNull();
  expect(packBudgetWarning("fixture", 1_600_001)).toContain("above 80%");
  expect(packBudgetWarning("fixture", PACK_BYTES_MAX)).toBe(
    "Deck pack fixture: 2,000,000 / 2,000,000 image bytes (100.0%); above 80% of the image budget.",
  );
});
