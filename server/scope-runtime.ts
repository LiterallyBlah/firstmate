import { checkPlanSupervisorAuthority, planSupervisorAuthority } from "./plan-supervisor-authority";
/** Build C composition only: no timer, worker executor, provisioning or Attach entry point. */
import type { PaseoApi } from "./host-types";
import type { SupervisionStatus } from "../shared/supervision";
import { GatewayLimitsSchema, type GatewayLimits, type GatewayReceiver } from "../shared/supervision-effects";
import { readFirstmateConfig, resolveHome } from "./config";
import { askMate, requireNoMigration } from "./mate";
import { workflowHomeIdentity } from "./workflow-ownership";
import { SupervisionRuntime } from "./supervision-runtime";
import { ScopeDiscussions } from "./scope-discussion";
import { SupervisionCommands } from "./supervision-commands";
import { SupervisionGateway, refuse } from "./supervision-effects";
import { SupervisorSessions } from "./supervisor-sessions";
import { SupervisionUiReceiver } from "./supervision-ui-receiver";
import { checkGeneralHeadroom, withScopeAdmission } from "./supervision-headroom";
import { readProjectContext } from "./supervision-memory";
import { checkPolicySource, policyRef, sameVector } from "./supervision-policy";
import { digest } from "./submissions";
import { SupervisionStore } from "./supervision-store";

