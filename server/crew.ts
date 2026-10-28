/**
 * What the captain can do to one crewmate from the board: steer it, interrupt
 * its turn, end it, or have the first mate relaunch it.
 *
 * None of these tears anything down. Ending a crewmate archives the agent and
 * leaves its workspace and worktree exactly as they are; relaunching is the
 * first mate's job, because it owns the brief and the backlog.
 *
 * Steering goes straight to the crewmate — the captain's words are
 * authoritative, as if typed into its tab — and the first mate hears about it
 * when that turn ends, through `CaptainSteers` and the `turn_ended` hook:
 * one note for a whole burst of steers to that crewmate (`queueBurstNote`),
 * so a conversation in the Converse drawer does not cost a first-mate turn a line.
 */
import { randomUUID } from "node:crypto";

import type { PluginLifecycleRegistration } from "@getpaseo/plugin/server";

import { CAPTAIN_STEER_MESSAGE_ID_PREFIX, CREW_LABELS } from "../shared/fleet";
import { SCOPE_LABELS } from "../shared/supervision-effects";
import { stopAgent } from "./cli";
import { closingText, fetchLiveAgent } from "./fleet";
import type { PaseoAgent, PaseoApi } from "./host-types";
import { askMate, extendBurstNote, queueBurstNote } from "./mate";
import { readFirstmateConfig, resolveHome } from "./config";
import { cutoverGate } from "./supervision-gate";
import { receiptJournal } from "./receipts";
import { sendWithoutInterrupting } from "./send";
import { TEMPLATES, message } from "./templates";

/** The most of a crewmate's answer relayed to the first mate; the same cap Paseo's own notification uses. */
const MAX_RELAYED_CHARS = 4000;

/** A deliberate refusal: the worker belongs to a scoped owner, or to a frozen or migrated plan. Distinct from a lookup
 * that failed or found the worker archived, which the steer relay must not treat as a reason to drop the captain's words. */
export class ScopedCrewRefusal extends Error {}

/** Refuses anything that is not a live crewmate, so the board cannot be pointed at an arbitrary agent. */
async function requireCrew(paseo: PaseoApi, agentId: string, stop = false): Promise<PaseoAgent> {
  const agent = await fetchLiveAgent(paseo, agentId);
  if (agent === null) throw new Error(`Paseo has no live agent ${agentId}.`);
  if (Object.values(SCOPE_LABELS).some(label => label in agent.labels)) {
    throw new ScopedCrewRefusal(`${agent.title ?? agentId} belongs to a scoped supervisor; legacy board controls and the steer relay cannot change or forward its work. Use its scope's checked controls.`);
  }
  if (agent.labels[CREW_LABELS.role] !== CREW_LABELS.crewRole) {
    throw new Error(`${agent.title ?? agentId} is not one of the crew.`);
  }
  // S07: a worker of a frozen or migrated plan is no longer the legacy board's; nor is its relay General's.
  const gate = cutoverGate(resolveHome(await readFirstmateConfig()));
  const item = { source: "burst" as const, id: `crew:${agentId}`, payloadHash: agentId, agentKey: agentId };
  // Stopping is the safe direction: an unreadable record that cannot name its workers never blocks Interrupt or End.
  const targets = (await gate.targets()).filter(t => !stop || !t.damaged || t.tokens !== null);
  const verdict = await gate.verdict(item, "send", targets);
  if (!verdict.admit) { await gate.refusal(item, verdict.reason); throw new ScopedCrewRefusal(`${agent.title ?? agentId}: ${verdict.reason}`); }
  return agent;
}

/** A steer nobody answered in this long is forgotten, so the map cannot grow for the life of the daemon. */
const STEER_TTL_MS = 60 * 60 * 1000;

/**
 * What the captain has said to each crewmate that the first mate has not yet
 * been told about. In memory: a plugin reload forgets it, and the first mate
 * learns of the exchange the next time it looks at that crewmate.
 *
 * A steer is handed over only by a turn that *contains* it — its text is one
 * of the ended turn's user messages. The first `turn_ended` after a steer is
 * not always the answer: the turn that was running when it was sent may end
 * first, and a provider that cannot join a running turn cancels it and starts
 * a new one, so the ended turn has to show it read the words.
 */
