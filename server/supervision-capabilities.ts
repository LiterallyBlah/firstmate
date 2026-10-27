/** S11 strong-mode capability gate under the conservative D6 amendment (data/fm-ss-d6).
 *
 * U1 (authenticated callers and receiver fences), U2 (durable subscription and heartbeat transfer) and U3
 * (conditional archive) are not delivered upstream and are not assumed. This module keeps the S00 probe rows
 * so a strong capability can be enabled later, and refuses every one of them now:
 *
 *   - a strong capability is enabled only with its flag, a public contract, a supported installed version and
 *     live receiver evidence (`StrongQualification`), and a version column S00 marks `source-supported`;
 *   - nothing ships a qualification, and S00 marks every strong row unsupported in every known version;
 *   - a requested capability that is missing is refused (`UNSUPPORTED`), never silently downgraded to the
 *     cooperative gateway;
 *   - the cooperative mode's limits are stated, never a claim of isolation, failover, takeover or exclusion.
 *
 * Pure and unwired. It writes nothing (no journal band is touched) and registers no RPC, hook or timer.
 */
import { z } from "zod";
import { SupervisionHash } from "../shared/supervision";
import { SupervisionError } from "./supervision-store";

/** The S00 capability-table rows each strong capability rests on, copied from the frozen S00 fixture
 * (`test/fixtures/supervision-s00/examples.json`; a test holds them equal). Columns are the 0.11 floor, the
 * packaged 0.12 proposal and the 0.13 disk source S00 inspected. None was live-qualified. */
export const S00_STRONG_ROWS = {
  "authenticated-admission": { floor011: "unsupported", proposal012: "unsupported", disk013: "unsupported" },
  "send-receipt": { floor011: "unsupported", proposal012: "unsupported", disk013: "unsupported" },
  "finish-transfer": { floor011: "unsupported", proposal012: "unsupported", disk013: "unsupported" },
  "heartbeat-owner": { floor011: "unsupported", proposal012: "unsupported", disk013: "unsupported" },
  "conditional-archive": { floor011: "unsupported", proposal012: "unsupported", disk013: "unsupported" },
} as const satisfies Record<string, Record<S00Column, S00Support>>;
export type S00Support = "source-supported" | "unsupported" | "unqualified";
export type S00Column = "floor011" | "proposal012" | "disk013";
export type S00Row = keyof typeof S00_STRONG_ROWS;

/** Each strong capability, the upstream primitive it consumes and the S00 rows that must all be supported. */
export const STRONG_CAPABILITIES = [
  { id: "authenticated-caller", upstream: "U1", rows: ["authenticated-admission"],
    contract: "admitEffect(authenticatedCaller, scopeId, epoch, …) checks a trusted caller at the receiver, never caller-supplied JSON" },
  { id: "receiver-fence", upstream: "U1", rows: ["authenticated-admission", "send-receipt"],
    contract: "admitEffect/getEffect: persistent admitted|rejected|uncertain receipt; a delayed old fence is rejected at the linearization point" },
  { id: "durable-subscriptions", upstream: "U2", rows: ["finish-transfer"],
    contract: "subscription.transfer(id, expectedOwner, newOwner, expectedVersion, replayAfter) with list/cancel/replay" },
  { id: "heartbeat-transfer", upstream: "U2", rows: ["heartbeat-owner"],
    contract: "heartbeat owner inventory and atomic transfer" },
  { id: "conditional-archive", upstream: "U3", rows: ["conditional-archive"],
    contract: "archiveIfUnchanged(agentId, expectedInventoryVersion, expectedDescendants, retainedWorkspacePolicy)" },
] as const satisfies readonly { id: string; upstream: "U1" | "U2" | "U3"; rows: readonly S00Row[]; contract: string }[];
export type StrongCapability = (typeof STRONG_CAPABILITIES)[number]["id"];
export const StrongCapabilityId = z.enum(STRONG_CAPABILITIES.map(c => c.id) as [StrongCapability, ...StrongCapability[]]);

