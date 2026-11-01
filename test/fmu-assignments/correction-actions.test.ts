/** Actual registered app handlers, temporary config/gate/journal, no native effects. */
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import { s04Fixture } from "../supervision-s04-fixture";
import { updateFirstmateConfig } from "../../server/config";
import { SupervisionRuntime } from "../../server/supervision-runtime";
import { WatchSupervisors } from "../../server/watch-supervisors";
import { cutoverGate } from "../../server/supervision-gate";

async function fixture() {
  const f = await s04Fixture(), scope = await f.addScope(1, "plan", ["build"]);
  await f.draft(scope, [{ id: "build" }]); await f.launch(scope, "build");
  const name = `checks-${randomUUID()}`;
  await mkdir(join(f.home, "watches"), { recursive: true }); await writeFile(join(f.home, "watches", name), "#!/usr/bin/env node\n// schedule: * * * * *\n");
  await updateFirstmateConfig({ mateAgentId: "" }); await updateFirstmateConfig({ home: f.home }); await updateFirstmateConfig({ mateAgentId: "general" });
  const runtime = new SupervisionRuntime(join(f.home, "runtime"), () => f.store); await runtime.mutate(f.home, async () => {});
  const handlers = new Map<string, (input: any) => Promise<any>>();
  const restart = () => new WatchSupervisors(runtime, { runner: { queued: async () => [] }, pendingInspections: async () => [] } as never)
    .register({ handle: (rpc: { name: string }, run: (input: any) => Promise<any>) => handlers.set(rpc.name, run) } as never);
  restart();
  const read = () => handlers.get("firstmate.watch.supervisors.read")!({}), act = (input: any) => handlers.get("firstmate.watch.supervisors.act-ui")!(input);
  const snapshot = () => read().then(s => ({ ...s, watches: s.watches.filter((w: any) => w.name === name) }));
  const action = (input: any) => act(input).then(s => ({ ...s, watches: s.watches.filter((w: any) => w.name === name) }));
  const before = await snapshot(), prepare = { op: "prepare", requestId: randomUUID(), expectedGeneration: 0, target: before.targets.find((t: any) => t.name === name) };
  const prepared = await action(prepare);
  const input = (op: string, s: any) => ({ op, requestId: randomUUID(), homeId: s.homeId, name, assignmentRequestId: s.watches[0].assignment.requestId, assignmentDigest: s.watches[0].assignmentDigest });
  return { ...f, name, scope, runtime, restart, read: snapshot, act: action, input, prepare, prepared, gate: cutoverGate(f.home) };
}

it("F3: prepare replay survives abort/later generation/progress; changed bytes and stale new admissions refuse", async () => {
  const f = await fixture();
  try {
    await f.act(f.input("abort", f.prepared));
    const next = { ...f.prepare, requestId: randomUUID(), expectedGeneration: 1 }, prepared = await f.act(next);
    await f.record(f.scope, "build", "done");
    const replay = await f.act(f.prepare);
    expect(replay.watches[0].assignment).toEqual(prepared.watches[0].assignment);
    expect(replay.watches[0].assignment.previous.target).toEqual(f.prepare.target);
    await expect(f.act({ ...f.prepare, expectedGeneration: 12 })).rejects.toThrow(/different/);
    await expect(f.act({ ...f.prepare, target: { ...f.prepare.target, name: "different-watch" } })).rejects.toThrow(/different/);
    await expect(f.act({ ...f.prepare, requestId: randomUUID(), expectedGeneration: 2 })).rejects.toThrow();
    await expect(f.act(f.input("commit", prepared))).rejects.toThrow(/changed/);
    expect((await f.store.read()).sources.bindings).toEqual([]);
  } finally { await f.runtime.stop(); }
});

for (const op of ["commit", "abort", "pause", "unassign", "resume"]) for (const afterWrite of [false, true]) {
  it(`F4: ${op} interrupted ${afterWrite ? "after" : "before"} final transport write recovers only its latest disposition`, async () => {
    const f = await fixture();
    try {
      let state = f.prepared;
      if (!["commit", "abort"].includes(op)) state = await f.act(f.input("commit", state));
      if (op === "resume") state = await f.act(f.input("pause", state));
      const request = f.input(op, state), stage = op === "abort" ? "aborted" : op === "commit" || op === "resume" ? "committed" : "paused";
      const original = f.gate.watchRoute.bind(f.gate);
      const spy = vi.spyOn(f.gate, "watchRoute").mockImplementation(async (...args) => {
        if (args[2] === stage) { if (afterWrite) await original(...args); throw Error("synthetic final transport crash"); }
        return original(...args);
      });
      try { await expect(f.act(request)).rejects.toThrow("synthetic final transport crash"); } finally { spy.mockRestore(); }
      const held = await f.read();
      expect(held.watches[0].assignment.stage).toBe(stage);
      if (!afterWrite) expect(held.watches[0].problem).toMatch(/transport.*held/);
      const sequence = (await f.store.read()).sequence;
      f.restart(); const recovered = await f.act(request);
      expect(recovered.watches[0].problem).toBeNull();
      expect((await f.gate.readWatchRoute(f.name))?.stage).toBe(stage);
      expect((await f.store.read()).sequence).toBe(sequence);
      let newer;
      if (op === "abort") newer = await f.act({ ...f.prepare, requestId: randomUUID(), expectedGeneration: 1 });
      else newer = await f.act(f.input(stage === "committed" ? "unassign" : "resume", recovered));
      const transport = await f.gate.readWatchRoute(f.name);
      await f.act(request); await f.act(f.prepare);
      expect((await f.read()).watches[0].assignment).toEqual(newer.watches[0].assignment);
      expect(await f.gate.readWatchRoute(f.name)).toEqual(transport);
      expect((await f.store.read()).sequence).toBe(sequence);
    } finally { await f.runtime.stop(); }
  });
}
