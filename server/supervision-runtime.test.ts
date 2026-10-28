import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { expect, it } from "vitest";
import { SupervisionRuntime } from "./supervision-runtime";

it("shares one coordinator without serializing independent callbacks; shutdown drains them and refuses new work", async () => {
  const root = join(process.env.PASEO_HOME!, randomUUID()), home = join(root, "home"), runtime = new SupervisionRuntime(root);
  let release!: () => void, entered!: () => void;
  const gate = new Promise<void>(done => { release = done; }), ready = new Promise<void>(done => { entered = done; });
  let firstStore: unknown;
  const first = runtime.mutate(home, async store => { firstStore = store; entered(); await gate; });
  await ready;
  await runtime.mutate(home, async store => { expect(store).toBe(firstStore); expect((await store.read()).freshness).toBe("current"); });
  let stopped = false; const stopping = runtime.stop().then(() => { stopped = true; });
  await new Promise(done => setTimeout(done, 10)); expect(stopped).toBe(false);
  await expect(runtime.mutate(home, async () => {})).rejects.toThrow("stopped");
  release(); await first; await stopping;
});
