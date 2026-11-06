import { randomUUID } from "node:crypto";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import { FirstmateConfigSchema } from "../shared/fleet";
import type { PaseoApi } from "./host-types";
import { SuperviseRequests } from "./supervise-requests";
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

it("a supervise request is answered on the next clock while the scoped sweep is still in its slow tail, and only inside a live turn", async () => {
  const home = join(process.env.PASEO_HOME!, randomUUID(), "home"), directory = join(home, "data", "supervise-requests");
  await mkdir(directory, { recursive: true });
  let reads = 0;
  const supervise = new SuperviseRequests({
    activation: { read: vi.fn(async () => { reads += 1; return { state: "ready" }; }) } as never,
    projects: { provision: vi.fn(), read: vi.fn(async () => ({ projects: [] })) } as never,
    config: async () => FirstmateConfigSchema.parse({ home, mateAgentId: "general" }),
  });
  supervise.remember({} as PaseoApi);
  supervise.turnStarted("general", "turn-1");
  async function queue(command: unknown) {
    const id = randomUUID();
    await writeFile(join(directory, `${id}.json`), JSON.stringify({ id, actor: "general", command }));
    return id;
  }
  let releaseTail!: () => void, tailEntered!: () => void;
  const entered = new Promise<void>(done => { tailEntered = done; }), gate = new Promise<void>(done => { releaseTail = done; });
  // The production driver: index.server.ts hands startWorkflowService the scoped
  // allSettled sweep and, for scope and supervise requests, the fast request passes.
  // This sweep models a request landing after the sweep's own supervise pass ran:
  // what remains is the slow tail (plans.tick and its neighbours) the single-flight
  // scoped lane cannot restart behind.
  let clock: (() => void) | undefined;
  vi.spyOn(globalThis, "setInterval").mockImplementation(((callback: () => void) => { clock = callback; return { unref() {} }; }) as never);
  let stop: (() => Promise<void>) | undefined;
  try {
    stop = startWorkflowService(async () => { await supervise.processRequests(); tailEntered(); await gate; },
      [() => supervise.processRequests()]);
    vi.restoreAllMocks();
    clock!(); // First second: the sweep's supervise pass runs, then its slow tail stalls.
    await entered;
    const id = await queue({ op: "activation" });
    clock!(); // Next second, tail still stalled: the request must not wait for it — the mate's turn will not wait either.
    const reply = await replyWithin(directory, id, 5000, () => clock!());
    expect(reply, "supervise request sat unanswered behind the stalled scoped sweep").not.toBeNull();
    expect(JSON.parse(reply!)).toMatchObject({ ok: true });
    expect(reads).toBe(1);
    clock!(); // A later pass sees the retained reply in its listing and skips the request, leaving it exactly as published.
    await delay(300);
    expect(await readFile(join(directory, `${id}.reply.json`), "utf8")).toBe(reply);
    await expect(stat(join(directory, `${id}.json`))).resolves.toBeDefined();
    expect(reads).toBe(1);
    // The fast lane keeps the in-turn gate: once the turn ends, the same prompt pass
    // publishes the refusal instead of acting, and no checked path runs.
    supervise.turnEnded("general", "turn-1");
    const refused = await queue({ op: "activation" });
    const refusal = await replyWithin(directory, refused, 5000, () => clock!());
    expect(refusal, "supervise request after turn end sat unanswered behind the stalled scoped sweep").not.toBeNull();
    expect(JSON.parse(refusal!)).toMatchObject({ ok: false, error: expect.stringContaining("only while the current first mate is in a turn") });
    expect(reads).toBe(1);
  } finally {
    vi.restoreAllMocks(); releaseTail(); await stop?.(); supervise.stop();
  }
}, 90_000);
