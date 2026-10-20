/**
 * The first mate: launching one, adopting one, and carrying the captain's
 * words to it.
 *
 * The plugin never dispatches a crewmate. It gives the first mate a home and a
 * charter and starts it there; from then on the first mate owns intake,
 * dispatch and supervision, with Paseo's own tools.
 */
import { randomUUID } from "node:crypto";
import type { CaptainMessage } from "../shared/attachments";
import { CREW_LABELS, type AgentSummary, type FirstmateConfig, type MateCommand } from "../shared/fleet";
import { readFirstmateConfig, resolveHome, updateFirstmateConfig } from "./config";
import { fetchLiveAgent, listAgents, resolveMate, sameDirectory, summarizeAgent } from "./fleet";
import { prepareHome, readOpening } from "./home";
import { TEMPLATES, message } from "./templates";
import { nameHomeOnce } from "./home-name";
import type { PaseoApi } from "./host-types";
import { sendSessionRequest } from "./daemon-session";
import { receiptJournal, recordGeneration, sha256 } from "./receipts";
import { observedSend, sendWithoutInterrupting } from "./send";
import { writeUpload } from "./uploads";
import { serialized } from "./serialize";

export const MATE_TITLE = "First mate";

/** What a first mate is started with. Empty strings leave the provider's default. */
interface MateSetup {
  provider: string;
  modeId: string;
  thinkingOptionId: string;
}

const NO_MATE = "There is no first mate yet. Open the FirstMate board and launch one.";

/**
 * The change of first mate in progress, if any — a launch, restart, adoption or
 * release. The "already aboard" check below reads the config, which is only
 * activated once the unprompted agent exists, so two launches that overlap — a double press,
 * the desktop and a phone — would both pass it, and an adoption or release
 * landing mid-launch would be overwritten by it. Every client of this daemon reaches the same plugin process, so
 * holding the change here is enough to make the second one wait for the first
 * — and then refuse, or restart the first mate the first one started.
 */
export function oneAtATime<T>(change: () => Promise<T>): Promise<T> {
  return serialized("firstmate.mate.lifecycle", change);
}

export function requireNoMigration(config: FirstmateConfig): void {
  if (config.migration !== null) throw new Error("A first-mate handover needs recovery. Use Recover migration on the board.");
  if (config.mateLaunch !== null) throw new Error("A first-mate launch needs recovery. Retry Launch if preparation failed; if opening delivery is uncertain, inspect the reserved session in Paseo and release the role before another launch.");
}

/** Refused when a first mate is already aboard, so a second launch cannot start a second one. */
export async function launchMate(
  paseo: PaseoApi,
  input: { provider: string; modeId: string },
): Promise<{ agentId: string; workspaceId: string | null }> {
  return oneAtATime(async () => {
    const config = await readFirstmateConfig();
    if (config.mateLaunch !== null && config.migration === null) {
      return startMate(paseo, config, config.mateLaunch.target, "launch");
    }
    requireNoMigration(config);
    const current = await resolveMate(paseo, config);
    if (current.agent !== null) {
      throw new Error(
        `A first mate is already aboard (${current.agent.title ?? current.agent.id}). Open it, or release it in the FirstMate settings first.`,
      );
    }
    return startMate(paseo, config, { ...input, thinkingOptionId: "" }, "launch");
  });
}

const MID_TURN = "The first mate is in the middle of a turn.";

export function isMidTurn(agent: { status: string }): boolean {
  return agent.status === "running" || agent.status === "initializing";
}

/**
 * Archives the first mate and launches a new one set up the same way, from
 * the live agent rather than the config: its model, mode or thinking may have
 * been changed in its own tab since launch, and an adopted one has nothing in
 * the config at all. Refused mid-turn, as Compact is: a turn cut off halfway
 * through a dispatch can leave a crewmate the records never heard of.
 *
 * The old one is archived before the new one starts, so two first mates never
 * hold the helm at once. Archiving stops its turn and ends its heartbeat —
 * Paseo retires a schedule whose agent is archived — and leaves its
 * conversation readable in Paseo's history. A launch that fails after that
 * leaves no first mate, which the board shows with its launch panel.
 */
