/** The committed evidence the S11 gates read: the frozen S00 strong rows and the reviewed reader runs. Kept apart from
 * `supervision-capabilities.ts` so nothing at runtime can pass another table or list (R11 N5, R3-N1): changing either is
 * a reviewed code change here, and tests of a hypothetical later delivery mock this module instead. Deeply frozen. */

export type S00Support = "source-supported" | "unsupported" | "unqualified";
export type S00Column = "floor011" | "proposal012" | "disk013";

const deepFreeze = <T>(value: T): T => {
  if (value && typeof value === "object") { for (const v of Object.values(value)) deepFreeze(v); Object.freeze(value); }
  return value;
};

/** The S00 capability-table rows each strong capability rests on, copied from the frozen S00 fixture
 * (`test/fixtures/supervision-s00/examples.json`; a test holds them equal). Columns are the 0.11 floor, the
 * packaged 0.12 proposal and the 0.13 disk source S00 inspected. None was live-qualified. */
export const S00_STRONG_ROWS = deepFreeze({
  "authenticated-admission": { floor011: "unsupported", proposal012: "unsupported", disk013: "unsupported" },
  "send-receipt": { floor011: "unsupported", proposal012: "unsupported", disk013: "unsupported" },
  "finish-transfer": { floor011: "unsupported", proposal012: "unsupported", disk013: "unsupported" },
  "heartbeat-owner": { floor011: "unsupported", proposal012: "unsupported", disk013: "unsupported" },
  "conditional-archive": { floor011: "unsupported", proposal012: "unsupported", disk013: "unsupported" },
} as const satisfies Record<string, Record<S00Column, S00Support>>);
export type S00Row = keyof typeof S00_STRONG_ROWS;

/** Reader runs a review has accepted, by the SHA-256 of their committed artifact (LF-normalised). An artifact counts only
 * when it is byte-for-byte one of these, so a hand-written result cannot satisfy the condition (R11 round 2). Adding a
 * run is a reviewed code change. The S11 smoke run is listed; it is partial (empty history). */
export const REVIEWED_READER_RUNS: readonly { readonly sha256: string; readonly artifact: string; readonly review: string }[] = deepFreeze([
  { sha256: "ca196767dab04aa15618849e02cc997886db24e056cb32bff738d4682e870ac3", artifact: "docs/scoped-supervision/s11-readers/result.json",
    review: "data/fm-ss-r11/report.md (round 1: a smoke test; the condition stays partial)" },
]);
