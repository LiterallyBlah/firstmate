import { createHash } from "node:crypto";
import type { AttentionState } from "../shared/attention";
import type { FleetCard } from "../shared/fleet";
import type { TimelineItem } from "./host-types";
import { isMateAction } from "./receipt-observers";

/** Opaque identities retain joins without retaining arbitrary labels or host URLs. */
export const attentionKey = (...parts: string[]) => createHash("sha256").update(JSON.stringify(parts)).digest("hex");
export const workerKey = (agent: string, host = "local") => attentionKey("worker", host, agent);
const hostKey = (card: FleetCard) => card.remote ? card.remote.serverId ?? card.remote.host : "local";
export function cardKey(card: FleetCard): string {
  const host = hostKey(card);
  const agent = card.agent?.id ?? card.remote?.worker?.id ?? card.backlog?.agentId;
  return agent ? workerKey(agent, host) : attentionKey("task", host, card.project ?? "", card.taskId ?? card.key);
}

/** Only explicit single task IDs are interpreted; prose and ambiguous/reused IDs stay unknown. */
export function attentionStates(card: FleetCard, cards: readonly FleetCard[]): AttentionState[] {
  if (card.column === "done") return [];
  const states: AttentionState[] = [];
  if (card.column === "ready") states.push("ready");
  if (card.backlog?.hold !== null && card.backlog?.hold !== undefined) states.push("hold");
  if (card.column === "queued" || card.backlog?.section === "queued") states.push("queued");
  if (card.remote?.worker?.followed) states.push("followed");
  if ((card.agent?.pendingPermissions ?? card.remote?.worker?.pendingPermissions ?? 0) > 0) states.push("permission");
  if (card.column === "failed") states.push("failure");
  const dependency = card.backlog?.blockedBy;
  if (dependency && /^[\w.-]+$/.test(dependency)) {
    const matches = cards.filter(other => other.taskId === dependency && other.project === card.project && hostKey(other) === hostKey(card));
    if (matches.length === 1 && matches[0]!.column === "done") states.push("dependencies-met");
  }
  return states;
}

/** Reuse the receipt observer's tool catalogue; never infer a target from prompt/shell prose. */
export function attentionActions(timeline: readonly TimelineItem[]) {
  return timeline.filter(item => item.type === "tool_call" && isMateAction(item.name)).slice(-500).flatMap(item => {
    if (item.type !== "tool_call" || item.status !== "completed" || item.error || item.detail.type !== "unknown") return [];
    const input = object(item.detail.input), output = object(item.detail.output);
    // Provider "completed" can wrap an MCP error. Require explicit success for mutations.
    const tool = item.name.split(/__|[.:/]/).at(-1)!;
    if (output.isError === true || output.success === false) return [];
    if (tool === "create_agent") {
      const labels = object(input.labels);
      if (typeof (output.agentId ?? output.id) !== "string" || labels["firstmate.role"] !== "crew" || typeof labels["firstmate.task"] !== "string") return [];
      return [{ subject: attentionKey("task", "local", typeof labels["firstmate.project"] === "string" ? labels["firstmate.project"] : "", labels["firstmate.task"]),
        call: attentionKey(item.callId), tool }];
    }
    if (output.success !== true || typeof input.agentId !== "string") return [];
    if (!["send_agent_prompt", "archive_agent", "cancel_agent", "kill_agent", "update_agent", "set_agent_mode", "respond_to_permission"].includes(tool)) return [];
    return [{ subject: workerKey(input.agentId), call: attentionKey(item.callId), tool }];
  });
}
function object(value: unknown): Record<string, unknown> {
  if (typeof value === "string") { try { return object(JSON.parse(value)); } catch { return {}; } }
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const row = value as Record<string, unknown>;
  // MCP text content is the same structured result the decision collector unwraps.
  if (Array.isArray(row.content) && row.isError !== true) {
    const text = row.content.find(part => part?.type === "text" && typeof part.text === "string");
    if (text) return object(text.text);
  }
  return row;
}
