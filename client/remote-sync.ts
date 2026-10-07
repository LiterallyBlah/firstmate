import type { PluginClientContext } from "@getpaseo/plugin/client";
import { SavedHosts, reportRemoteSyncError, syncRemotes } from "../shared/remotes";
import { configureIndependentDaemon, savedDaemonRegistry } from "./web";

/** Export only validated saved profiles, once per change. No raw payload or
 * validation error is logged: either can contain a host password. */
export function startRemoteSync(client: PluginClientContext): () => void {
  let stopped = false;
  let busy = false;
  let synced: string | null = null;
  let reported = "";
  async function tick() {
    if (stopped || busy) return;
    busy = true;
    try {
      const raw = savedDaemonRegistry();
      if (raw === undefined) return; // Native client; desktop is the sync source.
      if (raw === null) {
        if (reported !== "missing") { await client.rpc(reportRemoteSyncError, { unavailable: true }); reported = "missing"; }
        return;
      }
      if (raw === synced) return;
      let value: unknown;
      try { value = JSON.parse(raw); } catch { value = null; }
      const result = SavedHosts.safeParse(value);
      if (!result.success) {
        if (reported !== "format") { await client.rpc(reportRemoteSyncError, { unavailable: false }); reported = "format"; }
        return;
      }
      const snapshot = await client.rpc(syncRemotes, { hosts: result.data });
      await configureIndependentDaemon(snapshot.localServerId);
      synced = raw; reported = "";
    } catch { /* Connection interrupted; next tick retries without logging credentials. */ }
    finally { busy = false; }
  }
  void tick();
  const timer = setInterval(() => void tick(), 10000);
  return () => { stopped = true; clearInterval(timer); };
}
