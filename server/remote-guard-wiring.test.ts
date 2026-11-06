/** Production wiring: both remote mutation guards `index.server.ts` builds — the mate helper's queue
 * (`RemoteService`'s scoped guard) and the board's remote steer, interrupt and end — fail closed when
 * the supervision journal cannot be read. A caller rewired to an inline fail-open closure fails here. */
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const captured = vi.hoisted(() => ({ helper: [] as ((serverId: string, agentId: string) => Promise<void>)[], board: [] as unknown[] }));
vi.mock("./remotes", async (original) => {
  const real = await original<typeof import("./remotes")>();
  // The class syntax is test-only; the plugin's own bundles never carry it.
  class CapturingRemoteService extends real.RemoteService {
    constructor(...args: ConstructorParameters<typeof real.RemoteService>) {
      super(...args);
      if (args[3]) captured.helper.push(args[3]);
    }
  }
  return { ...real, RemoteService: CapturingRemoteService };
});
vi.mock("./remote-crew", async (original) => {
  const real = await original<typeof import("./remote-crew")>();
  // The board's handlers pass their guard last; run it as the real functions do, before any request.
  const guarded = (name: string) => async (...args: unknown[]) => {
    const guard = args.at(-1) as (serverId: string, agentId: string) => Promise<void>;
    captured.board.push(name);
    await guard(args[1] as string, args[2] as string);
    throw new Error(`${name} passed its guard`);
  };
  return { ...real, steerRemoteCrew: guarded("steer"), interruptRemoteCrew: guarded("interrupt"), exitRemoteCrew: guarded("exit") };
});
import contribute from "../index.server";
import { SupervisionRuntime } from "./supervision-runtime";

vi.setConfig({ testTimeout: 60000 });
beforeEach(() => writeFile(join(process.env.PASEO_HOME!, "server-id"), "isolated-remote-guard-wiring"));
afterEach(() => { vi.restoreAllMocks(); captured.helper.length = 0; captured.board.length = 0; });

it("the helper queue's guard and the board's remote guard both refuse while the journal cannot be read", async () => {
  vi.spyOn(globalThis, "setInterval").mockReturnValue({ unref() {} } as any);
  const read = vi.spyOn(SupervisionRuntime.prototype, "read").mockRejectedValue(new Error("journal unreadable"));
  vi.spyOn(console, "error").mockImplementation(() => {});
  const handlers = new Map<string, (input: any, context?: any) => Promise<any>>();
  const cleanup = contribute({ handle: (rpc: any, fn: any) => handlers.set(rpc.name, fn), on: () => () => {}, before: () => () => {}, registerSettings() {} } as any);
  try {
    const held = { code: "HELD", message: expect.stringMatching(/could not be read/) };
    expect(captured.helper).toHaveLength(1);
    await expect(captured.helper[0]!("srv_remote", "8552861a-dee4-4771-9968-a494a64d1a79")).rejects.toMatchObject(held);
    await expect(captured.helper[0]!("srv_remote", "8552861")).rejects.toMatchObject(held);
    const target = { serverId: "srv_remote", agentId: "8552861a-dee4-4771-9968-a494a64d1a79" };
    await expect(handlers.get("firstmate.remote-crew.steer")!({ ...target, text: "hello" }, { paseo: {} })).rejects.toMatchObject(held);
    await expect(handlers.get("firstmate.remote-crew.interrupt")!(target, { paseo: {} })).rejects.toMatchObject(held);
    await expect(handlers.get("firstmate.remote-crew.exit")!(target, { paseo: {} })).rejects.toMatchObject(held);
    expect(captured.board).toEqual(["steer", "interrupt", "exit"]);
    expect(read).toHaveBeenCalled();
  } finally { await cleanup(); }
});
