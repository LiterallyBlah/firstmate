import { mkdir, mkdtemp, readFile, rm, writeFile, chmod } from "node:fs/promises";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { BOARD_REVIEW_ROUTING, CURRENT_ROUTING, WatchRoutingSchema } from "../shared/watch-routing";
import { readFirstmateConfig, updateFirstmateConfig } from "./config";
import { pluginDir } from "./data-dir";
import type { PaseoApi } from "./host-types";
import { startWatches, type WatchService } from "./watch-service";
import { listWatches } from "./watch-files";
import { runWatchScript } from "./watch-run";

vi.mock("./watch-run", () => ({ runWatchScript: vi.fn(async () => ({ code: 0, stdout: "inspect this output", stderr: "", truncated: false, timedOut: false, spawnError: null })) }));
const directories: string[] = []; const services: WatchService[] = [];
afterEach(async () => { services.splice(0).forEach((service) => service.stop()); vi.unstubAllEnvs();
  vi.useRealTimers(); for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true }); vi.restoreAllMocks(); vi.clearAllMocks(); });
async function fixture() {
  const home = await mkdtemp(join(tmpdir(), "firstmate-watch-service-")); directories.push(home); vi.stubEnv("PASEO_HOME", home);
  await mkdir(join(home, "firstmate", "watches"), { recursive: true });
  await writeFile(join(home, "firstmate", "AGENTS.md"), "home charter");
  const path = join(home, "firstmate", "watches", "test-watch");
  await writeFile(path, "#!/usr/bin/env node\n// schedule: * * * * *\n"); await chmod(path, 0o755);
  await updateFirstmateConfig({ home: join(home, "firstmate"), disabledWatches: ["pr-watch"] });
  await updateFirstmateConfig({ mateAgentId: "mate" });
  const sent: any[] = [];
  const paseo = { agents: { ref: (id: string) => ({ refresh: async () => ({ agent: { id, provider: "codex", model: "m", cwd: join(home, "firstmate"),
    status: "idle", archivedAt: null, labels: {}, pendingPermissions: [], thinkingOptionId: "xhigh" } }),
    send: async (text: string, options: unknown) => sent.push({ id, text, options }) }) },
    providers: { listModels: async () => ({ models: [{ id: "m", thinkingOptions: [{ id: "medium", label: "Medium" }] }] }),
      listModes: async () => ({ modes: [{ id: "read-only", label: "Read-only" }] }) } } as unknown as PaseoApi;
  const hooks = new Map<string, any>(); const server = { on: (name: string, handler: unknown) => { hooks.set(name, handler); return () => {}; } } as Parameters<typeof startWatches>[0];
  const service = startWatches(server, readFirstmateConfig, async () => ({ cards: [] })); services.push(service); service.remember(paseo);
  return { home, paseo, service, sent, hooks, script: (await listWatches(join(home, "firstmate")))[0]! };
}
it("preserves existing script defaults and their current-session output path", async () => {
  const f = await fixture(); expect((await f.service.summaries())[0]?.routing).toEqual(CURRENT_ROUTING);
  await f.service.runner.runOne(join(f.home, "firstmate"), f.script); await f.service.runner.flush();
  expect(f.sent).toHaveLength(1); expect(f.sent[0].id).toBe("mate"); expect(f.sent[0].text).toContain("inspect this output");
  expect((await readFirstmateConfig()).disabledWatches).toEqual(["pr-watch"]);
});
it("persists explicit script routing and queues inspection input without waking the mate", async () => {
  const f = await fixture(); await f.service.configure({ name: "test-watch", ...BOARD_REVIEW_ROUTING });
  await f.service.runner.runOne(join(f.home, "firstmate"), f.script); await f.service.runner.flush();
  expect(f.sent).toEqual([]);
  const saved = JSON.parse(await readFile(join(pluginDir(), "watch-inspections", "inspection-runs.json"), "utf8"));
  expect(saved.inputs).toHaveLength(1); expect(saved.inputs[0].routing).toEqual(BOARD_REVIEW_ROUTING);
  await f.service.runner.runOne(join(f.home, "firstmate"), f.script); expect(runWatchScript).toHaveBeenCalledTimes(1);
  expect((await f.service.summaries())[0]?.lastResult).toBe("queued");
});
it("validates current-model reasoning and script-specific editing rules before persistence", async () => {
  const f = await fixture(); await expect(f.service.configure({ name: "test-watch", ...BOARD_REVIEW_ROUTING, newSessionReasoning: "ultra" })).rejects.toThrow("not supported");
  await expect(f.service.configure({ name: "test-watch", ...CURRENT_ROUTING, prompt: "rewrite script" })).rejects.toThrow("Files");
  await expect(f.service.create({ name: "test-watch", schedule: "* * * * *", prompt: "Inspect", enabled: true, ...CURRENT_ROUTING })).rejects.toThrow("existing script");
  expect((await f.service.summaries())[0]?.routing).toEqual(CURRENT_ROUTING);
});
it("edits/toggles managed watches without rewriting scripts or mate reasoning", async () => {
  const f = await fixture(); const before = await readFile(f.script.path, "utf8");
  await f.service.create({ name: "board-review", schedule: "*/10 * * * *", prompt: "Review", enabled: true, ...BOARD_REVIEW_ROUTING });
  await f.service.configure({ name: "board-review", schedule: "*/15 * * * *", prompt: "Updated review", ...BOARD_REVIEW_ROUTING });
  await f.service.toggle("board-review", false);
  expect((await f.service.summaries()).find((watch) => watch.name === "board-review")).toMatchObject({ schedule: "*/15 * * * *", prompt: "Updated review", enabled: false, managed: true });
  for (const watch of await f.service.summaries()) expect(() => WatchRoutingSchema.parse(watch.routing)).not.toThrow();
  await f.service.create({ name: "current-brief", schedule: "*/10 * * * *", prompt: "Inspect", enabled: false, ...CURRENT_ROUTING });
  expect(WatchRoutingSchema.parse((await f.service.summaries()).find((watch) => watch.name === "current-brief")?.routing)).toEqual(CURRENT_ROUTING);
  expect(await readFile(f.script.path, "utf8")).toBe(before); expect((await readFirstmateConfig()).mateAgentId).toBe("mate");
});
it("escalates a corrupt inspection ledger through a separate durable outbox without resetting evidence", async () => {
  vi.useFakeTimers(); vi.setSystemTime(new Date("2026-10-10T12:00:00Z")); vi.spyOn(console, "error").mockImplementation(() => {});
  const f = await fixture(); const path = join(pluginDir(), "watch-inspections", "inspection-runs.json");
  await mkdir(join(pluginDir(), "watch-inspections"), { recursive: true }); await writeFile(path, "corrupt evidence");
  await vi.advanceTimersByTimeAsync(15000);
  // Drain filesystem-backed timer work before advancing another tick.
  await vi.waitFor(() => expect(f.sent).toHaveLength(1));
  await vi.waitFor(async () => expect((await readFirstmateConfig()).mateNotes).toEqual([]));
  expect(f.sent[0].options.messageId).toMatch(/^firstmate-watch-runtime-/); expect(f.sent[0].text).toContain("watch-runtime");
  await vi.advanceTimersByTimeAsync(15000); expect(f.sent).toHaveLength(1);
  expect(await readFile(path, "utf8")).toBe("corrupt evidence");
});
it("returns the original creation receipt after the current provider's capabilities change", async () => {
  const f = await fixture(); const id = randomUUID();
  const watch = { name: "board-review", schedule: "*/10 * * * *", prompt: "Review", enabled: false, ...BOARD_REVIEW_ROUTING };
  await f.service.create(watch, id);
  vi.spyOn(f.paseo.providers, "listModes").mockResolvedValue({ provider: "codex", modes: [], error: null, fetchedAt: new Date().toISOString(), requestId: "catalog" });
  await expect(f.service.create(watch, id)).resolves.toBeUndefined();
  await expect(f.service.create({ ...watch, prompt: "Different" }, id)).rejects.toThrow("different");
  expect((await f.service.summaries()).filter((entry) => entry.name === watch.name)).toHaveLength(1);
});
it("captures script routing before the process runs, so an edit cannot reroute its pending output", async () => {
  const f = await fixture(); await f.service.configure({ name: "test-watch", ...BOARD_REVIEW_ROUTING });
  let complete!: (result: Awaited<ReturnType<typeof runWatchScript>>) => void;
  vi.mocked(runWatchScript).mockImplementationOnce(() => new Promise((done) => { complete = done; }));
  const running = f.service.runner.runOne(join(f.home, "firstmate"), f.script);
  await vi.waitFor(() => expect(complete).toBeTypeOf("function"));
  await f.service.configure({ name: "test-watch", ...CURRENT_ROUTING });
  complete({ code: 0, stdout: "captured output", stderr: "", truncated: false, timedOut: false, spawnError: null }); await running;
  await f.service.runner.flush(); expect(f.sent).toEqual([]);
  const state = JSON.parse(await readFile(join(pluginDir(), "watch-inspections", "inspection-runs.json"), "utf8"));
  expect(state.inputs[0].routing).toEqual(BOARD_REVIEW_ROUTING);
  await f.service.runner.runOne(join(f.home, "firstmate"), f.script);
  expect(runWatchScript).toHaveBeenCalledTimes(1);
});
it("holds new routing while that watch's earlier current-session output is still queued", async () => {
  const f = await fixture(); await f.service.runner.runOne(join(f.home, "firstmate"), f.script);
  expect(await f.service.runner.pendingDelivery("test-watch")).toBe(true);
  await f.service.configure({ name: "test-watch", ...BOARD_REVIEW_ROUTING });
  await f.service.runner.runOne(join(f.home, "firstmate"), f.script);
  expect(runWatchScript).toHaveBeenCalledTimes(1);
  await f.service.runner.flush(); expect(f.sent).toHaveLength(1);
  expect(await f.service.runner.pendingDelivery("test-watch")).toBe(false);
});
