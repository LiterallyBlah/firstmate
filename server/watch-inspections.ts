/** Durable isolated sessions. No crew labels, parent, supervisor charter or native completion subscription. */
import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import { z } from "zod";
import { InspectionResultSchema, watchRouting, type WatchRouting, type ManagedWatch } from "../shared/watch-routing";
import type { FirstmateConfig, WatchSummary } from "../shared/fleet";
import { atomicJson } from "./watch-config";
import { archiveChildren } from "./archive-inventory";
import { fetchLiveAgent, resolveMate } from "./fleet";
import type { PaseoApi, TimelineItem, TimelinePage } from "./host-types";
import { isMidTurn, oneAtATime } from "./mate";
import { serialized } from "./serialize";
import { sendWithoutInterrupting } from "./send";
import { message, readTemplate, TEMPLATES } from "./templates";
import { watchNote } from "./watches";
import type { QueuedNote } from "./watches";
import { WatchRoutingSchema } from "../shared/watch-routing";
import { resolveHome } from "./config";

export const INSPECTION_TIMEOUT_MS = 5 * 60 * 1000;
const RunSchema = z.object({
  runId: z.string().uuid(), name: z.string(), at: z.string(), home: z.string(), prompt: z.string(),
  routing: z.object({ executionSession: z.literal("new"), newSessionReasoning: z.string(), notificationPolicy: z.enum(["actionable", "always", "never"]) }),
  provider: z.string(), thinkingOptionId: z.string(), workspaceId: z.string().nullable(),
  status: z.enum(["prepared", "sent", "completed", "failed"]),
  rawText: z.string(), report: InspectionResultSchema.nullable(), error: z.string().nullable(),
  errors: z.array(z.string()).default([]), deliveryRevision: z.number().int().nonnegative().default(0),
  delivery: z.enum(["pending", "sent", "suppressed"]), attempts: z.array(z.string()),
  cleanup: z.enum(["pending", "archived"]), cleanupError: z.string().nullable(),
  deliveryError: z.string().nullable(), fingerprint: z.string().nullable(),
});
type InspectionRun = z.infer<typeof RunSchema>;
const InputSchema = z.object({ id: z.string().uuid(), name: z.string(), prompt: z.string(), routing: WatchRoutingSchema, note: z.object({
  name: z.string(), ran: z.string(), kind: z.enum(["output", "failed"]), text: z.string(), reason: z.string().optional(),
}).optional() });
const StateSchema = z.object({ version: z.literal(1), runs: z.array(RunSchema), inputs: z.array(InputSchema).default([]), scheduled: z.record(z.string(), z.string()).default({}) }).strict();
type State = z.infer<typeof StateSchema>;
type Ended = { kind: string; error?: { message: string }; reason?: string; timeline: readonly TimelineItem[] };
export interface InspectionOptions {
  root: string;
  paseo: () => PaseoApi | null;
  config: () => Promise<FirstmateConfig>;
  snapshot: (paseo: PaseoApi, config: FirstmateConfig) => Promise<unknown>;
  now?: () => number;
  children?: typeof archiveChildren;
}

export async function inspectionChoices(paseo: PaseoApi | null, config: FirstmateConfig) {
  if (!paseo || config.migration !== null || config.mateLaunch !== null) return { available: false, reason: "Wait for an available first mate and completed handover.", thinking: [] };
  const { agent } = await resolveMate(paseo, config);
  if (!agent) return { available: false, reason: "Launch or adopt a first mate first.", thinking: [] };
  const [models, modes] = await Promise.all([
    paseo.providers.listModels(agent.provider, { cwd: agent.cwd }),
    paseo.providers.listModes(agent.provider, { cwd: agent.cwd }),
  ]);
  if (models.error || modes.error) throw new Error(models.error ?? modes.error ?? "Provider catalog unavailable.");
  const model = (models.models ?? []).find((entry) => agent.model === null ? entry.isDefault === true : entry.id === agent.model || entry.aliases?.includes(agent.model));
  const available = (modes.modes ?? []).some((mode) => mode.id === "read-only");
  return { available, reason: available ? null : "The current provider has no read-only mode; isolated inspection is unavailable.",
    thinking: (model?.thinkingOptions ?? []).map(({ id, label }) => ({ id, label })) };
}

export function parseInspectionResult(text: string, runId: string) {
  if (text.length > 32000) throw new Error("Inspection result exceeds 32,000 characters.");
  const result = InspectionResultSchema.parse(JSON.parse(text.trim()));
  if (result.runId !== runId) throw new Error("Inspection result has the wrong run ID.");
  return result;
}

