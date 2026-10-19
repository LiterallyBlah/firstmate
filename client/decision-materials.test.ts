import { expect, it } from "vitest";
import { draftPreview, githubMaterialLabel, namedDraft } from "./decision-materials";
import { inlineTokens, lookupIn } from "./file-links";

it("links only home files verified by the existing resolver and preserves GitHub URLs", () => {
  const lookup = lookupIn({ "data/reply-draft.md": "data/reply-draft.md" });
  const ask = "Approve data/reply-draft.md for https://github.com/getpaseo/paseo/discussions/6478. Also missing.md";
  expect(inlineTokens(ask, lookup).filter(token => token.kind === "file")).toEqual([
    { kind: "file", path: "data/reply-draft.md", text: "data/reply-draft.md", code: false },
  ]);
  expect(namedDraft(ask, lookup)).toBe("data/reply-draft.md");
  expect(namedDraft("Approve data/report.md", () => "data/report.md")).toBeNull();
  expect(namedDraft("Approve data/reply-draft.md", () => null)).toBeNull();
  expect(githubMaterialLabel("https://github.com/getpaseo/paseo/discussions/6478")).toBe("Discussion #6478");
});
it("caps the preview by both lines and characters", () => {
  expect(draftPreview("  one\r\ntwo\r\nthree\r\nfour\r\nfive ")).toBe("one\ntwo\nthree\nfour");
  expect(draftPreview("x".repeat(1000))).toHaveLength(700);
});
