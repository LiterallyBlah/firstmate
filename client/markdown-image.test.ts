import { expect, it } from "vitest";
import { markdownImage } from "./markdown-image";

it("renders whole-line remote and inline raster images, including angle-escaped destinations", () => {
  expect(markdownImage('![Wake](https://example.com/wake.png "caption")')).toEqual({
    uri: "https://example.com/wake.png",
    label: "Wake",
  });
  expect(markdownImage("![](<https://example.com/a(b).png>)")).toEqual({
    uri: "https://example.com/a(b).png",
    label: "Image from the first mate",
  });
  expect(markdownImage("![Small](data:image/png;base64,aGVsbG8=)")?.uri).toContain("data:image/png");
});

it("leaves local paths, non-image links, mixed prose and unsafe schemes to existing text/link handling", () => {
  for (const source of [
    "![x](/tmp/x.png)",
    "![x](file:///tmp/x.png)",
    "![x](javascript:alert)",
    "![x](data:text/html;base64,aA==)",
    "![x](data:image/svg+xml;base64,aA==)",
    "[x](https://example.com/x.png)",
    "Before ![x](https://example.com/x.png) after",
  ]) {
    expect(markdownImage(source)).toBeNull();
  }
});
