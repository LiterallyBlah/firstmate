/** App-only single-project review. No actor/role assertion, Attach or batch transport. */
import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";
import { SupervisionHash, SupervisionUuid } from "./supervision";
import { AgentProfileSchema } from "./supervision-effects";
import { ProjectRuntimeSnapshotSchema } from "./project-runtime";
import { ProjectSetupInputSchema } from "./supervision-policy";

const count = z.number().int().min(1).max(1_000_000);
export const ProjectSetupChoicesSchema = z.object({
  homeId: z.string(), name: z.string().min(1).max(200),
  sourcePath: z.string().min(1).max(1024).nullable(),
  profile: AgentProfileSchema.nullable(),
  budget: z.object({ agents: count, turns: count }).strict().nullable(),
  limits: z.object({ supervisorSessions: z.literal(1), supervisorTurns: count }).strict().nullable(),
}).strict();
export type ProjectSetupChoices = z.infer<typeof ProjectSetupChoicesSchema>;
export const ProjectSetupCatalogSchema = z.object({
  snapshot: ProjectRuntimeSnapshotSchema,
  models: z.array(z.object({ provider: z.string(), label: z.string(), modes: z.array(z.object({ id: z.string(), label: z.string() }).strict()),
    thinking: z.array(z.object({ id: z.string(), label: z.string() }).strict()) }).strict()),
  sources: z.array(z.object({ path: z.string(), text: z.string(), problem: z.string().nullable() }).strict()),
  problems: z.array(z.string()),
  reviewed: z.array(ProjectSetupChoicesSchema),
  folderIssues: z.array(z.object({ name: z.string(), location: z.string(), rowDigest: SupervisionHash, canReplace: z.boolean() }).strict()).default([]),
}).strict();
export type ProjectSetupCatalog = z.infer<typeof ProjectSetupCatalogSchema>;
export const ProjectSetupPreviewSchema = z.object({
  choices: ProjectSetupChoicesSchema, review: ProjectSetupInputSchema.shape.review.nullable(), reviewDigest: SupervisionHash.nullable(),
  reasons: z.array(z.string()),
}).strict();
export type ProjectSetupPreview = z.infer<typeof ProjectSetupPreviewSchema>;
export const readProjectSetup = defineRpc({ name: "firstmate.projects.setup.read", input: z.object({ homeId: z.string() }).strict(), output: ProjectSetupCatalogSchema });
export const previewProjectSetup = defineRpc({ name: "firstmate.projects.setup.preview", input: ProjectSetupChoicesSchema, output: ProjectSetupPreviewSchema });
export const commitProjectSetup = defineRpc({ name: "firstmate.projects.setup.commit", input: ProjectSetupInputSchema, output: ProjectRuntimeSnapshotSchema });
export const ProjectSetupStatusSchema = z.object({ snapshot: ProjectRuntimeSnapshotSchema, requests: z.array(ProjectSetupInputSchema),
  recoverableCreates: z.array(SupervisionUuid).default([]) }).strict();
export const readSavedProjectSetup = defineRpc({ name: "firstmate.projects.setup.status", input: z.object({ homeId: z.string() }).strict(), output: ProjectSetupStatusSchema });
export const resumeProjectSetup = defineRpc({ name: "firstmate.projects.setup.resume", input: z.object({ homeId: z.string(), requestId: SupervisionUuid }).strict(), output: ProjectRuntimeSnapshotSchema });
export const ProjectSetupFolderSchema = z.object({ homeId: z.string(), registryDigest: SupervisionHash,
  name: z.string().min(1),
  replace: z.object({ location: z.string().min(1), rowDigest: SupervisionHash }).strict().optional() }).strict()
  // Repairs retain the exact registry name; the server binds it to the checked row.
  // Only additions choose a new name and use the narrower new-name policy.
  .refine(input => input.replace !== undefined || /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,99}$/.test(input.name),
    { path: ["name"], message: "Use 1–100 letters, numbers, dots, underscores or hyphens, starting with a letter or number." });
export const addProjectSetupFolder = defineRpc({ name: "firstmate.projects.setup.folder", input: ProjectSetupFolderSchema, output: ProjectRuntimeSnapshotSchema });
export const ProjectSetupInstructionsSchema = z.object({ homeId: z.string(), requestId: SupervisionUuid,
  registryDigest: SupervisionHash, name: z.string().min(1).max(200), text: z.string().trim().min(1).max(32000) }).strict();
export const saveProjectSetupInstructions = defineRpc({ name: "firstmate.projects.setup.instructions", input: ProjectSetupInstructionsSchema, output: z.object({ path: z.string() }).strict() });
