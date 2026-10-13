import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";
import type { SubmissionPayload, SubmissionReceipt } from "../shared/submissions";
import { SubmissionConflict, SubmissionStore } from "./submissions";

let root: string;
const namespace = { homeId: "home-1", fleetId: "fleet-1" };
const mate = { agentId: "mate", generation: "generation-1" };
const nextMate = { agentId: "mate", generation: "generation-2" };
const payload: SubmissionPayload = { ...namespace, topicId: "freeform", adviser: null, kind: "outcome", text: "Record this intake.", links: [] };
const store = () => new SubmissionStore(root, namespace);
const ack = (overrides: Partial<SubmissionReceipt> = {}): SubmissionReceipt => ({
  requestId: randomUUID(), actor: mate, disposition: "accepted-intake", note: "Filed intake; effects remain pending.",
  actions: [{ id: "intake", state: "completed", evidence: "data/intake/request-1" }, { id: "steer", state: "pending", evidence: "" }], ...overrides,
});
beforeEach(async () => { root = await mkdtemp(join(tmpdir(), "firstmate-submissions-")); await store().initialize(); });
afterEach(async () => { await rm(root, { recursive: true, force: true }); });

it("persists immutable content and deduplicates concurrent same-ID retries after process loss", async () => {
  const id = randomUUID();
  await Promise.all([store().prepare(id, payload), store().prepare(id, payload)]);
  const saved = (await store().list())[0]!;
  expect(saved).toMatchObject({ id, revision: 0, transport: "queued", payload });
  expect(await store().prepare(id, payload)).toEqual(saved);
  expect(await readdir(join(root, id))).toEqual(["00000000.json"]);
  // The same words under a new intent identity are legitimate, not text-deduplicated.
  await store().prepare(randomUUID(), payload);
  expect(await store().list()).toHaveLength(2);
});

it("binds every routing/content field, returning the saved receipt on conflict", async () => {
  const id = randomUUID(); const original = await store().prepare(id, payload);
  for (const changed of [{ text: "Changed" }, { links: ["task"] }, { topicId: "different" },
    { adviser: mate }, { kind: "decision-answer" as const }, { replyTo: randomUUID() }, { corrects: randomUUID() }]) {
    await expect(store().prepare(id, { ...payload, ...changed })).rejects.toMatchObject({ saved: original });
  }
  await expect(store().prepare(id, { ...payload, fleetId: "other" })).rejects.toThrow("Wrong submission home/fleet");
});

it("recovers the identity even when prepare commits and its reply is lost", async () => {
  const id = randomUUID();
  const crashing = new SubmissionStore(root, namespace, async () => { throw new Error("process lost after commit"); });
  await expect(crashing.prepare(id, payload)).rejects.toThrow("process lost");
  expect(await store().recoveryInbox()).toMatchObject([{ id, transport: "queued" }]);
  expect((await store().prepare(id, payload)).revision).toBe(0);
});

it("ignores unpublished temporary bytes without treating file existence as submission", async () => {
  const id = randomUUID(); await mkdir(join(root, id));
  await writeFile(join(root, id, `00000000.json.${randomUUID()}.tmp`), "partial");
  expect(await store().get(id)).toBeNull();
  await store().prepare(id, payload);
  expect(await store().recoveryInbox()).toMatchObject([{ id, transport: "queued" }]);
});

it("never replays a claim lost before send, or an accepted send whose reply was lost", async () => {
  for (const actuallySent of [false, true]) {
    const id = randomUUID(); await store().prepare(id, payload);
    let sends = 0;
    const claimed = await store().beginDelivery(id, mate);
    if (actuallySent) sends++;
    const recovered = await store().get(id);
    expect(recovered).toMatchObject({ transport: "uncertain", attempts: claimed.attempts });
    await expect(store().beginDelivery(id, mate)).rejects.toThrow("reconcile uncertainty");
    expect(sends).toBe(Number(actuallySent));
    expect((await store().recoveryInbox()).some(r => r.id === id)).toBe(true);
  }
});

it("keeps a durable uncertain claim when its persistence reply is lost", async () => {
  const id = randomUUID(); await store().prepare(id, payload);
  await expect(new SubmissionStore(root, namespace, async () => { throw new Error("crash"); }).beginDelivery(id, mate)).rejects.toThrow("crash");
  expect(await store().get(id)).toMatchObject({ transport: "uncertain", owner: mate });
  await expect(store().beginDelivery(id, mate)).rejects.toThrow();
});

