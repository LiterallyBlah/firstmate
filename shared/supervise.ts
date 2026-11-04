/** The current first mate's (General's) Supervisor setup transport: plan-help handover, plan Attach
 * and project provisioning through the same server paths and checks as the captain's app buttons.
 * Request files are a same-user role convention, not authenticated IPC. Every command is refused by
 * the cooperative role check unless the named actor is the configured first mate, in an active turn;
 * crewmates and Supervisors are refused. Handover `abort`
 * and `resolve-hold` are not mate commands: they stay with the captain's app controls. */
import { z } from "zod";
import { AttachSupervisorInputSchema, MigrationCommandSchema } from "./supervision-activation";
import { MigrationBackupSchema } from "./migration-settings";
import { ProjectProvisionInputSchema } from "./supervision-policy";
import { SupervisionUuid } from "./supervision";
import { PlanId } from "./workflow-plans";

export { SUPERVISE_ACTOR_SOURCE, isSuperviseMateActor, isSuperviseOriginActor, superviseReplayEquivalent } from "./supervision";
export const SUPERVISE_PROVENANCE = "first mate tool (unverified)" as const;

export const SuperviseCommandSchema = z.discriminatedUnion("op", [
  z.object({ op: z.literal("plan-help"), plan: PlanId }).strict(),
  z.object({ op: z.literal("evidence"), plan: PlanId, folder: z.string().max(1024).default("data"),
    rollbackPath: z.string().min(1).max(900).optional() }).strict(),
  z.object({ op: z.literal("backup-read") }).strict(),
  z.object({ op: z.literal("backup-set"), expectedRevision: z.number().int().nonnegative(), backup: MigrationBackupSchema }).strict(),
  z.object({ op: z.literal("activation") }).strict(),
  z.object({ op: z.literal("migrate"), command: MigrationCommandSchema }).strict(),
  // The transport request id is the attach request id, and the server fills the home identity,
  // so a mate command carries exactly the reviewed attach fields and nothing else.
  z.object({ op: z.literal("attach"), attach: AttachSupervisorInputSchema.omit({ homeId: true, requestId: true }) }).strict(),
  z.object({ op: z.literal("attach-resume"), attachRequestId: SupervisionUuid }).strict(),
  z.object({ op: z.literal("project-provision"), provision: ProjectProvisionInputSchema.omit({ homeId: true, requestId: true }) }).strict(),
  // Resumes the project's recorded provisioning input exactly (its original request id), for an
  // interrupted setup whose supervise reply already reported the interruption.
  z.object({ op: z.literal("project-provision-resume"), projectId: SupervisionUuid }).strict(),
]);
export type SuperviseCommand = z.infer<typeof SuperviseCommandSchema>;

export const SuperviseRequestSchema = z.object({ id: z.uuid(), actor: z.string().min(1).max(256), command: SuperviseCommandSchema }).strict();
export type SuperviseRequest = z.infer<typeof SuperviseRequestSchema>;