/** What the cooperative mode does not provide. Stated wherever the mode is reported; never softened. */
export const COOPERATIVE_LIMITS = [
  "Cooperative only: the plugin refuses stale commands at its own boundary; full-access sessions can bypass it through native tools, the CLI or a shell.",
  "No strong isolation: no authenticated caller channel, no receiver fence and no raw-capability confinement (U1 not delivered).",
  "No automatic failover or takeover: a supervisor is replaced only manually, after its exact predecessor is shown stopped.",
  "No durable callback or heartbeat transfer (U2 not delivered): legacy callbacks are drained or held with their original owner, never re-prompted.",
  "No conditional archive (U3 not delivered): archive needs a complete persisted inventory and still has a last-check race; incomplete ancestry refuses.",
  "Reservations are advisory: receivers do not check fences, so an advisory lock is never presented as enforced.",
] as const;
/** Even with every primitive, a full-access session is confined only by OS/credential isolation this plugin cannot provide. */
export const STRONG_LIMIT = "No full-access confinement is claimed: raw native, CLI and shell access is constrained only by OS/credential isolation outside this plugin.";

const semver = z.string().regex(/^\d+\.\d+\.\d+$/);
/** Evidence that one strong capability exists on a real receiver. A synthetic fixture never qualifies. */
export const StrongQualificationSchema = z.object({
  format: z.literal("firstmate.strong-qualification/1"),
  capability: StrongCapabilityId,
  /** The published, public signature consumed. A private protocol message is not a contract. */
  publicContract: z.object({ package: z.string().min(1).max(200), version: semver, signature: z.string().min(1).max(1024) }).strict(),
  /** The installed daemon/app versions the evidence covers, inclusive. Nothing is borrowed from a newer document. */
  supported: z.object({ min: semver, max: semver }).strict(),
  /** Actual receiver canaries (A18): denial of a delayed old fence, replay, the bypass analysis and so on. */
  receiverEvidence: z.array(z.object({ kind: z.enum(["receiver-canary", "bypass-analysis", "replay", "race"]), ref: z.string().min(1).max(1024),
    digest: SupervisionHash }).strict()).min(1).max(32)
    .refine(e => e.some(x => x.kind === "receiver-canary") && e.some(x => x.kind === "bypass-analysis"),
      "A receiver canary and a raw-tool/CLI/shell bypass analysis are both required."),
  qualification: z.literal("live-receiver"),
}).strict();
export type StrongQualification = z.infer<typeof StrongQualificationSchema>;
/** None. U1–U3 are not delivered; this build qualifies no strong capability. */
export const SHIPPED_QUALIFICATIONS: readonly StrongQualification[] = [];

const parseVersion = (v: string) => { const m = /^(\d+)\.(\d+)\.(\d+)/.exec(v); return m ? [Number(m[1]), Number(m[2]), Number(m[3])] as const : null; };
const compare = (a: readonly number[], b: readonly number[]) => a[0]! - b[0]! || a[1]! - b[1]! || a[2]! - b[2]!;
/** The S00 column that describes an installed version. A version S00 did not inspect has none: unqualified. */
export function s00Column(installed: string): S00Column | null {
  const v = parseVersion(installed);
  if (!v || v[0] !== 0) return null;
  return v[1] === 11 ? "floor011" : v[1] === 12 ? "proposal012" : v[1] === 13 ? "disk013" : null;
}

