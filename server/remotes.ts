/** Saved connections live outside the mate's home. The queue only executes
 * explicit CLI requests from the mate; it never chooses or dispatches work. */
import { randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { RemoteRequest, RemoteSnapshot, SavedHosts, type RemoteConnection, type RemoteHost, type RemoteProfile } from "../shared/remotes";
import { runPaseo, type CliResult } from "./cli";
import { readFirstmateConfig, resolveHome } from "./config";
import { paseoHome, pluginDir } from "./data-dir";
import { serialized } from "./serialize";

const Registry = z.object({ version: z.literal(1), syncedAt: z.string(), hosts: SavedHosts });
const empty = (): RemoteSnapshot => ({ version: 1, localServerId: "", syncedAt: null, syncError: null, hosts: [] });
export const remoteQueue = () => join(pluginDir(), "remote-requests");
async function atomic(path: string, value: unknown): Promise<void> {
  const temp = `${path}.${randomUUID()}.tmp`;
  try { await writeFile(temp, JSON.stringify(value, null, 2), { mode: 0o600 }); await rename(temp, path); }
  finally { await rm(temp, { force: true }); }
}
async function optionalJson(path: string): Promise<unknown> {
  try { return JSON.parse(await readFile(path, "utf8")); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw error; }
}

export function connectionTarget(host: RemoteProfile, connection: RemoteConnection): string {
  switch (connection.type) {
    case "relay": return `https://app.paseo.sh/#offer=${Buffer.from(JSON.stringify({
      v: 2, serverId: host.serverId, daemonPublicKeyB64: connection.daemonPublicKeyB64,
      relay: { endpoint: connection.relayEndpoint, ...(connection.useTls === undefined ? {} : { useTls: connection.useTls }) },
    })).toString("base64url")}`;
    case "directTcp": {
      const endpoint = connection.endpoint.replace(/^(?:wss?|tcp):\/\//, "");
      if (/[?#/@\s]/.test(endpoint.replace(/\/ws\/?$/, ""))) throw new Error("Unsupported TCP address");
      return `tcp://${endpoint.replace(/\/ws\/?$/, "")}${connection.useTls ? "?ssl=true" : ""}`;
    }
    case "remoteSsh": return `ssh://${connection.host}${connection.sshPort ? `:${connection.sshPort}` : ""}?daemonPort=${connection.daemonPort ?? 6767}`;
    case "directSocket": return `unix://${connection.path}`;
    case "directPipe": return `pipe://${connection.path}`;
  }
}
export function remoteEnvironment(host: RemoteProfile, target: string, source: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const env = { ...source };
  // Never carry local identity/authentication to another daemon, including
  // Windows' case-insensitive environment variable spellings.
  for (const key of Object.keys(env)) if (/^PASEO_(HOME|HOST|PASSWORD|LOCAL_CREDENTIAL|AGENT_ID|WORKSPACE_ID)$/i.test(key)) delete env[key];
  env.PASEO_HOST = target;
  if (host.password) env.PASEO_PASSWORD = host.password;
  return env;
}

/** Limit this bridge to orchestration. Target/authentication selectors are
 * forbidden, including nested global flags and Commander aliases. */
export function commandArguments(args: string[], owner: string): string[] {
  const command = args[0] ?? "";
  if (!["ls", "run", "logs", "inspect", "stop", "send", "wait", "archive", "permit", "provider", "project", "workspace"].includes(command)) throw new Error("Unsupported remote command");
  if (args.some((arg) => /^--(?:host|home|password)(?:=|$)/.test(arg))) throw new Error("Remote target cannot be overridden");
  if (args.some((arg, i) => (arg === "--label" && /^firstmate\.(?:owner|role)=/.test(args[i + 1] ?? "")) || /^--label=firstmate\.(?:owner|role)=/.test(arg))) throw new Error("Reserved ownership label");
  const result = [...args];
  if (command === "run") result.push("--background", "--label", "firstmate.role=crew", "--label", `firstmate.owner=${owner}`);
  if (command === "send") result.push("--no-wait");
  if (!result.includes("--json")) result.push("--json");
  return result;
}
function parsed(result: CliResult, allowText = false): unknown {
  if (result.code !== 0) {
    const text = `${result.stderr}\n${result.stdout}`;
    if (/password|unauthorized|authentication/i.test(text)) throw new Error("Remote authentication failed; reconnect this host in Paseo");
    throw new Error("Remote command failed; inspect the host in Paseo for details");
  }
  try { return JSON.parse(result.stdout); }
  catch { if (allowText) return result.stdout; throw new Error("Remote CLI returned an unsupported response"); }
}
function publicRows(value: unknown, keys: string[]): Record<string, unknown>[] {
  const list = Array.isArray(value) ? value : typeof value === "object" && value !== null ? Object.values(value).find(Array.isArray) : null;
  if (!Array.isArray(list)) throw new Error("Unsupported remote catalog response");
  return list.filter((row) => typeof row === "object" && row !== null).map((row) => Object.fromEntries(keys.filter((key) => key in row).map((key) => [key, row[key]])));
}
function record(value: unknown): Record<string, unknown> { return typeof value === "object" && value !== null ? value as Record<string, unknown> : {}; }
async function concurrentMap<T, R>(values: T[], limit: number, visit: (value: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(values.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, values.length) }, async () => {
    while (next < values.length) {
      const index = next++;
      results[index] = await visit(values[index]!);
    }
  }));
  return results;
}
function connectionStatus(result: CliResult): Record<string, unknown> {
  if (result.code === 0) return record(parsed(result));
  // `status` has a short diagnostics deadline. A successful authenticated
  // handshake still supplies the actual server ID in this specific error.
  for (const stream of [result.stderr, result.stdout]) {
    try {
      const error = record(record(JSON.parse(stream)).error);
      if (error.code === "DAEMON_REQUEST_TIMEOUT") return record(error.details);
    } catch { /* Not a structured timeout. */ }
  }
  return {};
}

export class RemoteService {
  private snapshot: RemoteSnapshot = empty();
  private hosts: RemoteProfile[] = [];
  private localId = "";
  private owner = "";
  private stopped = false;
  private controller = new AbortController();
  private preferred = new Map<string, string>();
  private timer: ReturnType<typeof setInterval> | undefined;
  private polling = false;
  private pumping = false;
  private pollAt = 0;
  private ready: Promise<void>;
  constructor(private readonly execute = runPaseo) { this.ready = this.load(); }
  private async load() {
    await mkdir(pluginDir(), { recursive: true });
    await mkdir(remoteQueue(), { recursive: true, mode: 0o700 });
    this.localId = (await readFile(join(paseoHome(), "server-id"), "utf8")).trim();
    this.owner = `${this.localId}:firstmate`;
    const saved = Registry.safeParse(await optionalJson(join(pluginDir(), "remotes.json")));
    if (saved.success) { this.hosts = saved.data.hosts.filter((host) => host.serverId !== this.localId); this.snapshot.syncedAt = saved.data.syncedAt; }
    const cached = RemoteSnapshot.safeParse(await optionalJson(join(pluginDir(), "remote-status.json")));
    if (cached.success) this.snapshot = cached.data;
    this.snapshot.localServerId = this.localId;
    this.reconcile();
  }
  private reconcile() {
    this.snapshot.hosts = this.hosts.map((host) => {
      const previous = this.snapshot.hosts.find((entry) => entry.serverId === host.serverId);
      return previous ? { ...previous, label: host.label } : { serverId: host.serverId, label: host.label, online: false, checkedAt: null, error: null, projects: [], workspaces: [], providers: [], workers: [] };
    });
  }
  async sync(input: RemoteProfile[]): Promise<RemoteSnapshot> {
    await this.ready;
    return serialized("firstmate.remote.sync", async () => {
      const hosts = SavedHosts.parse(input);
      if (!hosts.some((host) => host.serverId === this.localId)) throw new Error("This app's registry does not include the local host; existing remote access was retained");
      const syncedAt = new Date().toISOString();
      await atomic(join(pluginDir(), "remotes.json"), { version: 1, syncedAt, hosts: hosts.filter((host) => host.serverId !== this.localId) });
      this.hosts = hosts.filter((host) => host.serverId !== this.localId);
      this.snapshot.syncedAt = syncedAt; this.snapshot.syncError = null;
      this.reconcile(); await this.publish(); this.pollAt = 0;
      return this.read();
    });
  }
  async syncError(unavailable: boolean) {
    await this.ready;
    this.snapshot.syncError = unavailable ? "Saved host connections are unavailable in this client. Open FirstMate in Paseo desktop to sync." : "Paseo's saved host format is unsupported. Last valid remote configuration retained.";
    await this.publish();
  }
  async read(): Promise<RemoteSnapshot> { await this.ready; return structuredClone(this.snapshot); }
  private async publish() {
    if (this.stopped) return;
    await serialized("firstmate.remote.snapshot", async () => {
      await atomic(join(pluginDir(), "remote-status.json"), this.snapshot);
      const home = resolveHome(await readFirstmateConfig());
      try { await stat(join(home, "AGENTS.md")); }
      catch { return; }
      await atomic(join(home, "data", "remote-hosts.json"), this.snapshot);
    });
  }
  private async call(host: RemoteProfile, connection: RemoteConnection, args: string[]) {
    // Paseo 0.11's filtered logs and help print plain text even with --json.
    return parsed(await this.execute(args, remoteEnvironment(host, connectionTarget(host, connection)), this.controller.signal), args[0] === "logs" || args.includes("--help") || args.includes("-h"));
  }
  private async connect(host: RemoteProfile): Promise<RemoteConnection> {
    const preferred = this.preferred.get(host.serverId) ?? host.preferredConnectionId;
    const connections = [...host.connections].sort((a, b) => Number(b.id === preferred) - Number(a.id === preferred));
    for (const connection of connections) {
      if (this.stopped) throw new Error("Remote service stopped");
      try {
        const status = connectionStatus(await this.execute(["status", "--json"], remoteEnvironment(host, connectionTarget(host, connection)), this.controller.signal));
        if (status.serverId !== host.serverId || status.connectedDaemon !== "reachable") continue;
        this.preferred.set(host.serverId, connection.id);
        return connection;
      } catch { /* Only read-only probes retry another saved connection. */ }
    }
    throw new Error("Host unreachable or authentication failed; reconnect it in Paseo");
  }
  async request(selector: string, args: string[]): Promise<unknown> {
    await this.ready;
    const matches = this.hosts.filter((host) => host.serverId === selector || host.label === selector);
    if (matches.length !== 1) throw new Error("Host is unknown or its name is ambiguous; use its serverId from hosts");
    const host = matches[0]!;
    const command = commandArguments(args, this.owner);
    const connection = await this.connect(host);
    // Exactly one attempt once a command may change remote state. A timeout
    // is uncertain; never retry creation automatically.
    try { return await this.call(host, connection, command); }
    finally { this.pollAt = 0; }
  }
  async poll(): Promise<void> {
    await this.ready;
    if (this.polling || this.stopped) return;
    this.polling = true;
    try {
      await concurrentMap(this.hosts, 2, async (host) => {
        const previous = this.snapshot.hosts.find((entry) => entry.serverId === host.serverId);
        if (!previous) return;
        const next: RemoteHost = { ...previous, checkedAt: new Date().toISOString() };
        try {
          const connection = await this.connect(host);
          const [projects, workspaces, providers, crew] = await Promise.all([
            this.call(host, connection, ["project", "ls", "--json"]),
            this.call(host, connection, ["workspace", "ls", "--json"]),
            this.call(host, connection, ["provider", "ls", "--json"]),
            this.call(host, connection, ["ls", "-g", "--label", "firstmate.role=crew", "--label", `firstmate.owner=${this.owner}`, "--json"]),
          ]);
          next.projects = publicRows(projects, ["projectId", "name", "kind", "path"]);
          next.workspaces = publicRows(workspaces, ["workspaceId", "projectId", "name", "kind", "path", "cwd", "branch"]);
          next.providers = publicRows(providers, ["id", "provider", "name", "available", "status", "models"]);
          next.workers = await concurrentMap(publicRows(crew, ["id", "name", "status"]).slice(0, 100), 4, async (worker) => {
            const id = String(worker.id);
            const detail = record(await this.call(host, connection, ["inspect", id, "--json"]));
            const old = previous.workers.find((entry) => entry.id === id);
            const status = String(detail.Status ?? worker.status ?? "unknown");
            const updatedAt = String(detail.UpdatedAt ?? "");
            let output = old?.output ?? "";
            if (status !== "running" && status !== "initializing" && old?.updatedAt !== updatedAt) {
              const logs = await this.call(host, connection, ["logs", id, "--tail", "8", "--filter", "text", "--json"]);
              output = (typeof logs === "string" ? logs : JSON.stringify(logs)).slice(-8000);
            }
            return { id, name: String(detail.Name ?? worker.name ?? id), status, updatedAt, permissions: Array.isArray(detail.PendingPermissions) ? detail.PendingPermissions.length : 0, output };
          });
          next.online = true; next.error = null;
        } catch { next.online = false; next.error = "Cannot read this host. Reconnect it in Paseo; check its daemon and provider configuration."; }
        const index = this.snapshot.hosts.findIndex((entry) => entry.serverId === host.serverId);
        // A concurrent sync may have removed or replaced the profile.
        if (index >= 0 && this.hosts.includes(host)) this.snapshot.hosts[index] = next;
      });
      await this.publish();
    } finally { this.polling = false; }
  }
  private async pump() {
    await this.ready;
    if (this.pumping || this.stopped) return;
    this.pumping = true;
    try {
      const files = await readdir(remoteQueue());
      for (const file of files) {
        if (!/^[a-f0-9-]{36}\.request\.json$/.test(file)) continue;
        const path = join(remoteQueue(), file);
        if ((await stat(path)).size > 1024 * 1024) { await rm(path); continue; }
        const checked = RemoteRequest.safeParse(await optionalJson(path));
        if (!checked.success || `${checked.data.id}.request.json` !== file) { await rm(path); continue; }
        const request = checked.data;
        // Claim before execution. A plugin restart never replays a mutation.
        const claimed = path.replace(".request.json", ".claimed.json");
        await rename(path, claimed);
        let response;
        try {
          if (Date.now() - request.createdAt > 180000) throw new Error("Request expired before execution");
          response = { id: request.id, ok: true, result: await this.request(request.host, request.args) };
        } catch (error) { response = { id: request.id, ok: false, error: error instanceof Error && !/password|#offer=|relay:\/\//i.test(error.message) ? error.message : "Remote command failed" }; }
        await atomic(join(remoteQueue(), `${request.id}.response.json`), response);
        await rm(claimed, { force: true });
      }
      // Bounded retention for abandoned helper calls; never replay claimed work.
      for (const file of files.filter((name) => /^[a-f0-9-]{36}\.(?:response|claimed)\.json$/.test(name))) {
        const path = join(remoteQueue(), file);
        if (Date.now() - (await stat(path)).mtimeMs > 3600000) await rm(path, { force: true });
      }
    } finally { this.pumping = false; }
  }
  start() {
    this.timer = setInterval(() => {
      void this.pump().catch(() => { /* Requests retained for the next tick. */ });
      if (Date.now() >= this.pollAt) { this.pollAt = Date.now() + 60000; void this.poll().catch(() => { /* Last snapshot retained. */ }); }
    }, 1000);
  }
  stop() { this.stopped = true; this.controller.abort(); if (this.timer) clearInterval(this.timer); }
}
