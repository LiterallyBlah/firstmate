/** Append-only planning ledger. Reads have no effects; no method creates or prompts an agent. */
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rename, writeFile, stat } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { z } from "zod";
import { PlanId, WorkflowCommandSchema, planPosture, planProblems, planWorstCase, type AgendaItem, type PlanDefinition, type WorkflowCommand, type WorkflowPlan, type PlanNode } from "../shared/workflow-plans";
import { digest, publish } from "./submissions";
import { serialized } from "./serialize";
import { resolveInHome } from "./files";
import { parseBacklog } from "./backlog";
import { fill, readTemplate, TEMPLATES } from "./templates";

const EventSchema = z.object({ version: z.literal(1), plan: PlanId, sequence: z.number().int().nonnegative(), previous: z.string().length(64).nullable(),
  requestId: z.uuid(), requestHash: z.string().length(64), at: z.iso.datetime(), by: z.string().min(1),
  command: WorkflowCommandSchema, attempt: z.uuid().optional(), briefHash: z.string().length(64).optional(), hash: z.string().length(64) }).strict();
type Event = z.infer<typeof EventSchema>;
const checksum = ({ hash: _hash, ...event }: Event) => digest(event);
const terminal = (state: string) => ["done", "landed", "failed", "cancelled"].includes(state);
export function dependenciesMet(node: PlanNode, plans: readonly WorkflowPlan[]): boolean {
  return node.after.every(edge => {
    const state = plans.flatMap(p => Object.entries(p.nodes)).find(([id]) => id === edge.node)?.[1];
    return edge.on === "answered" ? !!state?.answer : edge.on === "landed" ? state?.state === "landed" : state?.state === "done" || state?.state === "landed";
  });
}
function reduce(previous: WorkflowPlan | null, event: Event): WorkflowPlan {
  const c = event.command;
  let next = previous ? structuredClone(previous) : null;
  if (c.op === "draft" || c.op === "implicit") {
    if (previous) throw new Error("Duplicate plan creation.");
    const definition: PlanDefinition = c.op === "draft" ? c.definition : {
      format: "firstmate.plan/1", id: c.launch.id, title: c.launch.title, request: { text: c.launch.title, at: event.at }, implicit: true,
      budget: { agents: 1, turns: 1 }, nodes: [{ id: c.launch.id, kind: "run", title: c.launch.title, summary: c.launch.title,
        workflow: c.launch.kind === "scout" ? "scout@1" : "task@1", launch: c.launch, after: [] }],
    };
    const posture = planPosture(definition);
    next = { definition, revision: 1, sequence: 0, hash: "", posture, status: posture === "review" ? "review" : "active",
      approvedBudget: planWorstCase(definition), nodes: Object.fromEntries(definition.nodes.map(n => [n.id, { state: "planned" as const }])), told: [], handled: [],
      history: [{ revision: 1, at: event.at, by: event.by, reason: "draft" }] };
  }
  if (!next) throw new Error("Plan log does not start with a draft.");
  if (c.op === "revise") {
    if (c.expected !== previous?.hash || c.definition.id !== next.definition.id) throw new Error("Stale plan revision.");
    for (const old of next.definition.nodes) {
      if (next.nodes[old.id]?.state !== "planned" && digest(c.definition.nodes.find(n => n.id === old.id)) !== digest(old)) throw new Error(`Started node ${old.id} is pinned; preserve it and replan separately.`);
      if (old.kind === "decision" && next.nodes[old.id]?.answer && digest(c.definition.nodes.find(n => n.id === old.id)) !== digest(old)) throw new Error("Answered decisions are immutable; add a replacement decision and hold affected work.");
    }
    next.definition = c.definition; next.revision++;
    for (const n of c.definition.nodes) next.nodes[n.id] ??= { state: "planned" };
    const worst = planWorstCase(c.definition);
    // Scope and changed choices require review; counts never reset by revision.
    next.posture = planPosture(c.definition);
    next.status = next.posture === "review" || worst.agents > next.approvedBudget.agents * 1.5 || worst.turns > next.approvedBudget.turns * 1.5 ? "review" : next.status;
    next.history.push({ revision: next.revision, at: event.at, by: event.by, reason: c.reason });
  }
  if (c.op === "start" || c.op === "implicit") {
    const id = c.op === "start" ? c.node : c.launch.id;
    if (next.status !== "active" || next.nodes[id]?.state !== "planned" || !event.attempt || !event.briefHash) throw new Error("Run is held, already started or has no pinned brief.");
    next.nodes[id] = { state: "starting", attempt: event.attempt, briefHash: event.briefHash, claimed: c.op === "implicit" };
  }
  if (c.op === "claim") {
    const node = next.definition.nodes.find(n => n.id === c.node), state = next.nodes[c.node];
    if (next.status !== "active" || node?.kind !== "run" || state?.state !== "starting" || state.claimed || state.attempt !== c.attempt || state.briefHash !== c.briefHash || digest(node.launch) !== digest(c.launch)) throw new Error("Launch does not match an unclaimed start intent; reconcile it without another create.");
    state.claimed = true;
  }
  if (c.op === "record") {
    const node = next.definition.nodes.find(n => n.id === c.node), state = next.nodes[c.node];
    if (node?.kind !== "run" || !state?.attempt || state.attempt !== c.attempt) throw new Error("Record does not match a committed start intent.");
    if (terminal(state.state) && !(state.state === "done" && c.state === "landed")) throw new Error("Completed run history is immutable.");
    if (c.state === "running" && (!c.agentId || !c.workspaceId)) throw new Error("A running record needs agent and workspace identities.");
    if (state.agentId && c.agentId && state.agentId !== c.agentId) throw new Error("Cannot replace an accounted worker.");
    next.nodes[c.node] = { ...state, state: c.state, evidence: c.evidence, ...(c.agentId ? { agentId: c.agentId } : {}), ...(c.workspaceId ? { workspaceId: c.workspaceId } : {}) };
  }
  if (c.op === "ack") next[c.kind] = [...new Set([...next[c.kind], ...c.ids])];
  return { ...next, hash: event.hash, sequence: event.sequence };
}

