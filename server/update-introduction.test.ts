import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { UpdateIntroductionService } from "./update-introduction";
import { workflowHomeIdentity } from "./workflow-ownership";
import { digest } from "./submissions";
import { IntroductionInputSchema } from "../shared/update-introduction";

it("reads create no preference, policy, home, journal or coordinator; dismissal is durable per home/version", async () => {
  const root = join(process.env.PASEO_HOME!, randomUUID()); await mkdir(root);
  let home = join(root, "home-a"); const service = () => new UpdateIntroductionService(root, async () => home);
  const input = () => ({ homeId: workflowHomeIdentity(home), version: 1 as const });
  expect((await service().read(input())).state).toBe("available"); expect(await readdir(root)).toEqual([]);
  await Promise.all([service().dismiss(input()), service().dismiss(input())]);
  expect((await service().read(input())).state).toBe("dismissed");
  const a = input(); home = join(root, "home-b");
  expect((await service().read(input())).state).toBe("available");
  await expect(service().dismiss(a)).rejects.toThrow("home changed");
  expect(await readdir(root)).toEqual(["update-introductions"]);
  // An older introduction receipt never dismisses this version.
  const folder = join(root, "update-introductions", digest(input().homeId)); await mkdir(folder);
  await writeFile(join(folder, "0.json"), JSON.stringify({ homeId: input().homeId, version: 0, dismissed: true }));
  expect((await service().read(input())).state).toBe("available");
  expect(IntroductionInputSchema.safeParse({ ...input(), version: 2 }).success).toBe(false);
});
it("does not overwrite damaged preferences or dismiss another home; aliases use the canonical home", async () => {
  const root = join(process.env.PASEO_HOME!, randomUUID()), home = join(root, "home"), homeId = workflowHomeIdentity(home);
  const service = new UpdateIntroductionService(root, async () => home), input = { homeId: join(home, "."), version: 1 as const };
  await service.dismiss(input); expect((await service.read({ ...input, homeId })).state).toBe("dismissed");
  const path = join(root, "update-introductions", digest(homeId), "1.json");
  await writeFile(path, "broken"); expect((await service.read(input)).state).toBe("held");
  await expect(service.dismiss(input)).rejects.toThrow("couldn't be checked"); expect(await readFile(path, "utf8")).toBe("broken");
  await writeFile(path, JSON.stringify({ format: "firstmate.introduction/1", homeId: "other-home", version: 1, dismissed: true }));
  expect((await service.read(input)).state).toBe("held");
});