export interface CapabilityRequest {
  /** The installed daemon version, read fresh. Unknown means nothing strong can be enabled. */
  installedVersion: string | null;
  /** Per-capability flags. All off by default. */
  flags: readonly string[];
  qualifications?: readonly unknown[];
  /** A later S00 re-probe's rows. Defaults to the frozen S00 table; nothing at runtime supplies another. */
  s00?: Readonly<Record<S00Row, Readonly<Record<S00Column, S00Support>>>>;
}
export interface CapabilityVerdict {
  id: StrongCapability; upstream: "U1" | "U2" | "U3"; requested: boolean;
  state: "off" | "enabled" | "refused"; reasons: string[];
}
export interface CapabilityReport {
  format: "firstmate.strong-capabilities/1"; installedVersion: string | null;
  /** `strong` only when every capability is enabled; anything less is cooperative, said plainly. */
  mode: "cooperative" | "strong"; capabilities: CapabilityVerdict[]; limits: readonly string[]; problems: string[];
  /** Explicit claims. Each is true only when its capabilities are all enabled. */
  claims: { authenticatedCallers: boolean; receiverExclusion: boolean; automaticFailover: boolean; automaticTakeover: boolean; conditionalArchive: boolean; fullAccessConfinement: false };
}

/** Evaluate every strong capability. Pure. An unknown flag or a malformed qualification is reported, never used. */
export function evaluateStrongCapabilities(request: CapabilityRequest): CapabilityReport {
  const table: Readonly<Record<S00Row, Readonly<Record<S00Column, S00Support>>>> = request.s00 ?? S00_STRONG_ROWS;
  const column = request.installedVersion ? s00Column(request.installedVersion) : null;
  const installed = request.installedVersion ? parseVersion(request.installedVersion) : null;
  const qualifications = (request.qualifications ?? SHIPPED_QUALIFICATIONS).flatMap(q => {
    const parsed = StrongQualificationSchema.safeParse(q);
    return parsed.success ? [parsed.data] : [];
  });
  const malformed = (request.qualifications ?? []).length - qualifications.length;
  const unknownFlags = request.flags.filter(f => !StrongCapabilityId.safeParse(f).success);
  const capabilities = STRONG_CAPABILITIES.map((c): CapabilityVerdict => {
    const requested = request.flags.includes(c.id), reasons: string[] = [];
    if (!installed) reasons.push("The installed Paseo version is unknown.");
    if (!column) reasons.push(`S00 did not inspect Paseo ${request.installedVersion ?? "(unknown)"}; nothing is borrowed from another version's source or documents.`);
    else for (const row of c.rows) if (table[row][column] !== "source-supported")
      reasons.push(`S00 row ${row} is ${table[row][column]} at ${request.installedVersion} (${c.upstream} not delivered).`);
    const own = qualifications.filter(q => q.capability === c.id);
    const fits = installed ? own.filter(q => compare(installed, parseVersion(q.supported.min)!) >= 0 && compare(installed, parseVersion(q.supported.max)!) <= 0) : [];
    if (!own.length) reasons.push(`No public contract with receiver evidence qualifies ${c.id} (${c.contract}).`);
    else if (!fits.length) reasons.push(`The ${c.id} qualification does not cover installed version ${request.installedVersion ?? "(unknown)"}.`);
    const qualified = reasons.length === 0;
    return { id: c.id, upstream: c.upstream, requested, state: !requested ? "off" : qualified ? "enabled" : "refused", reasons };
  });
  const strong = capabilities.every(c => c.state === "enabled");
  const on = (id: StrongCapability) => capabilities.find(c => c.id === id)!.state === "enabled";
  const failover = on("authenticated-caller") && on("receiver-fence") && on("durable-subscriptions") && on("heartbeat-transfer");
  return { format: "firstmate.strong-capabilities/1", installedVersion: request.installedVersion,
    mode: strong ? "strong" : "cooperative", capabilities, limits: strong ? [STRONG_LIMIT] : COOPERATIVE_LIMITS,
    problems: [...(unknownFlags.length ? [`Unknown capability flag(s) ignored: ${unknownFlags.join(", ")}.`] : []),
      ...(malformed > 0 ? [`${malformed} qualification record(s) are malformed and ignored.`] : [])],
    claims: { authenticatedCallers: on("authenticated-caller"), receiverExclusion: on("receiver-fence"), automaticFailover: failover,
      automaticTakeover: failover, conditionalArchive: on("conditional-archive"), fullAccessConfinement: false } };
}

