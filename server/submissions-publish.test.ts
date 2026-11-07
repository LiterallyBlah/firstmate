import { randomUUID } from "node:crypto";
import * as filesystem from "node:fs/promises";
import { mkdir, readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { publishBytes } from "./submissions";

// Keep real IO; wrap link so a test can refuse it the way Windows does while another handle holds the file.
vi.mock(import("node:fs/promises"), async importOriginal => {
  const actual = await importOriginal(); return { ...actual, link: vi.fn(actual.link) as typeof actual.link };
});
const platform = Object.getOwnPropertyDescriptor(process, "platform")!;
const as = (value: string) => Object.defineProperty(process, "platform", { ...platform, value });
afterEach(() => { Object.defineProperty(process, "platform", platform); vi.mocked(filesystem.link).mockClear(); });
const refuse = (code: string) => Object.assign(new Error(`${code}: operation not permitted, link`), { code });

async function directory() { const path = join(process.env.PASEO_HOME!, randomUUID()); await mkdir(path, { recursive: true }); return path; }

it("retries a transient Windows link refusal and leaves no temporary behind", async () => {
  as("win32"); const dir = await directory(), path = join(dir, "000000000002.publication.json");
  const real = (await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises")).link;
  vi.mocked(filesystem.link).mockRejectedValueOnce(refuse("EPERM")).mockRejectedValueOnce(refuse("EBUSY")).mockImplementation(real);
  await publishBytes(path, "whole\n");
  expect(await readFile(path, "utf8")).toBe("whole\n");
  expect(await readdir(dir)).toEqual(["000000000002.publication.json"]);
  expect(filesystem.link).toHaveBeenCalledTimes(3);
});

it("never retries an exclusive-link conflict, and elsewhere fails a refusal at once", async () => {
  as("win32"); const dir = await directory(), path = join(dir, "exclusive.json");
  await publishBytes(path, "first\n");
  await expect(publishBytes(path, "second\n")).rejects.toMatchObject({ code: "EEXIST" });
  expect(await readFile(path, "utf8")).toBe("first\n"); expect(filesystem.link).toHaveBeenCalledTimes(2);
  as("linux"); vi.mocked(filesystem.link).mockClear().mockRejectedValueOnce(refuse("EPERM"));
  await expect(publishBytes(join(dir, "other.json"), "x\n")).rejects.toMatchObject({ code: "EPERM" });
  expect(filesystem.link).toHaveBeenCalledOnce(); expect(await readdir(dir)).toEqual(["exclusive.json"]);
});
