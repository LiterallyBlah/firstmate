/** Produce the fixture with real server projections, inside the caller's disposable home. */
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { workflowFixture } from "../../test/workflow-fixture";
import { workflowStore } from "../../server/workflow-service";
import { workflowSnapshot, withWorkflowNeeds, withWorkflowCards } from "../../server/workflow-board";
import { NeedsYouService } from "../../server/needs-you-service";
export async function produce(home: string) {
  await mkdir(join(home, "data"), { recursive: true });
  await writeFile(join(home, "data/backlog.md"), "## In flight\n## Queued\n## Done\n");
  await workflowStore(home).execute({ op: "draft", definition: workflowFixture() }, randomUUID(), "fixture-mate");
  let now = 1000;
  const service = new NeedsYouService({ root: join(home, "decisions"), home: async () => home, catalog: async () => null, enabled: () => true, now: () => now });
  await service.read(); now += 2000;
  const needs = await withWorkflowNeeds(await service.read(), home);
  const plans = await workflowSnapshot(home), cards = await withWorkflowCards([], home);
  cards.push({ ...structuredClone(cards.find(c => c.taskId === "build")!), key: "other-project", project: "other", title: "Unrelated build" });
  await service.stop(); return { needs, plans, cards };
}