/** Use a strong capability or refuse. A refusal is final for that call: there is no cooperative fallback. */
export function requireStrong(report: CapabilityReport, id: StrongCapability): void {
  const verdict = report.capabilities.find(c => c.id === id)!;
  if (verdict.state !== "enabled") throw new SupervisionError("UNSUPPORTED",
    `Strong capability ${id} is ${verdict.state === "off" ? "not enabled" : "refused"}; nothing falls back to cooperative mode. ${verdict.reasons.join(" ")}`.trim().slice(0, 1024));
}

/** `FIRSTMATE_STRONG_CAPABILITIES`: a comma list of capability ids. Empty by default. Nothing reads it yet. */
export function strongFlags(env: Record<string, string | undefined> = process.env): string[] {
  return (env.FIRSTMATE_STRONG_CAPABILITIES ?? "").split(",").map(s => s.trim()).filter(Boolean);
}

// ---------------------------------------------------------------------------------------------------------------
// The S10 maintenance executor's approval conditions (R10 round 3). No executor ships; this states what an
// approval needs and refuses until each condition has its evidence.

export const EXECUTOR_CONDITIONS = [
  { id: "realpath", source: "R10 B1-R", met: "code", detail: "Symlink and junction aliases resolved before planning (`resolveCleanupAliases`)." },
  { id: "E1", source: "R10 round 3", met: "code", detail: "A retained filesystem root (`/`, `C:\\`) contains every path on it." },
  { id: "E2", source: "R10 round 3", met: "code", detail: "`\\\\?\\C:\\…` is canonicalised; other `\\\\?\\`/`\\\\.\\` forms and mid-path drive segments refuse the pass." },
  { id: "E3", source: "R10 round 3", met: "code", detail: "Path-like `retained` entries that are not absolute and canonical are refused at job definition." },
  { id: "live-readers", source: "R10 live-daemon readers", met: "evidence", detail: "`retainedWorkspaces()` and `nativeSchedules()` exercised through the plugin channel on a throwaway daemon of the installed version." },
  { id: "N7", source: "R10 N7", met: "gate", detail: "Duplicate-cleaner detection without a declared timer link stays a decision at the advisory-activation gate." },
  { id: "receiver", source: "S11 conservative", met: "gate", detail: "Advisory reservations are not receiver-enforced; an executor runs cooperatively and claims no exclusion." },
] as const;
export const ReaderEvidenceSchema = z.object({
  daemonVersion: semver, ref: z.string().min(1).max(1024), digest: SupervisionHash,
  readers: z.object({ retainedWorkspaces: z.enum(["complete", "refused"]), nativeSchedules: z.enum(["complete", "incomplete"]) }).strict(),
}).strict();
export interface ExecutorApproval { approved: boolean; conditions: { id: string; satisfied: boolean; detail: string }[] }
/** Whether a maintenance executor may be approved. Reader evidence must be for the installed version; N7 and the
 * cooperative receiver limit need the captain's explicit acknowledgement at the advisory gate. */
export function executorApproval(input: { installedVersion: string | null; readerEvidence?: unknown; acknowledged?: readonly string[] }): ExecutorApproval {
  const evidence = ReaderEvidenceSchema.safeParse(input.readerEvidence);
  const readers = evidence.success && evidence.data.daemonVersion === input.installedVersion && evidence.data.readers.retainedWorkspaces === "complete"
    && evidence.data.readers.nativeSchedules === "complete";
  const conditions = EXECUTOR_CONDITIONS.map(c => ({ id: c.id, detail: c.detail,
    satisfied: c.met === "code" ? true : c.met === "evidence" ? readers : (input.acknowledged ?? []).includes(c.id) }));
  return { approved: conditions.every(c => c.satisfied), conditions };
}
