/** Pure decision state machine. Persistence and source stability belong to the service. */
import { createHash } from "node:crypto";
import { z } from "zod";
import {
  DecisionSourceSchema,
  NeedsYouRequestSchema,
  NeedsYouTransitionSchema,
  type DecisionSource,
  type NeedsYouRequest,
  type NeedsYouSnapshot,
  type NeedsYouTarget,
  type NeedsYouTransition,
} from "../shared/needs-you";
import { normalizeAsk, type NeedsYouDetection } from "./needs-you-detect";

export const NeedsYouLedgerSchema = z
  .object({
    schema: z.literal(1),
    homeId: z.string().min(1),
    canonicalHome: z.string().min(1),
    version: z.number().int().nonnegative(),
    initializedAt: z.number().int().nonnegative().nullable(),
    observedAt: z.number().int().nonnegative().nullable(),
    requests: z.array(NeedsYouRequestSchema),
    parked: z.array(DecisionSourceSchema),
    sequence: z.number().int().nonnegative(),
    outbox: z.array(NeedsYouTransitionSchema),
  })
  .superRefine((ledger, context) => {
    const ids = new Set<string>();
    const submissions = new Set<string>();
    for (const request of ledger.requests) {
      if (
        ids.has(request.id) ||
        request.id !==
          decisionId(ledger.homeId, request.source.key, request.generation)
      ) {
        context.addIssue({
          code: "custom",
          message: "Invalid or duplicate decision identity.",
        });
      }
      ids.add(request.id);
      if (
        (request.state === "resolved") !== (request.resolution !== null) ||
        (request.state === "snoozed") !== (request.snoozedUntil !== null)
      ) {
        context.addIssue({
          code: "custom",
          message: "Inconsistent decision lifecycle.",
        });
      }
      for (const submission of request.submissions) {
        if (submissions.has(submission.submissionId))
          context.addIssue({
            code: "custom",
            message: "Duplicate answer submission.",
          });
        submissions.add(submission.submissionId);
      }
    }
    if (
      ledger.outbox.length !== ledger.sequence ||
      ledger.outbox.some(
        (event, index) =>
          event.sequence !== index + 1 ||
          event.homeId !== ledger.homeId ||
          event.eventId !== `${ledger.homeId}:${event.sequence}` ||
          !ids.has(event.requestId),
      )
    ) {
      context.addIssue({
        code: "custom",
        message: "Invalid decision transition sequence.",
      });
    }
  });
export type NeedsYouLedger = z.infer<typeof NeedsYouLedgerSchema>;
function decisionId(homeId: string, key: string, generation: number) {
  return `${homeId}:${createHash("sha256").update(key).digest("hex")}:${generation}`;
}
export function emptyLedger(
  homeId: string,
  canonicalHome: string,
): NeedsYouLedger {
  return {
    schema: 1,
    homeId,
    canonicalHome,
    version: 0,
    initializedAt: null,
    observedAt: null,
    requests: [],
    parked: [],
    sequence: 0,
    outbox: [],
  };
}

function emit(
  ledger: NeedsYouLedger,
  request: NeedsYouRequest,
  kind: NeedsYouTransition["kind"],
  now: number,
) {
  const sequence = ++ledger.sequence;
  ledger.outbox.push({
    sequence,
    eventId: `${ledger.homeId}:${sequence}`,
    homeId: ledger.homeId,
    requestId: request.id,
    generation: request.generation,
    revision: request.revision,
    kind,
    occurredAt: now,
  });
}

function finish(
  ledger: NeedsYouLedger,
  request: NeedsYouRequest,
  reason: NonNullable<NeedsYouRequest["resolution"]>["reason"],
  now: number,
) {
  request.state = "resolved";
  request.resolution = { reason, at: now };
  request.snoozedUntil = null;
  request.updatedAt = now;
  emit(ledger, request, "resolved", now);
}

function currentRequests(ledger: NeedsYouLedger) {
  const current = new Map<string, NeedsYouRequest>();
  for (const request of ledger.requests) {
    const old = current.get(request.source.key);
    if (!old || request.generation > old.generation)
      current.set(request.source.key, request);
  }
  return current;
}