export class CaptainSteers {
  private readonly pending = new Map<string, Array<{ text: string; at: number; messageId?: string | undefined }>>();

  constructor(private readonly now: () => number = Date.now) {}

  /** `messageId` is the steer's own id (`CAPTAIN_STEER_MESSAGE_ID_PREFIX`); it changes nothing here. */
  record(agentId: string, text: string, messageId?: string): void {
    this.pending.set(agentId, [...this.fresh(agentId), { text, at: this.now(), messageId }]);
  }

  /** Takes back a steer whose send failed, so it is never relayed as said. */
  forget(agentId: string, text: string): void {
    const kept = this.fresh(agentId).filter((entry) => entry.text !== text);
    if (kept.length === 0) this.pending.delete(agentId);
    else this.pending.set(agentId, kept);
  }

  /** The steers `userMessages` shows were read, removed; null when it shows none of them. */
  take(agentId: string, userMessages: readonly string[]): string[] | null {
    return this.takeRead(agentId, userMessages)?.map((entry) => entry.text) ?? null;
  }

  /** As `take`, with each steer's receipt id. */
  takeRead(agentId: string, userMessages: readonly string[]): Array<{ text: string; messageId?: string | undefined }> | null {
    const entries = this.fresh(agentId);
    const read = entries.filter((entry) => userMessages.some((message) => message.includes(entry.text.trim())));
    const left = entries.filter((entry) => !read.includes(entry));
    if (left.length === 0) this.pending.delete(agentId);
    else this.pending.set(agentId, left);
    return read.length === 0 ? null : read.map(({ text, messageId }) => ({ text, messageId }));
  }

  private fresh(agentId: string): Array<{ text: string; at: number; messageId?: string | undefined }> {
    const cutoff = this.now() - STEER_TTL_MS;
    return (this.pending.get(agentId) ?? []).filter((entry) => entry.at >= cutoff);
  }
}

/** The S08 scoped board adapter (`ScopedBoardSteer`); index.server does not supply one yet. */
export interface ScopedSteer { steer(paseo: PaseoApi, agentId: string, text: string): Promise<unknown> }

/**
 * Recorded before the send, so a turn that ends the instant the message lands
 * still finds it; taken back if the send fails.
 *
 * Every steer carries an id of its own into the crewmate's timeline, journal on
 * or off, so the Converse drawer can say which prompts were the captain's. That
 * is the one thing a send does differently with the journal off since the
 * journal existed (`receipt-paths.test.ts` holds it). A burst note still
 * gathering for this crewmate waits for the answer to this steer too.
 */
export async function steerCrew(paseo: PaseoApi, steers: CaptainSteers, agentId: string, text: string, scoped?: ScopedSteer): Promise<void> {
  if (scoped !== undefined) {
    const agent = await fetchLiveAgent(paseo, agentId);
    if (agent !== null && Object.values(SCOPE_LABELS).some((label) => label in agent.labels)) {
      // Scoped board traffic is persisted and routed to its own scope's inbox: no CaptainSteers entry,
      // no burst note and nothing for General. The adapter resolves the owner from the registry and
      // refuses rather than guess; labels only select which checked path is asked.
      await scoped.steer(paseo, agentId, text);
      return;
    }
  }
  await requireCrew(paseo, agentId);
  const messageId = `${CAPTAIN_STEER_MESSAGE_ID_PREFIX}${randomUUID()}`;
  steers.record(agentId, text, messageId);
  try {
    await sendWithoutInterrupting(paseo, agentId, text, { messageId }, { channel: "crew-steer", actor: "captain" });
  } catch (error) {
    steers.forget(agentId, text);
    throw error;
  }
  await extendBurstNote(agentId).catch((error: unknown) => console.error("[firstmate] could not hold the steer relay for its answer:", error));
}

export async function interruptCrew(paseo: PaseoApi, agentId: string): Promise<void> {
  await requireCrew(paseo, agentId, true);
  await stopAgent(agentId);
}

export async function exitCrew(paseo: PaseoApi, agentId: string): Promise<void> {
  await requireCrew(paseo, agentId, true);
  await paseo.agents.ref(agentId).archive();
}

