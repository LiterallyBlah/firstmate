/** The current first mate's Supervisor setup service: plan-help handover, plan Attach and project
 * provisioning over `data/supervise-requests/`, calling the exact server paths the captain's app
 * buttons call. Same-user role convention, not authenticated IPC: every command re-checks that the
 * named actor is the configured first mate, so crewmates and Supervisors are refused. Recorded
 * journal actors are that mate, never the captain. Handover `abort`/`resolve-hold` stay app-only. */
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
  constructor(private readonly options: SuperviseRequestsOptions) {}
  remember(paseo: PaseoApi) { if (!this.closed) this.paseo = paseo; }
  stop() { this.closed = true; this.paseo = null; }
  private config() { return (this.options.config ?? readFirstmateConfig)(); }
  /** The fresh role re-check behind every command: only the configured first mate, in this home. */
  private async checked(actorId: string) {
    if (this.closed) refuse("UNSUPPORTED", "Supervisor setup is stopped.");
    const config = await this.config();
    if (!config.mateAgentId || config.mateAgentId !== actorId || config.migration || config.mateLaunch)
      refuse("UNKNOWN_OWNER", "Only the current first mate sets up Supervisors through this tool.");
    const home = resolveHome(config);
    const actor: SupervisionActor = { kind: "mate-chat", id: actorId, source: SUPERVISE_ACTOR_SOURCE };
    return { config, home, homeId: workflowHomeIdentity(home), actor };
  }
  private native(): PaseoApi {
    if (!this.paseo) refuse("HELD", "The host connection is not available yet; retry the same request after FirstMate reconnects.");
    return this.paseo;
  }
  async execute(raw: SuperviseRequest) {
    const request = SuperviseRequestSchema.parse(raw), { homeId, actor } = await this.checked(request.actor);
    const command = request.command, activation = this.options.activation;
    switch (command.op) {
      case "plan-help": return activation.planHelp(homeId, command.plan);
      case "evidence": return activation.evidence({ homeId, plan: command.plan, folder: command.folder, ...(command.rollbackPath ? { rollbackPath: command.rollbackPath } : {}) });
      case "backup-read": return activation.readBackup(homeId);
      case "backup-set": return activation.saveBackup({ homeId, expectedRevision: command.expectedRevision, requestId: request.id, backup: command.backup }, SUPERVISE_PROVENANCE);
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
    }
  }
  /** Existing workflow clock only; replies stay on disk for a lost-read replay, as the other tools. */
  async processRequests() {
    if (this.closed) return;
    const config = await this.config(), home = resolveHome(config);
    if (config.migration || config.mateLaunch) return;
    const { absolute: directory } = await resolveInHome(home, "data/supervise-requests");
    await serialized(directory, async () => {
      let names: string[];
      try { names = await readdir(directory); } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return; throw error; }
      let processed = 0;
      for (const name of names.filter(n => /^[0-9a-f-]{36}\.json$/.test(n)).sort()) {
        const relative = `data/supervise-requests/${name}`, reply = (await resolveInHome(home, relative.replace(/\.json$/, ".reply.json"))).absolute;
        try { await stat(reply); continue; } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
        if (processed++ >= 20) break;
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
  const started = server.on("agent.turn_started", (_event, context) => supervise.remember(context.paseo));
  const ended = server.on("agent.turn_ended", (_event, context) => supervise.remember(context.paseo));
  return () => { started(); ended(); supervise.stop(); };
}