export async function restartMate(paseo: PaseoApi): Promise<{ agentId: string; workspaceId: string | null }> {
  return oneAtATime(async () => {
    const config = await readFirstmateConfig();
    requireNoMigration(config);
    const { agent } = await resolveMate(paseo, config);
    if (agent === null) throw new Error(NO_MATE);
    if (isMidTurn(agent)) throw new Error(`${MID_TURN} Restart it once it is idle.`);
    const setup: MateSetup = {
      provider: agent.model === null ? agent.provider : `${agent.provider}/${agent.model}`,
      modeId: agent.currentModeId ?? "",
      thinkingOptionId: agent.thinkingOptionId ?? "",
    };
    await paseo.agents.ref(agent.id).archive();
    try {
      return await startMate(paseo, config, setup, "restart");
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      throw new Error(`The old first mate was archived, but the new one did not start: ${reason}`);
    }
  });
}

/**
 * The note a restart adds after the opening (`templates/messages/restart-note.md`). It stays out of
 * `data/opening.md` so that it is said whatever the captain's opening says: the heartbeat it asks for is
 * how a new first mate hears about crewmates its predecessor started, which will not wake it.
 */
export function restartNote(): Promise<string> {
  return message(TEMPLATES.restartNote);
}

/**
 * Writes the home and starts a first mate in it, with the captain's opening — and, after a restart, the
 * note about the first mate before. Callers hold `oneAtATime` and have checked the helm.
 */
async function startMate(
  paseo: PaseoApi,
  config: FirstmateConfig,
  setup: MateSetup,
  start: "launch" | "restart",
): Promise<{ agentId: string; workspaceId: string | null }> {
  const home = resolveHome(config);
  await prepareHome(home, config);
  const opening = await readOpening(home);
  const prompt = start === "restart" ? `${opening}\n\n${await restartNote()}` : opening;

  const reservation = config.mateLaunch ?? {
    agentId: randomUUID(), home, target: setup, prompt, state: "prepared" as const,
  };
  if (reservation.home !== home) throw new Error("The reserved launch belongs to a different home.");
  if (reservation.state === "sending") throw new Error(`Opening delivery is uncertain for ${reservation.agentId}. Inspect that session in Paseo; release the role before another launch. The opening will not be resent.`);
  // Persist the reservation before any creation. A lost create reply retries the same identity.
  await updateFirstmateConfig({ mateAgentId: "", mateLaunch: reservation });

  const workspace = await paseo.workspaces.open(home);
  nameHomeOnce(paseo, workspace.id, home);
  const modeId = reservation.target.modeId.trim();
  const thinkingOptionId = reservation.target.thinkingOptionId.trim();
  const agent = await workspace.agents.create({
    agentId: reservation.agentId,
    idempotencyKey: reservation.agentId,
    config: {
      provider: reservation.target.provider,
      ...(modeId === "" ? {} : { modeId }),
      ...(thinkingOptionId === "" ? {} : { thinkingOptionId }),
    },
    title: MATE_TITLE,
    labels: { [CREW_LABELS.role]: CREW_LABELS.mateRole },
    // No prompt until config durably identifies this session as the mate.
  });
  if (agent.id !== reservation.agentId) throw new Error("Paseo returned a different identity for the reserved launch.");
  const prepared = await fetchLiveAgent(paseo, agent.id);
  if (prepared === null || prepared.workspaceId !== workspace.id || !(await sameDirectory(prepared.cwd, home)) || prepared.labels?.["paseo.parent-agent-id"] ||
      isMidTurn(prepared) || prepared.pendingPermissions.length > 0) {
    throw new Error("The reserved first mate is missing, busy, or outside its independent home workspace. No opening was sent.");
  }
  await updateFirstmateConfig({ mateAgentId: agent.id, mateProvider: reservation.target.provider, mateModeId: modeId,
    mateLaunch: { ...reservation, state: "sending" } });
  recordGeneration(start, agent.id, config.mateAgentId);
  await sendWithoutInterrupting(paseo, agent.id, reservation.prompt, { messageId: `firstmate-opening-${agent.id}` },
    { channel: "mate-opening", actor: "captain", mateRecipient: true });
  await updateFirstmateConfig({ mateLaunch: null });
  return { agentId: agent.id, workspaceId: workspace.id };
}

/**
 * Makes an existing agent the first mate. The charter is written into the
 * home either way, so an agent already working there picks it up on its next
 * session; one working elsewhere never sees it, which the board points out.
 */
