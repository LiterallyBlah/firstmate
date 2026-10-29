/** Default-off production composition over Build A's single owned home runtime. */
import { z } from "zod";
import type { PluginServerContext } from "@getpaseo/plugin/server";
import type { GatewayReceiver } from "../shared/supervision-effects";
import { PolicyRuleSchema, PolicySourceSchema } from "../shared/supervision-policy";
import { PlanRuleRecordSchema } from "../shared/plan-rules";
import { planSupervisorLimits } from "../shared/plan-supervisor-limits";
import type { SupervisionStatus } from "../shared/supervision";
import { readFirstmateConfig, resolveHome } from "./config";
import type { PaseoApi } from "./host-types";
import { SupervisionRuntime } from "./supervision-runtime";
import type { SupervisionStore } from "./supervision-store";
import { SupervisionCommands } from "./supervision-commands";
import { SupervisionGateway, effectsFor, refuse, stableId } from "./supervision-effects";
import { SupervisionWorkerReceiver } from "./supervision-worker-receiver";
import { SupervisionEvents } from "./supervision-events";
import { SupervisionInbox } from "./supervision-inbox";
import { SupervisorSessions } from "./supervisor-sessions";
import { registerSupervisionLifecycle, SupervisionLifecycle } from "./supervision-lifecycle";
import { ghPullRequestReader, registerScopedBoardIngress, ScopedBoardSteer, SupervisionSources, type PullRequestReader } from "./supervision-sources";
import { processScopeRequests } from "./scope-requests";
import { workflowStore } from "./workflow-service";
import { acceptPolicyInventory, checkPolicySource, currentPolicyVector } from "./supervision-policy";
import { PlanRules } from "./plan-rules";
import { workflowHomeIdentity } from "./workflow-ownership";
import { serialized } from "./serialize";
import { normalizedName } from "../shared/supervision-projects";
import type { RemoteSnapshot } from "../shared/remotes";
import { pluginDir } from "./data-dir";
import { join } from "node:path";
import { checkGeneralHeadroom, withScopeAdmission } from "./supervision-headroom";
import type { WorkflowCommand } from "../shared/workflow-plans";
import { digest } from "./submissions";
import { ruleRef } from "./plan-rules";
import { workflowHomeId } from "./workflow-board";
import { ProjectJudgments } from "./project-judgments";
import { mkdir } from "node:fs/promises";
import { checkPlanAllocation } from "./plan-allocation";

const Import = z.object({ sources: z.array(PolicySourceSchema).max(64), rules: z.array(PolicyRuleSchema).max(64),
  reviewedHolds: z.array(z.object({ id: z.uuid(), version: z.number().int().positive() }).strict()).max(64).optional() }).strict();
export interface PlanRuntimeOptions { enabled?: boolean; config?: typeof readFirstmateConfig;
  receiver?: (paseo: PaseoApi, store: SupervisionStore) => GatewayReceiver; slots?: number; headroom?: number; readPr?: PullRequestReader }
