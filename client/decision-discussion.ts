import type { NeedsYouSnapshot } from "../shared/needs-you";
import { decisionCardSnapshot } from "../shared/plan-decisions";
import { pendingAttachments } from "./attachments";
import { drafts } from "./draft";
import { routeDecision, type DecisionDestination } from "./needs-you-state";

/** A discussion is about exactly this question, with the mate it was opened for. */
export type DecisionDiscussion = Required<DecisionDestination> & { mateId: string };
export type DecisionIntent = { discussWith?: string; board?: boolean };

export function routeDiscussion(params: Readonly<Record<string, string>>): DecisionDiscussion | null {
  const destination = routeDecision(params);
  return destination?.homeId && destination.recordRevision && params.discussMate
    ? { homeId: destination.homeId, requestId: destination.requestId, recordRevision: destination.recordRevision, mateId: params.discussMate }
    : null;
}

export function discussionRequest(
  reference: DecisionDiscussion | null,
  snapshot: NeedsYouSnapshot | undefined,
  mateId: string | null,
  offline = false,
) {
  if (!reference || !snapshot || offline || snapshot.freshness.status !== "fresh" ||
      reference.mateId !== mateId || reference.homeId !== snapshot.homeId) return null;
  return decisionCardSnapshot(snapshot).requests.find(request =>
    request.id === reference.requestId && request.revision === reference.recordRevision &&
    (request.state === "new" || request.state === "seen" || request.state === "snoozed"),
  ) ?? null;
}

/** Only an empty composer gets a starting phrase. This never sends or touches attachments. */
export function prepareDiscussion(reference: DecisionDiscussion, snapshot: NeedsYouSnapshot | undefined, mateId: string, offline = false) {
  const request = discussionRequest(reference, snapshot, mateId, offline);
  if (request && drafts.get(mateId) === "" && pendingAttachments.get(mateId).length === 0) {
    drafts.set(mateId, `About «${request.source.title}»: `);
  }
  return request;
}
