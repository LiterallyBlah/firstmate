/** S11 under the conservative D6 amendment: every strong capability is refused on the installed contracts, the
 * S00 probe rows are kept unchanged, and a later delivery could enable one only with a public contract, a
 * supported version and live receiver evidence. Pure: no daemon, provider or journal. */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  COOPERATIVE_LIMITS, evaluateStrongCapabilities, EXECUTOR_CONDITIONS, executorApproval, requireStrong, S00_STRONG_ROWS, s00Column,
  SHIPPED_QUALIFICATIONS, STRONG_CAPABILITIES, STRONG_LIMIT, strongFlags, StrongQualificationSchema, type S00Row,
} from "./supervision-capabilities";
import { bindStrongReceivers, readAdmission, refuseStaleAdmission } from "./supervision-receivers";

const ALL = STRONG_CAPABILITIES.map(c => c.id);
const qualification = (capability: string, min = "0.14.0", max = "0.14.9") => ({
  format: "firstmate.strong-qualification/1", capability,
  publicContract: { package: "@getpaseo/plugin", version: "0.14.0", signature: "paseo.effects.admit(request)" },
  supported: { min, max }, qualification: "live-receiver",
  receiverEvidence: [{ kind: "receiver-canary", ref: "canary/delayed-fence.json", digest: "a".repeat(64) },
    { kind: "bypass-analysis", ref: "bypass/raw-cli-shell.md", digest: "b".repeat(64) }],
});
/** A hypothetical later S00 re-probe of the installed 0.13 in which the primitives were delivered. Test-only. */
const s013 = { s00: Object.fromEntries(Object.keys(S00_STRONG_ROWS).map(k => [k, { floor011: "unsupported", proposal012: "unsupported", disk013: "source-supported" }])) as Record<S00Row, never> };

describe("S00 probes are kept, not re-derived", () => {
  it("holds the strong rows equal to the frozen S00 capability table", () => {
    const examples = JSON.parse(readFileSync(join(process.cwd(), "test/fixtures/supervision-s00/examples.json"), "utf8"));
    const rows = examples.find((x: { kind: string }) => x.kind === "CapabilityTable").value.rows as { id: string; floor011: string; proposal012: string; disk013: string; liveQualified: boolean }[];
    for (const [id, columns] of Object.entries(S00_STRONG_ROWS)) {
      const row = rows.find(r => r.id === id)!;
      expect({ floor011: row.floor011, proposal012: row.proposal012, disk013: row.disk013 }).toEqual(columns);
      expect(row.liveQualified).toBe(false);
    }
    for (const c of STRONG_CAPABILITIES) for (const r of c.rows) expect(rows.some(x => x.id === r)).toBe(true);
  });
  it("maps only the versions S00 inspected to a column", () => {
    expect([s00Column("0.11.0"), s00Column("0.12.0"), s00Column("0.13.0"), s00Column("0.14.0"), s00Column("1.0.0"), s00Column("x")])
      .toEqual(["floor011", "proposal012", "disk013", null, null, null]);
  });
});

