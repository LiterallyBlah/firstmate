/**
 * The card's actions on a worker on a remote host: steer, interrupt, end, and the read-only Watch.
 *
 * Every one goes through `RemoteService.request` (`server/remotes.ts`), so it gets that path's
 * safeguards unchanged: only its allowed commands, no target or credential override, credentials
 * kept out of the environment it hands on, and exactly one attempt once a command may change
 * anything. Before that, the worker has to be one the last poll found this first mate owning on
 * that host — the board cannot be pointed at an arbitrary agent there, as `requireCrew` keeps it
 * from one here. A session the first mate only follows (`followed`, the captain's own) can be
 * watched, steered and interrupted like a worker, but never ended.
 */
import type { RemoteHost, RemoteSnapshot, RemoteWorker } from "../shared/remotes";
import { TEMPLATES, message } from "./templates";

/** The part of `RemoteService` the actions use. */
export interface RemoteGateway {
  read(): Promise<RemoteSnapshot>;
  request(selector: string, args: string[]): Promise<unknown>;
}

/** How much of a worker's recent activity Watch reads, and the most of it kept. */
const LOG_TAIL = "40";
const MAX_LOG_CHARS = 20000;

async function requireWorker(
  remotes: RemoteGateway,
  serverId: string,
  agentId: string,
): Promise<{ host: RemoteHost; worker: RemoteWorker }> {
  const host = (await remotes.read()).hosts.find((entry) => entry.serverId === serverId);
  if (host === undefined) throw new Error("That host is not one of the remote hosts saved in Paseo.");
  const worker = host.workers.find((entry) => entry.id === agentId);
  if (worker === undefined) throw new Error(`${host.label} has no worker ${agentId} of this first mate's.`);
  return { host, worker };
}

/** The request, with any error worded as `server/remotes.ts` words its queue's: never a credential or a pairing link. */
async function send(remotes: RemoteGateway, host: RemoteHost, args: string[]): Promise<unknown> {
  try {
    return await remotes.request(host.serverId, args);
  } catch (error) {
    throw new Error(
      error instanceof Error && !/password|#offer=|relay:\/\//i.test(error.message) ? error.message : "Remote command failed",
    );
  }
}

export async function steerRemoteCrew(
  remotes: RemoteGateway,
  serverId: string,
  agentId: string,
  text: string,
): Promise<{ host: RemoteHost; worker: RemoteWorker; text: string }> {
  const words = text.trim();
  if (words === "") throw new Error("Nothing to send.");
  const { host, worker } = await requireWorker(remotes, serverId, agentId);
  // After `--`, as the helper sends a prompt: the request path keeps it out of its option checks and
  // puts its own flags before it, and the CLI reads it as text even when it starts with a dash.
  await send(remotes, host, ["send", worker.id, "--", words]);
  return { host, worker, text: words };
}

export async function interruptRemoteCrew(remotes: RemoteGateway, serverId: string, agentId: string): Promise<void> {
  const { host, worker } = await requireWorker(remotes, serverId, agentId);
  await send(remotes, host, ["stop", worker.id]);
}

export async function exitRemoteCrew(remotes: RemoteGateway, serverId: string, agentId: string): Promise<void> {
  const { host, worker } = await requireWorker(remotes, serverId, agentId);
  // A followed session is the captain's own, not crew; the board never ends it.
  if (worker.followed === true) throw new Error(`${worker.name} is a session the first mate follows, not crew; end it on ${host.label}.`);
  await send(remotes, host, ["archive", worker.id]);
}

export async function remoteCrewLogs(
  remotes: RemoteGateway,
  serverId: string,
  agentId: string,
): Promise<{ text: string; readAt: string }> {
  const { host, worker } = await requireWorker(remotes, serverId, agentId);
  const result = await send(remotes, host, ["logs", worker.id, "--tail", LOG_TAIL, "--filter", "text"]);
  const text = typeof result === "string" ? result : JSON.stringify(result, null, 2);
  return { text: text.trim().slice(-MAX_LOG_CHARS), readAt: new Date().toISOString() };
}

/** What the first mate is told after the captain steers a remote worker (`templates/messages/remote-steer.md`). */
export function remoteSteerText(host: RemoteHost, worker: RemoteWorker, captain: string): Promise<string> {
  return message(TEMPLATES.remoteSteer, {
    agentId: worker.id,
    title: worker.name,
    host: host.label,
    serverId: host.serverId,
    captain,
  });
}
