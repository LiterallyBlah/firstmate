/** Isolated S04 fixture: a temporary home, a writable fixture store, explicit reviewed policy,
 * scoped plan owners and a synthetic receiver. Nothing touches a live home, daemon or provider.
 */
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { SupervisionActor } from "../shared/supervision";
import { PlanDefinitionSchema, type PlanDefinition, type WorkflowCommand } from "../shared/workflow-plans";
import type { GatewayLimits, ReceiverCapabilities } from "../shared/supervision-effects";
import { PolicyRuleSchema, PolicySourceSchema } from "../shared/supervision-policy";
import { SupervisionStore, type SupervisionMutation } from "../server/supervision-store";
import { SupervisionCommands, type ScopedPlanCommand } from "../server/supervision-commands";
import { acceptPolicyInventory, currentPolicyVector, policyRef } from "../server/supervision-policy";
import { SupervisionGateway } from "../server/supervision-effects";
import { SupervisorSessions } from "../server/supervisor-sessions";
import { planSubjectHash } from "../server/workflow-plans";
import { expected, hash } from "./supervision-fixture";
import { SyntheticReceiver } from "./synthetic-receiver";

export const captain: SupervisionActor = { kind: "captain-ui", id: "fixture-captain", source: "fixture/button" };
const sha = (v: string) => createHash("sha256").update(v).digest("hex");
const ORDERS = "Pilot implementation and isolated tests only.\n";
export const BRIEF = "Synthetic checked brief.";
export type NodeSpec = { id: string; kind?: "scout" | "ship"; after?: { node: string; on: "done" | "landed" | "answered" }[]; decision?: "owner" | "captain" };
export interface ScopeHandle { id: string; projectId: string; project: string; planId: string; owner: SupervisionActor; nodes: string[] }

export function planDefinition(id: string, project: string, nodes: NodeSpec[], budget = 6, delegated = false): PlanDefinition {
  const launch = (node: NodeSpec) => ({ id: node.id, title: `Run ${node.id}`, agentTitle: node.id, project, host: "local", baseBranch: "main",
    kind: node.kind ?? "scout", mode: "reviewed-PR", brief: { file: `data/${node.id}/brief.md` },
    agent: { provider: "codex/gpt-6.1-sol", modeId: "full-access", thinkingOptionId: "high" }, backlog: { existing: "none" } });
  return PlanDefinitionSchema.parse({ format: "firstmate.plan/1", id, title: `Goal ${id}`, request: { text: `Deliver ${id} end to end.`, at: "2026-10-20T12:00:00Z" },
    ...(delegated ? { ownership: { owner: "firstmate", evidence: "Captain: delegate routine stages and answers for this goal." } } : {}),
    budget: { agents: budget, turns: budget }, nodes: nodes.map(n => n.decision ? { kind: "decision", id: n.id, title: `Decide ${n.id}`, summary: "Choose.",
      after: (n.after ?? []).map(a => ({ ...a, reason: "needs-evidence" })), ...(n.decision === "captain" ? { authority: "captain" } : {}),
      options: [{ id: "yes", label: "Yes", consequence: "Proceed." }, { id: "no", label: "No", consequence: "Stop." }], recommendation: "yes", rationale: "Bounded." } :
      { kind: "run", id: n.id, title: `Run ${n.id}`, summary: `Bounded ${n.id}.`, workflow: n.kind === "ship" ? "task@1" : "scout@1", launch: launch(n),
        after: (n.after ?? []).map(a => ({ ...a, reason: a.on === "answered" ? "decision" : "builds-on" })) }) });
}

