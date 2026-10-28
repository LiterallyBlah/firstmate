/** R12O N3: plan reads, the agenda, the board snapshot and the 1 s plan-note tick list `.scoped/` once rather than
 * reading four sidecar files per plan. A plan with a sidecar folder is still read in full; the writer's own check
 * is unchanged. Temporary home (test/setup.ts). */
import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { workflowFixture } from "../test/workflow-fixture";
import { updateFirstmateConfig } from "./config";
import { CutoverGate, legacyWorkflowRoot } from "./supervision-gate";
import { workflowSnapshot } from "./workflow-board";
import { queuePlanNotes, workflowStore } from "./workflow-service";

afterEach(() => { vi.restoreAllMocks(); });

it("reads no sidecar for plans without a cutover folder, and still reads a plan that has one", async () => {
  const home = join(process.env.PASEO_HOME!, "home");
  await mkdir(join(home, "data"), { recursive: true });
  await updateFirstmateConfig({ home, mateAgentId: "", migration: null, mateLaunch: null });
  const store = workflowStore(home);
  await store.execute({ op: "draft", definition: workflowFixture() }, randomUUID(), "general");
  const id = workflowFixture().id;
  const sidecar = vi.spyOn(CutoverGate.prototype, "sidecar");
  await store.read(); await store.agenda(); await workflowSnapshot(home); await queuePlanNotes(home);
  expect(sidecar).not.toHaveBeenCalled();

  // Another plan's folder costs this plan nothing; its own folder is read in full (empty: no cutover).
  await mkdir(join(legacyWorkflowRoot(home), ".scoped", "another-plan"), { recursive: true });
  await store.read(); await store.agenda();
  expect(sidecar).not.toHaveBeenCalled();
  await mkdir(join(legacyWorkflowRoot(home), ".scoped", id), { recursive: true });
  expect((await store.read()).plans.map(p => p.definition.id)).toEqual([id]);
  expect(new Set(sidecar.mock.calls.map(([plan]) => plan))).toEqual(new Set([id]));
});
