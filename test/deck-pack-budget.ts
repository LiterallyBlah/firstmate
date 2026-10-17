import { PACK_BYTES_MAX } from "../server/deck-settings";

/** Advisory only; the pack linter separately enforces the hard serving limit. */
export function packBudgetWarning(id: string, bytes: number): string | null {
  if (bytes <= PACK_BYTES_MAX * 0.8) return null;
  return `Deck pack ${id}: ${bytes.toLocaleString("en-US")} / ${PACK_BYTES_MAX.toLocaleString("en-US")} image bytes (${((bytes / PACK_BYTES_MAX) * 100).toFixed(1)}%); above 80% of the image budget.`;
}
