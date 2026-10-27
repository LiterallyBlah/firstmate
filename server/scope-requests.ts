/** S04 dispatch partition and the scope helper's request consumer. No service loop starts it.
 * The normal workflowStore supplies the legacy guard; direct fixture stores may inject one.
 * The request file's actor is cooperative (same-user files), never an authenticated principal.
 */
import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import type { SupervisionActor } from "../shared/supervision";
import { resolveInHome } from "./files";
import { serialized } from "./serialize";
import { publish } from "./submissions";
import { ScopedPlanCommandSchema, type SupervisionCommands } from "./supervision-commands";
import { recordContinuation, type ContinuationRecord } from "./supervision-continuation";
import type { SupervisionGateway } from "./supervision-effects";
import type { SupervisionStore } from "./supervision-store";
import type { WorkflowPlanStore } from "./workflow-plans";
import { InboxResultSchema } from "../shared/supervision-inbox";
import { SupervisionUuid } from "../shared/supervision";
import type { SupervisionInbox } from "./supervision-inbox";
import { supervisionInboxStatus } from "./supervision-status";
import { SupervisionError } from "./supervision-store";

import { commandPlan, scopeRoute } from "./supervision-routing";
export { commandPlan, scopeRoute, legacyRoute } from "./supervision-routing";

const inboxTarget = { requestId: SupervisionUuid, scopeId: SupervisionUuid, epoch: z.number().int().positive(), offerId: SupervisionUuid };
const ScopeInboxCommand = z.discriminatedUnion("op", [
  z.object({ ...inboxTarget, op: z.literal("ack"), eventIds: z.array(SupervisionUuid).min(1).max(32) }).strict(),
  z.object({ ...inboxTarget, op: z.literal("handle"), results: z.array(z.object({ eventId: SupervisionUuid, result: InboxResultSchema }).strict()).min(1).max(32) }).strict(),
]);
const ScopeOutboxCommand = z.object({ requestId: SupervisionUuid, scopeId: SupervisionUuid, epoch: z.number().int().positive(),
  scopeVersion: z.number().int().positive(), outboxId: SupervisionUuid, resultRef: z.string().min(1).max(256) }).strict();
const ScopeReadCommand = z.object({ scopeId: SupervisionUuid, epoch: z.number().int().positive(),
  page: z.enum(["inbox", "outbox", "audit"]), after: z.number().int().nonnegative().default(0) }).strict();
export const ScopeRequestSchema = z.object({ id: z.uuid(), actor: z.string().min(1).max(256),
  kind: z.enum(["plan", "continuation", "inbox", "outbox", "read"]), input: z.unknown() }).strict();
export interface ScopeHandlers {
  commands: SupervisionCommands; gateway: SupervisionGateway | null; store: SupervisionStore; legacy: WorkflowPlanStore;
  globalMateId: () => Promise<string | null>; continuationsEnabled?: boolean; inbox?: SupervisionInbox;
}
/** One request: guest scope principal, partition check, then the same checked S03/S04 paths. */
export async function handleScopeRequest(request: z.infer<typeof ScopeRequestSchema>, handlers: ScopeHandlers): Promise<unknown> {
  if (request.actor === await handlers.globalMateId()) throw new Error("The global first mate is not a scope principal; it keeps using workflow.mjs.");
  const actor: SupervisionActor = { kind: "agent", id: request.actor, source: "scope-helper/request-file" };
  if (request.kind === "read") {
    const input = ScopeReadCommand.parse(request.input), status = await handlers.store.read();
    const binding = status.bindings.find(b => b.scopeId === input.scopeId);
    if (binding?.agentId !== actor.id || binding.epoch !== input.epoch) throw new SupervisionError("UNKNOWN_OWNER", "Read the current bound scope; this helper never grants the global role.");
    if (input.page === "audit") {
      const audit = await handlers.store.audit();
      return { freshness: audit.freshness, sequence: audit.sequence, hash: audit.hash, problems: audit.problems };
    }
    if (input.page === "inbox") return supervisionInboxStatus(status, { scopeId: input.scopeId, after: input.after });
    const rows = status.outbox.filter(o => o.ownerScopeId === input.scopeId && o.state === "pending");
    const entries = rows.slice(input.after, input.after + 8);
    return { freshness: status.freshness, sequence: status.sequence, entries, nextAfter: input.after + entries.length,
      hasMore: rows.length > input.after + entries.length };
  }
  if (request.kind === "outbox") return handlers.commands.acknowledge(ScopeOutboxCommand.parse(request.input), actor);
  if (request.kind === "inbox") {
    if (!handlers.inbox) throw new Error("Scoped mailbox handling is not enabled.");
    const input = ScopeInboxCommand.parse(request.input);
    return input.op === "ack" ? handlers.inbox.acknowledge(input.scopeId, input.epoch, input.offerId, input.eventIds, input.requestId, actor.id) :
      handlers.inbox.handle(input.scopeId, input.epoch, input.offerId, input.results, input.requestId, actor.id);
  }
  if (request.kind === "continuation") {
    const input = request.input as ContinuationRecord;
    await scopeRoute(handlers.legacy, input.planId);
    return recordContinuation(handlers.store, input, actor, handlers.continuationsEnabled);
  }
  const input = ScopedPlanCommandSchema.parse(request.input), plan = commandPlan(input.command);
  if (!plan) throw new Error("Scoped commands name exactly one plan.");
  await scopeRoute(handlers.legacy, plan, input.command);
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
    let processed = 0;
    for (const name of files.filter(f => /^[\da-f-]{36}\.json$/.test(f)).sort()) {
      const reply = join(directory, name.replace(/\.json$/, ".reply.json"));
      try { await stat(reply); continue; } catch (e) { if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e; }
      if (processed++ >= 20) break;
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