export async function adoptMate(paseo: PaseoApi, agentId: string): Promise<FirstmateConfig> {
  return oneAtATime(async () => {
    const candidate = await fetchLiveAgent(paseo, agentId);
    if (candidate === null) throw new Error(`Paseo has no live agent ${agentId}.`);
    if (["watch-inspector", "topic-adviser"].includes(candidate.labels?.["firstmate.role"] ?? "")) throw new Error("Inspectors and topic advisers cannot take the first-mate role.");
    const config = await readFirstmateConfig();
    requireNoMigration(config);
    // Checked here rather than trusted from the launch panel: a launch may have finished while this waited.
    const current = await resolveMate(paseo, config);
    if (current.agent !== null && current.agent.id !== agentId) {
      throw new Error(
        `A first mate is already aboard (${current.agent.title ?? current.agent.id}). Release it in the FirstMate settings first.`,
      );
    }
    await prepareHome(resolveHome(config), config);
    const adopted = await updateFirstmateConfig({ mateAgentId: agentId });
    recordGeneration("adopt", agentId, config.mateAgentId);
    return adopted;
  });
}

export async function releaseMate(): Promise<FirstmateConfig> {
  return oneAtATime(async () => {
    const config = await readFirstmateConfig();
    requireNoMigration({ ...config, mateLaunch: null });
    const released = await updateFirstmateConfig({ mateAgentId: "", mateLaunch: null });
    recordGeneration("release", "", config.mateAgentId);
    return released;
  });
}

/** Every live agent that could be adopted, those already working in the home first. */
export async function listCandidates(paseo: PaseoApi): Promise<{ home: string; agents: AgentSummary[] }> {
  const home = resolveHome(await readFirstmateConfig());
  const agents = (await listAgents(paseo))
    .filter((agent) => ![CREW_LABELS.crewRole, "watch-inspector", "topic-adviser"].includes(agent.labels[CREW_LABELS.role] ?? ""))
    .map(summarizeAgent)
    .sort((a, b) => {
      const inHome = Number(b.cwd === home) - Number(a.cwd === home);
      return inHome !== 0 ? inHome : b.updatedAt.localeCompare(a.updatedAt);
    });
  return { home, agents };
}

/** The first mate's id, or a sentence saying there is none. */
export async function requireMate(paseo: PaseoApi): Promise<string> {
  const mate = await resolveMate(paseo, await readFirstmateConfig());
  if (mate.agent === null) throw new Error(NO_MATE);
  return mate.agent.id;
}

/**
 * Sends `/compact`, the command Paseo's own composer sends: Claude Code,
 * Codex and OpenCode each compact on it. A plain send, since a slash command
 * must be a turn of its own — so it is refused while a turn is running, where
 * a send would interrupt it, and a steer would bury the command in a message.
 */
export async function compactMate(paseo: PaseoApi): Promise<string> {
  return oneAtATime(async () => {
    const config = await readFirstmateConfig();
    requireNoMigration(config);
    const { agent } = await resolveMate(paseo, config);
    if (agent === null) throw new Error(NO_MATE);
    if (isMidTurn(agent)) throw new Error(`${MID_TURN} Compact it once it is idle.`);
    await observedSend(paseo, agent.id, "/compact", undefined, { channel: "mate-compact", actor: "captain", mateRecipient: true });
    return agent.id;
  });
}

/** The template for each request, with nothing after it and with something. */
const COMMANDS = {
  bearings: [TEMPLATES.bearings, TEMPLATES.bearingsArgs],
  ahoy: [TEMPLATES.ahoy, TEMPLATES.ahoyArgs],
} as const;

/**
 * What Bearings and Ahoy send — the buttons, ⌘K, `/bearings` and `/ahoy` — from `templates/messages/`:
 * plain requests, which charter §10 defines, rather than slash commands, which the first mate's own
 * harness would take as its own. `args` is whatever the captain typed after the command.
 */
export async function commandText(command: MateCommand, args: string): Promise<string> {
  const extra = args.trim();
  const [plain, withArgs] = COMMANDS[command];
  const text = await (extra === "" ? message(plain) : message(withArgs, { args: extra }));
  if (command !== "bearings") return text;
  const { workflowBearings } = await import("./workflow-board");
  const plans = await workflowBearings(resolveHome(await readFirstmateConfig()));
  return plans ? `${text}\n\n${await message(TEMPLATES.workflowBearings, { plans })}` : text;
}

