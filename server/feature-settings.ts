/** Immutable policy revisions, separate from both the display document and supervision journal.
 * The runtime resolves live authority separately; store reads remain inert. */
import { mkdir, readFile, readdir } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";
import { z } from "zod";
import { DEFAULT_FEATURE_CAPACITY, FEATURE_CAPABILITIES, FEATURES_OFF, FeatureCapacitySchema,
  FeaturePolicySchema, FeaturePolicySnapshotSchema, FeatureSetInputSchema, FeatureSetResultSchema,
  type FeatureCapabilities, type FeatureCapacity, type FeaturePolicySnapshot, type FeatureSetInput,
  type FeatureSetResult } from "../shared/feature-settings";
import { canonical, digest, publish } from "./submissions";
import { serialized } from "./serialize";
import { workflowHomeIdentity } from "./workflow-ownership";

const ENV_KEYS = { projectMates: "FIRSTMATE_PROJECT_MATES", planSupervisors: "FIRSTMATE_PLAN_SUPERVISORS",
  scopedActivation: "FIRSTMATE_SCOPED_ACTIVATION", scopeUi: "FIRSTMATE_SCOPE_UI",
  scopeExecution: "FIRSTMATE_SCOPE_EXECUTION", maintenance: "FIRSTMATE_MAINTENANCE" } as const;
export interface LegacyFeatureSettings { homeId: string; requested: FeatureCapabilities; capacity: FeatureCapacity | null;
  present: boolean; problems: string[] }
/** Capture once for the original configured home. Switching home cannot copy a pilot opt-in. */
export function legacyFeatureSettings(home: string, env: NodeJS.ProcessEnv): LegacyFeatureSettings {
  const requested = Object.fromEntries(FEATURE_CAPABILITIES.map(k => [k, env[ENV_KEYS[k]] === "1"])) as FeatureCapabilities;
  // Match the runtime's existing capacity selection exactly, including partial pilots.
  const capacity = FeatureCapacitySchema.safeParse(requested.projectMates || requested.planSupervisors ? {
    slots: Number(env.FIRSTMATE_PROJECT_SLOTS ?? DEFAULT_FEATURE_CAPACITY.slots),
    generalHeadroom: Number(env.FIRSTMATE_GENERAL_HEADROOM ?? DEFAULT_FEATURE_CAPACITY.generalHeadroom),
  } : DEFAULT_FEATURE_CAPACITY);
  return { homeId: workflowHomeIdentity(home), requested, capacity: capacity.success ? capacity.data : null,
    present: FEATURE_CAPABILITIES.some(k => env[ENV_KEYS[k]] !== undefined),
    problems: capacity.success ? [] : ["The existing capacity settings are invalid. Review capacity before saving."] };
}
const Hash = z.string().regex(/^[0-9a-f]{64}$/);
const Identity = z.object({ format: z.literal("firstmate.feature-policy-home/1"), homeId: z.string() }).strict();
const Revision = z.object({ format: z.literal("firstmate.feature-policy-revision/1"), previous: Hash.nullable(),
  request: FeatureSetInputSchema, requestHash: Hash, result: FeatureSetResultSchema, hash: Hash }).strict();
type Revision = z.infer<typeof Revision>;
export class FeatureSettingsError extends Error {
  constructor(readonly code: "HELD" | "STALE" | "CONFLICT", message: string) { super(message); }
}
const held = () => new FeatureSettingsError("HELD", "Saved feature settings couldn't be checked. Review the saved records before changing them.");
const revisionName = (revision: number) => `${String(revision).padStart(16, "0")}.json`;

