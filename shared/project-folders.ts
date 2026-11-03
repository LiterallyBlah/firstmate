/** "Add project": app-only folder mapping into the project list. No admission, actor/role assertion, session or work. */
import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";
import { SupervisionHash } from "./supervision";
import { ProjectRuntimeSnapshotSchema } from "./project-runtime";

export const ProjectFolderSchema = z.object({ homeId: z.string(), registryDigest: SupervisionHash,
  name: z.string().min(1),
  replace: z.object({ location: z.string().min(1), rowDigest: SupervisionHash }).strict().optional() }).strict()
  // Repairs retain the exact registry name; the server binds it to the checked row.
  // Only additions choose a new name and use the narrower new-name policy.
  .refine(input => input.replace !== undefined || /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,99}$/.test(input.name),
    { path: ["name"], message: "Use 1–100 letters, numbers, dots, underscores or hyphens, starting with a letter or number." });
export const addProjectFolder = defineRpc({ name: "firstmate.projects.folder", input: ProjectFolderSchema, output: ProjectRuntimeSnapshotSchema });