describe("A18: each strong capability is explicitly supported or refused", () => {
  it("is cooperative and off by default, with its limits stated and no confinement claim", () => {
    expect(strongFlags({})).toEqual([]);
    expect(SHIPPED_QUALIFICATIONS).toEqual([]);
    const report = evaluateStrongCapabilities({ installedVersion: "0.13.0", flags: strongFlags({}) });
    expect(report.mode).toBe("cooperative");
    expect(report.capabilities.map(c => c.state)).toEqual(ALL.map(() => "off"));
    expect(report.limits).toBe(COOPERATIVE_LIMITS);
    expect(report.claims).toEqual({ authenticatedCallers: false, receiverExclusion: false, automaticFailover: false, automaticTakeover: false,
      conditionalArchive: false, fullAccessConfinement: false });
    for (const words of ["bypass", "No strong isolation", "No automatic failover or takeover", "No conditional archive", "advisory"])
      expect(report.limits.join(" ")).toContain(words);
  });
  it("refuses every requested capability on 0.11, 0.12 and installed 0.13: S00 unsupported and no qualified contract", () => {
    for (const version of ["0.11.0", "0.12.0", "0.13.0"]) {
      const report = evaluateStrongCapabilities({ installedVersion: version, flags: ALL });
      expect(report.mode).toBe("cooperative");
      for (const c of report.capabilities) {
        expect(c).toMatchObject({ requested: true, state: "refused" });
        expect(c.reasons.join(" ")).toMatch(/S00 row .* is unsupported/);
        expect(c.reasons.join(" ")).toMatch(/No public contract with receiver evidence/);
        expect(() => requireStrong(report, c.id)).toThrow(expect.objectContaining({ code: "UNSUPPORTED", message: expect.stringContaining("nothing falls back to cooperative mode") }));
      }
    }
  });
  it("never borrows a newer document: an unknown or uninspected version refuses even with a qualification", () => {
    for (const installedVersion of [null, "0.14.0", "garbage"]) {
      const report = evaluateStrongCapabilities({ installedVersion, flags: ["conditional-archive"], qualifications: [qualification("conditional-archive")] });
      expect(report.capabilities.find(c => c.id === "conditional-archive")).toMatchObject({ state: "refused", reasons: expect.arrayContaining([expect.stringMatching(/S00 did not inspect/)]) });
    }
  });
  it("a qualification alone does not enable a capability S00 marks unsupported at that version", () => {
    const report = evaluateStrongCapabilities({ installedVersion: "0.13.0", flags: ["receiver-fence"], qualifications: [qualification("receiver-fence", "0.13.0", "0.13.9")] });
    expect(report.capabilities.find(c => c.id === "receiver-fence")).toMatchObject({ state: "refused", reasons: [expect.stringMatching(/authenticated-admission is unsupported/), expect.stringMatching(/send-receipt is unsupported/)] });
  });
  it("rejects synthetic or incomplete evidence, and reports malformed records and unknown flags", () => {
    expect(StrongQualificationSchema.safeParse({ ...qualification("receiver-fence"), qualification: "synthetic-fixture" }).success).toBe(false);
    expect(StrongQualificationSchema.safeParse({ ...qualification("receiver-fence"), receiverEvidence: [qualification("x").receiverEvidence[0]] }).success).toBe(false);
    expect(StrongQualificationSchema.safeParse({ ...qualification("receiver-fence"), publicContract: { package: "p", version: "latest", signature: "s" } }).success).toBe(false);
    const report = evaluateStrongCapabilities({ installedVersion: "0.13.0", flags: ["receiver-fence", "isolation"], qualifications: [{ capability: "receiver-fence" }] });
    expect(report.problems).toEqual([expect.stringContaining("isolation"), expect.stringContaining("1 qualification record(s) are malformed")]);
  });
  it("a later delivery enables a capability only with its flag, an S00-supported column and a covering live qualification", () => {
    const q = qualification("conditional-archive", "0.13.0", "0.13.9");
    expect(evaluateStrongCapabilities({ installedVersion: "0.13.0", flags: ["conditional-archive"], qualifications: [q], ...s013 }).capabilities
      .find(c => c.id === "conditional-archive")).toMatchObject({ state: "enabled", reasons: [] });
    // Off without its flag; refused outside its version range; refused for another capability's evidence.
    expect(evaluateStrongCapabilities({ installedVersion: "0.13.0", flags: [], qualifications: [q], ...s013 }).capabilities.find(c => c.id === "conditional-archive")!.state).toBe("off");
    expect(evaluateStrongCapabilities({ installedVersion: "0.13.0", flags: ["conditional-archive"], qualifications: [qualification("conditional-archive", "0.13.1", "0.13.9")], ...s013 })
      .capabilities.find(c => c.id === "conditional-archive")).toMatchObject({ state: "refused", reasons: [expect.stringMatching(/does not cover installed version 0.13.0/)] });
    expect(evaluateStrongCapabilities({ installedVersion: "0.13.0", flags: ["conditional-archive"], qualifications: [qualification("conditional-archive", "0.12.0", "0.12.9")], ...s013 })
      .capabilities.find(c => c.id === "conditional-archive")).toMatchObject({ state: "refused", reasons: [expect.stringMatching(/does not cover installed version 0.13.0/)] });
    expect(evaluateStrongCapabilities({ installedVersion: "0.13.0", flags: ["durable-subscriptions"], qualifications: [q], ...s013 })
      .capabilities.find(c => c.id === "durable-subscriptions")!.state).toBe("refused");
  });
  it("never claims automatic failover or takeover, even with every primitive: S04 replaces supervisors manually (R11 N6)", () => {
    const quals = ALL.map(id => qualification(id, "0.13.0", "0.13.0"));
    const partial = evaluateStrongCapabilities({ installedVersion: "0.13.0", flags: ALL.filter(id => id !== "heartbeat-transfer"), qualifications: quals, ...s013 });
    expect(partial.mode).toBe("cooperative");
    expect(partial.claims).toMatchObject({ authenticatedCallers: true, receiverExclusion: true, automaticFailover: false, automaticTakeover: false, fullAccessConfinement: false });
    const all = evaluateStrongCapabilities({ installedVersion: "0.13.0", flags: ALL, qualifications: quals, ...s013 });
    expect(all.mode).toBe("strong");
    expect(all.limits).toEqual([STRONG_LIMIT]);
    expect(all.claims).toEqual({ authenticatedCallers: true, receiverExclusion: true, automaticFailover: false, automaticTakeover: false, conditionalArchive: true, fullAccessConfinement: false });
  });
  it("matches only the exact versions S00 inspected; other patches and prereleases are unqualified (R11 N7)", () => {
    for (const v of ["0.13.1", "0.13.0-beta.1", "0.11.2", "0.12.9"]) {
      expect(s00Column(v)).toBeNull();
      expect(evaluateStrongCapabilities({ installedVersion: v, flags: ["conditional-archive"], qualifications: [qualification("conditional-archive", "0.11.0", "0.13.9")], ...s013 })
        .capabilities.find(c => c.id === "conditional-archive")).toMatchObject({ state: "refused", reasons: expect.arrayContaining([expect.stringMatching(/S00 did not inspect/)]) });
    }
  });
});

