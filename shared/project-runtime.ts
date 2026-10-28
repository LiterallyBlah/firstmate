import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";
import { SupervisionHash, SupervisionUuid, SupervisionVersionRefSchema } from "./supervision";
import { PolicySourceSchema } from "./supervision-policy";
import { AgentProfileSchema } from "./supervision-effects";
import { MemoryKey } from "./supervision-projects";
const count = z.number().int().min(0).max(1_000_000);
const Budget = z.object({ agents: count, turns: count }).strict();
export const ProjectAdminSchema = z.discriminatedUnion("op", [
  z.object({ op: z.literal("admit"), registryDigest: SupervisionHash, name: z.string().min(1).max(200), aliases: z.array(z.string().min(1).max(200)).max(16),
    source: PolicySourceSchema, budget: Budget, profile: AgentProfileSchema,
    limits: z.object({ supervisorSessions: count.min(1), supervisorTurns: count.min(1) }).strict() }).strict(),
  z.object({ op: z.literal("project"), projectId: SupervisionUuid, expectedVersion: count, state: z.enum(["admitted", "stopped"]), aliases: z.array(z.string().min(1).max(200)).max(16).optional(), budget: Budget.nullable(), sourceVector: z.array(SupervisionVersionRefSchema).min(1).max(64) }).strict(),
  z.object({ op: z.literal("sponsor"), planScopeId: SupervisionUuid, expectedVersion: count, sponsorScopeId: SupervisionUuid.nullable(),
    claims: z.array(z.object({ projectId: SupervisionUuid, agents: count, turns: count, priority: count.min(1).max(9) }).strict()).min(1).max(64) }).strict(),
  z.object({ op: z.literal("release-sponsor"), planScopeId: SupervisionUuid, expectedVersion: count }).strict(),
  z.object({ op: z.literal("promote"), projectId: SupervisionUuid }).strict(),
  z.object({ op: z.literal("intake"), intakeId: z.string().min(1).max(300), textDigest: SupervisionHash, ownerScopeId: SupervisionUuid,
    projectIds: z.array(SupervisionUuid).min(1).max(64), tasks: z.array(z.object({ hostId: z.string().min(1).max(256), projectId: SupervisionUuid, nodeId: z.string().min(1).max(64) }).strict()).max(100) }).strict(),
  z.object({ op: z.literal("resolve-conflict"), conflictId: SupervisionUuid, expectedVersion: count, choice: z.string().min(1).max(2000) }).strict(),
  z.object({ op: z.literal("resolve-dependencies"), planScopeId: SupervisionUuid, planId: z.string().min(1).max(64) }).strict(),
  z.object({ op: z.literal("memory-propose"), projectId: SupervisionUuid, key: MemoryKey, expectedVersion: count, text: z.string().min(1).max(16384),
    evidence: z.array(z.object({ ref: z.string().min(1).max(1024), digest: SupervisionHash }).strict()).max(32) }).strict(),
  z.object({ op: z.literal("memory-decide"), proposalId: SupervisionUuid, proposalVersion: count.min(1), decision: z.enum(["accept", "reject"]), memoryVersion: count }).strict(),
]);
export type ProjectAdmin = z.infer<typeof ProjectAdminSchema>;
const PlanAssociation = z.object({ id: z.string(), title: z.string(), backend: z.enum(["legacy", "scoped"]),
  state: z.string(), projectIds: z.array(SupervisionUuid), sponsorScopeId: SupervisionUuid.nullable(), ownerScopeId: SupervisionUuid.nullable() }).strict();
export const ProjectRuntimeSnapshotSchema = z.object({ enabled: z.boolean(), homeId: z.string(), registryDigest: SupervisionHash.nullable(),
  sequence: count, hash: SupervisionHash.nullable(), freshness: z.string(), problems: z.array(z.string()),
  general: z.object({ agentId: z.string().nullable(), scopeId: SupervisionUuid.nullable(), headroom: count, slots: count,
    providerAvailability: z.literal("unknown") }).strict(),
  projects: z.array(z.object({ name: z.string(), projectId: SupervisionUuid.nullable(), scopeId: SupervisionUuid.nullable(), hostId: z.string().nullable(),
    directory: z.string().nullable(), state: z.string(), reason: z.string().nullable(), version: count, aliases: z.array(z.string()),
    agentId: z.string().nullable(), workspaceId: z.string().nullable(), provisionRequestId: SupervisionUuid.nullable(),
    sessions: count, turns: count, uncertain: count, memoryPending: count, profile: AgentProfileSchema.nullable(),
    limits: z.object({ supervisorSessions: count, supervisorTurns: count }).strict().nullable(), plans: z.array(PlanAssociation) }).strict()),
}).strict();
export type ProjectRuntimeSnapshot = z.infer<typeof ProjectRuntimeSnapshotSchema>;
export const readProjectRuntime = defineRpc({ name: "firstmate.projects.read", input: z.object({}).strict(), output: ProjectRuntimeSnapshotSchema });
/** Same-user role convention, as workflow requests. Never authenticated caller identity or Attach. */
export const administerProject = defineRpc({ name: "firstmate.projects.admin", input: z.object({ homeId: z.string(), requestId: SupervisionUuid, actorId: z.string().min(1), command: ProjectAdminSchema }).strict(), output: ProjectRuntimeSnapshotSchema });
export const provisionProjectFromUi = defineRpc({ name: "firstmate.projects.provision-ui", input: z.object({ homeId: z.string(), requestId: SupervisionUuid,
  projectId: SupervisionUuid, projectVersion: count.min(1) }).strict(), output: ProjectRuntimeSnapshotSchema });
export const readProjectMemory = defineRpc({ name: "firstmate.projects.memory", input: z.object({ homeId: z.string(), projectId: SupervisionUuid }).strict(),
  output: z.object({ projectId: SupervisionUuid, scopeId: SupervisionUuid, name: z.string(), aliases: z.array(z.string()), authority: z.literal("none"),
    conventions: z.array(z.object({ path: z.string(), digest: SupervisionHash, text: z.string(), authority: z.literal("none") }).strict()),
    proposals: z.array(z.object({ id: SupervisionUuid, version: count, key: z.string(), expectedVersion: count, digest: SupervisionHash, text: z.string() }).strict()),
    memory: z.array(z.object({ key: z.string(), version: count, digest: SupervisionHash, text: z.string(), authority: z.literal("none") }).strict()) }).strict() });
