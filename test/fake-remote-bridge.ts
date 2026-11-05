/** Fake CLI bridge for the label-bound remote receiver tests. Its `run`/`inspect`/`ls` answers use
 * the real JSON shapes captured by the slice 0 probe (`docs/scoped-supervision/remote-probe/evidence/live.json`:
 * `create`, `status:first-turn-settled`, `reconcile:label-listing`), with fixture profile values.
 * No host, network or daemon is touched. */
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { RemoteBridge } from "../server/supervision-remote-receiver";
import { RemoteConnectRefused } from "../server/remotes";

const probe = JSON.parse(readFileSync(join(process.cwd(), "docs/scoped-supervision/remote-probe/evidence/live.json"), "utf8")) as
  { steps: { name: string; parsed?: unknown }[] };
const probeStep = (name: string) => probe.steps.find((step) => step.name === name)?.parsed as Record<string, unknown>;
export const REMOTE_HOST = "srv_remote";
export const REMOTE_CWD = "/home/ariadne/work";

export class FakeCliBridge implements RemoteBridge {
  calls: string[][] = [];
  agents = new Map<string, Record<string, unknown>>();
  byAttempt = new Map<string, string[]>();
  /** lose-run: the run lands, then its reply is lost. connect: refused before any submission. */
  fault: "lose-run" | "connect" | null = null;
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
  async request(_selector: string, args: string[]): Promise<unknown> {
    this.calls.push([...args]);
    if (this.fault === "connect") throw new RemoteConnectRefused("Host unreachable or authentication failed; reconnect it in Paseo (last attempt: connect ECONNREFUSED)");
    if (args[0] === "workspace") return { workspaceId: "wks_remote1", cwd: REMOTE_CWD };
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