type Components = ReturnType<PlanRuntime["compose"]>;
type LifecycleHook = (event: unknown, context: unknown) => unknown;
export class PlanRuntime {
  private paseo: PaseoApi | null = null;
  private server: PluginServerContext | null = null;
  private readonly components = new Map<SupervisionStore, Components>();
  private readonly lifecycleHooks = new Map<SupervisionStore, Map<string, LifecycleHook[]>>();
  private readonly disposers: (() => void)[] = [];
  private closed = false;
  constructor(readonly runtime: SupervisionRuntime, private readonly options: PlanRuntimeOptions = {}) {
    const slots = options.slots ?? 4, headroom = options.headroom ?? 1;
    if (!Number.isSafeInteger(slots) || !Number.isSafeInteger(headroom) || headroom < 1 || slots <= headroom)
      throw new Error("Plan slots must leave at least one configured General slot.");
  }
  remember(paseo: PaseoApi) { if (this.options.enabled && !this.closed) this.paseo = paseo; }
  private config() { return (this.options.config ?? readFirstmateConfig)(); }
  register(server: PluginServerContext) {
    if (!this.options.enabled) return;
    this.server = server;
    this.disposers.push(server.on("agent.turn_started", (_e, { paseo }) => { this.remember(paseo); }),
      server.on("agent.turn_ended", (event, context) => this.lifecycleEvent("agent.turn_ended", event, context)),
      server.on("agent.permission_requested", (event, context) => this.lifecycleEvent("agent.permission_requested", event, context)),
      server.on("agent.permission_resolved", (event, context) => this.lifecycleEvent("agent.permission_resolved", event, context)));
  }
  /** Register at plugin start; the first post-restart callback must not wait for a view or tick. */
  private async lifecycleEvent(name: string, event: unknown, context: { paseo: PaseoApi }) {
    this.remember(context.paseo);
    if (!this.options.enabled || this.closed) return;
    const config = await this.config(), home = resolveHome(config);
    if (!config.mateAgentId || config.migration || config.mateLaunch) return;
    const status = await this.runtime.read(home);
    if (status.freshness !== "current" || !status.bindings.some(b => b.state === "active")) return;
    await this.runtime.mutate(home, async store => {
      await this.guard(home, config.mateAgentId);
      if (!this.components.has(store)) this.components.set(store, this.compose(store, home, config.mateAgentId, context.paseo));
      for (const handler of this.lifecycleHooks.get(store)?.get(name) ?? []) await handler(event, context);
    });
  }
  private async guard(home: string, generalId: string) {
    if (!this.options.enabled || this.closed) refuse("UNSUPPORTED", "Plan supervisors are disabled.");
    const config = await this.config();
    if (resolveHome(config) !== home || config.mateAgentId !== generalId || config.migration || config.mateLaunch)
      refuse("STALE", "Home/General changed or is migrating; scoped admission is held.");
  }
  compose(store: SupervisionStore, home: string, generalId: string, paseo: PaseoApi) {
    const rules = new PlanRules(store, home);
    const directory = async (name: string) => {
      const s = await store.read();
      const matches = s.projects?.projects.filter(p => p.state === "admitted" && [p.name, ...p.aliases].some(n => normalizedName(n) === normalizedName(name)));
      if (s.freshness !== "current" || matches?.length !== 1 || !matches[0]!.owner || matches[0]!.owner!.hostId !== "local")
        refuse("UNKNOWN_OWNER", "Worker project needs one admitted canonical local directory.");
      return matches[0]!.owner!.directory;
    };
    const receiver = this.options.receiver?.(paseo, store) ?? new SupervisionWorkerReceiver(paseo, this.runtime.root, directory);
    const commands = new SupervisionCommands(store, home, { enabled: true, rules, recovery: true, registerTasks: true });
    const allocation = (s: SupervisionStatus, input: import("../shared/scoped-commands").ScopedPlanCommand) => {
      const c = input.command, node = c.op === "implicit" ? c.launch.id : "node" in c ? c.node : null;
      checkPlanAllocation(s, input.scopeId, true, s.tasks.find(t => t.ownerScopeId === input.scopeId && t.nodeId === node)?.projectId);
    };
    const sources = new SupervisionSources(store), board = new ScopedBoardSteer(store, sources);
    const admissionCheck = async (s: SupervisionStatus, scopeId: string) => {
      await this.guard(home, generalId);
      const scope = s.scopes.find(v => v.id === scopeId);
      if (scope?.projectIds.some(id => s.projects?.projects.find(p => p.id === id)?.state === "stopped")) refuse("HELD", "This project's new effects are stopped.");
      for (const record of s.planRules?.filter(r => r.scopeId === scopeId && s.plans.some(p => p.scopeId === scopeId && p.plan.revision === r.revision)) ?? [])
        for (const ref of record.sources) { const source = s.policySources.find(v => v.id === ref.id); if (!source) refuse("HELD", "Rule source is unavailable."); await checkPolicySource(home, source); }
    };
    const gateway = new SupervisionGateway(store, commands, home, receiver, { enabled: true, rules, recovery: true,
      reserveStart: run => withScopeAdmission(store.homeId, run),
      startCheck: allocation,
      beforeStart: async (s, input) => { await this.guard(home, generalId); allocation(s, input); await checkGeneralHeadroom(s, receiver, this.options.slots ?? 4, this.options.headroom ?? 1); },
      prepareAdmission: async e => {
        await this.guard(home, generalId);
        const s = await store.read();
        const task = s.attempts.find(a => a.id === e.attemptId)?.taskId;
        const relevant = (status: SupervisionStatus) => e.attemptId ? status.sources.bindings.filter(b => b.scopeId === e.scopeId && b.state === "active" &&
          (b.taskId === task || e.dependencyBindings?.some(d => d.attemptId === b.attemptId))) : [];
        const bindings = relevant(s);
        for (const binding of bindings) {
          if (!e.admissionHead) refuse("HELD", "Bound PR sources require the exact selected source head.");
          const read = await sources.admissionCheck(this.options.readPr ?? ghPullRequestReader(), { repository: binding.repository, pr: binding.pr, expectedHead: e.admissionHead, requiredApprovals: 0 });
          if (read.code) refuse(read.code, read.message);
        }
        const captured = await store.read(), sourceHash = digest(captured.inbox.sources.filter(source => source.scopeId === e.scopeId && ["pr", "watch"].includes(source.kind)));
        return current => {
          if (digest(relevant(current)) !== digest(bindings)) refuse("STALE", "PR binding membership changed during final admission.");
          if (digest(current.inbox.sources.filter(source => source.scopeId === e.scopeId && ["pr", "watch"].includes(source.kind))) !== sourceHash) refuse("STALE", "PR observations changed during final admission.");
          for (const b of bindings) if (!current.sources.bindings.some(n => n.id === b.id && n.version === b.version && n.attemptId === b.attemptId)) refuse("STALE", "PR owner binding changed during admission.");
        };
      },
      admissionCheck: async (s, e) => {
        await admissionCheck(s, e.scopeId);
        if (e.attemptId && !["agent.interrupt", "agent.archive"].includes(e.operation)) checkPlanAllocation(s, e.scopeId, false);
        const scope = s.scopes.find(v => v.id === e.scopeId);
        if (scope?.projectIds.some(id => s.projects?.projects.find(p => p.id === id)?.state === "stopped")) refuse("HELD", "This project's new effects are stopped.");
        if (e.attemptId === null && e.operation === "agent.send" && scope?.kind === "plan") {
          const caps = planSupervisorLimits(s, e.scopeId);
          if (!caps.limits || caps.spent.turns > caps.limits.turns || caps.spent.sessions > caps.limits.sessions) refuse("HELD", "Counted supervisor limits are unavailable or exhausted.");
        }
      } });
    const sessions = new SupervisorSessions(store, gateway, receiver, { enabled: true,
      budgetRefused: scopeId => rules.budgetDecision(scopeId),
      reservationQueue: run => withScopeAdmission(store.homeId, run),
      preflightTurn: async () => { await this.guard(home, generalId); await checkGeneralHeadroom(await store.read(), receiver, this.options.slots ?? 4, this.options.headroom ?? 1); },
      limits: { supervisorSessions: 1, supervisorTurns: 1 },
      limitsFor: (s, scopeId) => {
        const scope = s.scopes.find(v => v.id === scopeId);
        if (scope?.kind === "plan") { const read = planSupervisorLimits(s, scopeId);
          if (!read.limits) refuse("HELD", "A reviewed durable supervisor continuing-turn cap is required.");
          return { supervisorSessions: read.limits.sessions, supervisorTurns: read.limits.turns }; }
        const p = s.projects?.projects.find(p => p.scopeId === scopeId);
        if (!p?.owner) refuse("HELD", "Project provisioning limits are unavailable.");
        return p.owner.limits;
      }, reserveCheck: admissionCheck, globalMateId: async () => { await this.guard(home, generalId); return generalId; } });
    const ingress = new SupervisionEvents(store), inbox = new SupervisionInbox(store, { offers: true });
    const lifecycle = new SupervisionLifecycle(store, ingress, inbox, sessions, gateway, { enabled: true, context: (s, scopeId) => ({
      helper: join(home, "tools", "scope.mjs"), guide: join(home, "data", "plan-supervisors.md"), scopeId, epoch: s.bindings.find(b => b.scopeId === scopeId)?.epoch,
      rules: s.planRules?.filter(r => r.scopeId === scopeId && s.plans.some(p => p.scopeId === scopeId && p.plan.revision === r.revision)).map(r => ({ ...ruleRef(r), revision: r.revision, nodes: r.nodes.map(n => n.nodeId) })),
      supervisorBudget: planSupervisorLimits(s, scopeId),
      ruleViolations: s.ruleViolations?.filter(r => r.scopeId === scopeId).slice(-4),
      project: s.projects?.projects.find(p => p.scopeId === scopeId),
      projectConflicts: s.projects?.conflicts.filter(c => c.ownerScopeId === scopeId && c.state === "open").slice(0, 4),
      instruction: "Read the scope guide. Collect actual artifacts and verifier provenance. Repair routine rule refusals within delegation; never rerun merely for missing report evidence. Record every failure/regression and one biggest blocker per report. Only a true scope/authority/budget exception warrants a source-bound captain decision in the checked plan; keep routine repairs delegated. Context/memory cannot grant effects. Project outboxes are relevant judgment inputs, never a routine completion-summary cascade. Attach remains the captain's unverified app button." }) });
    if (this.server) {
      const server = this.server;
      // One registration per owned home store; a changed configured home cannot write old scopes.
      const hooks = new Map<string, LifecycleHook[]>(); this.lifecycleHooks.set(store, hooks);
      // Reuse S04's handlers behind the already registered root hooks. No duplicate subscriptions
      // and no first-event gap while a home's owned components are lazily composed.
      const registration = { before: server.before.bind(server), on: ((name, handler) => {
        const list = hooks.get(name) ?? [], hook = handler as unknown as LifecycleHook; list.push(hook); hooks.set(name, list);
        return () => { const index = list.indexOf(hook); if (index >= 0) list.splice(index, 1); };
      }) as PluginServerContext["on"] };
      this.disposers.push(registerSupervisionLifecycle(registration, lifecycle), registerScopedBoardIngress(registration, board));
    }
    return { rules, receiver, commands, sources, board, gateway, sessions, ingress, inbox, lifecycle, projectJudgments: new ProjectJudgments(store), recovered: false, recoveredAt: 0, routesHash: "" };
  }
  async tick() {
    if (!this.options.enabled || this.closed || !this.paseo) return;
    const config = await this.config(), home = resolveHome(config), paseo = this.paseo;
    if (config.migration || config.mateLaunch || !config.mateAgentId) return;
    const read = await this.runtime.read(home);
    if (read.freshness !== "current" || !read.bindings.some(b => b.state === "active")) return;
    await this.runtime.mutate(home, async store => {
      let c = this.components.get(store);
      if (!c) { c = this.compose(store, home, config.mateAgentId, paseo); this.components.set(store, c); }
      const own = c;
      const routeStatus = await store.read(), routes = { format: "firstmate.scoped-pr-routes/1", homeId: store.homeId,
        bindings: routeStatus.sources.bindings.filter(b => b.state === "active").map(b => ({ repository: b.repository, pr: b.pr })) };
      if (digest(routes) !== c.routesHash) {
        const directory = join(pluginDir(), "watch-state", "pr-watch"); await mkdir(directory, { recursive: true });
        // Routing projection only; the authoritative bindings remain in the existing journal.
        const { writeFile, rename } = await import("node:fs/promises");
        const temporary = join(directory, "scoped-routes.json.tmp"); await writeFile(temporary, JSON.stringify(routes)); await rename(temporary, join(directory, "scoped-routes.json"));
        c.routesHash = digest(routes);
      }
      await c.rules.observeFailures();
      const stopRequests = await c.rules.requestStops(), projectInputs = await c.projectJudgments.observe();
      await processScopeRequests(home, { store, commands: c.commands, gateway: c.gateway, legacy: workflowStore(home), inbox: c.inbox, rules: c.rules,
        globalMateId: async () => { await this.guard(home, config.mateAgentId); return config.mateAgentId; }, continuationsEnabled: true,
        projectResult: (id, input, actor) => own.projectJudgments.handle(id, input, actor),
        admin: async (kind, id, input, actor) => { await this.guard(home, config.mateAgentId);
          if (kind === "rules") return own.rules.import(id, PlanRuleRecordSchema.parse(input), actor);
          const data = Import.parse(input);
          return acceptPolicyInventory(store, home, id, actor, { sources: data.sources, rules: data.rules, reviewedHolds: data.reviewedHolds ?? [] }, true); },
        bindPr: async (requestId, input, actor) => {
          const binding = z.object({ scopeId: z.uuid(), attemptId: z.uuid(), repository: z.string(), pr: z.number().int().positive() }).strict().parse(input);
          const s = await store.read(); if (!s.bindings.some(b => b.scopeId === binding.scopeId && b.agentId === actor.id && b.state === "active")) refuse("UNKNOWN_OWNER", "PR binding requires this exact supervisor.");
          return own.sources.bindPullRequest(binding, requestId);
        } });
      await c.rules.observeFailures();
      const logFailures = (results: PromiseSettledResult<unknown>[]) => results.forEach(r => { if (r.status === "rejected") console.error("[firstmate] scoped progress held:", r.reason); });
      logFailures(await Promise.allSettled([...new Set([...projectInputs, ...stopRequests])].map(id => own.lifecycle.wake(id, "event"))));
      const s = await store.read();
      logFailures(await Promise.allSettled(s.scopes.filter(scope => scope.kind === "plan" && scope.state === "active").map(scope =>
        serialized(`${store.root}:worker-dispatch:${scope.id}`, async () => {
          for (const attempt of s.attempts.filter(a => !a.importedFrom && s.tasks.some(t => t.id === a.taskId && t.ownerScopeId === scope.id && t.currentAttempt === a.id))) {
            const ids = effectsFor(await store.read(), attempt.id); if (!ids) continue;
            for (const id of [ids.workspace, ids.create, ids.send]) {
              const effect = (await store.read()).effects.find(e => e.id === id);
              if (!effect || effect.state === "succeeded") continue;
              if (effect.state !== "reserved") break; // Unknown is retained; recovery may observe identity, never resend.
              if (id === ids.send) await own.gateway.verifyWorker(attempt.id);
              if ((await own.gateway.dispatch(id)).state !== "succeeded") break;
            }
          }
        }))));
      if (!c.recovered || Date.now() - c.recoveredAt >= 60000) {
        if (!c.recovered) await c.ingress.boot();
        for (const binding of s.sources.bindings.filter(b => b.state === "active")) {
          try { await c.sources.observePullRequest(await (this.options.readPr ?? ghPullRequestReader())(binding.repository, binding.pr), { kind: "pr", key: "existing-workflow-clock" }); }
          catch { await c.sources.gap("pr", "github.com", null, `${binding.repository}#${binding.pr}`, ["fetch-failed", "no-cursor"], binding.scopeId); }
        }
        await c.lifecycle.recover(c.recovered ? "heartbeat" : "restart", paseo); c.recovered = true; c.recoveredAt = Date.now();
      }
      if (process.env.FIRSTMATE_PR_OBSERVATIONS === "1") {
        await c.sources.ingestPrSpool(join(pluginDir(), "watch-state", "pr-watch", "pr-observations"));
      }
    });
  }
  async remote(snapshot: RemoteSnapshot) {
    if (!this.options.enabled || this.closed) return;
    const home = resolveHome(await this.config());
    for (const [store, c] of this.components) if (store.homeId === workflowHomeIdentity(home)) await c.sources.observeRemote(snapshot);
  }
  async steer(paseo: PaseoApi, agentId: string, text: string) {
    if (!this.options.enabled) refuse("UNSUPPORTED", "Scoped board steering is disabled.");
    this.remember(paseo);
    const home = resolveHome(await this.config());
    const component = [...this.components].find(([store]) => store.homeId === workflowHomeIdentity(home))?.[1];
    if (!component) refuse("HELD", "The scoped runtime has not reconciled this home yet.");
    return component.board.steer(paseo, agentId, text);
  }
  async act(input: { homeId: string; requestId: string; command: Extract<WorkflowCommand, { op: "captain" }> }, paseo: PaseoApi) {
    if (!this.options.enabled || this.closed) return false;
    const config = await this.config(), home = resolveHome(config);
    const read = await this.runtime.read(home), backend = read.backends.find(b => b.planId === input.command.plan);
    if (!backend) return false;
    const original = read.commands.find(c => c.id === stableId("scoped-ui-intent", input.requestId))?.result.uiPlanIntent;
    if (original && read.commands.some(c => c.id === input.requestId)) {
      if (input.homeId !== workflowHomeId(home) || digest(original.command) !== digest(input.command)) refuse("CONFLICT", "Request ID belongs to another captain action.");
      await this.runtime.mutate(home, store => new SupervisionCommands(store, home, { enabled: true }).planCommand(original,
        { kind: "captain-ui", id: "workflow-board", source: "firstmate.workflow.act app convention (unverified)" }));
      return true;
    }
    await this.guard(home, config.mateAgentId); this.remember(paseo);
    if (input.homeId !== workflowHomeId(home) || backend.backend !== "scoped" || backend.state !== "active") refuse("HELD", "This plan's owning backend is held; do not use the legacy copy.");
    await this.runtime.mutate(home, async store => {
      const scope = read.scopes.find(s => s.id === backend.ownerScopeId), binding = read.bindings.find(b => b.scopeId === scope?.id);
      const plan = read.plans.find(p => p.plan.definition.id === input.command.plan)?.plan;
      if (!scope || !binding || !plan) refuse("HELD", "Scoped plan identity is unavailable.");
      const actor = { kind: "captain-ui" as const, id: "workflow-board", source: "firstmate.workflow.act app convention (unverified)" };
      const intentId = stableId("scoped-ui-intent", input.requestId), saved = read.commands.find(c => c.id === intentId)?.result.uiPlanIntent;
      const target = { scopeId: scope.id, planId: plan.definition.id, projectIds: scope.projectIds, hostId: binding.hostId };
      const op = input.command.action === "answer" ? "decision.answer" : ["hold", "decline"].includes(input.command.action) ? "plan.stop" : "plan.review";
      const node = plan.definition.nodes.find(n => n.id === input.command.node);
      const rules = read.planRules?.find(r => r.planId === plan.definition.id && r.revision === plan.revision);
      const body = saved ?? { ...input, homeId: read.homeId, scopeId: scope.id, scopeVersion: scope.version, epoch: binding.epoch,
        expectedPlanHash: plan.hash, revision: input.command.revision, subjectHash: input.command.subjectHash,
        dependencyBindings: (node?.after ?? []).map(e => {
          const owners = read.plans.filter(p => p.plan.definition.nodes.some(n => n.id === e.node));
          if (owners.length !== 1) refuse("HELD", "Captain action has an ambiguous prerequisite.");
          const owner = owners[0]!.plan;
          return { homeId: read.homeId, planId: owner.definition.id, nodeId: e.node, outcome: e.on, planHash: owner.hash, revision: owner.revision, attemptId: owner.nodes[e.node]?.attempt ?? null };
        }), policyVector: currentPolicyVector(read, { ...target, operation: op }), modelPolicyVector: currentPolicyVector(read, { ...target, operation: "model.use" }),
        evidenceVector: [], approvalId: null, head: null, artifactHash: null, briefHash: null, ...(rules ? { planRules: ruleRef(rules) } : {}) };
      if (saved && (digest(saved.command) !== digest(input.command) || saved.homeId !== read.homeId)) refuse("CONFLICT", "Request ID belongs to another captain action.");
      await store.transactCommand(intentId, digest(input), actor, async () => ({ expectedVersions: [], mutations: [],
        result: { planId: plan.definition.id, planHash: plan.hash, decisionId: null, outboxId: null, uiPlanIntent: body } }));
      await new SupervisionCommands(store, home, { enabled: true, rules: new PlanRules(store, home) }).planCommand(body, actor);
    });
    return true;
  }
  async stop() { this.closed = true; this.disposers.splice(0).forEach(dispose => dispose()); this.components.clear(); this.lifecycleHooks.clear(); }
}
