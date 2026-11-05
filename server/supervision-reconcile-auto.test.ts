import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import { s04Fixture } from "../test/supervision-s04-fixture";
import type { PaseoApi } from "./host-types";
import { SupervisionCommands } from "./supervision-commands";
import { SupervisionGateway } from "./supervision-effects";
import { SupervisionRuntime } from "./supervision-runtime";
import { SupervisionWorkerReceiver } from "./supervision-worker-receiver";
const execute = promisify(execFile);

/** The automatic path end to end: a worker start times out uncertain, the runtime's own
 * reconcile (the heartbeat/restart clock's call) settles it through the real worker
 * receiver with nobody acting, and the owner can then release the attempt. */
it("runtime reconcile settles a timed-out worker start as not created, then release is accepted", async () => {
  const root = join(process.env.PASEO_HOME!, randomUUID()), project = join(root, "project");
  await mkdir(project, { recursive: true });
  const git = async (...args: string[]) => execute("git", ["-C", project, ...args], { windowsHide: true });
  await git("init", "-b", "main"); await writeFile(join(project, "source.txt"), "baseline\n"); await git("add", ".");
  await git("-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit", "-m", "baseline");
  const timeout = Object.assign(new Error("Timeout waiting for message (60000ms)"), { code: "DAEMON_REQUEST_TIMEOUT" });
  const create = vi.fn(async () => { throw timeout; }); // The reply is lost; nothing is actually created.
  const list = vi.fn(async () => ({ entries: [], pageInfo: { nextCursor: null }, requestId: "fixture" }));
  const api = { workspaces: { create, list, ref: () => { throw new Error("no workspace was created"); } } } as unknown as PaseoApi;
  const receiver = new SupervisionWorkerReceiver(api, root, async () => project);
  const fx = await s04Fixture(), scope = await fx.addScope(1, "autoplan", ["build"]);
  await fx.draft(scope, [{ id: "build" }], true);
  const commands = new SupervisionCommands(fx.store, fx.home, { enabled: true, recovery: true });
  // The dispatching gateway's clock is minutes behind, so the uncertainty it records is
  // already older than the proof's minimum age when the runtime's clock reads it.
  const gateway = new SupervisionGateway(fx.store, commands, fx.home, receiver,
    { enabled: true, recovery: true, now: () => Date.now() - 10 * 60_000 });
  const started = await gateway.startWorker(await fx.input(scope, { op: "start", plan: scope.planId, node: "build" }), scope.owner);
  expect((await gateway.dispatch(started.effects!.workspace)).state).toBe("uncertain");
  const release = async () => commands.planCommand(
    await fx.input(scope, { op: "release", plan: scope.planId, node: "build", attempt: started.attemptId!, evidence: "Reconcile proved the timed-out start created nothing." }), scope.owner);
  await expect(release()).rejects.toMatchObject({ code: "UNCERTAIN" }); // Blocked while the effect is uncertain.
  const runtime = new SupervisionRuntime(join(fx.home, "store"), () => fx.store);
  await runtime.mutate(fx.home, async () => {});
  await runtime.reconcile(fx.home, receiver, ["plan"]); // Nobody acts: the existing clock settles it.
  const status = await fx.store.read(), byId = (id: string) => status.effects.find(e => e.id === id)!;
  expect(byId(started.effects!.workspace)).toMatchObject({ state: "failed" });
  expect(byId(started.effects!.workspace).receiptRef).toMatch(/^rejected:not-created:/);
  expect(byId(started.effects!.create).state).toBe("cancelled");
  expect(byId(started.effects!.send).state).toBe("cancelled");
  expect(create.mock.calls).toHaveLength(1); // Reconcile never resent or recreated.
  await release();
  const after = await fx.store.read();
  expect(after.attempts.find(a => a.id === started.attemptId)).toMatchObject({ state: "released-uncreated", spentAgents: 1, spentTurns: 1 });
}, 60000);
