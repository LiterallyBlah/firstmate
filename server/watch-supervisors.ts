/** Exact app assignment over the existing watch config, gate and owned journal. No session creation. */
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { PluginServerContext } from "@getpaseo/plugin/server";
import { actWatchSupervisor, readWatchSupervisors, type WatchAssignment, type WatchSupervisorSnapshot } from "../shared/watch-routing";
import { WatchConfigStore, WatchRouteHandoff } from "./watch-config";
import { listWatches } from "./watch-files";
import { readFirstmateConfig, resolveHome } from "./config";
import { pluginDir } from "./data-dir";
import { cutoverGate } from "./supervision-gate";
import { digest } from "./submissions";
import { SupervisionSources } from "./supervision-sources";
import type { SupervisionRuntime } from "./supervision-runtime";
import type { WatchService } from "./watch-service";
import { watchItem } from "./watches";
import { workflowHomeIdentity } from "./workflow-ownership";
import { planSupervisorLimits } from "../shared/plan-supervisor-limits";
import { supervisorConfigurations } from "./supervisor-configuration";
import { watchPolicyDigest } from "./supervision-source-state";
import { capacityHeld } from "../shared/supervision-capacity";
import { SOURCE_LIMITS } from "../shared/supervision-sources";

export class WatchSupervisors {
  readonly config = new WatchConfigStore(join(pluginDir(), "watch-config.json"));
  constructor(private readonly runtime: SupervisionRuntime, private readonly service: WatchService) {}
  async definitions(home: string) {
    return Promise.all((await listWatches(home)).map(async w => ({ name: w.name, definitionDigest: digest(await readFile(w.path, "utf8")) })));
  }
  async read(): Promise<WatchSupervisorSnapshot> {
    const config = await readFirstmateConfig(), home = resolveHome(config), s = await this.runtime.read(home), saved = await this.config.read();
    const definitions = await this.definitions(home), policy = await this.runtime.features?.read(home);
    const transportProblems = new Map<string, string>();
    for (const [name, row] of Object.entries(saved.assignments)) {
      try {
        const route = await cutoverGate(home).readWatchRoute(name);
        if (route?.requestId !== row.requestId || route.stage !== row.stage)
          transportProblems.set(name, "Assignment transport is held: its saved disposition is unfinished. Retry the exact accepted action to reconcile it.");
      } catch { transportProblems.set(name, "Assignment transport cannot be read; its original route remains held for reconciliation."); }
    }
    const assignmentProblem = (row: WatchAssignment | undefined) => {
      if (!row) return null;
      if (transportProblems.has(row.target.name)) return transportProblems.get(row.target.name)!;
      if (row.stage === "aborted") return null;
      if (row.target.homeId !== workflowHomeIdentity(home)) return "This retained assignment belongs to another home. Its route and evidence are not adopted here.";
      const b = s.bindings.find(b => b.scopeId === row.target.scopeId), task = s.tasks.find(t => t.id === row.target.taskId);
      const source = s.inbox.sources.find(source => source.kind === "watch" && source.id === digest(["s08-source", "watch", "local", null, row.target.name]));
      if (row.stage === "committed" && source?.gaps.length) return `Watch evidence remains held (${source.gaps.join(", ")}); reconcile the source before new work.`;
      if (row.stage === "committed" && capacityHeld(s, "sources", SOURCE_LIMITS.observationCeiling)) return "Watch source observation capacity is held; retained evidence and reconciliation reserves remain unchanged.";
      return !b || b.state !== "active" || digest({ agentId: b.agentId, epoch: b.epoch, profileDigest: b.profileDigest }) !== digest(row.target.owner) ||
        task?.currentAttempt !== row.target.attemptId || watchPolicyDigest(s, row.target.scopeId) !== row.target.policyDigest
        ? "The captured owner, profile, attempt or policy changed. The original assignment remains held; review its exact disposition." : null;
    };
    return { homeId: workflowHomeIdentity(home), watches: [...definitions.map(w => ({ ...w, assignment: saved.assignments[w.name] ?? null, assignmentDigest: saved.assignments[w.name] ? digest(saved.assignments[w.name]) : null,
      problem: saved.assignments[w.name] && saved.assignments[w.name]!.target.definitionDigest !== w.definitionDigest ? "Watch definition changed. Its original route and evidence remain held for review." : assignmentProblem(saved.assignments[w.name]) })),
      ...Object.entries(saved.assignments).filter(([name]) => !definitions.some(w => w.name === name)).map(([name, assignment]) => ({ name, definitionDigest: assignment.target.definitionDigest, assignment, assignmentDigest: digest(assignment),
        problem: "Assigned watch is missing or renamed. Its original route remains held; restore the exact definition or reconcile it explicitly." }))],
      targets: s.freshness !== "current" ? [] : s.tasks.flatMap(t => {
        const plan = s.plans.find(p => p.scopeId === t.ownerScopeId && p.plan.definition.id === t.planId), binding = s.bindings.find(b => b.scopeId === t.ownerScopeId);
        return t.hostId === "local" && t.currentAttempt && plan && binding?.state === "active" && s.scopes.some(scope => scope.id === t.ownerScopeId && scope.kind === "plan" && scope.state === "active")
          ? definitions.map(w => ({ ...w, homeId: s.homeId, hostId: "local" as const, scopeId: t.ownerScopeId, taskId: t.id, attemptId: t.currentAttempt!, planId: t.planId, planHash: plan.plan.hash,
            planRevision: plan.plan.revision, owner: { agentId: binding.agentId, epoch: binding.epoch, profileDigest: binding.profileDigest }, policyDigest: watchPolicyDigest(s, t.ownerScopeId) })) : [];
      }), owners: s.bindings.map(b => { const limits = planSupervisorLimits(s, b.scopeId), configuration = supervisorConfigurations(s, b.scopeId).find(c => c.id === b.configurationId);
        return { scopeId: b.scopeId, profile: configuration ? `${configuration.resolved.provider} · ${configuration.resolved.modeId} · ${configuration.resolved.thinkingOptionId ?? "no reasoning selector"}` : `Retained profile ${b.profileDigest}`,
          remainingSessions: limits.limits ? Math.max(0, limits.limits.sessions - limits.spent.sessions) : null,
          remainingTurns: limits.limits ? Math.max(0, limits.limits.turns - limits.spent.turns) : null }; }), observer: { available: false, reason: "Installed read-only observer adapter is unqualified. Full-access cannot replace independent read-only observation. Existing inspector history is retained." },
      problems: [...s.problems, ...(policy && !policy.effective.planSupervisors ? ["Plan Supervisor execution is disabled. Saved routes and pending effects remain retained."] : []), ...(config.migration || config.mateLaunch ? ["Home handover is in progress."] : [])] };
  }
  register(server: PluginServerContext) {
    server.handle(readWatchSupervisors, () => this.read());
    server.handle(actWatchSupervisor, async input => {
      const c = await readFirstmateConfig(), home = resolveHome(c), homeId = workflowHomeIdentity(home);
      if (c.migration || c.mateLaunch || (input.op === "prepare" ? input.target.homeId : input.homeId) !== homeId) throw Error("Home changed or is migrating; reopen the exact assignment.");
      const signature = digest(input), accepted = (await this.config.read()).receipts[input.requestId];
      if (accepted && accepted !== signature) throw Error("That request ID has different assignment action fields.");
      const gate = cutoverGate(home), handoff = new WatchRouteHandoff({ config: this.config, gate,
        definition: async name => { const found = (await this.definitions(home)).find(w => w.name === name); if (!found) throw Error("Exact watch definition is unavailable."); return found.definitionDigest; },
        pending: async name => [...(await this.service.runner.queued()).filter(n => n.name === name).map(n => ({ ...watchItem(n), delivery: n.delivery ?? null })),
          ...await this.service.pendingInspections(name)],
        validate: async target => { if (!(await this.read()).targets.some(t => digest(t) === digest(target))) throw Error("The captured plan, owner, profile or policy changed; no assignment is admitted."); },
        bindingState: async requestId => { const s = await this.runtime.read(home); return s.freshness !== "current" ? "unknown" : s.inbox.requests.some(r => r.id === requestId) ? "committed" : "absent"; },
        bind: (target, requestId) => this.runtime.mutate(home, store => new SupervisionSources(store).bindWatch(target, requestId)) });
      if (accepted && input.op !== "prepare") {
        await handoff.replayAction({ ...input, signature, stage: input.op === "abort" ? "aborted" : input.op === "commit" || input.op === "resume" ? "committed" : "paused" });
        return this.read();
      }
      await this.runtime.features?.check(home, "planSupervisors");
      if (input.op === "prepare") {
        await handoff.prepare(input);
      } else {
        const row = (await this.config.read()).assignments[input.name];
        if (row?.requestId !== input.assignmentRequestId) throw Error("Assignment changed; refresh this review.");
        const action = { requestId: input.requestId, signature, assignmentDigest: input.assignmentDigest };
        if (input.op === "commit") await handoff.commit(input.assignmentRequestId, action);
        else if (input.op === "abort") await handoff.abort(input.assignmentRequestId, action);
        else await gate.run(async () => {
          if (row.stage !== "committed" && row.stage !== "paused") throw Error("Only an established route can pause.");
          if (input.op === "resume") {
            const snapshot = await this.read(), watch = snapshot.watches.find(w => w.name === input.name);
            if (!watch || watch.problem || snapshot.problems.length) throw Error("The paused exact target, source or policy needs review; its admissions remain held.");
          }
          const stage = input.op === "resume" ? "committed" : "paused";
          let applicable = false;
          await this.config.change(async s => {
            const current = s.assignments[input.name];
            if (s.receipts[input.requestId]) {
              if (s.receipts[input.requestId] !== signature) throw Error("Assignment action request conflicts.");
              applicable = current?.requestId === input.assignmentRequestId && current.lastActionId === input.requestId && current.stage === stage;
              return;
            }
            if (!current || digest(current) !== input.assignmentDigest) throw Error("The reviewed assignment changed; reread before acting.");
            current.stage = stage; current.lastActionId = input.requestId; s.receipts[input.requestId] = signature;
            applicable = true;
          });
          if (applicable) await gate.watchRoute(input.name, row.requestId, stage);
        });
      }
      return this.read();
    });
  }
}
