/** Fake CLI bridge for the label-bound remote receiver tests. Its `run`/`inspect`/`ls` answers use
 * the real JSON shapes captured by the slice 0 probe (`docs/scoped-supervision/remote-probe/evidence/live.json`:
 * `create`, `status:first-turn-settled`, `reconcile:label-listing`), with fixture profile values.
 * Every `request` first runs through the real `commandArguments`, exactly as `RemoteService.request`
 * does, so a reserved-label or unsupported-command bug in a caller fails here instead of only in
 * production. Recorded `calls` are the transformed arguments the real bridge would send.
 * No host, network or daemon is touched. */
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { RemoteBridge } from "../server/supervision-remote-receiver";
import { commandArguments, RemoteConnectRefused } from "../server/remotes";

const probe = JSON.parse(readFileSync(join(process.cwd(), "docs/scoped-supervision/remote-probe/evidence/live.json"), "utf8")) as
  { steps: { name: string; parsed?: unknown }[] };
const probeStep = (name: string) => probe.steps.find((step) => step.name === name)?.parsed as Record<string, unknown>;
export const REMOTE_HOST = "srv_remote";
export const REMOTE_CWD = "/home/ariadne/work";

export class FakeCliBridge implements RemoteBridge {
  calls: string[][] = [];
  agents = new Map<string, Record<string, unknown>>();
  byAttempt = new Map<string, string[]>();
  /** lose-run: the run lands, then its reply is lost. connect: refused before any submission.
   * refuse-run: the run is definitely refused before submission (after any workspace create). */
  fault: "lose-run" | "connect" | "refuse-run" | "lose-permit" | null = null;
  /** Pending permissions per agent, as `permit ls`/`inspect` report them (slice 0 probe shapes). */
  permissions = new Map<string, { id: string; tool: string }[]>();
  addPermission(agentId: string, id: string, tool: string) {
    this.permissions.set(agentId, [...(this.permissions.get(agentId) ?? []), { id, tool }]);
    const detail = this.agents.get(agentId);
    if (detail) detail.PendingPermissions = (this.permissions.get(agentId) ?? []).map((row) => ({ id: row.id, tool: row.tool }));
  }
  daemonVersion: string | null = "0.14.0";
  clockSkewSeconds = 0;
  /** Applied to every inspect answer, to model a host that ignored part of the request. */
  tamperInspect: ((detail: Record<string, unknown>) => void) | null = null;
  async hostInfo() {
    return { serverId: REMOTE_HOST, label: "Remote", online: true, daemonVersion: this.daemonVersion, clockSkewSeconds: this.clockSkewSeconds };
  }
  async discoverByAttempt(_selector: string, attemptLabel: string) {
    const attempt = attemptLabel.slice("firstmate.attempt=".length);
    const template = (probeStep("reconcile:label-listing") as unknown as Record<string, unknown>[])[0] ?? {};
    return (this.byAttempt.get(attempt) ?? []).map((id) => ({ ...template, id, cwd: REMOTE_CWD, provider: "codex/gpt-6.1-sol", status: "idle" }));
  }
  async request(_selector: string, rawArgs: string[]): Promise<unknown> {
    // The real bridge's own validation and injection, before anything is recorded or answered:
    // reserved ownership labels, target overrides and unsupported commands throw here.
    const args = commandArguments(rawArgs, "srv_local:firstmate");
    this.calls.push([...args]);
    if (this.fault === "connect") throw new RemoteConnectRefused("Host unreachable or authentication failed; reconnect it in Paseo (last attempt: connect ECONNREFUSED)");
    if (args[0] === "workspace") return { workspaceId: "wks_remote1", cwd: REMOTE_CWD };
    if (args[0] === "run" && this.fault === "refuse-run") { this.fault = null; throw new Error("Unsupported remote command"); }
    if (args[0] === "run") {
      const id = randomUUID();
      const attempt = args.flatMap((arg, i) => arg === "--label" ? [args[i + 1] ?? ""] : []).find((label) => label.startsWith("firstmate.attempt="))?.slice("firstmate.attempt=".length);
      if (attempt) this.byAttempt.set(attempt, [...(this.byAttempt.get(attempt) ?? []), id]);
      this.agents.set(id, { ...probeStep("status:first-turn-settled"), Id: id, Provider: "codex", Model: "gpt-6.1-sol",
        Mode: "full-access", Thinking: "high", Status: "running", Cwd: REMOTE_CWD,
        CreatedAt: new Date(Date.now() + this.clockSkewSeconds * 1000).toISOString(), ParentAgentId: null, Archived: false, ArchivedAt: null, PendingPermissions: [] });
      if (this.fault === "lose-run") { this.fault = null; throw new Error("Remote command failed: Connection timed out"); }
      return { ...probeStep("create"), agentId: id, cwd: REMOTE_CWD };
    }
    if (args[0] === "permit" && args[1] === "ls")
      return [...this.permissions.entries()].flatMap(([agentId, rows]) => rows.map((row) => ({ id: row.id, agentId, agentShortId: agentId.slice(0, 8), name: row.tool, description: "-" })));
    if (args[0] === "permit" && (args[1] === "deny" || args[1] === "allow")) {
      const agentId = args[2]!, requestId = args[3]!;
      const row = (this.permissions.get(agentId) ?? []).find((entry) => entry.id === requestId);
      if (!row) throw new Error("Remote command failed: Permission request not found");
      this.permissions.set(agentId, (this.permissions.get(agentId) ?? []).filter((entry) => entry.id !== requestId));
      const detail = this.agents.get(agentId);
      if (detail) detail.PendingPermissions = (this.permissions.get(agentId) ?? []).map((entry) => ({ id: entry.id, tool: entry.tool }));
      // The answer landed, then its reply was lost: the caller must stay uncertain and never resend.
      if (this.fault === "lose-permit") { this.fault = null; throw new Error("Remote command failed: Connection timed out"); }
      return [{ requestId, agentId, agentShortId: agentId.slice(0, 8), name: row.tool, result: args[1] === "deny" ? "denied" : "allowed" }];
    }
    if (args[0] === "inspect") {
      const detail = this.agents.get(args[1]!);
      if (!detail) throw new Error("Remote command failed: Agent not found");
      const copy = structuredClone(detail);
      this.tamperInspect?.(copy);
      return copy;
    }
    return {};
  }
  runs() { return this.calls.filter((args) => args[0] === "run"); }
}
