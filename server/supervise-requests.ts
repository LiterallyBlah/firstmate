/** The current first mate's Supervisor setup service: plan-help handover, plan Attach and project
 * provisioning over `data/supervise-requests/`, calling the exact server paths the captain's app
 * buttons call. Same-user role convention, not authenticated IPC: every command is refused by the
 * cooperative role check unless the named actor is the configured first mate in an active turn, so
 * crewmates and Supervisors are refused. Recorded journal actors are that mate, never the captain.
 * Handover `abort`/`resolve-hold` stay app-only. */
import { readFile, readdir, stat } from "node:fs/promises";
import type { PluginServerContext } from "@getpaseo/plugin/server";
import { SuperviseRequestSchema, SUPERVISE_ACTOR_SOURCE, SUPERVISE_PROVENANCE, type SuperviseRequest } from "../shared/supervise";
import type { SupervisionActor } from "../shared/supervision";
import { readFirstmateConfig, resolveHome } from "./config";
import { resolveInHome } from "./files";
import { serialized } from "./serialize";
import { publish } from "./submissions";
import { refuse } from "./supervision-effects";
import { workflowHomeIdentity } from "./workflow-ownership";
import type { SupervisionActivation } from "./supervision-activation";
import type { ProjectRuntime } from "./project-runtime";
import type { PaseoApi } from "./host-types";

export interface SuperviseRequestsOptions {
  activation: SupervisionActivation;
  projects: ProjectRuntime;
  config?: typeof readFirstmateConfig;
}