/** Only the saved prompt's final logical assistant message can be a result. Hidden system notes
 * are not boundaries. Distinct message IDs remain distinct even within the same turn. */
export function inspectionResultText(entries: TimelinePage["entries"], promptId: string): string {
  let promptIndex = -1;
  entries.forEach(({ item }, index) => { if (item.type === "user_message" && item.clientMessageId === promptId) promptIndex = index; });
  if (promptIndex < 0) throw new Error("Inspector timeline did not contain the saved prompt.");
  const after = entries.slice(promptIndex + 1);
  if (after.some(({ item }) => item.type === "user_message")) throw new Error("Inspector received another prompt; its result cannot be attributed to this watch.");
  const assistant = after.filter(({ item }) => item.type === "assistant_message");
  const last = assistant.at(-1);
  if (!last || last.item.type !== "assistant_message") return "";
  const pieces = [last.item.text];
  // Providers may stream chunks with one explicit message ID. Without that ID, accept only the
  // final item; joining unrelated messages would fabricate a structured response.
  if (last.item.messageId) {
    for (let index = assistant.length - 2; index >= 0; index--) {
      const entry = assistant[index];
      if (!entry || entry.item.type !== "assistant_message" || entry.item.messageId !== last.item.messageId || entry.turnId !== last.turnId) break;
      pieces.unshift(entry.item.text);
    }
  }
  const promptTurn = entries[promptIndex]?.turnId;
  if (promptTurn && last.turnId && last.turnId !== promptTurn) throw new Error("Inspector result belongs to a different turn.");
  return pieces.join("");
}

/** Reconcile an uncertain acknowledgement through the complete retained timeline, including old mates. */
export async function timelineHasMessage(paseo: PaseoApi, agentId: string, messageId: string): Promise<boolean> {
  let cursor: NonNullable<Parameters<ReturnType<PaseoApi["agents"]["ref"]>["timeline"]["refetch"]>[0]>["cursor"];
  const seen = new Set<string>();
  for (;;) {
    const page = await paseo.agents.ref(agentId).timeline.refetch({ direction: cursor ? "before" : "tail", limit: 200, projection: "projected", ...(cursor ? { cursor } : {}) });
    if (page.error || page.staleCursor || page.gap) throw new Error(`Cannot reconcile result acknowledgement: ${page.error ?? "timeline changed or has a gap"}`);
    if (page.entries.some(({ item }) => item.type === "user_message" && item.clientMessageId === messageId)) return true;
    if (!page.hasOlder) return false;
    const next = page.startCursor; const key = JSON.stringify(next);
    if (!next || seen.has(key) || page.entries.length === 0) throw new Error("Timeline did not provide a progressing acknowledgement scan.");
    seen.add(key); cursor = next;
  }
}

export class WatchInspections {
  private state: State | null = null;
  private stopped = false;
  private readonly ended = new Map<string, Ended>();
  readonly statePath: string;
  constructor(private readonly options: InspectionOptions) { this.statePath = join(options.root, "inspection-runs.json"); }
  private now() { return (this.options.now ?? Date.now)(); }
  private directory(run: InspectionRun) { return join(this.options.root, "runs", run.runId); }
  private async load() {
    if (this.state) return this.state;
    try { this.state = StateSchema.parse(JSON.parse(await readFile(this.statePath, "utf8"))); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      this.state = { version: 1, runs: [], inputs: [], scheduled: {} };
    }
    return this.state;
  }
  private save() { return atomicJson(this.statePath, this.state); }
  private locked<T>(task: () => Promise<T>) { return serialized(`${this.statePath}.operations`, task); }
  stop() { this.stopped = true; }
  endedTurn(agentId: string, event: Ended) { this.ended.set(agentId, event); }
  private terminal(run: InspectionRun) { return run.status === "completed" || run.status === "failed"; }

  busy(name: string): Promise<boolean> {
    return this.locked(async () => { const state = await this.load(); return state.inputs.some((input) => input.name === name) ||
      state.runs.some((run) => run.name === name && (!this.terminal(run) || run.delivery === "pending" || run.cleanup !== "archived")); });
  }
  queueInput(name: string, prompt: string, routing: WatchRouting, note?: QueuedNote, minute?: string): Promise<void> {
    return this.locked(async () => {
      const state = await this.load();
      if (minute && state.scheduled[name] === minute) return;
      state.inputs.push({ id: randomUUID(), name, prompt, routing: watchRouting(routing), ...(note ? { note } : {}) });
      if (minute) state.scheduled[name] = minute;
      await this.save();
    });
  }
  async drainInputs() {
    const inputs = await this.locked(async () => [...(await this.load()).inputs]);
    for (const input of inputs) {
      // Persisted input ID doubles as the session/run identity: a crash before dequeue cannot repeat a review.
      const note = input.note ? { name: input.note.name, ran: input.note.ran, kind: input.note.kind, text: input.note.text,
        ...(input.note.reason === undefined ? {} : { reason: input.note.reason }) } : undefined;
      const started = await this.start(input.name, input.prompt, input.routing, input.id, note);
      if (started) await this.locked(async () => { const state = await this.load(); state.inputs = state.inputs.filter((entry) => entry.id !== input.id); await this.save(); });
    }
  }

