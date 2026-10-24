/** Bundled by the parent test. All paths/config come from its temporary fixture home. */
import { readFile } from "node:fs/promises";
import { SupervisionStore, SupervisionError, type SupervisionMutation } from "../server/supervision-store";
import { publish } from "../server/submissions";
import type { SupervisionExpected } from "../shared/supervision";

async function main() {
  const config = JSON.parse(await readFile(process.argv[2]!, "utf8")) as {
    dataRoot: string; home: string; mode: "crash" | "hold" | "claim" | "publish"; crash?: string;
    mutations?: SupervisionMutation[]; expected?: SupervisionExpected[]; requestId?: string; path?: string;
  };
  if (config.mode === "publish") { await publish(config.path!, { pid: process.pid }); return; }
  const store = new SupervisionStore(config.dataRoot, config.home, { writable: true, boundary: async name => {
    if (name === config.crash) process.kill(process.pid, "SIGKILL");
  } });
  await store.acquireCoordinator();
  if (config.mode === "hold") {
    process.stdout.write("ready\n");
    await new Promise<void>(resolve => process.once("message", () => resolve()));
    await store.releaseCoordinator();
  } else if (config.mutations) {
    const receipt = await store.transact(config.expected!, config.requestId!, config.mutations);
    process.stdout.write(JSON.stringify(receipt));
    await store.releaseCoordinator();
  } else await store.releaseCoordinator();
}
void main().catch(error => { process.stderr.write(JSON.stringify({ code: error instanceof SupervisionError ? error.code : error.code ?? "ERROR", message: error.message })); process.exitCode = 2; });