export class SuperviseRequests {
  private paseo: PaseoApi | null = null;
  private closed = false;
  /** Live turns by agent, from the host's turn events: setup runs only while the mate is mid-turn. */
  private readonly turns = new Set<string>();
  constructor(private readonly options: SuperviseRequestsOptions) {}
  remember(paseo: PaseoApi) { if (!this.closed) this.paseo = paseo; }
  turnStarted(agentId: string, turnId?: string | null) { if (!this.closed && agentId) this.turns.add(`${agentId}\0${turnId ?? ""}`); }
  turnEnded(agentId: string, turnId?: string | null) {
    if (turnId) this.turns.delete(`${agentId}\0${turnId}`);
    else for (const key of [...this.turns]) if (key.startsWith(`${agentId}\0`)) this.turns.delete(key);
  }
  stop() { this.closed = true; this.paseo = null; this.turns.clear(); }
  private config() { return (this.options.config ?? readFirstmateConfig)(); }
  /** The fresh cooperative role check behind every command: only the configured first mate, in this
   * home, while one of its turns is live — a request file dropped outside a turn is never acted on. */
  private async checked(actorId: string) {
    if (this.closed) refuse("UNSUPPORTED", "Supervisor setup is stopped.");
    const config = await this.config();
    if (!config.mateAgentId || config.mateAgentId !== actorId || config.migration || config.mateLaunch)
      refuse("UNKNOWN_OWNER", "Only the current first mate sets up Supervisors through this tool.");
    if (![...this.turns].some(key => key.startsWith(`${actorId}\0`)))
      refuse("HELD", "Supervisor setup runs only while the current first mate is in a turn. Submit a new request (new request id) from within your turn.");
    const home = resolveHome(config);
    const actor: SupervisionActor = { kind: "mate-chat", id: actorId, source: SUPERVISE_ACTOR_SOURCE };
    return { config, home, homeId: workflowHomeIdentity(home), actor };
  }
  private native(): PaseoApi {
    if (!this.paseo) refuse("HELD", "The host connection is not available yet. After FirstMate reconnects, submit a new request with a new request id; for an interrupted setup use attach-resume or project-provision-resume instead.");
    return this.paseo;
  }
  async execute(raw: SuperviseRequest) {
    const request = SuperviseRequestSchema.parse(raw), { homeId, actor } = await this.checked(request.actor);
    const command = request.command, activation = this.options.activation;
    switch (command.op) {
      case "plan-help": return activation.planHelp(homeId, command.plan);
      case "evidence": return activation.evidence({ homeId, plan: command.plan, folder: command.folder, ...(command.rollbackPath ? { rollbackPath: command.rollbackPath } : {}) });
      case "backup-read": return activation.readBackup(homeId);
      case "backup-set": return activation.saveBackup({ homeId, expectedRevision: command.expectedRevision, requestId: request.id, backup: command.backup }, SUPERVISE_PROVENANCE, actor.id);
      case "activation": return activation.read();
      case "migrate": {
        if (command.command.op === "abort" || command.command.op === "resolve-hold")
          refuse("UNSUPPORTED", "Canceling a handover and resolving its holds stay with the captain's app controls; this tool runs backup, evidence, prepare, reconcile, barrier and commit.");
        if (command.command.homeId !== homeId) refuse("STALE", "Home changed; reread the plan-help review.");
        return activation.migrate(command.command, actor);
      }
      case "attach": return activation.attach({ homeId, requestId: request.id, ...command.attach }, this.native(), actor);
      case "attach-resume": return activation.attach({ homeId, requestId: command.attachRequestId, resume: true }, this.native(), actor);
      case "project-provision": return this.options.projects.provision({ homeId, requestId: request.id, ...command.provision }, this.native(), actor);
      case "project-provision-resume": {
        const row = (await this.options.projects.read()).projects.find(p => p.projectId === command.projectId);
        if (!row?.provisionInput) refuse("HELD", "No saved provisioning request was found for this project. Read projects first, then provision or resume the recorded request.");
        return this.options.projects.provision(row.provisionInput, this.native(), actor);
      }
    }
  }
  /** Existing workflow clock only; replies stay on disk for a lost-read replay, as the other tools. */
  async processRequests() {
    if (this.closed) return;
    const config = await this.config(), home = resolveHome(config);
    if (config.migration || config.mateLaunch) return;
    const { absolute: directory } = await resolveInHome(home, "data/supervise-requests");
    // Cheap fast-lane gate, as for scope requests: one listing outside the lock decides
    // whether the checked pass is worth running; the pass re-lists under its serialization,
    // so a race here costs at most one extra pass or one clock beat, never a double act.
    let waiting: string[];
    try { waiting = await readdir(directory); } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return; throw error; }
    const anyWaiting = new Set(waiting);
    if (!waiting.some(n => /^[0-9a-f-]{36}\.json$/.test(n) && !anyWaiting.has(n.replace(/\.json$/, ".reply.json")))) return;
    await serialized(directory, async () => {
      let names: string[];
      try { names = await readdir(directory); } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return; throw error; }
      const listed = new Set(names);
      let processed = 0;
      for (const name of names.filter(n => /^[0-9a-f-]{36}\.json$/.test(n)).sort()) {
        const relative = `data/supervise-requests/${name}`;
        // Answered requests are retained and replies publish only under this serialized pass,
        // so the listing above is authoritative here; stat-ing every reply made each pass's
        // cost grow with the unpruned directory (thousands of pairs on a busy home).
        if (listed.has(name.replace(/\.json$/, ".reply.json"))) continue;
        if (processed++ >= 20) break;
        const reply = (await resolveInHome(home, relative.replace(/\.json$/, ".reply.json"))).absolute;
        let response;
        try {
          const path = (await resolveInHome(home, relative)).absolute;
          if ((await stat(path)).size > 256 * 1024) refuse("HELD", "Supervise request exceeds 256 KiB.");
          const request = SuperviseRequestSchema.parse(JSON.parse(await readFile(path, "utf8")));
          if (`${request.id}.json` !== name) refuse("CONFLICT", "Supervise request identity differs from its filename.");
          response = { ok: true, result: await this.execute(request) };
        } catch (error) { response = { ok: false, error: error instanceof Error ? error.message : String(error) }; }
        await publish(reply, response);
      }
    });
  }
}

/** No new RPC: the tool is the only caller. The host handle is remembered from ordinary agent turns. */
export function registerSuperviseRequests(server: PluginServerContext, supervise: SuperviseRequests) {
  const started = server.on("agent.turn_started", (event, context) => { supervise.remember(context.paseo); supervise.turnStarted(event.agent.id, event.turnId); });
  const ended = server.on("agent.turn_ended", (event, context) => { supervise.remember(context.paseo); supervise.turnEnded(event.agent.id, event.turnId); });
  return () => { started(); ended(); supervise.stop(); };
}
