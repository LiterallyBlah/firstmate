import { readdir, readFile, stat, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { z } from "zod";
import { WorkflowCommandSchema, type WorkflowCommand } from "../shared/workflow-plans";
import { readFirstmateConfig, resolveHome, updateFirstmateConfig } from "./config";
import { pluginDir } from "./data-dir";
import { resolveInHome } from "./files";
import { oneAtATime } from "./mate";
import { serialized } from "./serialize";
import { digest, publish } from "./submissions";
import { WorkflowPlanStore } from "./workflow-plans";
import { isHomeReady } from "./home";
import { message, TEMPLATES } from "./templates";
import { randomUUID } from "node:crypto";
import type { ScopedPlanCommand, SupervisionCommands } from "./supervision-commands";
import type { SupervisionActor } from "../shared/supervision";

/** Separate, disabled-by-default cooperative command class. Legacy file requests stay legacy. */
export function executeScopedWorkflow(commands: SupervisionCommands, input: ScopedPlanCommand, actor: SupervisionActor) {
  return commands.planCommand(input, actor);
}

export const WorkflowRequestSchema = z.object({ id: z.uuid(), actor: z.string().min(1), command: WorkflowCommandSchema }).strict();
export function workflowStore(home: string) { return new WorkflowPlanStore(join(pluginDir(), "workflow-plans", digest(process.platform === "win32" ? resolve(home).toLowerCase() : resolve(home))), home); }
export async function authorizeWorkflowActor(home: string, actor: string): Promise<void> {
  const live = await readFirstmateConfig();
  if (!live.mateAgentId || live.mateAgentId !== actor || resolveHome(live) !== home || live.migration || live.mateLaunch) throw new Error("Current first-mate role required.");
}
export async function queuePlanNotes(home: string): Promise<void> {
  const store = workflowStore(home);
  for (const plan of await store.list()) for (const action of plan.captainEvents ?? []) {
    if (action.notified) continue;
    const id = `firstmate-plan-${action.id}`;
    const text = await message(TEMPLATES.workflowNote, { action: JSON.stringify({ plan: plan.definition.id, ...action }).replace(/</g, "\\u003c") });
    await serialized("firstmate.mate.notes", async () => {
      const config = await readFirstmateConfig();
      if (resolveHome(config) !== home) throw new Error("Home changed while queuing a plan note.");
      if (!config.mateNotes.some(n => n.id === id)) await updateFirstmateConfig({ mateNotes: [...config.mateNotes, { id, text }] });
    });
    await store.execute({ op: "notified", plan: plan.definition.id, eventId: action.id }, randomUUID(), "plugin:outbox");
  }
}
/** `route` is the S04 legacy/scoped partition guard. The live service passes none until activation. */
export async function processWorkflowRequests(home: string, store: WorkflowPlanStore, authorize: (actor: string) => Promise<void>,
  route?: (command: WorkflowCommand) => Promise<void>): Promise<void> {
  const { absolute: directory } = await resolveInHome(home, "data/workflow-requests");
  return serialized(directory, async () => {
    let files: string[]; try { files = await readdir(directory); } catch (e) { if ((e as NodeJS.ErrnoException).code === "ENOENT") return; throw e; }
    let processed = 0;
    for (const name of files.filter(f => /^[\da-f-]{36}\.json$/.test(f)).sort()) {
      const reply = join(directory, name.replace(/\.json$/, ".reply.json"));
      try {
        const saved = await stat(reply);
        // Transport replies are disposable; mutation idempotency lives in the durable log.
        // Never remove a pending request, and retain a full day for a lost read reply.
        if (Date.now() - saved.mtimeMs > 86400000) {
          await rm((await resolveInHome(home, `data/workflow-requests/${name}`)).absolute);
          await rm(reply);
        }
        continue;
      } catch (e) { if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e; }
      if (processed++ >= 20) break;
      let result: unknown;
      try {
        const path = (await resolveInHome(home, `data/workflow-requests/${name}`)).absolute;
        if ((await stat(path)).size > 256000) throw new Error("Workflow request too large.");
        const request = WorkflowRequestSchema.parse(JSON.parse(await readFile(path, "utf8")));
        if (`${request.id}.json` !== name) throw new Error("Request identity mismatch.");
        if (!["plans", "show", "agenda", "lint"].includes(request.command.op)) await authorize(request.actor);
        await route?.(request.command);
        result = { ok: true, result: await store.execute(request.command, request.id, request.actor) };
      } catch (error) { result = { ok: false, error: error instanceof Error ? error.message : String(error) }; }
      await publish(reply, result);
    }
  });
}
export function startWorkflowService() {
  let pending: Promise<void> | undefined;
  const timer = setInterval(() => {
    if (pending) return;
    pending = oneAtATime(async () => {
      const config = await readFirstmateConfig(), home = resolveHome(config);
      if (config.migration || config.mateLaunch || !(await isHomeReady(home))) return;
      await processWorkflowRequests(home, workflowStore(home), actor => authorizeWorkflowActor(home, actor));
      await queuePlanNotes(home);
    }).catch(e => console.error("[firstmate] workflow queue:", e)).finally(() => { pending = undefined; });
  }, 1000);
  return async () => { clearInterval(timer); await pending; };
}