  start(name: string, instructions: string, routing: WatchRouting, inputId?: string, note?: QueuedNote): Promise<boolean> {
    return this.locked(async () => {
      if (this.stopped) return false;
      const state = await this.load();
      if (inputId && state.runs.some((run) => run.runId === inputId)) return true;
      // Pending results and cleanup also hold the slot. Never accumulate inspectors behind a busy mate.
      if (state.runs.some((run) => run.name === name && (!this.terminal(run) || run.delivery === "pending" || run.cleanup !== "archived"))) return false;
      const paseo = this.options.paseo();
      if (!paseo) return false;
      // No delivery helper is called from this non-reentrant gate.
      return oneAtATime(async () => {
        const config = await this.options.config();
        if (this.stopped || config.migration !== null || config.mateLaunch !== null) return false;
        const { agent: mate } = await resolveMate(paseo, config);
        if (!mate) return false;
        const runId = inputId ?? randomUUID();
        const run: InspectionRun = { runId, name, at: new Date(this.now()).toISOString(), home: resolveHome(config),
          prompt: "", routing: { ...watchRouting(routing), executionSession: "new" }, provider: `${mate.provider}${mate.model ? `/${mate.model}` : ""}`,
          thinkingOptionId: routing.newSessionReasoning === "inherit" ? mate.thinkingOptionId ?? "" : routing.newSessionReasoning,
          workspaceId: null, status: "prepared", rawText: "", report: null, error: null, delivery: "suppressed", attempts: [],
          errors: [], deliveryRevision: 0,
          cleanup: "pending", cleanupError: null, deliveryError: null, fingerprint: null };
        state.runs.push(run); await this.save();
        try {
          if (note?.kind === "failed") throw new Error(`${note.reason ?? "Watch script failed"}\n${note.text}`);
          const choices = await inspectionChoices(paseo, config);
          if (!choices.available) throw new Error(choices.reason ?? "Read-only inspection unavailable.");
          if (run.thinkingOptionId !== "" && !choices.thinking.some((option) => option.id === run.thinkingOptionId))
            throw new Error(`Reasoning '${run.thinkingOptionId}' is not supported by the current model. Edit this watch; no fallback was applied.`);
          const snapshot = await this.options.snapshot(paseo, config);
          const snapshotText = JSON.stringify(snapshot);
          if (snapshotText.length > 64000) throw new Error("Board snapshot exceeds 64,000 characters; inspection did not run. Evidence remains on the board.");
          run.prompt = await message(TEMPLATES.watchInspection, { runId, instructions, snapshot: snapshotText });
          const directory = this.directory(run);
          await mkdir(directory, { recursive: true });
          const cwd = join(this.options.root, "workspaces", name);
          const homePath = resolve(resolveHome(config)).toLowerCase(); const inspectorPath = resolve(cwd).toLowerCase();
          if (inspectorPath === homePath || inspectorPath.startsWith(`${homePath}${sep}`)) throw new Error("Inspector directory must be outside the first-mate home.");
          await mkdir(cwd, { recursive: true });
          await writeFile(join(cwd, "AGENTS.md"), await message(TEMPLATES.watchInspectorAgents), "utf8");
          await writeFile(join(cwd, "inspector-mcp.mjs"), await readTemplate(TEMPLATES.inspectorMcp), "utf8");
          await atomicJson(join(directory, "input.json"), snapshot);
          const workspace = await paseo.workspaces.open(cwd);
          if (workspace.id === mate.workspaceId) throw new Error("Inspector workspace is not separate from the first mate.");
          run.workspaceId = workspace.id; await this.save();
          await workspace.agents.create({ agentId: runId, idempotencyKey: runId,
            config: { provider: run.provider, modeId: "read-only", ...(run.thinkingOptionId ? { thinkingOptionId: run.thinkingOptionId } : {}),
              systemPrompt: await message(TEMPLATES.watchInspectorAgents),
              mcpServers: { paseo: { type: "stdio", command: process.execPath, args: [join(cwd, "inspector-mcp.mjs")] } },
              ...(mate.provider === "codex" ? { options: { sandbox_mode: "read-only", approval_policy: "never", web_search: "disabled", features: { multi_agent_v2: false } } } : {}),
            }, title: `Watch inspection: ${name}`, labels: { "firstmate.role": "watch-inspector", "firstmate.watch": name, "firstmate.watch-run": runId } });
          const inspector = await fetchLiveAgent(paseo, runId);
          if (!inspector || inspector.workspaceId !== workspace.id || inspector.labels["paseo.parent-agent-id"] || inspector.currentModeId !== "read-only")
            throw new Error("Inspector did not confirm independent read-only isolation.");
          // Persist prepared identity and exact prompt before send. Reconciliation reuses this message ID.
          await this.save();
          await sendWithoutInterrupting(paseo, runId, run.prompt, { messageId: `firstmate-inspection-${runId}` }, { channel: "inspection-prompt", actor: "plugin" });
          run.status = "sent"; await this.save();
        } catch (error) { await this.fail(run, error); }
        return true;
      });
    });
  }

