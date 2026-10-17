/** Metadata only: no prompts, tool arguments/results, permission text or host connection data. */
export const ATTENTION_STATES = ["ready", "dependencies-met", "hold", "queued", "followed", "permission", "failure"] as const;
export type AttentionState = typeof ATTENTION_STATES[number];
export type AttentionEvent = {
  version: 1;
  run: string;
  id: string;
  at: number;
  kind: "start" | "gap" | "permission-requested" | "permission-resolved" | "worker-ended" |
    "lead-started" | "lead-ended" | "action" | "remote-status" | "state-enter" | "state-exit";
  lead: string;
  subject?: string;
  request?: string;
  turn?: string | null;
  outcome?: "completed" | "failed" | "canceled";
  state?: AttentionState;
  status?: string;
  call?: string;
  tool?: string;
  /** Hook receipt time is exact on this host; not a provider event timestamp. */
  source: "hook" | "fleet" | "catalog" | "observer" | "receipt";
  /** Earliest possible time from a previous successful sample; null means left-censored. */
  since?: number | null;
  clockSkewSeconds?: number | null;
  pollMs?: number | null;
  baseline?: boolean;
  /** Turn-start/end bounds for tools without their own trustworthy timestamps. */
  actionSince?: number | null;
  /** Temporal association only. Never a causal claim. */
  associatedEvent?: string | null;
  reason?: "queue-overflow" | "recording-failed" | "fleet-unavailable" | "remote-unavailable" | "subject-missing" | "identity-changed";
};
export type AttentionInput = Omit<AttentionEvent, "version" | "run" | "id" | "lead">;
