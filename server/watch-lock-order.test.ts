/** R12O N1: a script watch routed to an isolated session must not hold the S07 cutover gate (G) while it waits for
 * the inspection lock (I). With I held across the lifecycle lock (L) by an inspection start, and L held by a note
 * flush that then claims G, the old `gated(() => record(...))` wedged all three until the plugin restarted.
 * Driven through a real WatchRunner tick, the real WatchInspections and the real gate, in a temporary home
 * (test/setup.ts); only the script run and Paseo are stand-ins. */
import { chmod, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, it } from "vitest";
import { CURRENT_ROUTING, type WatchRouting } from "../shared/watch-routing";
import { readFirstmateConfig, resolveHome, updateFirstmateConfig } from "./config";
import type { PaseoApi } from "./host-types";
import { flushMateNotes } from "./mate";
import { pluginDir } from "./data-dir";
import { cutoverGate } from "./supervision-gate";
import { WatchInspections } from "./watch-inspections";
import { WatchRunner } from "./watches";

const pause = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

it("a routed script run, an inspection start and a note flush all settle (no gate → inspection → lifecycle → gate cycle)", async () => {
  const home = join(process.env.PASEO_HOME!, "home");
  await mkdir(join(home, "data"), { recursive: true }); await mkdir(join(home, "watches"), { recursive: true });
  const header = process.platform === "win32" ? "#!/usr/bin/env node\n//" : "#!/bin/sh\n#";
  await writeFile(join(home, "watches", "probe"), `${header} schedule: * * * * *\n`, "utf8");
  await chmod(join(home, "watches", "probe"), 0o755);
  await updateFirstmateConfig({ home, mateAgentId: "", migration: null, mateLaunch: null });
  await updateFirstmateConfig({ mateAgentId: "mate-1", mateNotes: [{ id: "firstmate-note-1", text: "hello" }] });

  let releaseMate!: () => void; const mateParked = new Promise<void>(resolve => { releaseMate = resolve; });
  const agent = { id: "mate-1", status: "idle", archivedAt: null, pendingPermissions: [], labels: {}, provider: "claude", cwd: home };
  const paseo = { agents: { ref: () => ({ refresh: async () => { await mateParked; return { agent }; }, send: async () => undefined }) } } as unknown as PaseoApi;
  const inspections = new WatchInspections({ root: join(pluginDir(), "watch-inspections"), paseo: () => paseo, config: readFirstmateConfig, snapshot: async () => ({}) });
  const isolated: WatchRouting = { ...CURRENT_ROUTING, executionSession: "new" };
  const runner = new WatchRunner({
    home: async () => home, disabled: async () => ["pr-watch", "remote-watch"], deliver: async () => "sent",
    stateFile: join(pluginDir(), "watches.json"), scriptStateRoot: join(pluginDir(), "watch-state"),
    run: async () => ({ code: 0, timedOut: false, stdout: "script output\n", truncated: false, stderr: "", spawnError: null }),
    // As watch-service wires it for a script whose routing is an isolated session.
    routeNote: async note => { await inspections.queueInput(note.name, note.text, isolated, note); return true; },
    gate: async () => ({ gate: cutoverGate(resolveHome(await readFirstmateConfig())), recipient: "mate-1" }),
  });

  const settled: string[] = [];
  const track = (name: string, work: Promise<unknown>) => work.then(() => settled.push(name), () => settled.push(name));
  const c = track("flush", flushMateNotes(paseo)); // Holds L while the mate lookup is parked, then claims G.
  await pause(50);
  const b = track("start", inspections.start("probe", "x", isolated)); // Holds I, then waits for L.
  await pause(50);
  const a = track("tick", runner.tick(new Date(2026, 9, 28, 10, 5))); // Records the run, routing it through I.
  await pause(50);
  releaseMate();
  await Promise.race([Promise.all([a, b, c]), pause(5000)]);
  runner.stop();
  expect(settled.sort()).toEqual(["flush", "start", "tick"]);
  // The run was recorded, and its output went to the isolated session rather than General's queue.
  expect((await runner.summaries()).find(s => s.name === "probe")).toMatchObject({ lastRunAt: "2026-10-28T10:05:00Z", lastOutput: "script output" });
  expect(await runner.queued()).toEqual([]);
}, 20_000);
