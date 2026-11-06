import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import { fixture } from "../test/fmu-review-runtime-fixture";
import { FirstmateConfigSchema } from "../shared/fleet";
import { PlanRuntime } from "./plan-runtime";
import { SupervisionSources, normalizePullRequest } from "./supervision-sources";
import { startWorkflowService } from "./workflow-service";

const delay = (ms: number) => new Promise(done => setTimeout(done, ms));
async function replyWithin(directory: string, id: string, ms: number, beat?: () => void): Promise<string | null> {
  const deadline = Date.now() + ms;
  for (;;) {
    try { return await readFile(join(directory, `${id}.reply.json`), "utf8"); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    if (Date.now() >= deadline) return null;
    beat?.(); // Later clock beats, in case an earlier fast pass was still running at the first.
    await delay(25);
  }
}

it("a scope read is answered on the next clock while the scoped tick is still in its slow tail", async () => {
  const f = await fixture(), scope = f.scopes[0]!;
  // A bound PR makes a fresh runtime's first tick poll GitHub in its recovery tail,
  // long after that tick's own scope-request pass has finished.
  const started = await f.start(scope, scope.nodes[0]!);
  await new SupervisionSources(f.store).bindPullRequest({ scopeId: scope.id, attemptId: started.attemptId!, repository: "me/web", pr: 42 });
  let releasePr!: () => void, prEntered!: () => void;
  const entered = new Promise<void>(done => { prEntered = done; }), gate = new Promise<void>(done => { releasePr = done; });
  const slow = new PlanRuntime(f.runtime, { enabled: true, slots: 10,
    config: async () => FirstmateConfigSchema.parse({ home: f.home, mateAgentId: "general" }), receiver: () => f.receiver,
    readPr: async () => { prEntered(); await gate; return normalizePullRequest({ state: "OPEN", headRefOid: "a".repeat(40),
      author: { login: "builder" }, reviews: [], statusCheckRollup: [] }, "me/web", 42, new Date().toISOString()); } });
  slow.remember(f.api);
  // The production driver: index.server.ts hands startWorkflowService the scoped
  // allSettled tick and, for scope requests, the fast request pass.
  let clock: (() => void) | undefined;
  vi.spyOn(globalThis, "setInterval").mockImplementation(((callback: () => void) => { clock = callback; return { unref() {} }; }) as never);
  let stop: (() => Promise<void>) | undefined;
  try {
    stop = startWorkflowService(async () => { await Promise.allSettled([slow.tick()]); }, () => slow.processRequests());
    vi.restoreAllMocks();
    clock!(); // First second: the tick starts and stalls polling the bound PR in its tail.
    await entered;
    const id = await f.queue(scope, "read", { scopeId: scope.id, epoch: 1, page: "state" });
    clock!(); // Next second, tick still stalled: the request must not wait for it.
    const reply = await replyWithin(f.directory, id, 5000, () => clock!());
    expect(reply, "scope request sat unanswered behind the stalled tick").not.toBeNull();
    expect(JSON.parse(reply!)).toMatchObject({ ok: true });
    clock!(); // A later pass sees the retained reply in its listing and skips the request, leaving it exactly as published.
    await delay(300);
    expect(await readFile(join(f.directory, `${id}.reply.json`), "utf8")).toBe(reply);
    await expect(stat(join(f.directory, `${id}.json`))).resolves.toBeDefined();
  } finally {
    vi.restoreAllMocks(); releasePr(); await stop?.(); await slow.stop(); await f.service.stop(); await f.runtime.stop();
  }
}, 90_000);

it("an idle fast pass does no runtime read or mutate when no scope request is waiting", async () => {
  const f = await fixture(), scope = f.scopes[0]!;
  try {
    // The fixture directory holds only retained answered pairs, so this pass is idle:
    // it must stop at the cheap listing, never paying a journal read or the runtime lock.
    const read = vi.spyOn(f.runtime, "read"), mutate = vi.spyOn(f.runtime, "mutate");
    await f.service.processRequests();
    expect(read, "idle scope pass read the journal").not.toHaveBeenCalled();
    expect(mutate, "idle scope pass took the runtime lock").not.toHaveBeenCalled();
    // A waiting request still takes the full checked pass on the very next call.
    const id = await f.queue(scope, "read", { scopeId: scope.id, epoch: 1, page: "state" });
    await f.service.processRequests();
    expect(read).toHaveBeenCalled();
    expect(mutate).toHaveBeenCalled();
    expect(await f.result(id)).toMatchObject({ ok: true });
  } finally { await f.service.stop(); await f.runtime.stop(); }
}, 90_000);