  private async fail(run: InspectionRun, error: unknown) {
    run.status = "failed"; run.error = error instanceof Error ? error.message : String(error);
    run.errors.push(run.error);
    run.delivery = "pending"; run.fingerprint = `failure:${run.error}`;
    this.ended.delete(run.runId); await this.save();
  }

  reconcile(): Promise<void> {
    return this.locked(async () => {
      if (this.stopped) return;
      const paseo = this.options.paseo(); if (!paseo) return;
      const state = await this.load();
      for (const run of state.runs) {
        if (this.stopped) return;
        if (!this.terminal(run)) {
          try {
            const agent = await fetchLiveAgent(paseo, run.runId);
            if (!agent) throw new Error("Inspector disappeared or was archived before a result was saved.");
            const ended = this.ended.get(run.runId);
            if (ended && ended.kind !== "completed") throw new Error(ended.error?.message ?? ended.reason ?? "Inspection was canceled.");
            if (agent.pendingPermissions.length > 0) {
              for (const permission of agent.pendingPermissions) await paseo.agents.ref(run.runId).respondToPermission({ requestId: permission.id,
                response: { behavior: "deny", interrupt: true, message: "Watch inspectors cannot request additional authority." } });
              throw new Error("Inspector requested permission; denied and stopped.");
            }
            if (agent.status === "error" || agent.status === "closed") throw new Error(agent.lastError ?? "Inspector failed or closed.");
            if (this.now() - Date.parse(run.at) > INSPECTION_TIMEOUT_MS) throw new Error("Inspector exceeded five minutes; stopped.");
            if (isMidTurn(agent)) continue;
            const page = await paseo.agents.ref(run.runId).timeline.refetch({ direction: "tail", limit: 200, projection: "projected" });
            if (page.error || page.gap || page.staleCursor) throw new Error(`Inspection timeline unavailable: ${page.error ?? "timeline changed or has a gap"}`);
            // End hooks can omit system notes and carry item-only data; use retained entries for
            // explicit turn/message boundaries, and the hook only for cancellation/failure.
            const accepted = page.entries.some(({ item }) => item.type === "user_message" && item.clientMessageId === `firstmate-inspection-${run.runId}`);
            if (!accepted && run.status === "prepared") {
              // Do not create another agent after a lost acknowledgement. Existing identity is the recovery boundary.
              await sendWithoutInterrupting(paseo, run.runId, run.prompt, { messageId: `firstmate-inspection-${run.runId}` }, { channel: "inspection-prompt", actor: "plugin" });
              run.status = "sent"; await this.save(); continue;
            }
            if (!accepted) throw new Error("Inspector timeline did not contain the saved prompt.");
            run.rawText = inspectionResultText(page.entries, `firstmate-inspection-${run.runId}`);
            run.report = parseInspectionResult(run.rawText, run.runId);
            run.status = "completed";
            run.delivery = run.routing.notificationPolicy === "always" || (run.routing.notificationPolicy === "actionable" && run.report.outcome === "actionable") ? "pending" : "suppressed";
            run.fingerprint = JSON.stringify(run.report.findings.map((finding) => JSON.stringify(finding)).sort());
            this.ended.delete(run.runId);
            await atomicJson(join(this.directory(run), "result.json"), { report: run.report, rawText: run.rawText });
            await this.save();
          } catch (error) { await this.fail(run, error); }
        }
        if (run.delivery === "pending") {
          // Repeated identical findings/failures are retained but do not keep waking the first mate.
          const previous = state.runs.slice(0, state.runs.indexOf(run)).reverse().find((entry) => entry.name === run.name && this.terminal(entry) && entry.delivery !== "pending");
          if ((run.status === "failed" || run.routing.notificationPolicy !== "always") && previous?.fingerprint === run.fingerprint) {
            run.delivery = "suppressed"; await this.save();
          } else await this.deliver(paseo, run);
        }
        if (run.cleanup === "pending") {
          try {
            const inspector = await fetchLiveAgent(paseo, run.runId);
            if (inspector) {
              if (inspector.labels["firstmate.watch-run"] !== run.runId || inspector.labels["paseo.parent-agent-id"])
                throw new Error("Cannot archive an inspector whose ownership changed.");
              if ((await (this.options.children ?? archiveChildren)(run.runId)).length > 0) throw new Error("Inspector has descendants; automatic archive refused.");
              await paseo.agents.ref(run.runId).archive();
              if (await fetchLiveAgent(paseo, run.runId)) throw new Error("Inspector archive has not been confirmed.");
            }
            run.cleanup = "archived"; run.cleanupError = null; await this.save();
          } catch (error) {
            const reason = String(error);
            if (run.cleanupError !== reason) {
              run.cleanupError = reason; run.error = `Inspection cleanup failed: ${reason}`; run.errors.push(run.error);
              run.status = "failed"; run.delivery = "pending"; run.attempts = []; run.deliveryRevision += 1;
              run.fingerprint = `cleanup:${reason}`;
            }
            await this.save();
          }
        }
      }
    });
  }