describe("U1–U3 receiver seams refuse what is not delivered", () => {
  const off = evaluateStrongCapabilities({ installedVersion: "0.13.0", flags: [] });
  const receiver = { admitEffect: async () => ({}), getEffect: async () => null };
  const subscriptions = { list: async () => [], transfer: async () => ({}), cancel: async () => ({}) };
  const enabled = (ids: string[]) => evaluateStrongCapabilities({ installedVersion: "0.13.0", flags: ids, qualifications: ids.map(id => qualification(id, "0.13.0", "0.13.0")), ...s013 });
  it("binds nothing and refuses any supplied receiver whose capability is not enabled", () => {
    expect(bindStrongReceivers(off, {})).toEqual({});
    expect(() => bindStrongReceivers(off, { admission: receiver })).toThrow(expect.objectContaining({ code: "UNSUPPORTED" }));
    expect(() => bindStrongReceivers(off, { archive: { archiveIfUnchanged: async () => ({}) } })).toThrow(expect.objectContaining({ code: "UNSUPPORTED" }));
    const on = enabled(["authenticated-caller", "receiver-fence"]);
    expect(bindStrongReceivers(on, { admission: receiver })).toEqual({ admission: receiver });
    expect(() => bindStrongReceivers(on, { subscriptions })).toThrow(/durable-subscriptions/);
  });
  it("a subscription receiver needs heartbeat transfer as well as durable subscriptions (R11 N1/C06)", () => {
    expect(() => bindStrongReceivers(enabled(["durable-subscriptions"]), { subscriptions })).toThrow(/heartbeat-transfer/);
    expect(bindStrongReceivers(enabled(["durable-subscriptions", "heartbeat-transfer"]), { subscriptions })).toEqual({ subscriptions });
  });
  it("reads a U1 receipt strictly: a delayed old fence is STALE, a malformed or foreign answer is uncertain", () => {
    const stale = readAdmission("effect-1", { effectId: "e1", effectKey: "effect-1", state: "rejected", receiptVersion: 2, caller: "scope-a@1", reason: "stale-fence" });
    expect(() => refuseStaleAdmission(stale as never)).toThrow(expect.objectContaining({ code: "STALE" }));
    expect(readAdmission("effect-1", { effectKey: "effect-1", state: "admitted" })).toMatchObject({ state: "uncertain" });
    expect(readAdmission("effect-1", { effectId: "e2", effectKey: "effect-2", state: "admitted", receiptVersion: 1, caller: "c", reason: null })).toMatchObject({ state: "uncertain" });
    expect(() => refuseStaleAdmission(readAdmission("effect-1", { effectId: "e1", effectKey: "effect-1", state: "admitted", receiptVersion: 1, caller: "c", reason: null }) as never)).not.toThrow();
  });
  it("ties the reason to the state: a reason without a rejection, or a rejection without one, is uncertain (R11 N8)", () => {
    for (const state of ["admitted", "not-admitted", "succeeded", "failed", "uncertain"])
      expect(readAdmission("k", { effectId: "e", effectKey: "k", state, receiptVersion: 1, caller: "c", reason: "stale-fence" })).toMatchObject({ state: "uncertain" });
    expect(readAdmission("k", { effectId: "e", effectKey: "k", state: "rejected", receiptVersion: 1, caller: "c", reason: null })).toMatchObject({ state: "uncertain" });
  });
});

