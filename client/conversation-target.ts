import type { DiscussionTarget } from "../shared/scope-discussion";

/** Whether two captured recipients are the same logical owner: home, scope, epoch and agent. */
export function sameConversationTarget(a: DiscussionTarget, b: DiscussionTarget): boolean {
  // Routine journal updates may advance scopeVersion. The existing sender still
  // captures/checks that fresh version; navigation pins the logical recipient.
  return a.homeId === b.homeId && a.scopeId === b.scopeId && a.epoch === b.epoch && a.agentId === b.agentId;
}