  private async deliver(paseo: PaseoApi, run: InspectionRun) {
    try {
      const text = await watchNote([{ name: run.name, ran: run.at, kind: run.status === "failed" ? "failed" : "output",
        ...(run.error ? { reason: run.error } : {}), text: JSON.stringify({ runId: run.runId, result: run.report, errors: run.errors }) }], 0);
      await oneAtATime(async () => {
        const config = await this.options.config();
        if (this.stopped || config.migration !== null || config.mateLaunch !== null) return;
        const { agent } = await resolveMate(paseo, config);
        if (!agent || isMidTurn(agent) || agent.pendingPermissions.length > 0) return;
        const messageId = `firstmate-watch-result-${run.runId}${run.deliveryRevision ? `-${run.deliveryRevision}` : ""}`;
        // A response lost before migration may already have delivered. Check prior targets, never send to them.
        for (const target of run.attempts) {
          if (await timelineHasMessage(paseo, target, messageId)) {
            run.delivery = "sent"; run.deliveryError = null; await this.save(); return;
          }
        }
        if (!run.attempts.includes(agent.id)) { run.attempts.push(agent.id); await this.save(); }
        await sendWithoutInterrupting(paseo, agent.id, text, { messageId }, { channel: "inspection-delivery", actor: "plugin", relates: [`firstmate-inspection-${run.runId}`], mateRecipient: true });
        run.delivery = "sent"; run.deliveryError = null; await this.save();
      });
    } catch (error) { run.deliveryError = String(error); await this.save(); }
  }

  history(name: string) {
    return this.locked(async () => ({ runs: (await this.load()).runs.filter((run) => run.name === name).reverse().map((run) => ({
      runId: run.runId, at: run.at, status: run.status, delivery: run.delivery, cleanup: run.cleanup,
      report: JSON.stringify({ result: run.report, error: run.error, errors: run.errors, rawText: run.rawText, deliveryError: run.deliveryError, cleanupError: run.cleanupError }, null, 2),
      agentId: run.workspaceId === null ? null : run.runId,
    })) }));
  }
  summary(watch: ManagedWatch): Promise<WatchSummary> {
    return this.locked(async () => {
      const runs = (await this.load()).runs.filter((run) => run.name === watch.name);
      const run = runs.at(-1);
      const queued = (await this.load()).inputs.some((input) => input.name === watch.name);
      return { name: watch.name, schedule: watch.schedule, enabled: watch.enabled, invalid: null,
        running: run !== undefined && !this.terminal(run), lastRunAt: run?.at ?? null,
        lastResult: queued ? "queued" : !run ? "never" : run.status === "failed" ? "failed" : run.delivery === "pending" ? "queued" : run.delivery === "sent" ? "delivered" : "silent",
        lastOutput: run ? JSON.stringify(run.report ?? { status: run.status, error: run.error }, null, 2) : null,
        lastOutputAt: run?.at ?? null, lastError: run?.error ?? run?.deliveryError ?? run?.cleanupError ?? null,
        builtIn: false, outdated: false, routing: watchRouting(watch), managed: true, prompt: watch.prompt,
      };
    });
  }
}
