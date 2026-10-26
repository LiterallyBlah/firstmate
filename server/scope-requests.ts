/** S04 dispatch partition and the scope helper's request consumer. Unwired: no service loop starts it,
 * and `processWorkflowRequests` only applies the legacy guard when a caller passes one.
 * The request file's actor is cooperative (same-user files), never an authenticated principal.
 */
import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import type { SupervisionActor } from "../shared/supervision";
import type { WorkflowCommand } from "../shared/workflow-plans";
import { resolveInHome } from "./files";
import { serialized } from "./serialize";
import { publish } from "./submissions";
import { ScopedPlanCommandSchema, type SupervisionCommands } from "./supervision-commands";
import { recordContinuation, type ContinuationRecord } from "./supervision-continuation";
import type { SupervisionGateway } from "./supervision-effects";
import type { SupervisionStore } from "./supervision-store";
import type { WorkflowPlanStore } from "./workflow-plans";

const READS = ["plans", "show", "agenda", "lint"];
export function commandPlan(command: WorkflowCommand): string | null {
  return command.op === "draft" || command.op === "revise" ? command.definition.id : command.op === "implicit" ? command.launch.id : "plan" in command ? command.plan : null;
}
/** Legacy helper/board/decision writes refuse plans the scoped store owns or retains. An unreadable
 * scoped store still answers from its retained ownership capsules; it never blocks unrelated legacy work.
 */
export async function legacyRoute(supervision: SupervisionStore, command: WorkflowCommand): Promise<void> {
  if (READS.includes(command.op)) return;
  const plan = commandPlan(command);
  if (!plan) return;
  const status = await supervision.read();
  if (status.freshness === "uninitialized") return;
  if (status.backends.some(b => b.planId === plan) || status.retainedOwnership.some(o => o.workflows.some(w => w.plan === plan)))
    throw new Error(`Plan ${plan} is owned by a scoped supervisor; the legacy first-mate helper cannot change it.`);
}
/** Scoped commands refuse any plan the legacy store owns, has quarantined, or cannot currently prove absent. */
export async function scopeRoute(legacy: WorkflowPlanStore, plan: string): Promise<void> {
  const read = await legacy.read();
  if (read.unavailable) throw new Error("The legacy plan store is unavailable; a scoped command cannot prove its target is not legacy.");
  if (read.plans.some(p => p.definition.id === plan) || read.quarantined.some(q => q.plan === plan))
    throw new Error(`Plan ${plan} belongs to the legacy first mate; the scope helper cannot change it.`);
}

export const ScopeRequestSchema = z.object({ id: z.uuid(), actor: z.string().min(1).max(256),
  kind: z.enum(["plan", "continuation"]), input: z.unknown() }).strict();
export interface ScopeHandlers {
  commands: SupervisionCommands; gateway: SupervisionGateway | null; store: SupervisionStore; legacy: WorkflowPlanStore;
  globalMateId: () => Promise<string | null>; continuationsEnabled?: boolean;
}
/** One request: guest scope principal, partition check, then the same checked S03/S04 paths. */
export async function handleScopeRequest(request: z.infer<typeof ScopeRequestSchema>, handlers: ScopeHandlers): Promise<unknown> {
  if (request.actor === await handlers.globalMateId()) throw new Error("The global first mate is not a scope principal; it keeps using workflow.mjs.");
  const actor: SupervisionActor = { kind: "agent", id: request.actor, source: "scope-helper/request-file" };
  if (request.kind === "continuation") {
    const input = request.input as ContinuationRecord;
    await scopeRoute(handlers.legacy, input.planId);
    return recordContinuation(handlers.store, input, actor, handlers.continuationsEnabled);
  }
  const input = ScopedPlanCommandSchema.parse(request.input), plan = commandPlan(input.command);
  if (!plan) throw new Error("Scoped commands name exactly one plan.");
  await scopeRoute(handlers.legacy, plan);
  // One dispatch path: a scoped start always reserves its attempt and effects through the gateway.
  if (["start", "implicit", "claim"].includes(input.command.op)) {
    if (!handlers.gateway) throw new Error("Scoped starts need the S04 gateway; it is not enabled.");
    return handlers.gateway.startWorker(input, actor);
  }
  return handlers.commands.planCommand(input, actor);
}
export async function processScopeRequests(home: string, handlers: ScopeHandlers): Promise<void> {
  const { absolute: directory } = await resolveInHome(home, "data/scope-requests");
  return serialized(directory, async () => {
    let files: string[]; try { files = await readdir(directory); } catch (e) { if ((e as NodeJS.ErrnoException).code === "ENOENT") return; throw e; }
    for (const name of files.filter(f => /^[\da-f-]{36}\.json$/.test(f)).sort().slice(0, 20)) {
      const reply = join(directory, name.replace(/\.json$/, ".reply.json"));
      try { await stat(reply); continue; } catch (e) { if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e; }
      let result: unknown;
      try {
        const path = (await resolveInHome(home, `data/scope-requests/${name}`)).absolute;
        if ((await stat(path)).size > 256000) throw new Error("Scope request too large.");
        const request = ScopeRequestSchema.parse(JSON.parse(await readFile(path, "utf8")));
        if (`${request.id}.json` !== name) throw new Error("Request identity mismatch.");
        result = { ok: true, result: await handleScopeRequest(request, handlers) };
      } catch (error) {
        const code = (error as { code?: unknown }).code;
        result = { ok: false, error: error instanceof Error ? error.message : String(error), ...(typeof code === "string" ? { code } : {}) };
      }
      await publish(reply, result);
    }
  });
}
