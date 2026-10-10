import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { afterEach, expect, it } from "vitest";
import { CURRENT_ROUTING, BOARD_REVIEW_ROUTING, ManagedWatchSchema, WatchRoutingSchema, createWatch, configureWatch } from "../shared/watch-routing";
import { WatchConfigStore, atomicJson } from "./watch-config";
import { processWatchRequests } from "./watch-requests";

const directories: string[] = [];
afterEach(async () => { for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true }); });
async function fixture() {
  const home = await mkdtemp(join(tmpdir(), "firstmate-watch-config-")); directories.push(home);
  return { home, store: new WatchConfigStore(join(home, "watch-config.json")) };
}
const pilot = { name: "board-review", schedule: "*/10 * * * *", prompt: "Review the board", enabled: true, ...BOARD_REVIEW_ROUTING };

it("requires explicit creation/config fields and rejects provider/model expansion", () => {
  expect(createWatch.input.safeParse({ name: "test", schedule: "* * * * *", prompt: "inspect", enabled: true }).success).toBe(false);
  expect(configureWatch.input.safeParse({ name: "test" }).success).toBe(false);
  expect(createWatch.input.safeParse({ ...pilot, provider: "other/model" }).success).toBe(false);
  expect(createWatch.input.safeParse({ ...pilot, model: "other" }).success).toBe(false);
  expect(createWatch.input.safeParse(pilot).success).toBe(true);
});
it("preserves current reasoning and forbids redundant current-session notification", () => {
  expect(WatchRoutingSchema.parse(CURRENT_ROUTING)).toEqual({ executionSession: "current", newSessionReasoning: "inherit", notificationPolicy: "never" });
  expect(WatchRoutingSchema.safeParse({ ...CURRENT_ROUTING, newSessionReasoning: "medium" }).success).toBe(false);
  expect(WatchRoutingSchema.safeParse({ ...CURRENT_ROUTING, notificationPolicy: "always" }).success).toBe(false);
});
it("validates names, cron and duplicates before persisting", async () => {
  const { store } = await fixture(); await store.create(pilot);
  await expect(store.create(pilot)).rejects.toThrow("already");
  await expect(store.create({ ...pilot, name: "other", schedule: "bad schedule" })).rejects.toThrow();
  expect(ManagedWatchSchema.safeParse({ ...pilot, name: "../../home" }).success).toBe(false);
  expect((await store.read()).watches).toEqual([pilot]);
});
it("keeps missing/legacy routing as current defaults, and fails closed on corrupt routing", async () => {
  const { store } = await fixture(); expect((await store.read()).scripts).toEqual({});
  await writeFile(store.path, JSON.stringify({ version: 1, scripts: {}, watches: [] }));
  expect((await store.read()).watches).toEqual([]);
  await writeFile(store.path, "broken"); await expect(store.read()).rejects.toThrow();
  await writeFile(store.path, JSON.stringify({ version: 1, scripts: { a: { ...BOARD_REVIEW_ROUTING, executionSession: "bad" } }, watches: [] }));
  await expect(store.read()).rejects.toThrow();
});
it("serializes independent config updates without losing fields", async () => {
  const { store } = await fixture(); await Promise.all([store.create(pilot), store.script("pr-watch", BOARD_REVIEW_ROUTING)]);
  expect((await store.read()).watches).toEqual([pilot]); expect((await store.read()).scripts["pr-watch"]).toEqual(BOARD_REVIEW_ROUTING);
});
it("processes typed home-tool requests with durable idempotent creation receipts", async () => {
  const { home, store } = await fixture(); const id = randomUUID(); const directory = join(home, "data", "watch-requests");
  await atomicJson(join(directory, `${id}.json`), { id, operation: "create", input: pilot });
  const handle: Parameters<typeof processWatchRequests>[1] = async (request) => {
    if (request.operation === "create") await store.create(request.input, request.id);
  };
  await processWatchRequests(home, handle);
  expect(JSON.parse(await readFile(join(directory, `${id}.reply.json`), "utf8"))).toEqual({ ok: true });
  await rm(join(directory, `${id}.reply.json`)); await processWatchRequests(home, handle);
  expect((await store.read()).watches).toHaveLength(1);
  await expect(store.create({ ...pilot, prompt: "changed" }, id)).rejects.toThrow("different");
});
it("rejects invalid request fields without altering config", async () => {
  const { home, store } = await fixture(); const id = randomUUID(); const directory = join(home, "data", "watch-requests");
  await atomicJson(join(directory, `${id}.json`), { id, operation: "create", input: { ...pilot, notificationPolicy: "bad" } });
  await processWatchRequests(home, async () => { throw new Error("must not reach handler"); });
  const result = JSON.parse(await readFile(join(directory, `${id}.reply.json`), "utf8")); expect(result.ok).toBe(false);
  expect((await store.read()).watches).toEqual([]);
});
it("does not starve pending tool requests behind retained completed receipts", async () => {
  const { home } = await fixture(); const directory = join(home, "data", "watch-requests");
  for (let index = 0; index < 21; index++) {
    const id = `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`;
    await atomicJson(join(directory, `${id}.json`), { id, operation: "create", input: pilot });
    await atomicJson(join(directory, `${id}.reply.json`), { ok: true });
  }
  const id = "ffffffff-ffff-4fff-8fff-ffffffffffff";
  await atomicJson(join(directory, `${id}.json`), { id, operation: "create", input: pilot });
  let calls = 0; await processWatchRequests(home, async () => { calls++; }); expect(calls).toBe(1);
});
