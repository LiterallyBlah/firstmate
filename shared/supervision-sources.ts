/** S08 source adapter data: PR/head/check/review observations, remote inferred fingerprints and
 * persistent board submissions. Observation and ownership joins only; nothing here dispatches,
 * releases, merges or mutates a remote host. Source prose is quoted evidence, never authority.
 */
import { z } from "zod";
import { SupervisionHash, SupervisionUtc, SupervisionUuid } from "./supervision";

const count = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER), positive = count.min(1);
const text = (max = 256) => z.string().min(1).max(max);
export const GitHead = z.string().regex(/^[0-9a-f]{40,64}$/);
/** Lowercased `owner/repo`, the only repository identity a binding or observation may carry. */
export const Repository = z.string().max(201).regex(/^[a-z0-9_.-]{1,100}\/[a-z0-9_.-]{1,100}$/);

export const PR_OBSERVATION_FORMAT = "firstmate.pr-observation/1" as const;
export const PrCheckSchema = z.object({
  /** `run:<run>/attempt:<n|?>/job:<job>` when the details link exposes it; otherwise a content digest. */
  id: text(1024), identity: z.enum(["run", "digest"]), name: text(512), workflow: text(512).nullable(),
  status: z.enum(["pending", "success", "failure", "neutral", "skipped", "unknown"]),
  /** gh's PR view does not say which checks are required; null is unknown, never "not required". */
  required: z.boolean().nullable(),
}).strict();
export const PrReviewSchema = z.object({
  id: text(256), author: text(256).nullable(), state: text(64),
  /** The commit the review was submitted against. Null is unknown and never counts as current. */
  commit: GitHead.nullable(), submittedAt: text(64).nullable(),
}).strict();
export const PrObservationSchema = z.object({
  format: z.literal(PR_OBSERVATION_FORMAT), repository: Repository, pr: positive,
  state: z.enum(["OPEN", "CLOSED", "MERGED"]), head: GitHead, author: text(256).nullable(),
  checks: z.array(PrCheckSchema).max(256), requiredChecks: z.enum(["unknown", "known"]),
  reviews: z.array(PrReviewSchema).max(256), observedAt: SupervisionUtc,
}).strict();
export type PrObservation = z.infer<typeof PrObservationSchema>;
export type PrCheck = z.infer<typeof PrCheckSchema>;

/** One primary owner per pull request: an explicit registry join, never a title, label or backlog line. */
export const SourceBindingSchema = z.object({
  id: SupervisionHash, kind: z.literal("pull-request"), repository: Repository, pr: positive,
  scopeId: SupervisionUuid, taskId: SupervisionUuid, attemptId: SupervisionUuid,
  state: z.enum(["active", "retired"]), version: positive,
}).strict();
export type SourceBinding = z.infer<typeof SourceBindingSchema>;
export const pullRequestBindingKey = (repository: string, pr: number) => ["pull-request", repository.toLowerCase(), pr] as const;

/** Persisted before the send: the captain's message ID and the exact attempt/epoch it targets.
 * `correlation` is typed (clientMessageId seen) or inferred (text only), and inferred grants nothing.
 */
export const BoardSubmissionSchema = z.object({
  id: SupervisionUuid, messageId: text(256), scopeId: SupervisionUuid, taskId: SupervisionUuid, attemptId: SupervisionUuid,
  epoch: positive, hostId: z.literal("local"), agentId: text(), textDigest: SupervisionHash, payloadRef: z.string().regex(/^blob:[0-9a-f]{64}$/),
  state: z.enum(["reserved", "accepted", "uncertain", "failed"]), createdAt: SupervisionUtc,
  correlation: z.object({ turnId: text().nullable(), eventId: SupervisionUuid, certainty: z.enum(["verified", "inferred"]) }).strict().nullable(),
  version: positive,
}).strict();
export type BoardSubmission = z.infer<typeof BoardSubmissionSchema>;

/** Readiness is a projection for admission checks. It is never merge, release or completion authority. */
export interface PrReadiness {
  format: "firstmate.pr-readiness/1"; repository: string; pr: number;
  state: "ready" | "pending" | "red" | "stale" | "blocked" | "merged" | "closed" | "unknown";
  head: string | null; reasons: string[];
  checks: { state: "passing" | "pending" | "failing" | "none" | "unknown"; coverage: "required" | "all-observed"; failing: string[] };
  /** Distinct independent reviewers whose latest review approves this exact head. */
  approvals: { reviewId: string; author: string }[];
  /** Review IDs at an older head, or with an unknown commit: retained, never counted. */
  staleReviews: string[];
  /** Observations that would have been ready at their head and no longer are. */
  invalidated: { head: string; observedAt: string; reason: string }[];
  observations: number; duplicates: number; observedAt: string | null;
}

export interface RemoteCoverage {
  serverId: string; label: string; state: "fresh" | "stale" | "offline";
  checkedAt: string | null; ageMs: number | null; clockSkewSeconds: number | null;
  /** Never "complete": a catalog poll has no cursor and equal content can hide a new turn. */
  claim: "fingerprint-only" | "none"; gaps: string[]; workers: number; followedExcluded: number; error: boolean;
}

export const SOURCE_LIMITS = { staleRemoteMs: 3 * 60 * 1000, clockSkewSeconds: 180, answerChars: 4000, spoolFiles: 64, spoolBytes: 64 * 1024 } as const;
