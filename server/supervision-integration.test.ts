import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { inboxFixture, observation, ids, now } from "../test/supervision-inbox-fixture";
import { SupervisionStore } from "./supervision-store";
import { hash } from "../test/supervision-fixture";

const actor = { kind: "agent" as const, id: "fixture-owner", source: "fixture/integrated-command" };
const result = { planId: null, planHash: null, decisionId: null, outboxId: null };

it("checked command publication rejects an inbox replay marker with another transaction identity", async () => {
  const f = await inboxFixture(), before = await f.store.read(), markerId = randomUUID();
  await expect(f.store.transactCommand(randomUUID(), hash, actor, async () => ({
    expectedVersions: [{ kind: "inbox-request", id: markerId, version: 0 }],
    mutations: [{ kind: "inbox-request", value: { id: markerId, inputHash: hash, resultIds: [], version: 1 } }], result,
  }))).rejects.toMatchObject({ code: "CONFLICT" });
  const fresh = await new SupervisionStore(f.dataRoot, f.home).read();
  expect(fresh.freshness).toBe("current"); expect(fresh.sequence).toBe(before.sequence); expect(fresh.hash).toBe(before.hash);
});

it("replays a checked command in a mixed mailbox journal without reauthorizing or losing handling", async () => {
  const f = await inboxFixture(), admitted = await f.events.admit(observation()), before = await f.store.read();
  const source = before.inbox.sources[0]!, requestId = randomUUID();
  const accepted = await f.store.transactCommand(requestId, hash, actor, async snapshot => {
    expect(snapshot.inbox.events).toEqual(before.inbox.events); expect(snapshot.commands).toEqual([]);
    return { expectedVersions: [{ kind: "inbox-source", id: source.id, version: source.version }],
      mutations: [{ kind: "inbox-source", value: { ...source, observedAt: new Date(now.getTime() + 1).toISOString(), version: source.version + 1 } }], result };
  });
  const offerId = (await f.inbox.prepare(ids.scope, 1, true)).resultIds[0]!;
  await f.inbox.beginSend(ids.scope, 1, offerId, true);
  await f.inbox.acknowledge(ids.scope, 1, offerId, admitted.resultIds);
  await f.inbox.handle(ids.scope, 1, offerId, [{ eventId: admitted.resultIds[0]!, result: { kind: "no-action", reason: "Inspected integrated fixture.", evidenceIds: [before.inbox.events[0]!.envelope.payloadRef.slice(5)] } }]);
  const reader = new SupervisionStore(f.dataRoot, f.home), handled = await reader.read();
  expect(await reader.transactCommand(requestId, hash, actor, async () => { throw Error("Accepted replay must not prepare"); })).toEqual(accepted);
  const fresh = await reader.read();
  expect(fresh).toEqual(handled); expect(fresh.freshness).toBe("current");
  expect(fresh.commands).toHaveLength(1); expect(fresh.inbox.mailboxes[0]?.watermark).toBe(1);
  expect(fresh.inbox.assignments[0]?.state).toBe("handled");
});