export async function s04Fixture(options: { capabilities?: Partial<ReceiverCapabilities>; limits?: GatewayLimits } = {}) {
  const home = join(process.env.PASEO_HOME!, randomUUID());
  await mkdir(join(home, "data"), { recursive: true });
  await writeFile(join(home, "data/orders.md"), ORDERS);
  const hooks: { boundary: ((name: string) => Promise<void>) | null } = { boundary: null };
  const store = new SupervisionStore(join(home, "store"), home, { writable: true, boundary: async name => hooks.boundary?.(name),
    processIdentity: async () => ({ state: "alive", start: "fixture-process" }) });
  await store.initialize(); await store.acquireCoordinator();
  const receiver = new SyntheticReceiver(options.capabilities);
  const commands = new SupervisionCommands(store, home, { enabled: true });
  const gateway = new SupervisionGateway(store, commands, home, receiver, { enabled: true });
  const state = { globalMate: "general-first-mate" as string | null, sourceAccepted: false };
  const sessions = new SupervisorSessions(store, gateway, receiver, { enabled: true, limits: options.limits ?? { supervisorSessions: 3, supervisorTurns: 10 },
    globalMateId: async () => state.globalMate });
  const source = PolicySourceSchema.parse({ id: randomUUID(), version: 1, path: "data/orders.md", lineStart: 1, lineEnd: 1,
    fileHash: sha(ORDERS), excerptHash: sha(ORDERS.trimEnd()), provenance: captain, supersedes: [] });

  /** A scoped plan owner. `bound` gives it an active epoch-1 binding; otherwise it stays dormant for activation. */
  async function addScope(n: number, plan: string, nodes: string[], bound = true): Promise<ScopeHandle> {
    const id = `00000000-0000-4000-8000-0000000001${String(n).padStart(2, "0")}`, projectId = `00000000-0000-4000-8000-0000000002${String(n).padStart(2, "0")}`;
    const owner: SupervisionActor = { kind: "agent", id: `owner-${n}`, source: "fixture/scope-helper" };
    for (const node of nodes) { await mkdir(join(home, "data", node), { recursive: true }); await writeFile(join(home, "data", node, "brief.md"), BRIEF); }
    const mutations: SupervisionMutation[] = [
      { kind: "scope", value: { id, homeId: store.homeId, kind: "plan", projectIds: [projectId], sponsorId: null, version: 1, mode: "scoped", state: bound ? "active" : "dormant" } },
      ...(bound ? [{ kind: "binding" as const, value: { scopeId: id, epoch: 1, hostId: "local", agentId: owner.id, workspaceId: `supervisor-ws-${n}`, profileDigest: hash, state: "active" as const, checkpointHash: hash, acknowledgedSeq: 0, heartbeatDue: null } }] : []),
      { kind: "backend", value: { planId: plan, ownerScopeId: id, backend: "scoped", state: "active", sourceHash: null, version: 1 } },
      ...nodes.map(nodeId => ({ kind: "task" as const, value: { id: randomUUID(), ownerScopeId: id, planId: plan, nodeId, projectId, hostId: "local", version: 1, currentAttempt: null } })),
    ];
    await store.transact(expected(mutations), randomUUID(), mutations);
    const rule = PolicyRuleSchema.parse({ id: randomUUID(), version: 1, sources: [policyRef("policy-source", source)],
      selector: { scopeIds: [id], projectIds: [projectId], projectNames: { [projectId]: `project-${n}` }, hostIds: ["local"], planIds: [plan] },
      operations: ["plan.start", "plan.review", "plan.stop", "plan.record", "decision.answer", "model.use"], effect: "allow",
      constraints: { models: [], profileDigests: [], requireApproval: false, requireHead: false, requireChecks: false, independentReviews: 0, requiredReviewIds: [], availability: "always" }, expiresAt: null, supersedes: [] });
    await acceptPolicyInventory(store, home, randomUUID(), captain, { sources: state.sourceAccepted ? [] : [source], rules: [rule] }, true);
    state.sourceAccepted = true;
    return { id, projectId, project: `project-${n}`, planId: plan, owner, nodes };
  }
  async function input(scope: ScopeHandle, command: WorkflowCommand): Promise<ScopedPlanCommand> {
    const s = await store.read(), p = s.plans.find(p => p.plan.definition.id === scope.planId)?.plan;
    const operation = command.op === "captain" ? command.action === "answer" ? "decision.answer" : ["hold", "decline"].includes(command.action) ? "plan.stop" : "plan.review" :
      command.op === "progress" && command.action === "answer" ? "decision.answer" :
      ["start", "claim", "implicit"].includes(command.op) ? "plan.start" : ["record", "invalidate", "validate", "close", "ack"].includes(command.op) ? "plan.record" : "plan.review";
    const target = { scopeId: scope.id, planId: scope.planId, projectIds: [scope.projectId], hostId: "local", operation } as const;
    const node = "node" in command ? p?.definition.nodes.find(n => n.id === command.node) : undefined;
    const binding = s.bindings.find(b => b.scopeId === scope.id), own = s.scopes.find(x => x.id === scope.id)!;
    return { requestId: randomUUID(), homeId: store.homeId, scopeId: scope.id, epoch: binding?.epoch ?? 1, scopeVersion: own.version,
      expectedPlanHash: p?.hash ?? null, revision: p?.revision ?? 0, subjectHash: p ? planSubjectHash(p) : null, command,
      policyVector: currentPolicyVector(s, target), modelPolicyVector: currentPolicyVector(s, { ...target, operation: "model.use" }), evidenceVector: [],
      approvalId: null, head: null, artifactHash: null, briefHash: ["start", "claim", "implicit"].includes(command.op) ? sha(BRIEF) : null,
      dependencyBindings: node?.after.map(e => { const owner = s.plans.find(p => p.plan.nodes[e.node])!.plan;
        return { homeId: s.homeId, planId: owner.definition.id, nodeId: e.node, outcome: e.on, planHash: owner.hash, revision: owner.revision, attemptId: owner.nodes[e.node]?.attempt ?? null }; }) ?? [] };
  }
  const actorFor = async (scope: ScopeHandle): Promise<SupervisionActor> => {
    const binding = (await store.read()).bindings.find(b => b.scopeId === scope.id);
    return { ...scope.owner, id: binding?.agentId ?? scope.owner.id };
  };
  async function run(scope: ScopeHandle, command: WorkflowCommand, actor?: SupervisionActor) {
    return commands.planCommand(await input(scope, command), actor ?? await actorFor(scope));
  }
  async function draft(scope: ScopeHandle, nodes: NodeSpec[], delegated = false) {
    await run(scope, { op: "draft", definition: planDefinition(scope.planId, scope.project, nodes, 6, delegated) });
    const p = (await store.read()).plans.find(p => p.plan.definition.id === scope.planId)!.plan;
    if (p.status === "review") await run(scope, { op: "captain", plan: scope.planId, revision: p.revision, subjectHash: planSubjectHash(p), action: "approve", text: "Approve the bounded fixture plan." }, captain);
  }
  async function start(scope: ScopeHandle, node: string) {
    return gateway.startWorker(await input(scope, { op: "start", plan: scope.planId, node }), await actorFor(scope));
  }
  /** Full local launch through the gateway: workspace, unprompted create, verify, brief. */
  async function launch(scope: ScopeHandle, node: string) {
    const started = await start(scope, node);
    await gateway.dispatch(started.effects!.workspace); await gateway.dispatch(started.effects!.create);
    await gateway.verifyWorker(started.attemptId!); await gateway.dispatch(started.effects!.send);
    return started;
  }
  async function record(scope: ScopeHandle, node: string, state: "done" | "landed" | "failed" | "running") {
    const p = (await store.read()).plans.find(p => p.plan.definition.id === scope.planId)!.plan;
    return run(scope, { op: "record", plan: scope.planId, node, attempt: p.nodes[node]!.attempt!, state, evidence: `Verified synthetic evidence for ${node}.` });
  }
  async function files() {
    const names = (await readdir(join(store.root, "transactions"))).sort();
    return Promise.all(names.map(async n => [n, await readFile(join(store.root, "transactions", n), "utf8")]));
  }
  return { home, store, receiver, commands, gateway, sessions, state, hooks, addScope, input, run, draft, start, launch, record, files, actorFor };
}
export type S04Fixture = Awaited<ReturnType<typeof s04Fixture>>;
