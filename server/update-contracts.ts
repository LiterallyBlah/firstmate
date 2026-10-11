/** Fields read from the installed Paseo 0.11 CLI's plugin ls/update --check JSON.
 * Projected from protocol/messages.js: protocol is dev-only and cannot be imported by a shipped plugin.
 * Missing/unsupported identity data fails closed rather than falling back to another source.
 */
import { z } from "zod";

const Registry = z.object({ url: z.string().url(), id: z.string() });
const Identity = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("directory"), path: z.string() }),
  z.object({
    kind: z.literal("git"),
    remote: z.string(),
    pluginPath: z.string(),
    registry: Registry.optional(),
  }),
  z.object({
    kind: z.literal("npm"),
    packageName: z.string(),
    pluginPath: z.string(),
    registry: Registry.optional(),
  }),
]);
const Installation = z.object({
  identity: Identity,
  currentRevision: z.string().optional(),
});
export const PluginListItemSchema = z.object({
  id: z.string(),
  path: z.string(),
  status: z.enum(["running", "disabled", "failed"]),
  installation: Installation.optional(),
  ref: z.string().optional(),
  npm: z.object({ requestedSpec: z.string() }).optional(),
});
export const PluginUpdatePreviewSchema = z.object({
  id: z.string(),
  outcome: z.enum(["update", "current", "installed-newer", "local", "error"]),
  current: Installation.optional(),
  target: z
    .discriminatedUnion("kind", [
      z.object({
        kind: z.literal("git"),
        commit: z.string().regex(/^[0-9a-f]{40,64}$/),
      }),
      z.object({
        kind: z.literal("npm"),
        version: z.string().min(1),
        resolved: z.string().url(),
        integrity: z.string().min(1),
      }),
    ])
    .optional(),
});
