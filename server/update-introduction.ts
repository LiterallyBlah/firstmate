/** Durable per-home/version dismissal, independent of policy and supervision storage. */
import { mkdir, readFile } from "node:fs/promises";
import { dirname, isAbsolute, join } from "node:path";
import { z } from "zod";
import type { PluginServerContext } from "@getpaseo/plugin/server";
import { IntroductionInputSchema, PROJECT_INTRODUCTION_VERSION, readUpdateIntroduction, dismissUpdateIntroduction } from "../shared/update-introduction";
import { workflowHomeIdentity } from "./workflow-ownership";
import { digest, publish } from "./submissions";
import { serialized } from "./serialize";

const Receipt = z.object({ format: z.literal("firstmate.introduction/1"), homeId: z.string(), version: z.number().int().positive(), dismissed: z.literal(true) }).strict();
type Input = z.infer<typeof IntroductionInputSchema>;
export class UpdateIntroductionService {
  constructor(private readonly root: string, private readonly currentHome: () => Promise<string>) {}
  private async guard(input: Input) {
    IntroductionInputSchema.parse(input);
    const home = workflowHomeIdentity(await this.currentHome());
    if (!isAbsolute(input.homeId) || workflowHomeIdentity(input.homeId) !== home)
      throw new Error("FirstMate's home changed. Refresh before saving this choice.");
    return home;
  }
  private path(homeId: string, version: number) { return join(this.root, "update-introductions", digest(homeId), `${version}.json`); }
  async read(input: Input): Promise<{ homeId: string; version: typeof PROJECT_INTRODUCTION_VERSION; state: "available" | "dismissed" | "held" }> {
    const homeId = await this.guard(input), version = PROJECT_INTRODUCTION_VERSION;
    let state: "available" | "dismissed" | "held" = "available";
    try {
      const bytes = await readFile(this.path(homeId, version), "utf8");
      if (bytes.length > 4096) throw new Error("Oversized introduction preference");
      const saved = Receipt.parse(JSON.parse(bytes));
      state = saved.homeId === homeId && saved.version === version ? "dismissed" : "held";
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") state = "held"; }
    await this.guard(input);
    return { homeId, version, state };
  }
  async dismiss(input: Input) {
    const homeId = await this.guard(input), path = this.path(homeId, input.version);
    return serialized(path, async () => {
      await this.guard(input);
      const current = await this.read(input);
      if (current.state === "held") throw new Error("This introduction preference couldn't be checked. Try again after reconnecting.");
      if (current.state === "dismissed") return current;
      await mkdir(dirname(path), { recursive: true });
      await this.guard(input);
      try { await publish(path, { format: "firstmate.introduction/1", homeId, version: input.version, dismissed: true }); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; }
      const saved = await this.read(input);
      if (saved.state !== "dismissed") throw new Error("The introduction choice couldn't be confirmed. Try again.");
      return saved;
    });
  }
}
export function registerUpdateIntroduction(server: Pick<PluginServerContext, "handle">, service: UpdateIntroductionService) {
  server.handle(readUpdateIntroduction, input => service.read(input));
  server.handle(dismissUpdateIntroduction, input => service.dismiss(input));
}