/**
 * Delivers the captain's words, joining the first mate's turn if it is mid-way through one.
 * Images go with the message; files are written to Paseo's uploads first and go as their paths —
 * see `shared/attachments.ts`. Nothing is written until the first mate is known to exist. The chat's
 * `messageId` becomes the timeline item's `clientMessageId`, by which the chat finds the images it kept.
 */
export async function askMate(paseo: PaseoApi, message: CaptainMessage, beforeSend?: (agentId: string) => Promise<void>): Promise<string> {
  return oneAtATime(async () => {
    requireNoMigration(await readFirstmateConfig());
    const agentId = await requireMate(paseo);
    const images = message.images ?? [];
    const attachments = await Promise.all((message.files ?? []).map((file) => writeUpload(file)));
    // Update requests claim their verified identity here, after the lifecycle guards and immediately before delivery.
    await beforeSend?.(agentId);
    await sendWithoutInterrupting(paseo, agentId, message.text.trim(), {
      ...(images.length > 0 ? { images } : {}),
      ...(attachments.length > 0 ? { attachments } : {}),
      ...(message.messageId === undefined ? {} : { messageId: message.messageId }),
    }, { channel: "mate-ask", actor: "captain", mateRecipient: true });
    return agentId;
  });
}

/**
 * Durable delivery for crew notes, including those arriving during a failed handover. `receipt` names, for the
 * receipt journal, where the note came from and what it follows from; it changes nothing about the note.
 */
export async function queueMateNote(
  paseo: PaseoApi,
  text: string,
  receipt?: { source: "steer-relay" | "remote-steer"; relates: readonly string[] },
): Promise<void> {
  const id = `firstmate-note-${randomUUID()}`;
  await serialized("firstmate.mate.notes", async () => {
    const config = await readFirstmateConfig();
    await updateFirstmateConfig({ mateNotes: [...config.mateNotes, { id, text }] });
  });
  if (receipt !== undefined) recordNoteQueued(id, receipt.source, text, receipt.relates);
  await flushMateNotes(paseo).catch((error: unknown) => console.error("[firstmate] crew note queued for retry:", error));
}

/** A burst note waits this long after its latest exchange or steer before it goes to the first mate. */
export const BURST_QUIET_MS = 2 * 60 * 1000;
/** And never longer than this after its first, so a long conversation is still reported as it goes. */
export const BURST_MAX_MS = 10 * 60 * 1000;

type MateNote = FirstmateConfig["mateNotes"][number];

/** Whether a note is still gathering its burst: not yet due, and so never in a send's hands. */
function holding(note: MateNote, now: number): boolean {
  return note.burst !== undefined && Date.parse(note.burst.holdUntil) > now;
}

function holdUntil(startedAt: string, now: number): string {
  return new Date(Math.min(now + BURST_QUIET_MS, Date.parse(startedAt) + BURST_MAX_MS)).toISOString();
}

/**
 * Coalesces the captain's conversation with one worker into one note, so a burst of messages costs the
 * first mate one turn rather than one per message. `key` names the worker; `part` is this exchange, and
 * `render` turns every part of the burst, oldest first, into the note's text. A note still holding for
 * `key` takes the part and holds on; otherwise a new one is queued, held for `BURST_QUIET_MS`.
 *
 * A note is merged into only while it holds, and `flushMateNotes` sends only notes that have stopped
 * holding — so a part can never be merged into a note that a send has already taken.
 */
