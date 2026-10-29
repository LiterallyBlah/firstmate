/** Additive rules: historical plan/1 definitions and their hashes remain unchanged. */
import { z } from "zod";

const text = z.string().trim().min(1).max(2048);
const hash = z.string().regex(/^[0-9a-f]{64}$/);
const id = z.string().uuid();
const count = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const artifact = z.object({ digest: hash, verifier: text, method: z.enum(["automatic", "model", "human"]), provenance: text }).strict();
const notApplicable = z.object({ applies: z.literal(false), reason: text }).strict();
const applicable = <T extends z.ZodRawShape>(shape: T) => z.union([notApplicable, z.object({ applies: z.literal(true), ...shape }).strict()]);
export const RuleNodeSchema = z.object({
  nodeId: text,
  checks: z.array(z.object({ id: text, command: text, passCriterion: text }).strict()).min(1).max(32),
  design: applicable({ baseline: artifact, captures: z.array(z.object({ viewport: text, state: text }).strict()).min(1).max(32) }),
  performance: applicable({ metric: text, unit: text, threshold: z.number().finite(), comparison: z.enum(["at-most", "at-least"]), workload: text, environment: text }),
  longRun: applicable({ sessions: count.min(1), turns: count.min(1), runtimeMs: count.min(1), deadline: z.iso.datetime(), spend: count.min(1), spendUnit: text }),
  heavyTests: applicable({ suite: text, inputs: hash, dependencyLock: hash, toolchain: text, platform: text, fixtures: hash,
    baseline: artifact, restore: text, verifyIsolation: text }),
}).strict().refine(n => new Set(n.checks.map(c => c.id)).size === n.checks.length, "Duplicate check identity");
export const PlanRuleRecordSchema = z.object({
  format: z.literal("firstmate.plan-rules/1"), id, version: count.min(1), homeId: text, scopeId: id, planId: text,
  revision: count.min(1), sources: z.array(z.object({ kind: z.literal("policy-source"), id, version: count.min(1), digest: hash }).strict()).min(1).max(32),
  supervisorLimits: z.object({ sessions: count.min(1).max(1000), turns: count.min(1).max(100000) }).strict(),
  nodes: z.array(RuleNodeSchema).min(1).max(100),
}).strict().refine(r => new Set(r.nodes.map(n => n.nodeId)).size === r.nodes.length, "Duplicate rule node");
export const PlanRuleRefSchema = z.object({ id, version: count.min(1), digest: hash }).strict();
export const RuleVerificationSchema = z.object({
  format: z.literal("firstmate.rule-verification/1"), id, version: z.literal(1), homeId: text, scopeId: id, planId: text, nodeId: text,
  revision: count.min(1), rules: PlanRuleRefSchema, attemptId: id, head: z.string().regex(/^[0-9a-f]{40,64}$/),
  buildInputs: hash, at: z.iso.datetime(), verifierId: text, workerId: text,
  checks: z.array(z.object({ id: text, command: text, result: z.enum(["passed", "failed", "unknown"]), artifact }).strict()).max(32),
  regressions: z.array(z.object({ failureId: id, caseId: text, reproducedFailure: artifact, fixedResult: z.enum(["passed", "failed", "unknown"]), fixedArtifact: artifact }).strict()).max(64),
  design: z.object({ baseline: hash, captures: z.array(z.object({ viewport: text, state: text, artifact }).strict()).max(32), verdict: z.enum(["passed", "failed", "unknown"]), comparison: artifact }).strict().nullable(),
  performance: z.object({ metric: text, unit: text, workload: text, environment: text, measured: z.number().finite().nullable(), artifact }).strict().nullable(),
  blocker: z.object({ category: text, description: text, evidence: artifact, correctiveNode: text.nullable(), disposition: artifact.nullable() }).strict(),
  budget: z.object({ startedAt: z.iso.datetime(), consumedSessions: count, consumedTurns: count, consumedMs: count, consumedSpend: count, remainingSessions: count, remainingTurns: count, remainingMs: count, remainingSpend: count, artifact }).strict().nullable(),
  snapshot: z.object({ key: hash, baseline: hash, isolated: z.literal(true), clean: z.literal(true), verified: z.literal(true), restoredForAttempt: id,
    provenance: artifact, reused: z.boolean(), setupMs: count, result: z.enum(["passed", "failed", "unknown"]), resultArtifact: artifact }).strict().nullable(),
}).strict();
export const RuleFailureSchema = z.object({ format: z.literal("firstmate.rule-failure/1"), id, version: z.literal(1), homeId: text,
  scopeId: id, planId: text, nodeId: text, attemptId: id, head: z.string().regex(/^[0-9a-f]{40,64}$/).nullable(), at: z.iso.datetime(),
  category: text, description: text, evidence: artifact, caseId: text.nullable(), reproduction: artifact.nullable(),
}).strict();
export const RuleViolationSchema = z.object({ format: z.literal("firstmate.rule-violation/1"), id, version: z.literal(1), homeId: text,
  scopeId: id, planId: text, nodeId: text, attemptId: id.nullable(), stage: z.enum(["dispatch", "completion"]),
  subjectHash: hash, rules: PlanRuleRefSchema.nullable(), conditions: z.array(text).min(1).max(64), at: z.iso.datetime(),
}).strict();
export type PlanRuleRecord = z.infer<typeof PlanRuleRecordSchema>;
export type RuleVerification = z.infer<typeof RuleVerificationSchema>;
export type RuleFailure = z.infer<typeof RuleFailureSchema>;
export type RuleViolation = z.infer<typeof RuleViolationSchema>;
export type PlanRuleRef = z.infer<typeof PlanRuleRefSchema>;
