import { randomUUID } from "node:crypto";
/** Read-only connection bootstrap. No launch, Attach, model wake or second writer. */
import { createPaseoClient } from "@getpaseo/client";
import { sameDirectory } from "./fleet";
import { SupervisionError } from "./supervision-store";
export interface PlanBootstrapConnection { paseo: ReturnType<typeof createPaseoClient>; close(): Promise<void> }
export async function connectPlanBootstrap(home: string, generalId: string,
  options: { env?: NodeJS.ProcessEnv; create?: typeof createPaseoClient } = {}): Promise<PlanBootstrapConnection | null> {
  const env = options.env ?? process.env;
  // Optional: without it, store-only scope requests are still served and host effects wait for a host handle.
  if (!env.FIRSTMATE_PLAN_BOOTSTRAP_URL) return null;
  let url: URL;
  try { url = new URL(env.FIRSTMATE_PLAN_BOOTSTRAP_URL); }
  catch { throw new SupervisionError("HELD", "FIRSTMATE_PLAN_BOOTSTRAP_URL is not a valid URL."); }
  if (!["ws:", "wss:"].includes(url.protocol) || !["127.0.0.1", "[::1]"].includes(url.hostname) || !url.port ||
    url.pathname !== "/ws" || url.username || url.password || url.search || url.hash)
    throw new SupervisionError("HELD", "Plan bootstrap needs an explicit loopback WebSocket endpoint ending in /ws, without URL credentials.");
  const client = (options.create ?? createPaseoClient)({ url: url.href, ...(env.FIRSTMATE_PLAN_BOOTSTRAP_PASSWORD ? { password: env.FIRSTMATE_PLAN_BOOTSTRAP_PASSWORD } : {}),
    clientId: `firstmate-operating-plans-${randomUUID()}`, connectTimeoutMs: 5000, reconnect: { enabled: true } });
  try {
    await client.connect();
    const general = (await client.agents.ref(generalId).refresh())?.agent;
    if (!general || general.id !== generalId || general.archivedAt || !await sameDirectory(general.cwd, home))
      throw new SupervisionError("HELD", "Plan bootstrap could not verify the configured General identity and home.");
    return { paseo: client, close: () => client.close() };
  } catch (error) {
    await client.close().catch(() => {});
    if (error instanceof SupervisionError) throw error;
    // Never put the endpoint's credentials or SDK authentication diagnostics in the journal/log.
    throw new SupervisionError("HELD", "Plan bootstrap connection is unavailable; retained work remains held.");
  }
}