export class FeatureSettingsStore {
  readonly homeId: string;
  readonly directory: string;
  constructor(root: string, home: string, private readonly legacy?: LegacyFeatureSettings) {
    if (!isAbsolute(home)) throw new Error("Feature settings require an absolute home path.");
    this.homeId = workflowHomeIdentity(home);
    this.directory = join(resolve(root), "feature-settings", digest(this.homeId));
  }
  private async revisions(resumeHash?: string): Promise<Revision[] | null> {
    let names: string[];
    try { names = await readdir(this.directory); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw held(); }
    // A pre-publication crash must not turn a damaged or partly initialized store into defaults.
    if (!names.includes("identity.json") || names.some(n => !/^(identity|\d{16}(?:\.receipt)?)\.json(?:\.[\w-]+\.tmp)?$/.test(n))) throw held();
    try {
      const identity = Identity.parse(JSON.parse(await readFile(join(this.directory, "identity.json"), "utf8")));
      if (identity.homeId !== this.homeId) throw held();
      const files = names.filter(n => /^\d{16}\.json$/.test(n)).sort();
      if (!files.length) throw held();
      if (names.some(n => /^\d{16}\.receipt\.json$/.test(n) && !files.includes(n.replace(".receipt", "")))) throw held();
      const revisions: Revision[] = [], requests = new Set<string>();
      for (const [index, name] of files.entries()) {
        if (name !== revisionName(index + 1)) throw held();
        const bytes = await readFile(join(this.directory, name), "utf8");
        if (Buffer.byteLength(bytes) > 1024 * 1024) throw held();
        const revision = Revision.parse(JSON.parse(bytes)), { hash, ...body } = revision;
        const { request, result } = revision, policy = result.policy;
        if (digest(body) !== hash || revision.previous !== (revisions.at(-1)?.hash ?? null) ||
          request.home !== this.homeId || request.expectedRevision !== index || revision.requestHash !== digest(request) ||
          requests.has(request.requestId) || result.homeId !== this.homeId || result.requestId !== request.requestId ||
          policy.homeId !== this.homeId || policy.revision !== index + 1 || policy.updated.requestId !== request.requestId ||
          canonical({ requested: policy.requested, capacity: policy.capacity }) !== canonical(request.change)) throw held();
        // Retain an independent publication receipt: losing a published final revision cannot
        // silently resurrect an older opt-in. Coordinated loss of both copies is not detectable.
        const receipt = join(this.directory, name.replace(".json", ".receipt.json"));
        try {
          if (canonical(JSON.parse(await readFile(receipt, "utf8"))) !== canonical(revision)) throw held();
        } catch (error) {
          // An explicit exact retry may finish only the final validated, unpublished revision.
          // Reads never repair; altered/missing published history is never overwritten.
          if ((error as NodeJS.ErrnoException).code !== "ENOENT" || index !== files.length - 1 || revision.requestHash !== resumeHash) throw held();
          try { await publish(receipt, revision); }
          catch (race) { if ((race as NodeJS.ErrnoException).code !== "EEXIST") throw race; }
          if (canonical(JSON.parse(await readFile(receipt, "utf8"))) !== canonical(revision)) throw held();
        }
        requests.add(request.requestId); revisions.push(revision);
      }
      return revisions;
    } catch { throw held(); }
  }
  async read(): Promise<FeaturePolicySnapshot> {
    try {
      const revisions = await this.revisions(), policy = revisions?.at(-1)?.result.policy ?? null;
      const legacy = this.legacy?.homeId === this.homeId ? this.legacy : undefined;
      const requested = policy?.requested ?? legacy?.requested ?? { ...FEATURES_OFF };
      const capacity = policy?.capacity ?? legacy?.capacity ?? (legacy?.problems.length ? null : { ...DEFAULT_FEATURE_CAPACITY });
      const problems = policy ? [] : legacy?.problems ?? [];
      return FeaturePolicySnapshotSchema.parse({ homeId: this.homeId, revision: policy?.revision ?? 0,
        source: policy ? "saved" : legacy?.present ? "legacy-environment" : "default", state: problems.length ? "held" : "ready",
        requested, effective: problems.length ? { ...FEATURES_OFF } : requested, capacity, policy, problems,
        dependencyRefusals: FEATURE_CAPABILITIES.filter(k => requested[k]).map(capability => ({ capability,
          code: problems.length ? "POLICY_HELD" : "RUNTIME_ENFORCEMENT_UNAVAILABLE",
          reason: problems.length ? problems.join(" ") : "In-app feature changes are not available yet. Your existing setup stays in use." })),
        runtimeEnforced: false, writesAvailable: false });
    } catch {
      return FeaturePolicySnapshotSchema.parse({ homeId: this.homeId, revision: null, source: "saved", state: "held",
        requested: { ...FEATURES_OFF }, effective: { ...FEATURES_OFF }, capacity: null, policy: null,
        problems: [held().message], dependencyRefusals: FEATURE_CAPABILITIES.map(capability => ({ capability,
          code: "POLICY_HELD", reason: held().message })), runtimeEnforced: false, writesAvailable: false });
    }
  }
  /** Immutable persistence seam; the app transport serializes saves with final effect claims. It writes no
   * source authority, session/owner identity, spend, strong qualification or supervision record. */
  async set(input: FeatureSetInput): Promise<FeatureSetResult> {
    const parsed = FeatureSetInputSchema.parse(input);
    if (!isAbsolute(parsed.home) || workflowHomeIdentity(parsed.home) !== this.homeId)
      throw new FeatureSettingsError("STALE", "FirstMate's home changed. Refresh before saving settings.");
    const request = { ...parsed, home: this.homeId }, requestHash = digest(request);
    return serialized(this.directory, async () => {
      const revisions = await this.revisions(requestHash);
      const retry = revisions?.find(r => r.request.requestId === request.requestId);
      if (retry) {
        if (retry.requestHash !== requestHash) throw new FeatureSettingsError("CONFLICT", "This saved request has different settings. Keep the original request or review a new change.");
        return retry.result;
      }
      const previous = revisions?.at(-1) ?? null, currentRevision = previous?.result.policy.revision ?? 0;
      if (request.expectedRevision !== currentRevision) throw new FeatureSettingsError("STALE", "Feature settings changed. Refresh and review them before saving.");
      if (currentRevision === Number.MAX_SAFE_INTEGER) throw held();
      const policy = FeaturePolicySchema.parse({ format: "firstmate.feature-policy/1", homeId: this.homeId,
        revision: currentRevision + 1, ...request.change, updated: { kind: "plugin-ui-unverified",
          source: "firstmate.features.set", requestId: request.requestId, at: new Date().toISOString() } });
      const result = FeatureSetResultSchema.parse({ homeId: this.homeId, requestId: request.requestId, policy });
      const body = { format: "firstmate.feature-policy-revision/1" as const, previous: previous?.hash ?? null, request, requestHash, result };
      await mkdir(this.directory, { recursive: true });
      if (!revisions) {
        try { await publish(join(this.directory, "identity.json"), { format: "firstmate.feature-policy-home/1", homeId: this.homeId }); }
        catch (error) {
          // A competing initializer owns publication. Re-read instead of assuming its identity/state.
          if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
          return this.setAfterRace(request, requestHash);
        }
      }
      try { await publish(join(this.directory, revisionName(policy.revision)), { ...body, hash: digest(body) }); }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
        return this.setAfterRace(request, requestHash);
      }
      await publish(join(this.directory, revisionName(policy.revision).replace(".json", ".receipt.json")), { ...body, hash: digest(body) });
      return result;
    });
  }
  private async setAfterRace(request: FeatureSetInput, requestHash: string): Promise<FeatureSetResult> {
    const revisions = await this.revisions(), retry = revisions?.find(r => r.request.requestId === request.requestId);
    if (retry?.requestHash === requestHash) return retry.result;
    throw new FeatureSettingsError(retry ? "CONFLICT" : "STALE", "Feature settings changed in another process. Check the saved request before continuing.");
  }
}
