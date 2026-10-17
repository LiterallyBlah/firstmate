/**
 * What the receipt journal sees rather than does: the first mate's own Paseo tool calls in each turn it ends,
 * a crewmate of the first mate ending a turn — whose finish note Paseo may or may not have sent, and which the
 * plugin can never read — and, on request, a page of a timeline through the SDK cursor. Nothing here sends,
 * steers or writes anything but receipts. The optional detached attention callback has its own opt-in.
 */
import type { PluginLifecycleEvents, PluginHookContext, PluginLifecycleRegistration } from "@getpaseo/plugin/server";
import type { z } from "zod";

import { CREW_LABELS, type FirstmateConfig } from "../shared/fleet";
import type { pageReceiptTimeline } from "../shared/receipts";
import type { PaseoApi, TimelineItem } from "./host-types";
import { receiptJournal, receiptJournalEnabled, sha256 } from "./receipts";
import { canonical } from "./submissions";

/** Paseo's agent tools whose calls change the crew, the schedules or a permission: the first mate's actions. */
const MATE_ACTION = /(?:^|__|[.:/])(create_agent|send_agent_prompt|archive_agent|cancel_agent|kill_agent|update_agent|set_agent_mode|respond_to_permission|create_workspace|archive_workspace|create_heartbeat|delete_heartbeat|create_schedule|update_schedule|delete_schedule|pause_schedule|resume_schedule|run_schedule_once)$/;
export const isMateAction = (name: string) => MATE_ACTION.test(name);

export function mateActions(timeline: readonly TimelineItem[]): Array<{ callId: string; name: string; status: string; detailSha256: string }> {
  return timeline.flatMap((item) =>
    item.type === "tool_call" && isMateAction(item.name)
      ? [{ callId: item.callId, name: item.name, status: item.status, detailSha256: sha256(canonical(item.detail ?? null)) }]
      : [],
  ).slice(0, 500);
}

export function registerReceiptObservers(server: PluginLifecycleRegistration, readConfig: () => Promise<FirstmateConfig>,
  observe?: (event: PluginLifecycleEvents["agent.turn_ended"], context: PluginHookContext) => void,
): () => void {
  return server.on("agent.turn_ended", async (event, context) => {
    // The optional metadata observer queues work and returns; receipt/delivery semantics stay unchanged.
    try { observe?.(event, context); } catch { console.error("[firstmate] attention observer could not queue a turn"); }
    const journal = receiptJournal();
    if (journal === null) return;
    try {
      const mate = (await readConfig()).mateAgentId.trim();
      if (mate === "") return;
      if (event.agent.id === mate) {
        const actions = mateActions(event.timeline);
        if (actions.length > 0) {
          journal.record({ kind: "mate-actions", mateAgentId: mate, generationOf: mate, turnId: event.turnId,
            outcome: event.outcome.kind, source: "turn_ended", actions });
        }
      } else if (event.agent.parentAgentId === mate) {
        journal.record({ kind: "native-finish", childAgentId: event.agent.id, parentAgentId: mate, turnId: event.turnId,
          outcome: event.outcome.kind, certainty: "uncertain", reason: "paseo-system-envelope-not-recorded" });
      }
    } catch (error) {
      console.error("[firstmate] receipt journal could not observe a turn's end:", error);
    }
  });
}

type PageInput = z.output<typeof pageReceiptTimeline.input>;
type PageOutput = z.infer<typeof pageReceiptTimeline.output>;

/** Which of the first mate's agents `agentId` is, or a refusal: the RPC reads only those. */
async function roleOf(paseo: PaseoApi, config: FirstmateConfig, agentId: string): Promise<PageOutput["role"]> {
  if (agentId === config.mateAgentId.trim()) return "first-mate";
  if (config.previousMateIds.includes(agentId)) return "former-first-mate";
  const found = await paseo.agents.ref(agentId).refresh().catch(() => null);
  const role = found?.agent?.labels?.[CREW_LABELS.role];
  if (role === CREW_LABELS.crewRole) return "crew";
  if (role === CREW_LABELS.mateRole) return "former-first-mate";
  throw new Error(`${agentId} is neither a first mate nor one of the crew.`);
}

/** One page of a timeline, as Paseo gives it, with nothing changed but the shape of each entry. */
export async function pageTimeline(paseo: PaseoApi, config: FirstmateConfig, input: PageInput): Promise<PageOutput> {
  if (!receiptJournalEnabled()) throw new Error("The receipt journal is off; set FIRSTMATE_RECEIPT_JOURNAL=1 for the daemon to use it.");
  const role = await roleOf(paseo, config, input.agentId);
  const page = await paseo.agents.ref(input.agentId).timeline.refetch({
    direction: input.direction, limit: input.limit, projection: input.projection, ...(input.cursor ? { cursor: input.cursor } : {}),
  });
  return {
    agentId: input.agentId, role,
    epoch: page.epoch, direction: page.direction, projection: page.projection, reset: page.reset,
    staleCursor: page.staleCursor, gap: page.gap, hasOlder: page.hasOlder, hasNewer: page.hasNewer,
    window: { minSeq: page.window.minSeq, maxSeq: page.window.maxSeq, nextSeq: page.window.nextSeq },
    startCursor: page.startCursor, endCursor: page.endCursor, error: page.error,
    entries: page.entries.map((entry) => ({
      seqStart: entry.seqStart, seqEnd: entry.seqEnd, turnId: entry.turnId ?? null, timestamp: entry.timestamp, item: entry.item,
    })),
  };
}