describe("R10 round-3 and R11 executor-approval conditions", () => {
  const run = (extra: object = {}, result: object = {}) => JSON.stringify({ paseo: "0.13.0", verdict: "both readers complete", ...extra,
    result: { retainedWorkspaces: { result: "complete", value: { workspaces: [], paths: [] } }, nativeSchedules: { complete: true, schedules: [{ id: "s" }] }, ...result } });
  const seeded = { history: { pages: 2, entries: 3, unavailableProviderSessions: 1 } };
  const ack = ["N7", "receiver"], executor = { deleteFollowsLinks: false };
  it("lists realpath, E1–E3, no-follow deletion, the live readers, N7 and the receiver limit", () => {
    expect(EXECUTOR_CONDITIONS.map(c => c.id)).toEqual(["realpath", "E1", "E2", "E3", "no-follow-delete", "live-readers", "N7", "receiver"]);
  });
  it("refuses approval by default; code conditions are met, the executor, evidence and the gate's acknowledgements are not", () => {
    const a = executorApproval({ installedVersion: "0.13.0" });
    expect(a.approved).toBe(false);
    expect(a.conditions.filter(c => !c.satisfied).map(c => c.id)).toEqual(["no-follow-delete", "live-readers", "N7", "receiver"]);
  });
  it("the S11 smoke run is PARTIAL: an empty history cannot close the live-reader condition (R11 N2)", () => {
    const artifact = readFileSync(join(process.cwd(), "docs/scoped-supervision/s11-readers/result.json"), "utf8");
    const a = executorApproval({ installedVersion: "0.13.0", readerArtifact: artifact, acknowledged: ack, executor });
    expect(a.approved).toBe(false);
    expect(a.conditions.find(c => c.id === "live-readers")).toMatchObject({ state: "partial", satisfied: false, reasons: [expect.stringMatching(/history listing was empty/)] });
    expect(executorApproval({ installedVersion: "0.13.0", readerArtifact: run(), acknowledged: ack, executor }).conditions.find(c => c.id === "live-readers")!.state).toBe("partial");
    expect(executorApproval({ installedVersion: "0.13.0", readerArtifact: run({}, { history: { pages: 1, entries: 2, unavailableProviderSessions: 0 } }), acknowledged: ack, executor })
      .conditions.find(c => c.id === "live-readers")).toMatchObject({ state: "partial", reasons: [expect.stringMatching(/unavailable provider/)] });
  });
  it("accepts no self-attested record: only a run artifact for the installed version with both readers complete", () => {
    const state = (artifact: string | undefined, installedVersion = "0.13.0") => executorApproval({ installedVersion, readerArtifact: artifact, acknowledged: ack, executor }).conditions.find(c => c.id === "live-readers")!.state;
    expect(state(JSON.stringify({ daemonVersion: "0.13.0", digest: "0".repeat(64), readers: { retainedWorkspaces: "complete", nativeSchedules: "complete" } }))).toBe("open");
    expect(state(run({}, seeded), "0.13.1")).toBe("open");
    expect(state(run({}, { ...seeded, retainedWorkspaces: { result: "refused" } }))).toBe("open");
    expect(state("not json")).toBe("open");
    expect(state(run({}, seeded))).toBe("met");
  });
  it("approves only with a non-empty reader run, a no-follow executor and N7/receiver acknowledged (R11 N3)", () => {
    expect(executorApproval({ installedVersion: "0.13.0", readerArtifact: run({}, seeded), acknowledged: ack, executor: { deleteFollowsLinks: true } }).approved).toBe(false);
    expect(executorApproval({ installedVersion: "0.13.0", readerArtifact: run({}, seeded), acknowledged: ["receiver"], executor }).approved).toBe(false);
    expect(executorApproval({ installedVersion: "0.13.0", readerArtifact: run({}, seeded), acknowledged: ack, executor }).approved).toBe(true);
  });
});
