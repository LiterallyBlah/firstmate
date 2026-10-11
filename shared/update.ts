import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";

export const UPDATE_REFRESH_MS = 5 * 60_000;
export const UpdateStatusSchema = z.object({
  state: z.enum(["checking", "current", "available", "unavailable"]),
  explanation: z.string(),
  latest: z.string().optional(),
  token: z.string().optional(),
  requested: z.boolean().optional(),
});
export type UpdateStatus = z.infer<typeof UpdateStatusSchema>;

export const checkUpdate = defineRpc({
  name: "firstmate.update.check",
  input: z.object({}),
  output: UpdateStatusSchema,
});
export const requestUpdate = defineRpc({
  name: "firstmate.update.request",
  input: z.object({ token: z.string().min(1).max(64) }),
  output: z.object({
    status: UpdateStatusSchema,
    agentId: z.string().nullable(),
  }),
});