/** What the first mate is asked when the captain presses Relaunch (`templates/messages/relaunch.md`). */
export function relaunchText(agent: Pick<PaseoAgent, "id" | "title" | "labels">, note: string): Promise<string> {
  const task = agent.labels[CREW_LABELS.task];
  return message(TEMPLATES.relaunch, {
    worker: task ?? `"${agent.title ?? agent.id}"`,
    agentId: agent.id,
    note: note.trim(),
  });
}

export async function relaunchCrew(paseo: PaseoApi, agentId: string, note: string): Promise<string> {
  const agent = await requireCrew(paseo, agentId);
  return askMate(paseo, { text: await relaunchText(agent, note) });
}

/** One exchange: what the captain said and what the turn that read it answered (`templates/messages/steer-relay-exchange.md`). */
export async function relayExchange(captain: readonly string[], answer: string | null): Promise<string> {
  const response =
    answer === null
      ? await message(TEMPLATES.steerRelayNoAnswer)
      : answer.length <= MAX_RELAYED_CHARS
        ? answer
        : await message(TEMPLATES.steerRelayClipped, { answer: answer.slice(0, MAX_RELAYED_CHARS) });
  return message(TEMPLATES.steerRelayExchange, { captain: captain.join("\n\n"), response });
}

/** The note for a burst of exchanges with one crewmate, oldest first (`templates/messages/steer-relay.md`). */
export function relayNote(agent: { id: string; title: string | null }, exchanges: readonly string[]): Promise<string> {
  return message(TEMPLATES.steerRelay, { agentId: agent.id, title: agent.title ?? agent.id, exchanges: exchanges.join("\n") });
}

/** What the first mate is told about one turn the captain started from the board, alone in its note. */
export async function relayText(
  agent: { id: string; title: string | null },
  captain: readonly string[],
  answer: string | null,
): Promise<string> {
  return relayNote(agent, [await relayExchange(captain, answer)]);
}

/**
 * Paseo tells the first mate when a crewmate *it* prompted finishes. A turn
 * the captain started from the board was prompted by nobody Paseo knows to
 * notify, so this hook does it: when that turn ends, the first mate gets what
 * the captain said and what the crewmate answered — merged with the burst's
 * other exchanges into one note, sent once the conversation goes quiet.
 */
export function registerSteerRelay(
  server: PluginLifecycleRegistration,
  steers: CaptainSteers,
): () => void {
  return server.on("agent.turn_ended", async (event, { paseo }) => {
    // A cancelled turn is the one a steer replaced, not the one that answers it.
    if (event.outcome.kind === "canceled") return;
    const userMessages = event.timeline.flatMap((item) => (item.type === "user_message" ? [item.text] : []));
    const read = steers.takeRead(event.agent.id, userMessages);
    if (read === null) return;
    // Refresh labels here too: a pending legacy steer may predate scoped ownership.
    // Refuse before reading/forwarding the answer or queueing any note to General. Only a deliberate scoped or cutover
    // refusal withholds the relay, and it throws, so it is never silent (R12-3). A worker archived since its turn ended,
    // or a lookup that failed, is relayed as before: the captain's words are never dropped for want of a re-check.
    try {
      await requireCrew(paseo, event.agent.id);
    } catch (error) {
      if (error instanceof ScopedCrewRefusal) throw error;
      console.error(`[firstmate] could not re-check ${event.agent.id} before relaying the captain's words; relaying them as before:`, error);
    }
    const captain = read.map((entry) => entry.text);
    const ids = read.flatMap((entry) => (entry.messageId === undefined ? [] : [entry.messageId]));
    const journal = receiptJournal();
    for (const messageId of journal === null ? [] : ids) {
      journal!.record({
        kind: "steer-read", messageId, crewAgentId: event.agent.id, turnId: event.turnId,
        clientMessageIdSeen: event.timeline.some((item) => item.type === "user_message" && item.clientMessageId === messageId),
      });
    }
    try {
      const agent = { id: event.agent.id, title: event.agent.title };
      await queueBurstNote(
        paseo,
        { key: agent.id, part: await relayExchange(captain, closingText(event.timeline)), render: (parts) => relayNote(agent, parts) },
        { source: "steer-relay", relates: ids },
      );
    } catch (error) {
      read.forEach((entry) => steers.record(event.agent.id, entry.text, entry.messageId));
      console.error(`[firstmate] could not tell the first mate about the captain's words to ${event.agent.id}:`, error);
    }
  });
}
