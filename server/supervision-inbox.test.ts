import { randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { inboxFixture, observation, ids, second, now } from "../test/supervision-inbox-fixture";
import { SupervisionInbox } from "./supervision-inbox";
import { SupervisionStore, type SupervisionMutation } from "./supervision-store";
import { expected } from "../test/supervision-fixture";
import { supervisionInboxStatus } from "./supervision-status";
import { SupervisionInboxStatusSchema } from "../shared/supervision-rpc";

async function files(path: string): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const entry of await readdir(path, { withFileTypes: true })) {
    if (entry.isDirectory()) Object.assign(out, await files(join(path, entry.name)));
    else out[join(path, entry.name)] = (await readFile(join(path, entry.name))).toString("base64");
  }
  return out;
}
async function offered() {
  const f = await inboxFixture();
  await f.events.admit(observation());
  await f.events.admit(observation({ sourceKey: "turn-2", turnId: "turn-2" }));
  const offer = await f.inbox.prepare(ids.scope, 1, true), offerId = offer.resultIds[0]!;
  const eventIds = (await f.store.read()).inbox.offers.find(o => o.id === offerId)!.eventIds;
  return { ...f, offerId, eventIds };
}
describe("S02 per-scope mailbox", () => {
  it("is disabled by default; reading creates no files, source calls or resources", async () => {
    const f = await inboxFixture(), before = await files(f.store.root);
    await expect(new SupervisionInbox(f.store).prepare(ids.scope, 1, true)).rejects.toMatchObject({ code: "UNSUPPORTED" });
    const reader = new SupervisionStore(f.dataRoot, f.home);
    const page = supervisionInboxStatus(await reader.read(), { scopeId: ids.scope }, now);
    expect(SupervisionInboxStatusSchema.parse(page)).toMatchObject({ offersEnabled: false, deliverySupported: false, counts: { pending: 0 } });
    expect(await files(f.store.root)).toEqual(before);
  });
  it("accepted offer replay remains readable with new offers disabled", async () => {
    const f = await inboxFixture(); await f.events.admit(observation());
    const requestId = randomUUID(), first = await f.inbox.prepare(ids.scope, 1, true, requestId);
    const disabled = new SupervisionInbox(new SupervisionStore(f.dataRoot, f.home));
    expect((await disabled.prepare(ids.scope, 1, true, requestId)).receipt).toEqual(first.receipt);
    await expect(disabled.prepare(ids.scope, 1, true)).rejects.toMatchObject({ code: "UNSUPPORTED" });
  });
  it("acceptance and acknowledgement do not handle anything or advance the watermark", async () => {
    const f = await offered();
    await f.inbox.beginSend(ids.scope, 1, f.offerId, true);
    await f.inbox.accepted(ids.scope, 1, f.offerId);
    let status = await f.store.read();
    expect(status.inbox.assignments.map(a => a.state)).toEqual(["offered", "offered"]);
    expect(status.inbox.mailboxes[0]?.watermark).toBe(0);
    await expect(f.inbox.acknowledge(ids.scope, 1, f.offerId, f.eventIds.slice(1))).rejects.toMatchObject({ code: "CONFLICT" });
    await f.inbox.acknowledge(ids.scope, 1, f.offerId, f.eventIds);
    status = await f.store.read();
    expect(status.inbox.assignments.map(a => a.state)).toEqual(["acknowledged", "acknowledged"]);
    expect(supervisionInboxStatus(status, {}, now).counts.acknowledgedUnhandled).toBe(2);
    expect(status.inbox.mailboxes[0]?.watermark).toBe(0);
  });
  it("only explicit durable results handle events; the contiguous watermark never skips a hole", async () => {
    const f = await offered();
    await f.inbox.beginSend(ids.scope, 1, f.offerId, true);
    await f.inbox.acknowledge(ids.scope, 1, f.offerId, f.eventIds); // Lost accepted response is not resent.
    const events = (await f.store.read()).inbox.events;
    const result = { kind: "no-action" as const, reason: "Inspected fixture evidence; no work requested.", evidenceIds: [events[0]!.envelope.payloadRef.slice(5)] };
    await f.inbox.handle(ids.scope, 1, f.offerId, [{ eventId: f.eventIds[1]!, result }]);
    expect((await f.store.read()).inbox.mailboxes[0]?.watermark).toBe(0);
    await f.inbox.handle(ids.scope, 1, f.offerId, [{ eventId: f.eventIds[0]!, result }]);
    expect((await f.store.read()).inbox.mailboxes[0]?.watermark).toBe(2);
    expect((await f.store.read()).plans).toEqual([]); // No workflow done/landed transition.
  });
  it("refuses fabricated handling evidence and nonterminal effects without changing store bytes", async () => {
    const f = await offered(); await f.inbox.beginSend(ids.scope, 1, f.offerId, true); await f.inbox.acknowledge(ids.scope, 1, f.offerId, f.eventIds);
    for (const result of [
      { kind: "no-action" as const, reason: "fabricated", evidenceIds: ["0".repeat(64)] },
      { kind: "result" as const, effectIds: [ids.effect], evidenceIds: [] },
      { kind: "result" as const, effectIds: [second.effect], evidenceIds: [] },
    ]) {
      const before = await files(f.store.root);
      await expect(f.inbox.handle(ids.scope, 1, f.offerId, [{ eventId: f.eventIds[0]!, result }])).rejects.toMatchObject({ code: "HELD" });
      expect(await files(f.store.root)).toEqual(before);
    }
  });
  it("pins exact request bytes; accepted replay survives later epoch replacement without new spend", async () => {
    const f = await offered(), requestId = randomUUID();
    await f.inbox.beginSend(ids.scope, 1, f.offerId, true);
    const first = await f.inbox.acknowledge(ids.scope, 1, f.offerId, f.eventIds, requestId);
    const old = (await f.store.read()).bindings.find(b => b.scopeId === ids.scope)!;
    for (const binding of [{ ...old, state: "suspect" as const }, { ...old, state: "prepared" as const, epoch: 2 }, { ...old, state: "active" as const, epoch: 2 }]) {
      const status = await f.store.read(); await f.store.transact([status.versions.find(v => v.kind === "binding" && v.id === ids.scope)!], randomUUID(), [{ kind: "binding", value: binding }]);
    }
    const before = await files(f.store.root);
    const replay = await f.inbox.acknowledge(ids.scope, 1, f.offerId, f.eventIds, requestId);
    expect(replay.receipt).toEqual(first.receipt); expect(replay.replayed).toBe(true);
    await expect(f.inbox.acknowledge(ids.scope, 1, f.offerId, [...f.eventIds].reverse(), requestId)).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(f.inbox.acknowledge(ids.scope, 1, f.offerId, f.eventIds)).rejects.toMatchObject({ code: "STALE" });
    expect(await files(f.store.root)).toEqual(before);
    await f.inbox.reoffer(ids.scope, 2);
    const replacement = await f.inbox.prepare(ids.scope, 2, true);
    const status = await f.store.read();
    expect(status.inbox.offers.find(o => o.id === f.offerId)?.state).toBe("retired");
    expect(status.inbox.offers.find(o => o.id === replacement.resultIds[0])?.eventIds).toEqual(f.eventIds);
    expect(status.inbox.events).toHaveLength(2); expect(status.attempts[0]?.spentAgents).toBe(1);
  });
  it("keeps unknown send uncertain, with stable informational offer identity and capped explicit retries", async () => {
    const f = await offered();
    let clock = now.getTime();
    const inbox = new SupervisionInbox(f.store, { offers: true, now: () => new Date(clock) });
    await inbox.beginSend(ids.scope, 1, f.offerId, true);
    await expect(inbox.beginSend(ids.scope, 1, f.offerId, true)).rejects.toMatchObject({ code: "HELD" });
    await expect(inbox.prepare(ids.scope, 1, true)).rejects.toMatchObject({ code: "HELD" });
    const blob = (await f.store.read()).inbox.events[0]!.envelope.payloadRef.slice(5);
    for (let sends = 1; sends < 3; sends++) {
      await inbox.reconcileNotAccepted(ids.scope, 1, f.offerId, blob);
      await expect(inbox.beginSend(ids.scope, 1, f.offerId, true)).rejects.toMatchObject({ code: "HELD" });
      clock += 60_000; await inbox.beginSend(ids.scope, 1, f.offerId, true);
    }
    await expect(inbox.reconcileNotAccepted(ids.scope, 1, f.offerId, blob)).rejects.toMatchObject({ code: "HELD" });
    const status = await f.store.read(); expect(status.inbox.offers).toHaveLength(1); expect(status.inbox.offers[0]).toMatchObject({ id: f.offerId, sends: 3, state: "uncertain" });
  });
  it("one busy/slow owner does not block another; General is never a mailbox dependency", async () => {
    const f = await inboxFixture();
    await Promise.all([f.events.admit(observation()), f.events.admit(observation({ agentId: "worker-b", sourceKey: "b:1" }))]);
    await expect(f.inbox.prepare(ids.scope, 1, false)).rejects.toMatchObject({ code: "HELD" });
    const b = await f.inbox.prepare(second.scope, 1, true); await f.inbox.beginSend(second.scope, 1, b.resultIds[0]!, true);
    const offer = (await f.store.read()).inbox.offers[0]!;
    await f.inbox.acknowledge(second.scope, 1, offer.id, offer.eventIds);
    const s = await f.store.read();
    expect(s.inbox.assignments.find(a => a.scopeId === ids.scope)?.state).toBe("assigned");
    expect(s.inbox.assignments.find(a => a.scopeId === second.scope)?.state).toBe("acknowledged");
    expect(s.scopes.some(scope => scope.kind === "general")).toBe(false);
  });
  it("rejects raw event admission missing a disposition atomically", async () => {
    const f = await inboxFixture(); await f.events.admit(observation());
    const status = await f.store.read(), event = status.inbox.events[0]!;
    const id = randomUUID(), mutations: SupervisionMutation[] = [{ kind: "inbox-event", value: { ...event, id, envelope: { ...event.envelope, eventId: id, source: { ...event.envelope.source, key: "unassigned" } } } }];
    const before = await files(f.store.root);
    await expect(f.store.transact(expected(mutations), randomUUID(), mutations)).rejects.toMatchObject({ code: "HELD" });
    expect(await files(f.store.root)).toEqual(before);
  });
  it("refuses forged contiguous watermark and foreign-scope disposition before publication", async () => {
    const f = await offered(), s = await f.store.read(), box = s.inbox.mailboxes[0]!, row = s.inbox.assignments[0]!;
    const before = await files(f.store.root);
    const badBox: SupervisionMutation[] = [{ kind: "inbox-mailbox", value: { ...box, watermark: 2, version: box.version + 1 } }];
    await expect(f.store.transact(expected(badBox, box.version), randomUUID(), badBox)).rejects.toMatchObject({ code: "HELD" });
    const badOwner: SupervisionMutation[] = [{ kind: "inbox-assignment", value: { ...row, scopeId: second.scope, version: row.version + 1 } }];
    await expect(f.store.transact(expected(badOwner, row.version), randomUUID(), badOwner)).rejects.toMatchObject({ code: "CONFLICT" });
    expect(await files(f.store.root)).toEqual(before);
  });
  it("binds accepted inbox replay markers to their actual publishing transaction", async () => {
    const f = await inboxFixture(), markerId = randomUUID(), transactionId = randomUUID();
    const batch: SupervisionMutation[] = [{ kind: "inbox-request", value: { id: markerId, inputHash: "a".repeat(64), resultIds: [], version: 1 } }];
    const before = await files(f.store.root);
    await expect(f.store.transact(expected(batch), transactionId, batch)).rejects.toMatchObject({ code: "CONFLICT" });
    expect(await files(f.store.root)).toEqual(before);
  });
  it("public event/source/offer pages are bounded and preserve complete pending/gap counts", async () => {
    const f = await inboxFixture();
    for (let i = 0; i < 6; i++) await f.events.admit(observation({ turnId: `t${i}`, sourceKey: `s${i}` }));
    await f.events.boot(); await f.inbox.prepare(ids.scope, 1, true);
    const s = await f.store.read(), first = supervisionInboxStatus(s, { scopeId: ids.scope, limit: 2 }, now);
    expect(first).toMatchObject({ counts: { pending: 6, sourcesWithGaps: 1 }, hasMore: true, nextAfter: 2 });
    const next = supervisionInboxStatus(s, { scopeId: ids.scope, after: first.nextAfter!, limit: 2 }, now);
    expect(next.entries.map(e => e.disposition.ordinal)).toEqual([3, 4]);
    const source = supervisionInboxStatus(s, { pageKind: "sources", limit: 1 }, now); expect(source.sources).toHaveLength(1); expect(source.hasMore).toBe(true);
    const offers = supervisionInboxStatus(s, { scopeId: ids.scope, pageKind: "offers" }, now); expect(offers.offers).toHaveLength(1);
    for (const page of [first, next, source, offers]) { expect(Buffer.byteLength(JSON.stringify(page))).toBeLessThanOrEqual(24 * 1024); expect(SupervisionInboxStatusSchema.safeParse(page).success).toBe(true); }
  });
});
