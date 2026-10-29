/** S04 dispatch partition and Build B's default-off scope helper request consumer.
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
import type { PlanRules } from "./plan-rules";
import { readProjectContext } from "./supervision-memory";

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
  page: z.enum(["inbox", "outbox", "audit", "state", "context"]), after: z.number().int().nonnegative().default(0) }).strict();
export const ScopeRequestSchema = z.object({ id: z.uuid(), actor: z.string().min(1).max(256),
  kind: z.enum(["plan", "continuation", "inbox", "outbox", "read", "rule-verification", "rule-failure", "policy-evidence", "policy", "rules", "pr-bind", "artifact", "project-result", "stop-worker"]), input: z.unknown() }).strict();
export interface ScopeHandlers {
  commands: SupervisionCommands; gateway: SupervisionGateway | null; store: SupervisionStore; legacy: WorkflowPlanStore;
  globalMateId: () => Promise<string | null>; continuationsEnabled?: boolean; inbox?: SupervisionInbox;
  rules?: PlanRules;
  admin?: (kind: "policy" | "rules", requestId: string, input: unknown, actor: SupervisionActor) => Promise<unknown>;
  bindPr?: (requestId: string, input: unknown, actor: SupervisionActor) => Promise<unknown>;
  projectResult?: (requestId: string, input: unknown, actor: SupervisionActor) => Promise<unknown>;
}
/** One request: guest scope principal, partition check, then the same checked S03/S04 paths. */
export async function handleScopeRequest(request: z.infer<typeof ScopeRequestSchema>, handlers: ScopeHandlers): Promise<unknown> {
  const global = request.actor === await handlers.globalMateId();
  if (request.kind === "artifact") {
    if (!handlers.rules) throw new Error("Scoped artifacts are disabled.");
    return handlers.rules.artifact(request.id, request.input, { kind: global ? "mate-chat" : "agent", id: request.actor, source: "scope artifact request (cooperative)" });
  }
  if (request.kind === "rules" && !global) {
    if (!handlers.rules) throw new Error("Plan rules are disabled.");
    return handlers.rules.import(request.id, request.input as never, { kind: "agent", id: request.actor, source: "scope-helper/request-file" });
  }
  if (request.kind === "policy" || request.kind === "rules") {
    if (!global || !handlers.admin) throw new Error("Only the current General may submit reviewed source-bound policy/rules imports.");
    return handlers.admin(request.kind, request.id, request.input, { kind: "mate-chat", id: request.actor, source: "reviewed scope-policy request file (cooperative)" });
  }
  if (global) throw new Error("The global first mate is not a scope principal; it keeps using workflow.mjs.");
  const actor: SupervisionActor = { kind: "agent", id: request.actor, source: "scope-helper/request-file" };
  if (request.kind === "stop-worker") {
    if (!handlers.gateway) throw new Error("Checked worker stops are disabled.");
    const input = z.object({ scopeId: z.uuid(), epoch: z.number().int().positive(), attemptId: z.uuid(), causation: z.string().min(1).max(512) }).strict().parse(request.input);
    const effect = await handlers.gateway.propose({ ...input, requestId: request.id, operation: "agent.interrupt" }, actor);
    return effect.state === "reserved" ? handlers.gateway.dispatch(effect.id) : effect;
  }
  if (request.kind === "policy-evidence") {
    if (!handlers.rules) throw new Error("Policy evidence transport is disabled.");
    return handlers.rules.policyEvidence(request.id, request.input, actor);
  }
  if (request.kind === "project-result") {
    if (!handlers.projectResult) throw new Error("Project judgment handling is disabled.");
    return handlers.projectResult(request.id, request.input, actor);
  }
  if (request.kind === "pr-bind") {
    if (!handlers.bindPr) throw new Error("Scoped PR sources are disabled.");
    return handlers.bindPr(request.id, request.input, actor);
  }
  if (request.kind === "rule-verification" || request.kind === "rule-failure") {
    if (!handlers.rules) throw new Error("Plan-rule evidence is disabled.");
    return handlers.rules.evidence(request.id, request.kind, request.input, actor);
  }
  if (request.kind === "read") {
    const input = ScopeReadCommand.parse(request.input), status = await handlers.store.read();
    const binding = status.bindings.find(b => b.scopeId === input.scopeId);
    if (binding?.agentId !== actor.id || binding.epoch !== input.epoch) throw new SupervisionError("UNKNOWN_OWNER", "Read the current bound scope; this helper never grants the global role.");
    if (input.page === "context") {
      const scope = status.scopes.find(s => s.id === input.scopeId), ids = scope?.projectIds.slice(input.after, input.after + 1) ?? [];
      const contexts = await Promise.all(ids.map(id => readProjectContext(handlers.store, id)));
      const proposals = status.projects?.memoryProposals.filter(p => p.scopeId === input.scopeId && p.state === "proposed").slice(0, 8) ?? [];
      const pending = await Promise.all(proposals.map(async p => ({ ...p, text: Buffer.from(await handlers.store.readBlob(p.textDigest, 16384)).toString("utf8"), authority: "none" })));
      return { contexts, proposals: pending, nextAfter: input.after + ids.length, hasMore: input.after + ids.length < (scope?.projectIds.length ?? 0) };
    }
    if (input.page === "audit") {
      const audit = await handlers.store.audit();
      return { freshness: audit.freshness, sequence: audit.sequence, hash: audit.hash, problems: audit.problems };
    }
    if (input.page === "state") {
      const ownTasks = status.tasks.filter(t => t.ownerScopeId === input.scopeId);
      const entries = ownTasks.slice(input.after, input.after + 8);
      return { freshness: status.freshness, homeId: status.homeId, scope: status.scopes.find(s => s.id === input.scopeId), binding,
        plans: status.plans.filter(p => p.scopeId === input.scopeId), rules: status.planRules?.filter(r => r.scopeId === input.scopeId),
        tasks: entries, attempts: status.attempts.filter(a => entries.some(t => t.id === a.taskId)),
        policyRules: status.policyRules.filter(r => r.selector.scopeIds.includes(input.scopeId)),
        policySources: status.policySources.filter(source => status.policyRules.some(rule => rule.selector.scopeIds.includes(input.scopeId) && rule.sources.some(ref => ref.id === source.id))), evidence: status.policyEvidence.filter(e => e.scopeId === input.scopeId),
        project: status.projects?.projects.find(p => p.scopeId === input.scopeId),
        conflicts: status.projects?.conflicts.filter(c => c.ownerScopeId === input.scopeId).slice(-8),
        memory: status.projects?.memory.filter(m => m.scopeId === input.scopeId).slice(-32),
        proposals: status.projects?.memoryProposals.filter(m => m.scopeId === input.scopeId && m.state === "proposed").slice(-8),
        violations: status.ruleViolations?.filter(v => v.scopeId === input.scopeId).slice(-8), nextAfter: input.after + entries.length,
        hasMore: input.after + entries.length < ownTasks.length };
    }
    if (input.page === "inbox") return supervisionInboxStatus(status, { scopeId: input.scopeId, after: input.after });
    const rows = status.outbox.filter(o => o.ownerScopeId === input.scopeId && o.state === "pending");
    const entries = rows.slice(input.after, input.after + 8).map(row => ({ ...row,
      projectInput: status.commands.find(c => c.id === row.causationId)?.result.projectInput,
      decision: row.decisionId ? status.decisions.find(d => d.id === row.decisionId) : undefined }));
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
  if (["replace", "retire"].includes(input.command.op)) {
    if (!handlers.gateway) throw new Error("Scoped recovery needs its checked S04 adapter.");
    return handlers.gateway.recoverPlan(input, actor);
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
        if (Buffer.byteLength(JSON.stringify(result)) > 512 * 1024) throw new SupervisionError("HELD", "Scope response exceeds 512 KiB; narrow the request or page its retained inputs.");
      } catch (error) {
        const code = (error as { code?: unknown }).code;
        result = { ok: false, error: error instanceof Error ? error.message : String(error), ...(typeof code === "string" ? { code } : {}) };
      }
      await publish(reply, result);
    }
  });
}
