/** S06 opt-in metadata format and pure reporting. No observer, timer, prompt capture or live wiring.
 * Callers must measure the actual boundary; synthetic clocks never establish provider performance.
 */
import { z } from "zod";
import { SupervisionHash, SupervisionUuid } from "../shared/supervision";

const count = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const instant = z.number().finite().nonnegative(); // milliseconds relative to the run origin
const optionalInstant = instant.nullable();
const stages = ["committed", "offered", "acknowledged", "handled"] as const;
const MetricSample = z.object({
  eventId: SupervisionUuid, scopeId: SupervisionUuid,
  observed: instant, committed: optionalInstant, offered: optionalInstant,
  acknowledged: optionalInstant, handled: optionalInstant,
  sourcePolls: count,
}).strict().superRefine((s, ctx) => {
  let previous = s.observed, missing = false;
  for (const stage of stages) {
    const at = s[stage];
    if (at === null) { missing = true; continue; }
    if (missing || at < previous) ctx.addIssue({ code: "custom", path: [stage], message: "Stages require an ordered measured prefix." });
    previous = at;
  }
});

/** IDs/hashes, bounded runtime versions, relative timestamps and counts only. Unknown stays null.
 * Census coverage describes the checked route, not arbitrary same-user native/shell bypasses.
 */
export const PilotMetricsSchema = z.object({
  format: z.literal("firstmate.supervision-pilot-metrics/2"),
  runId: SupervisionUuid, sourceHead: z.string().regex(/^[0-9a-f]{40}$/), fixtureHash: SupervisionHash,
  mode: z.enum(["synthetic", "live"]), route: z.enum(["legacy", "scoped"]), clock: z.enum(["virtual", "monotonic"]),
  runtime: z.object({ node: z.string().regex(/^v?\d+\.\d+\.\d+$/), platform: z.enum(["win32", "linux", "darwin"]) }).strict(),
  windowMs: instant.positive(), generalBusyMs: instant,
  samples: z.array(MetricSample).max(10_000),
  captain: z.array(z.object({ id: SupervisionUuid, submitted: instant, admitted: optionalInstant, firstReply: optionalInstant }).strict()
    .refine(s => (s.admitted === null ? s.firstReply === null : s.admitted >= s.submitted && (s.firstReply === null || s.firstReply >= s.admitted)), "Captain stages must be ordered.")).max(1000),
  census: z.object({ coverage: z.enum(["checked-route", "partial"]), generalRoutinePayloads: count,
    projectRoutinePayloads: count,
    // Additional ingress observations deduplicated locally; never delivery to General.
    duplicateObservations: count,
    // Native callbacks delivered to General for this trial, including duplicates.
    accidentalCallbacks: count }).strict(),
  spend: z.object({ workerSessions: count, workerTurns: count, supervisorSessions: count, supervisorTurns: count, generalTurns: count,
    uncertainEffects: count, providerTokens: count.nullable(), billedMicros: count.nullable() }).strict(),
}).strict().superRefine((s, ctx) => {
  if (s.generalBusyMs > s.windowMs) ctx.addIssue({ code: "custom", path: ["generalBusyMs"], message: "Busy interval exceeds observation window." });
  if (s.mode === "live" && s.clock !== "monotonic") ctx.addIssue({ code: "custom", path: ["clock"], message: "Live runs require measured monotonic time." });
  if (s.mode === "synthetic" && (s.spend.providerTokens !== null || s.spend.billedMicros !== null))
    ctx.addIssue({ code: "custom", path: ["spend"], message: "Synthetic calls do not measure provider usage." });
  const keys = s.samples.map(row => row.eventId);
  if (new Set(keys).size !== keys.length) ctx.addIssue({ code: "custom", path: ["samples"], message: "One metric sample per event identity." });
  if (new Set(s.captain.map(row => row.id)).size !== s.captain.length) ctx.addIssue({ code: "custom", path: ["captain"], message: "Repeated captain sample." });
  for (const row of s.samples) for (const key of ["observed", ...stages] as const)
    if (row[key] !== null && row[key]! > s.windowMs) ctx.addIssue({ code: "custom", path: ["samples"], message: "Stage exceeds observation window." });
  for (const row of s.captain) for (const at of [row.submitted, row.admitted, row.firstReply])
    if (at !== null && at > s.windowMs) ctx.addIssue({ code: "custom", path: ["captain"], message: "Stage exceeds observation window." });
});
export type PilotMetrics = z.infer<typeof PilotMetricsSchema>;

/** Nearest-rank p50/p95. Include missing/censored samples in the denominator, never as zero. */
function metricDistribution(values: readonly (number | null)[]) {
  const measured = values.filter((n): n is number => n !== null).sort((a, b) => a - b);
  const percentile = (p: number) => measured.length ? measured[Math.ceil(p * measured.length) - 1]! : null;
  return { denominator: values.length, measured: measured.length, missing: values.length - measured.length,
    minMs: measured[0] ?? null, p50Ms: percentile(.5), p95Ms: percentile(.95), maxMs: measured.at(-1) ?? null };
}
export function summarizePilotMetrics(raw: unknown) {
  const run = PilotMetricsSchema.parse(raw);
  const sinceObserved = (key: typeof stages[number]) => metricDistribution(run.samples.map(s => s[key] === null ? null : s[key]! - s.observed));
  return {
    runId: run.runId, mode: run.mode, route: run.route, clock: run.clock,
    windowMs: run.windowMs, generalBusyMs: run.generalBusyMs, events: run.samples.length,
    scopes: new Set(run.samples.map(s => s.scopeId)).size, sourcePolls: run.samples.reduce((n, s) => n + s.sourcePolls, 0),
    commit: sinceObserved("committed"), offer: sinceObserved("offered"), ack: sinceObserved("acknowledged"), handled: sinceObserved("handled"),
    queueAge: metricDistribution(run.samples.map(s => s.offered === null || s.committed === null ? null : s.offered - s.committed)),
    captainAdmission: metricDistribution(run.captain.map(s => s.admitted === null ? null : s.admitted - s.submitted)),
    captainFirstReply: metricDistribution(run.captain.map(s => s.firstReply === null ? null : s.firstReply - s.submitted)),
    census: { ...run.census, zeroRoutineOnCheckedRoute: run.census.coverage === "checked-route" &&
      run.census.generalRoutinePayloads === 0 && run.census.projectRoutinePayloads === 0 &&
      run.census.accidentalCallbacks === 0 && run.spend.generalTurns === 0 },
    spend: run.spend,
  };
}