/** Missing tasks are not evidence of any resolution, however many reads agree. */
export function missingRequests(
  ledger: NeedsYouLedger,
  detection: NeedsYouDetection,
): string[] {
  const present = new Set(detection.sources.map((source) => source.key));
  return [...currentRequests(ledger).values()]
    .filter(
      (request) =>
        request.state !== "resolved" && !present.has(request.source.key),
    )
    .map((request) => request.source.taskId);
}

function targetChanged(before: DecisionSource, after: DecisionSource) {
  return (
    before.url !== after.url ||
    before.reportPath !== after.reportPath ||
    before.gateToken !== after.gateToken
  );
}

/** Only call with a stable valid observation. No source edit is ever performed. */
export function reconcileNeedsYou(
  previous: NeedsYouLedger,
  detection: NeedsYouDetection,
  now: number,
): NeedsYouLedger {
  if (!detection.valid || missingRequests(previous, detection).length)
    return previous;
  const ledger = structuredClone(previous);
  const baseline = ledger.initializedAt === null;
  const current = currentRequests(ledger);
  ledger.parked = detection.sources
    .filter((source) => source.disposition === "parked")
    .sort((a, b) => a.key.localeCompare(b.key));
  for (const source of [...detection.sources].sort((a, b) =>
    a.key.localeCompare(b.key),
  )) {
    const old = current.get(source.key);
    if (source.disposition !== "open") {
      if (old && old.state !== "resolved") {
        finish(
          ledger,
          old,
          source.disposition === "done"
            ? "completed"
            : source.blockedBy
              ? "deferred"
              : "answered",
          now,
        );
      }
      continue;
    }
    const changedAsk =
      old !== undefined &&
      normalizeAsk(old.source.ask) !== normalizeAsk(source.ask);
    const newGeneration =
      old === undefined ||
      old.state === "resolved" ||
      targetChanged(old.source, source) ||
      (changedAsk &&
        (old.state === "answer-sent" || old.state === "delivery-uncertain"));
    if (newGeneration) {
      if (old && old.state !== "resolved")
        finish(ledger, old, "superseded", now);
      const generation = (old?.generation ?? 0) + 1;
      const request: NeedsYouRequest = {
        id: decisionId(ledger.homeId, source.key, generation),
        source,
        generation,
        revision: (old?.revision ?? 0) + 1,
        state: baseline ? "seen" : "new",
        detectedAt: now,
        updatedAt: now,
        originalAsk: source.ask,
        baseline,
        seenAt: null,
        seenRevision: null,
        snoozedUntil: null,
        submissions: [],
        resolution: null,
      };
      ledger.requests.push(request);
      if (!baseline) emit(ledger, request, "actionable", now);
    } else if (old) {
      if (changedAsk) {
        old.revision++;
        old.updatedAt = now;
        emit(ledger, old, "updated", now);
      }
      old.source = source;
    }
  }
  if (baseline) ledger.initializedAt = now;
  expireSnoozes(ledger, now);
  return changed(previous, ledger, now);
}

function expireSnoozes(ledger: NeedsYouLedger, now: number) {
  for (const request of ledger.requests) {
    if (
      request.state !== "snoozed" ||
      request.snoozedUntil === null ||
      now < request.snoozedUntil
    )
      continue;
    request.state = "new";
    request.baseline = false;
    request.snoozedUntil = null;
    request.updatedAt = now;
    emit(ledger, request, "snooze-due", now);
  }
}

function changed(
  previous: NeedsYouLedger,
  next: NeedsYouLedger,
  now: number,
): NeedsYouLedger {
  if (JSON.stringify(previous) === JSON.stringify(next)) return previous;
  next.version = previous.version + 1;
  next.observedAt = now;
  return next;
}

export type NeedsYouMutation =
  | { kind: "seen" }
  | { kind: "snooze"; until: number }
  | { kind: "unsnooze" }
  | {
      kind: "answer";
      submissionId: string;
      outcome: "uncertain" | "accepted" | "failed";
    };

