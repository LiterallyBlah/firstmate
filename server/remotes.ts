/** Saved connections live outside the mate's home. The queue only executes
 * explicit CLI requests from the mate; it never chooses or dispatches work. */
import { randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { RemoteFollow, RemoteRequest, RemoteSnapshot, SavedHosts, type RemoteConnection, type RemoteHost, type RemoteProfile, type RemoteWorker } from "../shared/remotes";
import { runPaseo, type CliResult } from "./cli";
import { readFirstmateConfig, resolveHome } from "./config";
import { paseoHome, pluginDir } from "./data-dir";
import { serialized } from "./serialize";

const Registry = z.object({ version: z.literal(1), syncedAt: z.string(), hosts: SavedHosts });
/** At most this many followed agents per host, besides the crew. */
const MAX_FOLLOWED = 50;
/** As in the helper's `permit ls`: the latest tool calls of at most this many waiting workers per poll. */
const MAX_RECENT_TOOLS_AGENTS = 10;
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
 * forbidden, including nested global flags and Commander aliases. Everything
 * after `--` is a prompt (the helper's `--prompt-file`), never an option. */
export function commandArguments(args: string[], owner: string): string[] {
  const command = args[0] ?? "";
  if (!["ls", "run", "logs", "inspect", "stop", "send", "wait", "archive", "permit", "provider", "project", "workspace"].includes(command)) throw new Error("Unsupported remote command");
  const end = args.indexOf("--");
  const options = end < 0 ? [...args] : args.slice(0, end);
  if (options.some((arg) => /^--(?:host|home|password)(?:=|$)/.test(arg))) throw new Error("Remote target cannot be overridden");
  if (options.some((arg, i) => (arg === "--label" && /^firstmate\.(?:owner|role)=/.test(options[i + 1] ?? "")) || /^--label=firstmate\.(?:owner|role)=/.test(arg))) throw new Error("Reserved ownership label");
  // The CLI's own --prompt-file would read any file the daemon can; the helper's reads only the home.
  if (options.some((arg) => /^--prompt-file(?:=|$)/.test(arg))) throw new Error("Use the helper's --prompt-file, which reads the file from the home");
  if (command === "run") options.push("--background", "--label", "firstmate.role=crew", "--label", `firstmate.owner=${owner}`);
  if (command === "send") options.push("--no-wait");
  if (!options.includes("--json")) options.push("--json");
  return end < 0 ? options : [...options, ...args.slice(end)];
}
const MAX_ERROR_CHARS = 1500;
/** More than a few minutes: the delay of a remote run can never account for it. */
const CLOCK_WARNING_SECONDS = 180;
/** Remove what must never leave the daemon: the host's password and relay
 * details, pairing links, relay URLs and bearer credentials. */
export function redact(text: string, host?: RemoteProfile): string {
  const secrets = host ? [host.password, ...host.connections.flatMap((c) => c.type === "relay" ? [c.relayEndpoint, c.daemonPublicKeyB64] : [])] : [];
  let out = text
    .replace(/\S*#offer=[^\s"',;)]*/gi, "[pairing link]")
    .replace(/\b[a-z][a-z0-9+.-]*:\/\/[^\s"',;)]*relay[^\s"',;)]*/gi, "[relay URL]")
    .replace(/paseo\.bearer\.[^\s"',;)]+/gi, "[credential]");
  for (const secret of secrets) if (secret) out = out.split(secret).join("[redacted]");
  return out;
}
/** The CLI's own complaint — its JSON error's message and details, else its
 * text — from stderr, else stdout; redacted and capped. */
export function remoteError(result: CliResult, host?: RemoteProfile): string {
  for (const stream of [result.stderr, result.stdout]) {
    const text = stream.replace(/\u001b\[[0-9;]*m/g, "").trim();
    if (!text) continue;
    let message = text;
    try {
      const error = record(record(JSON.parse(text)).error);
      if (typeof error.message === "string" && error.message.trim()) {
        message = [error.message.trim(), typeof error.details === "string" ? error.details.trim() : ""].filter(Boolean).join("\n");
      }
    } catch { /* Not JSON; the text itself is the complaint. */ }
    const clean = redact(message, host);
    return clean.length > MAX_ERROR_CHARS ? `${clean.slice(0, MAX_ERROR_CHARS)}…` : clean;
  }
  return `the Paseo CLI exited with code ${result.code}`;
}
function parsed(result: CliResult, allowText = false, host?: RemoteProfile): unknown {
  if (result.code !== 0) {
    const message = remoteError(result, host);
    if (/password|unauthori[sz]ed|authentication/i.test(message)) throw new Error("Remote authentication failed; reconnect this host in Paseo");
    throw new Error(`Remote command failed: ${message}`);
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
    return parsed(await this.execute(args, remoteEnvironment(host, connectionTarget(host, connection)), this.controller.signal), args[0] === "logs" || args.includes("--help") || args.includes("-h"), host);
  }
  private async connect(host: RemoteProfile): Promise<RemoteConnection> {
    const preferred = this.preferred.get(host.serverId) ?? host.preferredConnectionId;
    const connections = [...host.connections].sort((a, b) => Number(b.id === preferred) - Number(a.id === preferred));
    let reason = "";
    for (const connection of connections) {
      if (this.stopped) throw new Error("Remote service stopped");
      try {
        const result = await this.execute(["status", "--json"], remoteEnvironment(host, connectionTarget(host, connection)), this.controller.signal);
        const status = connectionStatus(result);
        if (status.serverId !== host.serverId || status.connectedDaemon !== "reachable") {
          reason = status.serverId && status.serverId !== host.serverId ? "a saved connection reaches a different server" : result.code === 0 ? "the daemon is not reachable" : remoteError(result, host);
          continue;
        }
        this.preferred.set(host.serverId, connection.id);
        return connection;
      } catch (error) { reason = redact(error instanceof Error ? error.message : String(error), host); /* Only read-only probes retry another saved connection. */ }
    }
    if (/password|unauthori[sz]ed|authentication/i.test(reason)) reason = "authentication failed";
    throw new Error(`Host unreachable or authentication failed; reconnect it in Paseo${reason ? ` (last attempt: ${reason.slice(0, 500)})` : ""}`);
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
    const sentAt = Date.now();
    try {
      const result = await this.call(host, connection, command);
      if (command[0] === "run") await this.measureClock(host, connection, result, sentAt, Date.now());
      return result;
    } finally { this.pollAt = 0; }
  }
  /** A new agent's CreatedAt, on the host's clock, falls between sending its
   * `run` and the answer on ours; anything outside that window is the host's
   * clock. Read-only; a failure keeps the last measurement. */
  private async measureClock(host: RemoteProfile, connection: RemoteConnection, result: unknown, sentAt: number, receivedAt: number) {
    const agentId = record(result).agentId;
    if (typeof agentId !== "string") return;
    try {
      const createdAt = Date.parse(String(record(await this.call(host, connection, ["inspect", agentId, "--json"])).CreatedAt ?? ""));
      if (Number.isNaN(createdAt)) return;
      const skew = createdAt < sentAt ? createdAt - sentAt : createdAt > receivedAt ? createdAt - receivedAt : 0;
      const entry = this.snapshot.hosts.find((candidate) => candidate.serverId === host.serverId);
      if (!entry) return;
      entry.clockSkew = { seconds: Math.round(skew / 1000), measuredAt: new Date(receivedAt).toISOString(), agentId };
      await this.publish();
    } catch { /* The run itself succeeded. */ }
  }
  /** A warning for every helper answer while the host's clock looks more than a few minutes off. */
  clockWarning(selector: string): string | undefined {
    const entry = this.snapshot.hosts.filter((host) => host.serverId === selector || host.label === selector);
    const skew = entry.length === 1 ? entry[0]!.clockSkew : null;
    if (!skew || Math.abs(skew.seconds) < CLOCK_WARNING_SECONDS) return undefined;
    const minutes = Math.round(Math.abs(skew.seconds) / 60);
    return `Warning: host ${JSON.stringify(entry[0]!.label)}'s clock appears to be about ${minutes} minute${minutes === 1 ? "" : "s"} ${skew.seconds < 0 ? "behind" : "ahead of"} this machine's `
      + `(agent ${skew.agentId}'s CreatedAt, measured ${skew.measuredAt}). Its times are shown as the host reports them; `
      + `${skew.seconds < 0 ? "add" : "subtract"} about ${minutes} minute${minutes === 1 ? "" : "s"} before comparing them with this machine's clock.`;
  }
  /** The agent ids `data/remote-follow.json` lists for this host, by serverId or name. Lenient: a bad entry is skipped. */
  private async followed(host: RemoteProfile): Promise<string[]> {
    let value: unknown;
    try { value = await optionalJson(join(resolveHome(await readFirstmateConfig()), "data", "remote-follow.json")); }
    catch { return []; }
    const list = Array.isArray(value) ? value : record(value).follow;
    if (!Array.isArray(list)) return [];
    const agents = list.flatMap((entry) => {
      const checked = RemoteFollow.safeParse(entry);
      return checked.success && (checked.data.host === host.serverId || checked.data.host === host.label) ? [checked.data.agent.trim()] : [];
    });
    return [...new Set(agents)].filter(Boolean).slice(0, MAX_FOLLOWED);
  }
  /** The last assistant message alone. Paseo's `logs` matches an unknown filter against the item type. */
  private async lastMessage(host: RemoteProfile, connection: RemoteConnection, id: string): Promise<string | undefined> {
    try {
      const logs = await this.call(host, connection, ["logs", id, "--tail", "1", "--filter", "assistant_message", "--json"]);
      const text = (typeof logs === "string" ? logs : JSON.stringify(logs)).trim();
      return text === "No activity to display." ? "" : text.slice(-8000);
    } catch { return undefined; }
  }
  /** What each pending permission asks: one read-only `permit ls` for the whole host, and each waiting
   * worker's `recentTools`, read the way the helper's `permit ls` reads them — a pending Bash call is
   * usually the last, with its command, which `permit ls` does not give. */
  private async describePermissions(host: RemoteProfile, connection: RemoteConnection, workers: RemoteWorker[]): Promise<void> {
    await concurrentMap(workers.filter((worker) => worker.permissions > 0).slice(0, MAX_RECENT_TOOLS_AGENTS), 4, async (worker) => {
      try {
        const logs = await this.call(host, connection, ["logs", worker.id, "--filter", "tools", "--tail", "3"]);
        worker.recentTools = String(typeof logs === "string" ? logs : JSON.stringify(logs)).split(/\r?\n/).map((line) => line.trim()).filter(Boolean).slice(-3).map((line) => line.slice(0, 1000));
      } catch { /* The request itself is still reported. */ }
    });
    let rows: Record<string, unknown>[];
    try { rows = publicRows(await this.call(host, connection, ["permit", "ls", "--json"]), ["id", "agentId", "name", "description"]); }
    catch { return; }
    for (const worker of workers) {
      for (const permission of worker.pendingPermissions ?? []) {
        const row = rows.find((entry) => entry.agentId === worker.id && entry.id === permission.id);
        if (!row) continue;
        if (typeof row.name === "string" && row.name) permission.tool = row.name;
        if (typeof row.description === "string" && row.description && row.description !== "-") permission.description = row.description.slice(0, 2000);
      }
    }
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
          const crewRows = publicRows(crew, ["id", "name", "status"]).slice(0, 100);
          const worker = async (row: Record<string, unknown>, followed: boolean): Promise<RemoteWorker> => {
            const detail = record(await this.call(host, connection, ["inspect", String(row.id), "--json"]));
            const id = String(detail.Id ?? row.id);
            const old = previous.workers.find((entry) => entry.id === id);
            const status = detail.Archived === true ? "archived" : String(detail.Status ?? row.status ?? "unknown");
            const updatedAt = String(detail.UpdatedAt ?? "");
            let output = old?.output ?? "";
            let lastMessage = old?.lastMessage;
            if (status !== "running" && status !== "initializing" && old?.updatedAt !== updatedAt) {
              const logs = await this.call(host, connection, ["logs", id, "--tail", "8", "--filter", "text", "--json"]);
              output = (typeof logs === "string" ? logs : JSON.stringify(logs)).slice(-8000);
              lastMessage = await this.lastMessage(host, connection, id);
            }
            const pending = Array.isArray(detail.PendingPermissions) ? detail.PendingPermissions.map(record) : [];
            return {
              id, name: String(detail.Name ?? row.name ?? id), status, updatedAt, permissions: pending.length, output,
              ...(lastMessage === undefined ? {} : { lastMessage }),
              ...(pending.length ? { pendingPermissions: pending.map((entry) => ({ id: String(entry.id ?? ""), tool: String(entry.tool ?? entry.name ?? "unknown") })) } : {}),
              ...(followed ? { followed: true } : {}),
            };
          };
          next.workers = await concurrentMap(crewRows, 4, (row) => worker(row, false));
          // Followed agents are only ever read: inspect and logs, never a label or a send.
          const crewIds = next.workers.map((entry) => entry.id);
          const follow = (await this.followed(host)).filter((agent) => !crewIds.some((id) => id.startsWith(agent)));
          const followed = await concurrentMap(follow, 4, async (agent): Promise<RemoteWorker> => {
            try { return await worker({ id: agent }, true); }
            catch { return { id: agent, name: agent, status: "unavailable", updatedAt: "", permissions: 0, output: "", followed: true }; }
          });
          for (const entry of followed) if (!next.workers.some((other) => other.id === entry.id)) next.workers.push(entry);
          if (next.workers.some((entry) => entry.permissions > 0)) await this.describePermissions(host, connection, next.workers);
          next.online = true; next.error = null;
        } catch { next.online = false; next.error = "Cannot read this host. Reconnect it in Paseo; check its daemon and provider configuration."; }
        const index = this.snapshot.hosts.findIndex((entry) => entry.serverId === host.serverId);
        // A concurrent sync may have removed or replaced the profile.
        // A run measured during this poll keeps its clock measurement.
        if (index >= 0 && this.hosts.includes(host)) this.snapshot.hosts[index] = { ...next, clockSkew: this.snapshot.hosts[index]!.clockSkew ?? null };
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
        const warning = this.clockWarning(request.host);
        await atomic(join(remoteQueue(), `${request.id}.response.json`), warning ? { ...response, warning } : response);
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
