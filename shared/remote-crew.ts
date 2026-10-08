/**
 * What the board's card can do to a worker on a remote host. Each goes through the plugin's remote
 * request path (`RemoteService.request` in `server/remotes.ts`) — its allowed commands, its
 * credential handling and its single attempt — and only to a worker the last poll found this first
 * mate owning on that host. Relaunch is not here: it needs a new brief on that host, which is the
 * first mate's to write.
 */
import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";

const remoteWorker = z.object({
  /** The saved host's serverId, exactly as the card has it. */
  serverId: z.string().min(1).max(2048),
  agentId: z.string().min(1).max(256),
});

/** Words to the remote worker (`paseo send`); the first mate is told what was said. */
export const steerRemoteCrew = defineRpc({
  name: "firstmate.remote-crew.steer",
  input: remoteWorker.extend({ text: z.string().min(1).max(100000) }),
  output: z.object({}),
});

/** Stops the remote worker's current turn (`paseo stop`). */
export const interruptRemoteCrew = defineRpc({
  name: "firstmate.remote-crew.interrupt",
  input: remoteWorker,
  output: z.object({}),
});

/** Archives the remote worker (`paseo archive`); its workspace there is left as it is. */
export const exitRemoteCrew = defineRpc({
  name: "firstmate.remote-crew.exit",
  input: remoteWorker,
  output: z.object({}),
});

/** The remote worker's recent activity, read-only (`paseo logs --filter text`), for Watch. */
export const remoteCrewLogs = defineRpc({
  name: "firstmate.remote-crew.logs",
  input: remoteWorker,
  output: z.object({ text: z.string(), readAt: z.string() }),
});