export async function queueBurstNote(
  paseo: PaseoApi,
  burst: { key: string; part: string; render: (parts: readonly string[]) => Promise<string> },
  receipt: { source: "steer-relay" | "remote-steer"; relates: readonly string[] },
  now: () => number = Date.now,
): Promise<void> {
  const queued = await serialized("firstmate.mate.notes", async () => {
    const config = await readFirstmateConfig();
    const at = now();
    const open = config.mateNotes.find((note) => note.burst?.key === burst.key && holding(note, at));
    if (open?.burst !== undefined) {
      const parts = [...open.burst.parts, burst.part];
      const relates = [...open.burst.relates, ...receipt.relates];
      const merged: MateNote = {
        id: open.id,
        text: await burst.render(parts),
        burst: { ...open.burst, parts, relates, holdUntil: holdUntil(open.burst.startedAt, at) },
      };
      await updateFirstmateConfig({ mateNotes: config.mateNotes.map((note) => (note.id === open.id ? merged : note)) });
      return { id: merged.id, text: merged.text, relates };
    }
    const startedAt = new Date(at).toISOString();
    const note: MateNote = {
      id: `firstmate-note-${randomUUID()}`,
      text: await burst.render([burst.part]),
      burst: { key: burst.key, parts: [burst.part], relates: [...receipt.relates], startedAt, holdUntil: holdUntil(startedAt, at) },
    };
    await updateFirstmateConfig({ mateNotes: [...config.mateNotes, note] });
    return { id: note.id, text: note.text, relates: [...receipt.relates] };
  });
  // A merge records the note again under the same id, with the whole burst's text and relates: the latest wins.
  recordNoteQueued(queued.id, receipt.source, queued.text, queued.relates);
  await flushMateNotes(paseo).catch((error: unknown) => console.error("[firstmate] crew note queued for retry:", error));
}

/**
 * The captain has just steered `key` again: a burst note still holding for it waits the quiet period
 * from now, so the answer to this steer joins it rather than following it in a note of its own.
 */
export async function extendBurstNote(key: string, now: () => number = Date.now): Promise<void> {
  await serialized("firstmate.mate.notes", async () => {
    const config = await readFirstmateConfig();
    const at = now();
    const open = config.mateNotes.find((note) => note.burst?.key === key && holding(note, at));
    if (open?.burst === undefined) return;
    const burst = { ...open.burst, holdUntil: holdUntil(open.burst.startedAt, at) };
    if (burst.holdUntil === open.burst.holdUntil) return;
    await updateFirstmateConfig({ mateNotes: config.mateNotes.map((note) => (note.id === open.id ? { ...open, burst } : note)) });
  });
}

export function flushMateNotes(paseo: PaseoApi, now: () => number = Date.now): Promise<void> {
  return oneAtATime(async () => {
    const config = await readFirstmateConfig();
    if (config.migration !== null || config.mateLaunch !== null) return;
    // Notes still gathering a burst wait; the 15-second note timer comes back for them.
    const note = config.mateNotes.find((entry) => !holding(entry, now()));
    if (note === undefined) return;
    const { agent } = await resolveMate(paseo, config);
    if (agent === null || isMidTurn(agent)) return;
    // One note per idle turn: a second send may replace the first on providers without steer.
    await sendWithoutInterrupting(paseo, agent.id, note.text, { messageId: note.id }, { channel: "mate-note", actor: "plugin", mateRecipient: true });
    await serialized("firstmate.mate.notes", async () => {
      const latest = await readFirstmateConfig();
      await updateFirstmateConfig({ mateNotes: latest.mateNotes.filter((entry) => entry.id !== note.id) });
    });
  });
}

/** A note put in the first mate's outbox, for the receipt journal; nothing when it is off. */
export function recordNoteQueued(noteId: string, source: "steer-relay" | "remote-steer" | "watch-runtime", text: string, relates: readonly string[] = []): void {
  receiptJournal()?.record({
    kind: "note-queued", noteId, source, generationOf: null,
    contentSha256: sha256(text), contentBytes: Buffer.byteLength(text), relates: [...relates].slice(0, 100),
  });
}

/**
 * Clears the first mate's attention flag while the captain has the FirstMate
 * panel open, as looking at the agent in Paseo would. The SDK has no call for
 * it, so it goes over the plugin's own channel (`daemon-session.ts`). Skipped
 * for a first mate waiting on a permission, as Paseo's own "mark as read"
 * skips one: the flag is the only prompt to answer it.
 */
export async function markMateSeen(paseo: PaseoApi): Promise<{ cleared: boolean }> {
  const { agent } = await resolveMate(paseo, await readFirstmateConfig());
  if (agent === null || agent.requiresAttention !== true) return { cleared: false };
  if (agent.pendingPermissions.length > 0 || agent.attentionReason === "permission") return { cleared: false };
  await sendSessionRequest({ type: "clear_agent_attention", agentId: agent.id }, "clear_agent_attention_response");
  return { cleared: true };
}
