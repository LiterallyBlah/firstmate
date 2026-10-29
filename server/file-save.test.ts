import { readFile } from "node:fs/promises";
import { URL } from "node:url";
import { expect, it } from "vitest";

it("ships the exact same save protocol in the daemon and the installed home helper", async () => {
  const daemon = await readFile(new URL("./file-save.mjs", import.meta.url));
  const helper = await readFile(new URL("../templates/tools/file-save.mjs", import.meta.url));
  expect(daemon).toEqual(helper);
});
