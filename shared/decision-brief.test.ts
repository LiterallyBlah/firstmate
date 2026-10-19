import { expect, it } from "vitest";
import { parseDecisionBrief } from "./decision-brief";

export const brief = `# Which pilot should run first?

**Background.** The engine works but has not completed a real job.
More background and trade-offs must remain visible.

**Options:**
1. **Public research pilot (recommended).** Use a frozen corpus.
   - No live environment needed.
2. **Owned security lab.** Needs a lab VM and approved scope.

**My recommendation:** option 1, once budgets are in.
Keep the lab for the security profile's own proof.

## Further context
Keep this paragraph too.`;

it("reads bold section labels, full paragraphs, numbered choices and the whole recommendation", () => {
  const parsed = parseDecisionBrief(brief);
  expect(parsed.sections.map((s) => s.kind)).toEqual([
    "other",
    "background",
    "options",
    "recommendation",
    "other",
  ]);
  expect(parsed.sections[1]!.body).toContain("More background and trade-offs");
  expect(parsed.options).toEqual([
    {
      number: "1",
      label: "Public research pilot",
      body: "1. **Public research pilot (recommended).** Use a frozen corpus.\n   - No live environment needed.",
    },
    {
      number: "2",
      label: "Owned security lab",
      body: "2. **Owned security lab.** Needs a lab VM and approved scope.",
    },
  ]);
  expect(parsed.recommendation).toBe(
    "option 1, once budgets are in.\nKeep the lab for the security profile's own proof.",
  );
  expect(parsed.sections.at(-1)!.body).toBe("Keep this paragraph too.");
});
it("keeps unstructured and fenced content without inventing choices", () => {
  expect(parseDecisionBrief("Plain old brief").sections).toEqual([
    { title: "", kind: "other", body: "Plain old brief" },
  ]);
  expect(
    parseDecisionBrief(
      "## Background\n```md\n## Options\n```\n## Recommendation\nProceed.",
    ).sections,
  ).toHaveLength(2);
  expect(
    parseDecisionBrief("## Options\n1. **Same**\n2. **Same**").options,
  ).toEqual([]);
  expect(
    parseDecisionBrief("## Options\n```md\n1. **Example only**\n```").options,
  ).toEqual([]);
});
