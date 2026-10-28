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
import { randomUUID } from "node:crypto";
import { readFirstmateConfig, resolveHome } from "./config";
import { cutoverGate } from "./supervision-gate";
import { digest } from "./submissions";

/** Refuses a mutation the supervision registry owns (S08: remote mutation of scoped work stays disabled). */
export type RemoteMutationGuard = (serverId: string, agentId: string) => Promise<void>;

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

/** S08's guard remains in front of S07. The remote request itself never holds the cutover lock. */
async function mutate(remotes: RemoteGateway, host: RemoteHost, worker: RemoteWorker, args: string[]) {
  const gate = cutoverGate(resolveHome(await readFirstmateConfig())), agentKey = `remote:${host.serverId}:${worker.id}`;
  return gate.deliver({ source: "crew-action", id: `remote:${randomUUID()}`, payloadHash: digest({ serverId: host.serverId, args }), agentKey },
    agentKey, () => send(remotes, host, args));
}

export async function steerRemoteCrew(
  remotes: RemoteGateway,
  serverId: string,
  agentId: string,
  text: string,
  guard?: RemoteMutationGuard,
): Promise<{ host: RemoteHost; worker: RemoteWorker; text: string }> {
  const words = text.trim();
  if (words === "") throw new Error("Nothing to send.");
  const { host, worker } = await requireWorker(remotes, serverId, agentId);
  await guard?.(serverId, worker.id);
  // After `--`, as the helper sends a prompt: the request path keeps it out of its option checks and
  // puts its own flags before it, and the CLI reads it as text even when it starts with a dash.
  await mutate(remotes, host, worker, ["send", worker.id, "--", words]);
  return { host, worker, text: words };
}

export async function interruptRemoteCrew(remotes: RemoteGateway, serverId: string, agentId: string, guard?: RemoteMutationGuard): Promise<void> {
  const { host, worker } = await requireWorker(remotes, serverId, agentId);
  await guard?.(serverId, worker.id);
  await mutate(remotes, host, worker, ["stop", worker.id]);
}

export async function exitRemoteCrew(remotes: RemoteGateway, serverId: string, agentId: string, guard?: RemoteMutationGuard): Promise<void> {
  const { host, worker } = await requireWorker(remotes, serverId, agentId);
  await guard?.(serverId, worker.id);
  // A followed session is the captain's own, not crew; the board never ends it.
  if (worker.followed === true) throw new Error(`${worker.name} is a session the first mate follows, not crew; end it on ${host.label}.`);
  await mutate(remotes, host, worker, ["archive", worker.id]);
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

/** One steer to a remote worker, as its note carries it (`templates/messages/remote-steer-message.md`). */
export function remoteSteerMessage(captain: string): Promise<string> {
  return message(TEMPLATES.remoteSteerMessage, { captain });
}

/** What the first mate is told after a burst of the captain's steers to a remote worker, oldest first (`templates/messages/remote-steer.md`). */
export function remoteSteerNote(host: RemoteHost, worker: RemoteWorker, messages: readonly string[]): Promise<string> {
  return message(TEMPLATES.remoteSteer, {
    agentId: worker.id,
    title: worker.name,
    host: host.label,
    serverId: host.serverId,
    messages: messages.join("\n"),
  });
}

/** The note for one steer alone. */
export async function remoteSteerText(host: RemoteHost, worker: RemoteWorker, captain: string): Promise<string> {
  return remoteSteerNote(host, worker, [await remoteSteerMessage(captain)]);
}
