import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";

const text = z.string().min(1).max(2048);
const port = z.number().int().min(1).max(65535).optional();
// Projection of Paseo 0.11's private @paseo:daemon-registry format. Unknown
// appearance/lifecycle fields are discarded, never copied into the daemon.
export const SavedConnection = z.discriminatedUnion("type", [
  z.object({ id: text, type: z.literal("directTcp"), endpoint: text, useTls: z.boolean().optional() }),
  z.object({ id: text, type: z.literal("directSocket"), path: text }),
  z.object({ id: text, type: z.literal("directPipe"), path: text }),
  z.object({ id: text, type: z.literal("remoteSsh"), host: text, sshPort: port, daemonPort: port }),
  z.object({ id: text, type: z.literal("relay"), relayEndpoint: text, useTls: z.boolean().optional(), daemonPublicKeyB64: text }),
]);
export const SavedHost = z.object({
  serverId: text, label: text, password: z.string().max(4096).optional(),
  preferredConnectionId: z.string().nullable().optional(),
  connections: z.array(SavedConnection).min(1).max(20),
});
export const SavedHosts = z.array(SavedHost).max(100).refine(
  (hosts) => new Set(hosts.map((host) => host.serverId)).size === hosts.length,
  "Duplicate host IDs",
);
export type RemoteProfile = z.infer<typeof SavedHost>;
export type RemoteConnection = z.infer<typeof SavedConnection>;
export const RemoteWorker = z.object({ id: z.string(), name: z.string(), status: z.string(), updatedAt: z.string(), permissions: z.number(), output: z.string() });
export const RemoteHost = z.object({
  serverId: z.string(), label: z.string(), online: z.boolean(), checkedAt: z.string().nullable(), error: z.string().nullable(),
  projects: z.array(z.record(z.string(), z.unknown())), workspaces: z.array(z.record(z.string(), z.unknown())),
  providers: z.array(z.record(z.string(), z.unknown())), workers: z.array(RemoteWorker),
});
export const RemoteSnapshot = z.object({ version: z.literal(1), localServerId: z.string(), syncedAt: z.string().nullable(), syncError: z.string().nullable(), hosts: z.array(RemoteHost) });
export type RemoteSnapshot = z.infer<typeof RemoteSnapshot>;
export type RemoteHost = z.infer<typeof RemoteHost>;
export const syncRemotes = defineRpc({
  name: "firstmate.remotes.sync",
  input: z.object({ hosts: SavedHosts }), output: RemoteSnapshot,
});
export const readRemotes = defineRpc({ name: "firstmate.remotes.read", input: z.object({}), output: RemoteSnapshot });
export const reportRemoteSyncError = defineRpc({
  name: "firstmate.remotes.sync-error", input: z.object({ unavailable: z.boolean() }), output: z.object({}),
});
export const RemoteRequest = z.object({
  id: z.uuid(), host: text, args: z.array(z.string().max(100000)).min(1).max(100), createdAt: z.number(),
});
