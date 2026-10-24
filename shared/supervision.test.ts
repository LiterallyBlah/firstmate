import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { SupervisionContractSchema, SupervisionHash, SupervisionUtc } from "./supervision";

const examples = JSON.parse(readFileSync(join(process.cwd(), "test/fixtures/supervision-s00/examples.json"), "utf8"));
const corpus = JSON.parse(readFileSync(join(process.cwd(), "test/fixtures/supervision-s00/regression-corpus.json"), "utf8")) as {
  cases: { id: string; exampleIndex: number; path: (string | number)[]; input: unknown; expectedValid: boolean }[] };
describe("corrected S00 production contracts", () => {
  it("round-trips all six frozen examples and rejects unknown envelope/nested properties", () => {
    for (const example of examples) {
      expect(SupervisionContractSchema.parse(example)).toEqual(example);
      expect(SupervisionContractSchema.safeParse({ ...example, extra: true }).success).toBe(false);
      expect(SupervisionContractSchema.safeParse({ ...example, value: { ...example.value, extra: true } }).success).toBe(false);
    }
    const nested = structuredClone(examples[2]); nested.value.policyVector[0].extra = true;
    expect(SupervisionContractSchema.safeParse(nested).success).toBe(false);
  });
  for (const test of corpus.cases) it(test.id, () => {
    // The frozen corpus addresses every timestamp/hash field. Full-schema checks include nested evidence.
    const example = structuredClone(examples[test.exampleIndex]);
    let target = example.value;
    for (const part of test.path.slice(0, -1)) {
      if (target[part] === undefined) target[part] = typeof part === "number" ? {} : [];
      target = target[part];
    }
    const final = test.path.at(-1)!;
    if (test.path[0] === "evidence" && !target.ref) { target.ref = "fixture"; target.freshness = "2026-10-24T20:00:00Z"; target.digest = "a".repeat(64); }
    target[final] = test.input;
    expect(SupervisionContractSchema.safeParse(example).success).toBe(test.expectedValid);
    const scalar = /digest|hash/i.test(String(final)) ? SupervisionHash : SupervisionUtc;
    expect(scalar.safeParse(test.input).success).toBe(test.expectedValid);
  });
});