export class WorkflowPlanStore {
  constructor(readonly root: string, readonly home: string) {}
  private directory(id: string) { return join(this.root, PlanId.parse(id)); }
  private async events(id: string): Promise<Event[]> {
    let files: string[];
    try { files = await readdir(this.directory(id)); } catch (e) { if ((e as NodeJS.ErrnoException).code === "ENOENT") return []; throw e; }
    if (files.some(f => !/^\d{8}\.json(?:\.[\w-]+\.tmp)?$/.test(f))) throw new Error(`Unknown file in plan log ${id}.`);
    const events: Event[] = []; let previous: string | null = null;
    for (const name of files.filter(f => /^\d{8}\.json$/.test(f)).sort()) {
      if (name !== `${String(events.length).padStart(8, "0")}.json`) throw new Error(`Plan log ${id} has a gap.`);
      const path = join(this.directory(id), name);
      if ((await stat(path)).size > 512000) throw new Error("Plan event too large.");
      const event = EventSchema.parse(JSON.parse(await readFile(path, "utf8")));
      if (event.plan !== id || event.sequence !== events.length || event.previous !== previous || checksum(event) !== event.hash || event.requestHash !== digest(event.command)) throw new Error(`Plan log ${id} failed its hash chain.`);
      previous = event.hash; events.push(event);
    }
    return events;
  }
  async get(id: string): Promise<WorkflowPlan | null> { return (await this.events(id)).reduce<WorkflowPlan | null>(reduce, null); }
  async list(): Promise<WorkflowPlan[]> {
    let entries;
    try { entries = await readdir(this.root, { withFileTypes: true }); } catch (e) { if ((e as NodeJS.ErrnoException).code === "ENOENT") return []; throw e; }
    const plans: WorkflowPlan[] = [];
    for (const entry of entries) { if (!entry.isDirectory()) throw new Error("Unexpected file in workflow-plans."); const plan = await this.get(entry.name); if (plan) plans.push(plan); }
    return plans.sort((a, b) => a.definition.id.localeCompare(b.definition.id));
  }
  async brief(node: PlanNode): Promise<{ hash: string; text: string }> {
    if (node.kind !== "run") throw new Error("Decisions cannot start workers.");
    const path = await resolveInHome(this.home, node.launch.brief.file);
    if ((await stat(path.absolute)).size > 100000) throw new Error("Brief exceeds 100,000 bytes.");
    const text = await readFile(path.absolute, "utf8"); if (!text.trim()) throw new Error("Brief is empty.");
    return { hash: createHash("sha256").update(text).digest("hex"), text };
  }
  async execute(input: WorkflowCommand, requestId: string, by: string): Promise<unknown> {
    const command = WorkflowCommandSchema.parse(input); z.uuid().parse(requestId);
    if (command.op === "plans") return this.list();
    if (command.op === "show") return this.get(command.plan);
    if (command.op === "agenda") return this.agenda();
    return serialized(resolve(this.root), async () => {
      const id = command.op === "draft" || command.op === "revise" ? command.definition.id : command.op === "implicit" ? command.launch.id : command.plan;
      const events = await this.events(id), previous = events.reduce<WorkflowPlan | null>(reduce, null);
      const replay = events.find(e => e.requestId === requestId);
      if (replay) { if (replay.requestHash !== digest(command)) throw new Error("Request ID has different content."); await this.render(previous!); return this.result(previous!, replay); }
      const plans = await this.list();
      if (command.op === "draft" || command.op === "revise") {
        const problems = planProblems(command.definition, plans); if (problems.length) throw new Error(problems.join("\n"));
      }
      if (command.op === "implicit" && plans.some(p => p.definition.nodes.some(n => n.id === id))) throw new Error("Task already belongs to a plan; use its recorded start intent.");
      let briefHash: string | undefined;
      if (command.op === "start") {
        const node = previous?.definition.nodes.find(n => n.id === command.node);
        if (!node || !dependenciesMet(node, plans)) throw new Error("Run dependencies are not satisfied.");
        briefHash = (await this.brief(node)).hash;
      } else if (command.op === "implicit") briefHash = (await this.brief({ kind: "run", id, title: command.launch.title, summary: command.launch.title, after: [], workflow: command.launch.kind === "scout" ? "scout@1" : "task@1", launch: command.launch })).hash;
      const event: Event = { version: 1, plan: id, sequence: events.length, previous: previous?.hash ?? null, requestId, requestHash: digest(command), at: new Date().toISOString(), by, command,
        ...(briefHash ? { briefHash, attempt: randomUUID() } : {}), hash: "" };
      event.hash = checksum(event); const next = reduce(previous, event);
      if (event.sequence > 99999999) throw new Error("Plan event capacity exceeded.");
      await mkdir(this.directory(id), { recursive: true });
      // Exclusive hard link is the cross-process compare-and-swap. A collision is never retried.
      await publish(join(this.directory(id), `${String(event.sequence).padStart(8, "0")}.json`), event);
      await this.render(next);
      return this.result(next, event);
    });
  }
  private result(plan: WorkflowPlan, event: Event) {
    const c = event.command, node = c.op === "start" ? c.node : c.op === "implicit" ? c.launch.id : null;
    const definition = plan.definition.nodes.find(n => n.id === node);
    return { plan, worstCase: planWorstCase(plan.definition), backlog: plan.definition.nodes.map(n => ({ node: n.id, section: terminal(plan.nodes[n.id]!.state) ? "done" : plan.nodes[n.id]!.state === "planned" ? "queued" : "in-flight", line: planBacklogLine(plan, n) })),
      comingUp: plan.definition.nodes.filter(n => n.kind === "decision" && !plan.nodes[n.id]?.answer),
      ...(definition?.kind === "run" && node ? { launch: { ...definition.launch, workflow: { plan: plan.definition.id, node, attempt: plan.nodes[node]!.attempt, briefHash: plan.nodes[node]!.briefHash } } } : {}) };
  }
  async render(plan: WorkflowPlan): Promise<void> {
    const path = await resolveInHome(this.home, `data/plans/${plan.definition.id}/plan.md`);
    await mkdir(dirname(path.absolute), { recursive: true });
    const content = fill(await readTemplate(TEMPLATES.workflowPlan), {
      title: plan.definition.title, request: plan.definition.request.text, revision: String(plan.revision), posture: plan.posture, state: plan.status,
      budget: JSON.stringify(planWorstCase(plan.definition)),
      nodes: plan.definition.nodes.map(n => `- **${n.title}** — ${plan.nodes[n.id]?.state ?? "planned"}\n  ${n.summary}\n  ${n.kind === "run" ? `${n.workflow} · ${n.launch.agent.provider} · ${n.launch.agent.thinkingOptionId ?? "default thinking"} · ${n.launch.host}` : `${n.options.map(o => `${o.label}: ${o.consequence}`).join("; ")}\n  Recommended: ${n.recommendation ?? "none yet"} — ${n.rationale}`}\n  After: ${n.after.map(d => `${d.node} (${d.reason}, ${d.on})`).join(", ") || "ready"}${plan.nodes[n.id]?.evidence ? `\n  Evidence: ${plan.nodes[n.id]!.evidence}` : ""}`).join("\n\n"),
      history: plan.history.map(h => `- ${h.revision} · ${h.at} · ${h.by} · ${h.reason}`).join("\n"),
    });
    const temporary = `${path.absolute}.${randomUUID()}.tmp`;
    await writeFile(temporary, content, { flag: "wx" }); await rename(temporary, path.absolute);
  }
  async agenda(): Promise<AgendaItem[]> {
    const plans = await this.list(), result: AgendaItem[] = [];
    let backlog = ""; try { backlog = await readFile((await resolveInHome(this.home, "data/backlog.md")).absolute, "utf8"); } catch (e) { if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e; }
    const items = parseBacklog(backlog);
    for (const plan of plans) {
      const add = (kind: AgendaItem["kind"], priority: number, key: string, text: string, node?: string, extra = {}) => {
        const id = `${plan.definition.id}:${key}`;
        if (kind === "tell" ? plan.told.includes(id) : plan.handled.includes(id)) return;
        result.push({ id, kind, priority, plan: plan.definition.id, text, ...(node ? { node } : {}), ...extra });
      };
      if (plan.status === "abandoned") continue;
      if (plan.status === "review") add("tell", 5, `approval:${plan.revision}`, `Present ${plan.definition.title} for approval.`);
      for (const node of plan.definition.nodes) {
        const state = plan.nodes[node.id]!;
        if (state.state === "unresolved") add("escalation", 1, `uncertain:${node.id}:${state.attempt}`, `Reconcile ${node.title}; never create or send again blindly.`, node.id);
        if (node.after.some(d => plans.some(p => ["failed", "cancelled"].includes(p.nodes[d.node]?.state ?? "")))) add("replan", 3, `dependency:${node.id}:${plan.revision}`, `${node.title} has a failed or cancelled dependency.`, node.id);
        const ready = dependenciesMet(node, plans);
        if (node.kind === "run" && state.state === "planned" && plan.status === "active" && ready) {
          try { await this.brief(node); add("start", 4, `start:${node.id}:${plan.revision}`, `Start ${node.title}.`, node.id); }
          catch { add("replan", 3, `brief:${node.id}:${plan.revision}`, `Supply the missing or unreadable brief for ${node.title}.`, node.id); }
        }
        if (node.kind === "decision" && !state.answer && ready) add("tell", 5, `decision:${node.id}:${plan.revision}`, `Decision due: ${node.title}.`, node.id);
        if (terminal(state.state)) add("tell", 5, `finished:${node.id}:${state.state}`, `${node.title}: ${state.state}. ${state.evidence ?? ""}`, node.id);
        // Until slice 4, live facts must be checked by the mate. A worker's status never completes a run.
        if (["running", "starting"].includes(state.state)) add("replan", 3, `observe:${node.id}:${state.attempt}`, `Verify ${node.title} against Paseo and its delivery evidence; outcome is unobserved.`, node.id);
        const line = planBacklogLine(plan, node), section = terminal(state.state) ? "done" : state.state === "planned" ? "queued" : "in-flight";
        const current = items.find(i => i.id === node.id);
        if (!current || current.section !== section || (!plan.definition.implicit && current.plan !== plan.definition.id) || (state.agentId && current.agentId !== state.agentId)) add("books", 6, `books:${node.id}:${digest({ line, section }).slice(0, 12)}`, `Reconcile ${node.title} in ${section}.`, node.id, { line, section });
      }
    }
    return result.sort((a, b) => a.priority - b.priority || a.id.localeCompare(b.id));
  }
}

export function planBacklogLine(plan: WorkflowPlan, node: PlanNode): string {
  const state = plan.nodes[node.id]!;
  const needed = plan.definition.nodes.filter(n => n.after.some(d => d.node === node.id)).map(n => n.id);
  return `- [${terminal(state.state) ? "x" : " "}] ${node.id} - ${node.title}` +
    (node.kind === "run" ? ` (project: ${node.launch.project}) (kind: ${node.launch.kind}) (mode: ${node.launch.mode})${node.launch.host === "local" ? "" : ` (host: ${node.launch.host})`}` : " (kind: captain)") +
    (plan.definition.implicit ? "" : ` (plan: ${plan.definition.id})`) + (node.after.length ? ` (blocked-by: ${node.after.map(d => d.node).join(", ")})` : "") +
    (needed.length ? ` (needed-by: ${needed.join(", ")})` : "") + (state.agentId ? ` (agent: ${state.agentId})` : "");
}
