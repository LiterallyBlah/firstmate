/** R12-3: the steer relay re-checks the worker after taking the captain's steer. Only a deliberate scoped or cutover
 * refusal withholds the relay, loudly; an archived worker or a failed lookup is relayed to the first mate as before
 * (9ed5dd8), never silently dropped. Real burst-note queue in a temporary home (test/setup.ts); no daemon. */
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { beforeEach, expect, it, vi } from "vitest";
import { readFirstmateConfig, updateFirstmateConfig } from "./config";
import { CaptainSteers, registerSteerRelay } from "./crew";
import type { PaseoApi } from "./host-types";
import { workerLabels } from "./supervision-effects";

vi.mock("./cli", () => ({ stopAgent: async () => undefined }));

const WORKER = "worker-build";
const event = { outcome: { kind: "completed" }, turnId: "t1", agent: { id: WORKER, title: "Build" },
  timeline: [{ type: "user_message", text: "keep going" }, { type: "assistant_message", text: "On it.\nworking: tests" }] };
const crew = { "firstmate.role": "crew" };
const api = (refresh: () => Promise<unknown>) => ({ agents: { ref: () => ({ refresh, send: async () => undefined }) } }) as unknown as PaseoApi;
const agent = (extra: object) => async () => ({ agent: { id: WORKER, title: "Build", status: "idle", archivedAt: null, labels: crew, ...extra } });

let handler!: (event: unknown, context: { paseo: PaseoApi }) => Promise<void>;
let steers: CaptainSteers;
beforeEach(async () => {
  const home = join(process.env.PASEO_HOME!, "home");
  await mkdir(join(home, "data"), { recursive: true });
  await updateFirstmateConfig({ home, mateAgentId: "", migration: null, mateLaunch: null, mateNotes: [] });
  await updateFirstmateConfig({ mateAgentId: "general-mate" });
  steers = new CaptainSteers();
  registerSteerRelay({ on: (_name: string, h: typeof handler) => { handler = h; return () => undefined; } } as never, steers);
});

it("a live, unscoped crewmate is relayed as before", async () => {
  steers.record(WORKER, "keep going", "firstmate-crew-steer-a");
  await handler(event, { paseo: api(agent({})) });
  expect((await readFirstmateConfig()).mateNotes).toEqual([expect.objectContaining({ burst: expect.objectContaining({ key: WORKER }) })]);
});

it.each([
  ["archived between the turn ending and the hook", agent({ archivedAt: "2026-10-28T00:00:00Z" })],
  ["whose re-check fails", async () => { throw new Error("daemon unavailable"); }],
] as const)("a worker %s is still relayed to the first mate, never silently dropped (R12-3)", async (_case, refresh) => {
  const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
  steers.record(WORKER, "keep going", "firstmate-crew-steer-b");
  await expect(handler(event, { paseo: api(refresh) })).resolves.toBeUndefined();
  const notes = (await readFirstmateConfig()).mateNotes;
  expect(notes).toHaveLength(1);
  expect(notes[0]!.text).toContain("keep going");
  expect(error).toHaveBeenCalledWith(expect.stringContaining("relaying them as before"), expect.anything());
  error.mockRestore();
});

it("a worker that became scoped is refused explicitly: the hook throws, and nothing reaches the first mate", async () => {
  const labels = { ...crew, ...workerLabels("00000000-0000-4000-8000-000000000001", { nodeId: "build" } as never, "00000000-0000-4000-8000-000000000002", { kind: "ship", project: "pilot" } as never) };
  steers.record(WORKER, "keep going", "firstmate-crew-steer-c");
  await expect(handler(event, { paseo: api(agent({ labels })) })).rejects.toThrow("belongs to a scoped supervisor");
  expect((await readFirstmateConfig()).mateNotes).toEqual([]);
});
