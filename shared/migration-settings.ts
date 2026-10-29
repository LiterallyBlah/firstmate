/** App-only snapshot configuration. Saving grants no handover or Attach authority. */
import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";
export const MigrationBackupSchema = z.object({ destination: z.string().trim().min(1).max(2048), retention: z.string().trim().min(1).max(2048) }).strict();
export const MigrationSettingsInputSchema = z.object({ homeId: z.string(), expectedRevision: z.number().int().nonnegative(), requestId: z.uuid(), backup: MigrationBackupSchema }).strict();
export type MigrationSettingsInput = z.infer<typeof MigrationSettingsInputSchema>;
export const MigrationSettingsSnapshotSchema = z.object({ homeId: z.string(), revision: z.number().int().nonnegative(),
  // Retain invalid/partial legacy configuration so the app can explain and correct it.
  backup: z.object({ destination: z.string().max(2048), retention: z.string().max(2048) }).strict().nullable(), source: z.enum(["default", "legacy-environment", "saved"]),
  requestId: z.uuid().nullable(), problems: z.array(z.string()) }).strict();
export type MigrationSettingsSnapshot = z.infer<typeof MigrationSettingsSnapshotSchema>;
export const readMigrationSettings = defineRpc({ name: "firstmate.supervision.backup.read", input: z.object({ homeId: z.string() }).strict(), output: MigrationSettingsSnapshotSchema });
export const setMigrationSettings = defineRpc({ name: "firstmate.supervision.backup.set", input: MigrationSettingsInputSchema, output: MigrationSettingsSnapshotSchema });
