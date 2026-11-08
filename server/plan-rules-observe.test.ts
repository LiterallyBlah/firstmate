import { describe, expect, it, vi } from "vitest";
import { inboxFixture, observation } from "../test/supervision-inbox-fixture";
import { PlanRules } from "./plan-rules";
import { digest } from "./submissions";

/** An assigned, non-failure turn per index, each with its own evidence blob. */
async function assigned(f: Awaited<ReturnType<typeof inboxFixture>>, count: number) {
  for (let n = 0; n < count; n++)
    await f.events.admit(observation({ turnId: `turn-${n}`, sourceKey: `worker-a:turn-${n}:completed`, payload: { outcome: "completed", n } }));
}
function counted(f: Awaited<ReturnType<typeof inboxFixture>>) {
  return { blobs: vi.spyOn(f.store, "readBlob"), reads: vi.spyOn(f.store, "read") };
}

describe("PlanRules.observeFailures on an idle clock", () => {
  it("reads each assigned event's evidence once, not on every tick, and never re-reads the journal per blob", async () => {
    const f = await inboxFixture(), events = 40;
    await assigned(f, events);
    const s = await f.store.read();
    expect(s.inbox.assignments.filter(a => a.id === a.primaryEventId && a.scopeId && a.attemptId)).toHaveLength(events);
    const rules = new PlanRules(f.store, f.home), spy = counted(f);
    await rules.observeFailures();
    // The first tick judges every assigned event once, against the one journal read the tick made.
    expect(spy.blobs).toHaveBeenCalledTimes(events);
    expect(spy.reads).toHaveBeenCalledTimes(1);
    for (const call of spy.blobs.mock.calls) expect(call[2]).toBeDefined();
    spy.blobs.mockClear(); spy.reads.mockClear();
    for (let tick = 0; tick < 5; tick++) await rules.observeFailures();
    // Idle ticks: one journal read each, no evidence re-read. Before the fix: `events` blob reads per
    // tick, each with its own full journal read.
    expect(spy.blobs).not.toHaveBeenCalled();
    expect(spy.reads).toHaveBeenCalledTimes(5);
    expect(rules.evidenceReads).toBe(events);
    expect((await f.store.read()).ruleFailures ?? []).toHaveLength(0);
  });

  it("still observes a new failed turn on the next tick, exactly as before", async () => {
    const f = await inboxFixture();
    await assigned(f, 5);
    const rules = new PlanRules(f.store, f.home);
    await rules.observeFailures(); await rules.observeFailures();
    const spy = counted(f);
    await f.events.admit(observation({ turnId: "turn-failed", outcome: "failed", sourceKey: "worker-a:turn-failed:failed", payload: { kind: "failed", reason: "crash" } }));
    spy.blobs.mockClear();
    await rules.observeFailures();
    expect(spy.blobs).toHaveBeenCalledTimes(1);
    const s = await f.store.read(), event = s.inbox.events.find(e => e.envelope.subject.turnId === "turn-failed")!;
    expect(s.ruleFailures).toHaveLength(1);
    expect(s.ruleFailures![0]).toMatchObject({ category: "failed-live-turn", attemptId: s.inbox.assignments.find(a => a.id === event.id)!.attemptId,
      evidence: { digest: event.envelope.evidence[0]!.digest, verifier: "scoped-ingress", method: "automatic" } });
    // Once recorded, the failure is not read or recorded again.
    spy.blobs.mockClear();
    await rules.observeFailures(); await rules.observeFailures();
    expect(spy.blobs).not.toHaveBeenCalled();
    expect((await f.store.read()).ruleFailures).toHaveLength(1);
  });

  it("re-judges an event whose evidence changes", async () => {
    const f = await inboxFixture();
    await assigned(f, 3);
    await f.events.admit(observation({ turnId: "turn-failed", outcome: "failed", sourceKey: "worker-a:turn-failed:failed", payload: { kind: "failed" } }));
    const real = await f.store.read(), failedEvent = real.inbox.events.find(e => e.envelope.subject.turnId === "turn-failed")!;
    const first = real.inbox.events.find(e => e.envelope.subject.turnId === "turn-0")!;
    // Hold the failed event out of the first ticks, so only the three completions are judged.
    const without = { ...real, inbox: { ...real.inbox, events: real.inbox.events.filter(e => e.id !== failedEvent.id) } };
    const reads = vi.spyOn(f.store, "read").mockResolvedValue(without);
    const rules = new PlanRules(f.store, f.home), blobs = vi.spyOn(f.store, "readBlob");
    await rules.observeFailures(); await rules.observeFailures();
    expect(blobs).toHaveBeenCalledTimes(3);
    // The same event now names different (committed) evidence: it is read again and judged on it.
    const changed = structuredClone(without);
    changed.inbox.events.find(e => e.id === first.id)!.envelope.evidence[0]!.digest = failedEvent.envelope.evidence[0]!.digest;
    reads.mockResolvedValue(changed);
    blobs.mockClear();
    await rules.observeFailures();
    expect(blobs).toHaveBeenCalledTimes(1);
    expect(blobs.mock.calls[0]![0]).toBe(failedEvent.envelope.evidence[0]!.digest);
    reads.mockRestore();
    expect((await f.store.read()).ruleFailures?.map(r => r.evidence.provenance)).toEqual([expect.stringContaining(first.id)]);
  });

  it("refuses a caller status from another home for a blob read", async () => {
    const f = await inboxFixture();
    await assigned(f, 1);
    const s = await f.store.read(), blob = s.inbox.events[0]!.envelope.evidence[0]!.digest;
    await expect(f.store.readBlob(blob, undefined, { ...s, homeId: digest("other") })).rejects.toMatchObject({ code: "CONFLICT" });
    expect(Buffer.from(await f.store.readBlob(blob, undefined, s)).toString("utf8")).toContain("completed");
  });
});
