import { randomUUID } from "node:crypto";
import { readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { inboxFixture, observation, api, timelinePage, ids, second, now } from "../test/supervision-inbox-fixture";
import { SupervisionEvents, sourceId } from "./supervision-events";
import { SupervisionStore, type SupervisionMutation } from "./supervision-store";
import { supervisionInboxStatus, hasScopedWorker } from "./supervision-status";
import { expected } from "../test/supervision-fixture";
import { markCrewSeen } from "./crew-seen";
import type { PaseoAgent, PaseoApi } from "./host-types";
import type { PluginLifecycleEvents } from "@getpaseo/plugin/server";
import { digest } from "./submissions";

describe("S02 durable local ingress", () => {
  it("deduplicates repeated source deliveries and joins cross-source provenance into one consequence", async () => {
    const f = await inboxFixture(), requestId = randomUUID(), original = observation();
    const first = await f.events.admit(original, requestId);
    expect((await f.events.admit(original, requestId)).receipt).toEqual(first.receipt);
    await f.events.admit(original);
    await f.events.admit({ ...original, sourceKind: "timeline", sourceKey: "timeline:1", epoch: "t1" });
    await f.events.admit({ ...original, sourceKind: "catalog", sourceKey: "catalog:1", epoch: null });
    const s = await f.store.read();
    expect(s.inbox.events).toHaveLength(3); expect(new Set(s.inbox.events.map(e => e.consequenceKey)).size).toBe(1);
    expect(s.inbox.assignments.map(a => a.state)).toEqual(["assigned", "superseded", "superseded"]);
    expect(s.inbox.mailboxes[0]).toMatchObject({ nextOrdinal: 2, watermark: 0 });
    expect(s.inbox.assignments[0]?.scopeId).toBe(ids.scope);
    expect(s.inbox.events.every(e => e.envelope.certainty !== "verified")).toBe(true);
    await expect(f.events.admit({ ...original, outcome: "failed" }, requestId)).rejects.toMatchObject({ code: "CONFLICT" });
  });
  it("never conflates null turn IDs, permissions or distinct workers", async () => {
    const f = await inboxFixture();
    for (const o of [observation({ turnId: null, sourceKey: "unknown:1" }), observation({ turnId: null, sourceKey: "unknown:2" }),
      observation({ agentId: "worker-b", sourceKey: "b:1" }), observation({ kind: "permission", turnId: null, permissionId: "p1", sourceKey: "p1" }),
      observation({ kind: "permission", turnId: null, permissionId: "p2", sourceKey: "p2" })]) await f.events.admit(o);
    const s = await f.store.read(); expect(new Set(s.inbox.events.map(e => e.consequenceKey)).size).toBe(5);
    expect(s.inbox.assignments.filter(a => a.scopeId === ids.scope)).toHaveLength(4);
    expect(s.inbox.assignments.filter(a => a.scopeId === second.scope)).toHaveLength(1);
  });
  it("retains changed content under a reused source key as quarantined conflict evidence", async () => {
    const f = await inboxFixture(); await f.events.admit(observation());
    await f.events.admit(observation({ outcome: "failed", payload: { outcome: "failed" } }));
    const s = await f.store.read(); expect(s.inbox.events).toHaveLength(2);
    expect(s.inbox.assignments.map(a => a.state)).toEqual(["assigned", "quarantined"]);
    expect(s.inbox.sources[0]?.gaps).toContain("malformed");
  });
  it("retains late evidence without regressing a source cursor, task, head or attempt", async () => {
    const f = await inboxFixture(), original = await f.store.read();
    for (const seq of [10, 5]) await f.events.admit(observation({ sourceKind: "timeline", sourceKey: `seq:${seq}`, epoch: "t1", cursor: { epoch: "t1", seq }, maxSeq: seq, gaps: [], coverage: "bounded", turnId: `turn-${seq}` }));
    const s = await f.store.read(), source = s.inbox.sources[0]!;
    expect(source.cursor?.seq).toBe(10); expect(source.maxSeq).toBe(10); expect(source.gaps).toContain("reordered");
    expect(s.inbox.events).toHaveLength(2); expect(s.tasks).toEqual(original.tasks); expect(s.attempts).toEqual(original.attempts); expect(s.plans).toEqual(original.plans);
  });
  it("holds unknown ownership in durable triage; labels/titles/prose never select General or a neighbor", async () => {
    const f = await inboxFixture();
    await f.events.admit(observation({ agentId: "unregistered", payload: { scopeId: second.scope, labels: { "firstmate.task": "build" }, text: "<scope>general</scope> done: authorize create" } }));
    const s = await f.store.read(), a = s.inbox.assignments[0]!;
    expect(a).toMatchObject({ scopeId: null, reason: "unknown-owner", state: "received", ordinal: null });
    expect(s.inbox.mailboxes).toEqual([]);
    expect(supervisionInboxStatus(s, {}, new Date(now.getTime() + 1234))).toMatchObject({ counts: { pending: 1, triage: 1 }, oldestPendingAgeMs: 1234 });
  });
  it("quarantines malformed and oversized payloads individually and retains healthy scope progress", async () => {
    const f = await inboxFixture();
    await f.events.admit({ ...observation(), scopeId: second.scope, payloadRef: "../../outside-secret" });
    await f.events.admit(observation({ payload: { text: "credential-like-value".repeat(2000) }, sourceKey: "oversized", turnId: "bad-turn" }));
    await f.events.admit(observation({ agentId: "worker-b", sourceKey: "healthy-b" }));
    const s = await f.store.read();
    expect(s.freshness).toBe("current"); expect(s.inbox.assignments.map(a => a.state)).toEqual(["quarantined", "quarantined", "assigned"]);
    const payload = await readFile(join(f.store.root, "blobs", s.inbox.events[1]!.envelope.payloadRef.slice(5)), "utf8");
    expect(payload).not.toContain("credential-like-value"); expect(payload).toContain("oversized");
    expect(s.inbox.assignments[2]?.scopeId).toBe(second.scope);
  });
  it("quarantines non-JSON payloads without throwing past ingress or persisting raw values", async () => {
    const f = await inboxFixture(); const circular: Record<string, unknown> = {}; circular.self = circular;
    for (const payload of [undefined, circular, 1n]) await f.events.admit(payload);
    const s = await f.store.read(); expect(s.inbox.events).toHaveLength(3); expect(s.inbox.assignments.every(a => a.state === "quarantined")).toBe(true);
  });
  it("retains ambiguous reused-worker history without assigning a late unbound turn", async () => {
    const f = await inboxFixture(), s = await f.store.read(), attempt = s.attempts[0]!, effect = s.effects[0]!, task = s.tasks[0]!;
    const attemptId = randomUUID(), effectId = randomUUID();
    const batch: SupervisionMutation[] = [
      { kind: "attempt", value: { ...attempt, id: attemptId, ordinal: 2, launchEffectId: effectId } },
      { kind: "effect", value: { ...effect, id: effectId, attemptId, logicalKey: "replacement-create" } },
      { kind: "task", value: { ...task, currentAttempt: attemptId, version: 2 } },
    ];
    await f.store.transact(batch.map(m => ({ ...expected([m])[0]!, version: m.kind === "task" ? 1 : 0 })), randomUUID(), batch);
    await f.events.admit(observation());
    const current = await f.store.read();
    expect(current.inbox.assignments[0]).toMatchObject({ scopeId: null, reason: "ambiguous-owner", candidates: [ids.scope] });
    expect(current.attempts).toHaveLength(3); expect(current.attempts.filter(a => a.taskId === task.id).reduce((n, a) => n + a.spentAgents, 0)).toBe(2);
  });
  it("a late cross-source duplicate keeps its original pinned attempt after worker reuse", async () => {
    const f = await inboxFixture(); await f.events.admit(observation());
    const s = await f.store.read(), attempt = s.attempts[0]!, effect = s.effects[0]!, task = s.tasks[0]!, attemptId = randomUUID(), effectId = randomUUID();
    const batch: SupervisionMutation[] = [{ kind: "attempt", value: { ...attempt, id: attemptId, ordinal: 2, launchEffectId: effectId } },
      { kind: "effect", value: { ...effect, id: effectId, attemptId, logicalKey: "reused-session-launch" } }, { kind: "task", value: { ...task, currentAttempt: attemptId, version: 2 } }];
    await f.store.transact(batch.map(m => ({ ...expected([m])[0]!, version: m.kind === "task" ? 1 : 0 })), randomUUID(), batch);
    await f.events.admit(observation({ sourceKind: "catalog", sourceKey: "late-duplicate", epoch: null }));
    expect((await f.store.read()).inbox.assignments.map(a => [a.state, a.attemptId])).toEqual([["assigned", ids.attempt], ["superseded", ids.attempt]]);
  });
  it("explicitly resolves unknown-owner triage once exact registry evidence exists, retaining prior provenance", async () => {
    const f = await inboxFixture(), input = observation({ agentId: "future-worker" });
    const first = await f.events.admit(input);
    await f.events.admit({ ...input, sourceKind: "catalog", sourceKey: "catalog-future", epoch: null });
    await expect(f.events.resolve(first.resultIds[0]!)).rejects.toMatchObject({ code: "UNKNOWN_OWNER" });
    const s = await f.store.read(), task = s.tasks.find(t => t.id === second.task)!, attempt = s.attempts.find(a => a.id === second.attempt)!, effect = s.effects.find(e => e.id === second.effect)!;
    const attemptId = randomUUID(), effectId = randomUUID();
    const batch: SupervisionMutation[] = [{ kind: "attempt", value: { ...attempt, id: attemptId, ordinal: 2, launchEffectId: effectId, worker: { hostId: "local", agentId: "future-worker", workspaceId: "future-workspace" } } },
      { kind: "effect", value: { ...effect, id: effectId, attemptId, logicalKey: "future-launch" } }, { kind: "task", value: { ...task, currentAttempt: attemptId, version: 2 } }];
    await f.store.transact(batch.map(m => ({ ...expected([m])[0]!, version: m.kind === "task" ? 1 : 0 })), randomUUID(), batch);
    await f.events.resolve(first.resultIds[0]!);
    const current = await f.store.read();
    expect(current.inbox.assignments[0]).toMatchObject({ scopeId: second.scope, attemptId, reason: "attempt-owner", state: "assigned", ordinal: 1 });
    expect(current.inbox.assignments[1]).toMatchObject({ scopeId: null, state: "superseded", primaryEventId: first.resultIds[0] });
    expect(supervisionInboxStatus(current, {}, now).counts).toMatchObject({ pending: 1, triage: 0 });
    expect((await f.inbox.prepare(second.scope, 1, true)).resultIds).toHaveLength(1);
  });
  it("saturation refuses admission durably, does not move source baseline or evict earlier critical events", async () => {
    const f = await inboxFixture({ maxPendingEvents: 1 });
    await f.events.admit(observation({ sourceKind: "timeline", epoch: "t1", cursor: { epoch: "t1", seq: 1 }, maxSeq: 1 }));
    const refused = await f.events.admit(observation({ sourceKind: "timeline", sourceKey: "seq:2", turnId: "turn2", epoch: "t1", cursor: { epoch: "t1", seq: 2 }, maxSeq: 2 }));
    expect(refused.resultIds).toEqual([]);
    const s = await f.store.read(); expect(s.inbox.events).toHaveLength(1); expect(s.inbox.sources[0]?.cursor?.seq).toBe(1);
    expect(s.inbox.sources[0]?.gaps).toContain("queue-pressure"); expect(supervisionInboxStatus(s, {}, now).admissionsHeld).toBe(true);
    // Duplicate provenance still fits because it adds no pending consequence.
    await f.events.admit(observation({ sourceKind: "catalog", epoch: null, sourceKey: "same-outcome" }));
    expect((await f.store.read()).inbox.assignments.map(a => a.state)).toEqual(["assigned", "superseded"]);
  });
  it("explicit boot reconciliation records gaps without interpreting an absent hook or idle agent as done", async () => {
    const f = await inboxFixture();
    await f.events.boot();
    const first = await f.store.read();
    expect(first.inbox.sources).toHaveLength(2); expect(first.inbox.sources.every(s => s.gaps.includes("boot") && s.gaps.includes("hook-not-durable"))).toBe(true);
    const restarted = new SupervisionEvents(f.store, { now: () => now }); await restarted.boot();
    const s = await f.store.read(); expect(s.inbox.sources.every(s => s.gaps.includes("epoch-changed"))).toBe(true);
    expect(s.inbox.events).toEqual([]); expect(s.attempts).toEqual(first.attempts); expect(s.inbox.assignments).toEqual([]);
  });
  it("uses public refetch for empty hook timeline, stores bounded metadata and never a done acknowledgement", async () => {
    const f = await inboxFixture(), refetch = vi.fn(async () => timelinePage());
    const event = { agent: { id: "worker-a" }, turnId: "turn-1", outcome: { kind: "completed" }, timeline: [] } as unknown as PluginLifecycleEvents["agent.turn_ended"];
    await f.events.ended(event, api(refetch));
    expect(refetch).toHaveBeenCalledWith({ direction: "tail", limit: 32, projection: "canonical" }, "worker-a");
    const s = await f.store.read(); expect(s.inbox.events).toHaveLength(2);
    expect(s.inbox.assignments.map(a => a.state)).toEqual(["assigned", "observed"]);
    expect(s.inbox.sources.find(c => c.kind === "timeline")).toMatchObject({ coverage: "bounded", cursor: { epoch: "timeline-1", seq: 1 } });
    expect(s.inbox.mailboxes[0]?.watermark).toBe(0);
    for (const name of await readdir(join(f.store.root, "blobs"))) expect(await readFile(join(f.store.root, "blobs", name), "utf8")).not.toContain("done: a reported status");
  });
  it.each(["empty", "error", "gap", "stale", "wrong-turn"])("keeps %s timeline coverage explicitly incomplete", async kind => {
    const f = await inboxFixture();
    const page = timelinePage({ ...(kind === "empty" ? { entries: [] } : {}), ...(kind === "error" ? { error: "secret-like-error-do-not-retain" } : {}),
      ...(kind === "gap" ? { gap: true } : {}), ...(kind === "stale" ? { staleCursor: true } : {}) });
    await f.events.timeline(api(async () => page), "worker-a", kind === "wrong-turn" ? "missing-turn" : "turn-1");
    const s = await f.store.read(); expect(s.inbox.sources[0]?.coverage).toBe("gap"); expect(s.inbox.sources[0]?.cursor).toBeNull();
    expect(s.inbox.events[0]?.envelope.certainty).toBe("inferred"); expect(s.inbox.mailboxes[0]?.watermark).toBe(1);
  });
  it.each(["cursor-epoch", "unordered", "too-many"])("refuses false coverage for malformed %s pages", async kind => {
    const f = await inboxFixture(), page = timelinePage();
    if (kind === "cursor-epoch") page.endCursor = { epoch: "foreign", seq: 1 };
    if (kind === "unordered") page.entries.push({ ...page.entries[0]!, seqStart: 0, seqEnd: 0 });
    if (kind === "too-many") page.entries = Array.from({ length: 33 }, (_, i) => ({ ...page.entries[0]!, seqStart: i + 1, seqEnd: i + 1 }));
    await f.events.timeline(api(async () => page), "worker-a");
    const s = await f.store.read(); expect(s.inbox.sources[0]).toMatchObject({ coverage: "gap", cursor: null }); expect(s.inbox.sources[0]?.gaps).toContain("malformed");
  });
  it("catalog reconciles exact pending permissions with hooks and retains status/evidence independently of General", async () => {
    const f = await inboxFixture(); await f.events.permission("worker-a", "p1");
    const agent = { id: "worker-a", status: "running", updatedAt: now.toISOString(), requiresAttention: false, pendingPermissions: [{ id: "p1" }] } as unknown as PaseoAgent;
    await f.events.catalog([agent], api(async () => { throw new Error("running agent must not refetch"); }));
    const s = await f.store.read(); expect(s.inbox.assignments.map(a => a.state)).toEqual(["assigned", "superseded", "observed"]);
    expect(s.inbox.events[0]?.consequenceKey).toBe(s.inbox.events[1]?.consequenceKey);
  });
  it("catalog observation for a fast scope continues while another scope's timeline request is pending", async () => {
    const f = await inboxFixture(); let release!: (p: ReturnType<typeof timelinePage>) => void;
    const agents = ["worker-a", "worker-b"].map(id => ({ id, status: "idle", updatedAt: now.toISOString(), requiresAttention: true, pendingPermissions: [] }) as unknown as PaseoAgent);
    const sweep = f.events.catalog(agents, api((_input, agentId) => agentId === "worker-a" ? new Promise(resolve => { release = resolve; }) : Promise.resolve(timelinePage({ agentId: "worker-b" }))));
    await vi.waitFor(async () => expect((await f.store.read()).inbox.events.some(e => e.envelope.source.kind === "timeline" && e.envelope.subject.agentId === "worker-b")).toBe(true));
    const b = await f.inbox.prepare(second.scope, 1, true); expect(b.resultIds).toHaveLength(1);
    release(timelinePage()); await sweep;
  });
  it("a malformed catalog subject records its gap while a different scope's timeline is still pending", async () => {
    const f = await inboxFixture(); let release!: (p: ReturnType<typeof timelinePage>) => void;
    const good = { id: "worker-a", status: "idle", updatedAt: now.toISOString(), requiresAttention: false, pendingPermissions: [] } as unknown as PaseoAgent;
    const malformed = { id: "worker-b", status: "idle" } as unknown as PaseoAgent;
    const sweep = f.events.catalog([good, malformed], api(() => new Promise(resolve => { release = resolve; })));
    let timeout: unknown;
    try {
      await vi.waitFor(async () => expect((await f.store.read()).inbox.sources.find(s => s.kind === "catalog" && s.agentId === "worker-b")?.gaps).toContain("fetch-failed"), { timeout: 1000 });
    } catch (error) { timeout = error; }
    await vi.waitFor(() => expect(release).toBeTypeOf("function")); release(timelinePage()); await sweep;
    if (timeout) throw timeout;
  });
  it("a failed timeline call exposes one source gap and omits raw error content", async () => {
    const f = await inboxFixture(); await f.events.timeline(api(async () => { throw new Error("credential-like-provider-error"); }), "worker-a");
    const s = await f.store.read(); expect(s.inbox.sources[0]).toMatchObject({ coverage: "gap", gaps: ["fetch-failed"] });
    for (const name of await readdir(join(f.store.root, "transactions"))) expect(await readFile(join(f.store.root, "transactions", name), "utf8")).not.toContain("credential-like-provider-error");
  });
  it("a changed timeline epoch starts a held reset, then an explicit valid tail can establish bounded coverage", async () => {
    const f = await inboxFixture(); await f.events.timeline(api(async () => timelinePage()), "worker-a");
    const reset = timelinePage({ epoch: "timeline-2", startCursor: { epoch: "timeline-2", seq: 1 }, endCursor: { epoch: "timeline-2", seq: 1 } });
    await f.events.timeline(api(async () => reset), "worker-a");
    expect((await f.store.read()).inbox.sources[0]).toMatchObject({ epoch: "timeline-2", cursor: null, coverage: "gap" });
    await f.events.timeline(api(async () => reset), "worker-a");
    expect((await f.store.read()).inbox.sources[0]).toMatchObject({ epoch: "timeline-2", cursor: { epoch: "timeline-2", seq: 1 }, coverage: "bounded" });
  });
  it("one slow timeline fetch cannot hold another scope's ingress/offer or overwrite a newer source version", async () => {
    const f = await inboxFixture();
    let release!: (p: ReturnType<typeof timelinePage>) => void;
    const slow = f.events.timeline(api(() => new Promise(resolve => { release = resolve; })), "worker-a");
    await vi.waitFor(() => expect(release).toBeTypeOf("function"));
    await f.events.admit(observation({ agentId: "worker-b", sourceKey: "b:complete" }));
    expect((await f.inbox.prepare(second.scope, 1, true)).resultIds).toHaveLength(1);
    await f.events.recordGap("timeline", "worker-a", "new-epoch", ["boot"]);
    release(timelinePage()); await expect(slow).rejects.toMatchObject({ code: "STALE" });
    expect((await f.store.read()).inbox.sources.find(s => s.id === sourceId("timeline", "worker-a"))?.epoch).toBe("new-epoch");
  });
  it("keeps scoped workers out of General's time-based crew-seen inference", async () => {
    const f = await inboxFixture(), status = await f.store.read(), clear = vi.fn();
    const crew = { id: "worker-a", labels: { "firstmate.role": "crew", "paseo.parent-agent-id": "general" }, requiresAttention: true, attentionReason: "finished", attentionTimestamp: now.toISOString(), pendingPermissions: [], status: "idle", archivedAt: null } as unknown as PaseoAgent;
    const paseo = { agents: { list: async () => ({ entries: [{ agent: crew }], pageInfo: { nextCursor: null } }) } } as unknown as PaseoApi;
    expect(hasScopedWorker(status, crew.id)).toBe(true);
    expect(await markCrewSeen(paseo, "general", now, clear, async id => !hasScopedWorker(status, id))).toEqual([]); expect(clear).not.toHaveBeenCalled();
  });
  it("preserves timers, disabled watches, schedules and offline coverage with zero resource/send calls", async () => {
    const f = await inboxFixture(), path = join(f.home, "..", "legacy-config.json");
    const legacy = { disabled: ["board-review", "workspace-review", "metis-pentest", "launch-metrics.mjs"], storage: { schedule: "15 3 * * *", timezone: "daemon-local", hosts: ["local", "Light-offline"] }, heartbeat: { id: "unknown-existing-owner", interval: "30m" } };
    await writeFile(path, JSON.stringify(legacy)); const before = digest(await readFile(path, "utf8"));
    const noResource = new Proxy({}, { get: () => { throw new Error("resource/send API forbidden"); } }) as PaseoApi;
    await f.events.boot(); await f.events.catalog([], noResource); supervisionInboxStatus(await f.store.read(), {}, now);
    expect(digest(await readFile(path, "utf8"))).toBe(before);
  });
});

describe("S02 ingress publication interruption", () => {
  it.each(["tip:linked", "event:linked", "publication:linked"])("%s never exposes cursor without its event/disposition", async point => {
    let crash = false;
    const f = await inboxFixture({ boundary: async name => { if (crash && name === point) { crash = false; throw new Error(`isolated fault ${point}`); } } });
    crash = true; const requestId = randomUUID();
    await expect(f.events.admit(observation({ sourceKind: "timeline", epoch: "t1", cursor: { epoch: "t1", seq: 1 }, maxSeq: 1 }), requestId)).rejects.toMatchObject({ code: "HELD" });
    let s = await new SupervisionStore(f.dataRoot, f.home).read();
    if (point === "publication:linked") {
      expect(s.freshness).toBe("current"); expect(s.inbox.events).toHaveLength(1); expect(s.inbox.assignments).toHaveLength(1); expect(s.inbox.sources[0]?.cursor?.seq).toBe(1);
      const replay = await f.events.admit(observation({ sourceKind: "timeline", epoch: "t1", cursor: { epoch: "t1", seq: 1 }, maxSeq: 1 }), requestId);
      expect(replay.replayed).toBe(true);
    } else {
      expect(s.freshness).toBe("held"); expect(s.inbox.events).toEqual([]); expect(s.inbox.sources).toEqual([]); expect(s.inbox.assignments).toEqual([]);
      if (point === "event:linked") {
        await f.store.recoverPublication(); s = await f.store.read();
        expect(s.inbox.events).toHaveLength(1); expect(s.inbox.assignments).toHaveLength(1); expect(s.inbox.sources[0]?.cursor?.seq).toBe(1);
      } else await expect(f.store.recoverPublication()).rejects.toMatchObject({ code: "HELD" });
    }
  });
});