it("accepts only matching affirmative delivery evidence, and recorded does not mean acted", async () => {
  const id = randomUUID(); await store().prepare(id, payload); const claimed = await store().beginDelivery(id, mate);
  const attempt = claimed.attempts[0]!;
  await expect(store().recordDelivery(id, attempt.id, "changed hash", "timeline")).rejects.toBeInstanceOf(SubmissionConflict);
  await expect(store().recordDelivery(id, attempt.id, claimed.payloadHash, "")).rejects.toThrow();
  const recorded = await store().recordDelivery(id, attempt.id, claimed.payloadHash, "user-message exact envelope");
  expect(recorded.transport).toBe("recorded");
  expect(recorded.receipts).toEqual([]);
  expect(await store().recoveryInbox()).toHaveLength(1);
});

it("recovers accepted intake and partial effects across mate generation transfer", async () => {
  const id = randomUUID(); await store().prepare(id, payload); await store().beginDelivery(id, mate);
  const receipt = ack(); await store().acknowledge(id, receipt, mate);
  await store().transfer(id, mate, nextMate);
  expect(await store().recoveryInbox()).toMatchObject([{ id, owner: nextMate, receipts: [receipt], transport: "uncertain" }]);
  await expect(store().acknowledge(id, ack(), mate)).rejects.toThrow("Stale mate generation");
  await expect(store().acknowledge(id, ack({ actor: nextMate }), mate)).rejects.toThrow("not verified");
  await expect(store().acknowledge(id, ack({ actor: nextMate, actions: [] }), nextMate)).rejects.toThrow("loses recorded action progress");
  const completed = ack({ actor: nextMate, disposition: "completed", actions: [receipt.actions[0]!, { id: "steer", state: "completed", evidence: "worker-message-id" }] });
  await store().acknowledge(id, completed, nextMate);
  expect(await store().recoveryInbox()).toEqual([]);
  expect((await store().get(id))!.receipts).toEqual([receipt, completed]);
  await expect(store().transfer(id, nextMate, mate)).rejects.toThrow("terminal");
});

it("atomically keeps ack identity with its effect across lost reply, conflicts and terminal retries", async () => {
  const id = randomUUID(); await store().prepare(id, payload); await store().beginDelivery(id, mate);
  const receipt = ack({ disposition: "declined", actions: [] });
  await expect(new SubmissionStore(root, namespace, async () => { throw new Error("reply lost"); }).acknowledge(id, receipt, mate)).rejects.toThrow("reply lost");
  expect((await store().acknowledge(id, receipt, mate)).receipts).toEqual([receipt]);
  await expect(store().acknowledge(id, { ...receipt, note: "different" }, mate)).rejects.toThrow("different content");
  await expect(store().acknowledge(id, ack(), mate)).rejects.toThrow("terminal");
});

it("keeps both the earlier instruction and a corrective submission", async () => {
  const id = randomUUID(); await store().prepare(id, payload); await store().beginDelivery(id, mate);
  const correctionId = randomUUID(); await store().prepare(correctionId, { ...payload, text: "Correction", corrects: id });
  expect(await store().recoveryInbox()).toHaveLength(2);
  expect((await store().get(id))!.transport).toBe("uncertain");
});

it("fails closed on missing store identity, foreign home, malformed record, gaps or changed payload", async () => {
  const id = randomUUID(); await store().prepare(id, payload); await store().beginDelivery(id, mate);
  await expect(new SubmissionStore(root, { ...namespace, homeId: "other" }).list()).rejects.toThrow("different home/fleet");
  const first = join(root, id, "00000000.json");
  const text = await readFile(first, "utf8");
  await writeFile(first, "{"); await expect(store().list()).rejects.toThrow();
  await writeFile(first, text.replace("Record this intake.", "Different text."));
  await expect(store().list()).rejects.toThrow("identity/content mismatch");
  await rm(first); await expect(store().list()).rejects.toThrow("revision gap");
  await rm(join(root, "identity.json"));
  await expect(store().prepare(randomUUID(), payload)).rejects.toThrow("ENOENT");
  await expect(store().initialize()).rejects.toThrow("nonempty store");
});