export function mutateNeedsYou(
  previous: NeedsYouLedger,
  target: NeedsYouTarget,
  mutation: NeedsYouMutation,
  now: number,
): NeedsYouLedger {
  if (target.homeId !== previous.homeId)
    throw new Error("The FirstMate home changed. Refresh the decision.");
  const ledger = structuredClone(previous);
  const request = ledger.requests.find((entry) => entry.id === target.id);
  if (
    !request ||
    request.revision !== target.revision ||
    request.state === "resolved"
  )
    throw new Error("This decision changed. Refresh before acting.");
  if (mutation.kind === "answer") {
    const owned = ledger.requests
      .flatMap((entry) =>
        entry.submissions.map((submission) => ({ request: entry, submission })),
      )
      .find((entry) => entry.submission.submissionId === mutation.submissionId);
    if (
      owned &&
      (owned.request.id !== target.id ||
        owned.submission.revision !== target.revision)
    )
      throw new Error(
        "This submission id belongs to another decision revision.",
      );
    const existing = owned?.submission;
    if (existing) {
      if (existing.outcome === mutation.outcome) return previous;
      if (existing.outcome !== "uncertain")
        throw new Error("This submission already has a definitive outcome.");
      existing.outcome = mutation.outcome;
      existing.settledAt = now;
      if (mutation.outcome === "failed") {
        request.state = existing.previousState;
        request.snoozedUntil = existing.previousSnoozedUntil;
      }
    } else {
      if (
        request.state === "answer-sent" ||
        request.state === "delivery-uncertain"
      )
        throw new Error(
          "An answer is already pending. Inspect it before submitting another.",
        );
      request.submissions.push({
        submissionId: mutation.submissionId,
        revision: target.revision,
        outcome: mutation.outcome,
        recordedAt: now,
        settledAt: mutation.outcome === "uncertain" ? null : now,
        previousState: request.state,
        previousSnoozedUntil: request.snoozedUntil,
      });
    }
    if (mutation.outcome !== "failed") {
      request.state =
        mutation.outcome === "accepted" ? "answer-sent" : "delivery-uncertain";
      request.snoozedUntil = null;
    }
    emit(
      ledger,
      request,
      mutation.outcome === "failed" ? "answer-failed" : "answer-pending",
      now,
    );
  } else {
    if (
      request.state === "answer-sent" ||
      request.state === "delivery-uncertain"
    )
      throw new Error(
        "An answer is pending; this decision cannot be snoozed or acknowledged again.",
      );
    if (mutation.kind === "seen") {
      if (request.seenRevision === request.revision && request.state !== "new")
        return previous;
      request.seenAt = now;
      request.seenRevision = request.revision;
      if (request.state !== "snoozed") request.state = "seen";
      emit(ledger, request, "seen", now);
    } else if (mutation.kind === "snooze") {
      if (!Number.isSafeInteger(mutation.until) || mutation.until <= now)
        throw new Error("Snooze needs an absolute future wake time.");
      if (
        request.state === "snoozed" &&
        request.snoozedUntil === mutation.until
      )
        return previous;
      request.state = "snoozed";
      request.snoozedUntil = mutation.until;
      emit(ledger, request, "snoozed", now);
    } else {
      if (request.state !== "snoozed") return previous;
      request.state =
        request.seenAt !== null || request.baseline ? "seen" : "new";
      request.snoozedUntil = null;
      emit(ledger, request, "unsnoozed", now);
    }
  }
  request.updatedAt = now;
  expireSnoozes(ledger, now);
  return changed(previous, ledger, now);
}

export function needsYouSnapshot(
  ledger: NeedsYouLedger | null,
  freshness: NeedsYouSnapshot["freshness"],
): NeedsYouSnapshot {
  const known = ledger?.initializedAt != null;
  const requests = ledger?.requests ?? [];
  return {
    homeId: ledger?.homeId ?? null,
    version: ledger?.version ?? 0,
    actionCount: known
      ? requests.filter(
          (entry) => entry.state === "new" || entry.state === "seen",
        ).length
      : null,
    newCount: known
      ? requests.filter((entry) => entry.state === "new").length
      : null,
    snoozedCount: known
      ? requests.filter((entry) => entry.state === "snoozed").length
      : null,
    pendingAnswerCount: known
      ? requests.filter(
          (entry) =>
            entry.state === "answer-sent" ||
            entry.state === "delivery-uncertain",
        ).length
      : null,
    freshness,
    requests: structuredClone(requests),
    parked: structuredClone(ledger?.parked ?? []),
    delivery: "off",
  };
}
