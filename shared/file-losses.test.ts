import { expect, it } from "vitest";
import { fileLosses } from "./file-losses";

it("names removed tasks and completed work made unfinished, while allowing ordinary edits", () => {
  expect(fileLosses("## Done\n- [x] a - Finished\n- [x] b - Also finished\n## Queued\n- [ ] c - Waiting\n- [ ] anonymous task\n",
    "## In flight\n- [ ] a - New wording\n## Queued\n- [ ] c - Improved wording\n")).toEqual([
    "Mark unfinished again: a - Finished", "Remove task: b - Also finished", "Remove task: anonymous task",
  ]);
  expect(fileLosses("## Done\n- [ ] a - Finished\n", "## In flight\n- [ ] a - Finished\n")).toEqual(["Mark unfinished again: a - Finished"]);
  expect(fileLosses("## Done\n- [x] a - Finished\n", "## In flight\n- [x] a - Finished\n")).toEqual(["Mark unfinished again: a - Finished"]);
});

it("counts duplicate task removals and handles BOM, CRLF, and alternate bullets", () => {
  expect(fileLosses("\uFEFF## Done\r\n* [x] a – Task\r\n* [x] a – Task\r\n", "## Done\n* [x] a – Task\n")).toEqual(["Remove task: a – Task"]);
});