export interface ScopeServices { discussions: ScopeDiscussions; commands: SupervisionCommands }
export interface ScopeRuntimeOptions {
  enabled?: boolean; uiEnabled?: boolean; slots?: number; generalHeadroom?: number;
  config?: typeof readFirstmateConfig; receiver?: (paseo: PaseoApi) => GatewayReceiver;
  /** Build B may supply its stored, revision-checked cap here. Never composer input. */
  planLimits?: (status: SupervisionStatus, scopeId: string) => GatewayLimits;
  planBudgetRefused?: (store: SupervisionStore, home: string, scopeId: string) => Promise<void>;
}
export class ScopeRuntime {
  constructor(readonly runtime: SupervisionRuntime, private readonly options: ScopeRuntimeOptions = {}) {}
  private async checked(homeId: string) {
    if (!this.options.enabled && !this.runtime.features) refuse("UNSUPPORTED", "Scope execution is disabled; no session or writer was created.");
    const config = await (this.options.config ?? readFirstmateConfig)(); requireNoMigration(config);
    if (config.mateLaunch) refuse("HELD", "FirstMate ownership is changing; preserve this message.");
    const home = resolveHome(config);
    if (workflowHomeIdentity(home) !== homeId) refuse("STALE", "Home changed; preserve the original message and refresh.");
    await this.runtime.features?.check(home, "scopeExecution");
    return { config, home };
  }
  async execute<T>(homeId: string, scopeId: string, paseo: PaseoApi, run: (services: ScopeServices) => Promise<T>): Promise<T> {
    const { home } = await this.checked(homeId);
    const compose = async (store: SupervisionStore) => {
      const receiver = this.options.receiver?.(paseo) ?? new SupervisionUiReceiver(paseo, this.runtime.root, { projectMates: true });
      const initialPolicy = await this.runtime.features?.read(home);
      const stored = await store.read();
      const planLimits = !this.runtime.features || initialPolicy?.effective.planSupervisors || stored.planRules?.some(r => r.scopeId === scopeId) ? this.options.planLimits : undefined;
      const check = async (status: SupervisionStatus, scopeId: string) => {
        await this.checked(homeId);
        const scope = status.scopes.find(s => s.id === scopeId);
        if (scope?.kind === "project") await this.runtime.features?.check(home, "projectMates");
        if (!scope || scope.kind === "maintenance") refuse("UNSUPPORTED", "This scope has no qualified discussion adapter.");
        if (scope.projectIds.some(id => status.projects?.projects.find(p => p.id === id)?.state !== "admitted"))
          refuse("HELD", "Every associated project must remain admitted before sending.");
        if (scope.kind === "plan" && planLimits) {
          const current = await checkPlanSupervisorAuthority(home, status, scopeId);
          if (digest(current) !== digest(capturedRuleAuthority)) refuse("STALE", "Supervisor rule authority changed before admission.");
        }
        for (const project of status.projects?.projects.filter(p => scope.projectIds.includes(p.id)) ?? []) for (const ref of project.sourceVector) {
          const source = status.policySources.find(s => s.id === ref.id);
          if (!source || !sameVector([ref], [policyRef("policy-source", source)]) || status.policySources.some(s => s.supersedes.includes(ref.id)))
            refuse("STALE", "Project admission source changed; refresh before sending.");
          await checkPolicySource(home, source);
        }
      };
      const commands = new SupervisionCommands(store, home, { enabled: true, unverifiedUiAnswers: true,
        commandBoundary: run => this.runtime.features ? this.runtime.features.boundary(home, run) : run(),
        answerAdmission: async () => { await this.checked(homeId); } });
      const gateway = new SupervisionGateway(store, commands, home, receiver, { enabled: true, policyFence: this.runtime.features?.gateway(home, "scopeExecution", () => store.read()),
        admissionCheck: async (status, effect) => {
          // This service can only dispatch its own conversation effects. Worker effects belong to Build B.
          if (effect.attemptId !== null) refuse("UNSUPPORTED", "Discussion cannot dispatch worker effects.");
          await check(status, effect.scopeId);
          const capacity = await this.runtime.features?.capacity(home);
          if (capacity) await checkGeneralHeadroom(status, receiver, capacity.slots, capacity.generalHeadroom, effect.id);
          if (capturedRuleAuthority && digest(effect.planRules ?? null) !== digest(capturedRuleAuthority))
            refuse("STALE", "This supervisor effect did not reserve the current rule authority.");
          if (profileAuthority(status) !== capturedProfileAuthority || digest(readLimits(status)) !== digest(limits))
            refuse("STALE", "Discussion profile, plan or budget changed before dispatch.");
        } });
      const profileAndLimits = async (status: SupervisionStatus, scopeId: string) => {
        const binding = status.bindings.find(b => b.scopeId === scopeId);
        const project = status.projects?.projects.find(p => p.scopeId === scopeId);
        if (project?.owner) return { profile: project.owner.profile, limits: project.owner.limits };
        // The continuing-turn cap comes only from the stored Build B seam. This profile
        // lookup never raises or resets the cumulative reservation budget.
        if (binding) return { profile: await gateway.profile(binding.profileDigest), limits: readLimits(status) };
        const plan = status.plans.find(p => p.scopeId === scopeId)?.plan;
        const runNode = plan?.definition.nodes.find(n => n.kind === "run");
        if (!runNode || runNode.kind !== "run") refuse("HELD", "No stored discussion profile is available.");
        return { profile: runNode.launch.agent, limits: readLimits(status) };
      };
      const initial = await store.read();
      const capturedRuleAuthority = planLimits && initial.scopes.some(s => s.id === scopeId && s.kind === "plan")
        ? planSupervisorAuthority(initial, scopeId) : null;
      const profileAuthority = (status: SupervisionStatus) => digest(status.projects?.projects.find(p => p.scopeId === scopeId)?.owner ??
        status.plans.find(p => p.scopeId === scopeId)?.plan.definition ?? null);
      const capturedProfileAuthority = profileAuthority(initial);
      const readLimits = (status: SupervisionStatus) => GatewayLimitsSchema.parse(status.projects?.projects.find(p => p.scopeId === scopeId)?.owner?.limits ??
        (status.scopes.find(s => s.id === scopeId)?.kind === "plan" ? planLimits?.(status, scopeId) : undefined) ?? { supervisorSessions: 1, supervisorTurns: 1 });
      const limits = readLimits(initial);
      const sessions = new SupervisorSessions(store, gateway, receiver, { enabled: true,
        featurePolicy: async () => this.runtime.features?.reservation(home, "scopeExecution"),
        reserveBoundary: run => this.runtime.features ? this.runtime.features.boundary(home, run) : run(),
        limits, ...(capturedRuleAuthority ? { ruleRef: (current: SupervisionStatus, id: string) => planSupervisorAuthority(current, id) } : {}),
        budgetRefused: scope => this.options.planBudgetRefused?.(store, home, scope) ?? Promise.resolve(),
        globalMateId: async () => (await this.checked(homeId)).config.mateAgentId || null,
        reserveCheck: async current => {
          await check(current, scopeId);
          if (profileAuthority(current) !== capturedProfileAuthority) refuse("STALE", "Stored discussion profile or plan changed before reservation.");
          const latest = readLimits(current);
          if (JSON.stringify(latest) !== JSON.stringify(limits)) refuse("STALE", "Stored discussion budget changed; refresh.");
          const capacity = await this.runtime.features?.capacity(home);
          await checkGeneralHeadroom(current, receiver, capacity?.slots ?? this.options.slots ?? 4, capacity?.generalHeadroom ?? this.options.generalHeadroom ?? 1);
        } });
      const discussions = new ScopeDiscussions(home, store, sessions, {
        enabled: true, uiEnabled: this.runtime.features ? (await this.runtime.features.read(home)).effective.scopeUi : !!this.options.uiEnabled, admittedProjectsOnly: true,
        actor: { kind: "plugin-ui-unverified", id: "unauthenticated-plugin-call", source: "scope Send (unverified)" },
        reserve: work => withScopeAdmission(homeId, work),
        projectContext: async ids => {
          const context = []; let bytes = 0;
          for (const id of ids) {
            if ((await store.read()).projects?.projects.find(p => p.id === id)?.state !== "admitted") refuse("HELD", "Project context is no longer admitted.");
            const value = await readProjectContext(store, id); bytes += Buffer.byteLength(JSON.stringify(value));
            if (bytes > 512 * 1024) refuse("HELD", "Project context exceeds the 512 KiB shared snapshot budget; choose fewer projects.");
            context.push(value);
          }
          return context;
        },
        generalId: async () => (await this.checked(homeId)).config.mateAgentId || null,
        profile: async id => (await profileAndLimits(await store.read(), id)).profile,
        generalSend: (text, messageId, beforeSend) => askMate(paseo, { text, messageId }, async agentId => {
          await this.checked(homeId); await beforeSend(agentId);
        }, start => this.runtime.features ? this.runtime.features.boundary(home, async () => {
          await this.checked(homeId);
          const pending = start(); void pending.catch(() => undefined); return { pending };
        }) : Promise.resolve({ pending: start() })),
      });
      return run({ discussions, commands });
    };
    // General's ordinary conversation must not wait for scoped writer/coordinator recovery.
    // Its thread transport writes only on explicit Send, and project context still fails closed.
    return scopeId === "general" ? compose(new SupervisionStore(this.runtime.root, home)) : this.runtime.mutate(home, compose);
  }
}
