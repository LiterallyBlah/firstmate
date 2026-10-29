import { expect, it } from "vitest";
import { NeedsYouSnapshotSchema } from "./needs-you";
import { ScopedCaptainDecisionSchema } from "./scoped-captain-decision";
import { filterScopeInbox } from "./scope-inbox";
const hash = "a".repeat(64);
export const captainDecisionFixture = (kind: "plan" | "project" | "maintenance") => ScopedCaptainDecisionSchema.parse({
  format: "firstmate.scoped-captain-decision/1", homeId: "home", scope: { kind, id: `${kind}-scope` }, origin: { kind, id: `${kind}-origin` },
  decisionId: `${kind}-decision`, revision: 1, subjectHash: hash, title: `${kind} choice`, question: "Which bounded option should proceed?",
  options: [{ number: 1, id: "one", label: "First option" }, { number: 2, id: "two", label: "Second option" }], recommendation: "one",
  projectIds: kind === "maintenance" ? [] : ["project"], evidence: [{ ref: `${kind}/evidence@1`, digest: hash }], permittedActions: ["answer"],
});
it("A11/A21: one strict captain contract supports all origins without accepting actor claims or invented action types", () => {
  for (const origin of ["plan", "project", "maintenance"] as const) {
    const value = captainDecisionFixture(origin);
    expect(value.origin.kind).toBe(origin);
    expect(ScopedCaptainDecisionSchema.safeParse({ ...value, actor: { kind: "captain-ui" } }).success).toBe(false);
    expect(ScopedCaptainDecisionSchema.safeParse({ ...value, permittedActions: ["attach"] }).success).toBe(false);
    expect(ScopedCaptainDecisionSchema.safeParse({ ...value, recommendation: "missing" }).success).toBe(false);
    expect(ScopedCaptainDecisionSchema.safeParse({ ...value, options: [value.options[0], value.options[0]] }).success).toBe(false);
  }
});
it("A09: scope/ancestry filters preserve global totals, unknown quarantines and incomplete inventory without counting Coming up", () => {
  const snapshot = NeedsYouSnapshotSchema.parse({ homeId: "home", version: 1, actionCount: 4, newCount: 1, snoozedCount: 0, pendingAnswerCount: 0,
    freshness: { status: "fresh", asOf: 1000, checkedAt: 1000, problems: [] }, delivery: "off", requests: [], parked: [], scopedComplete: false,
    quarantined: [{ line: 3, taskId: null, key: null, hasHold: true, problem: "Ambiguous scope; retained" }], scopedProblems: ["Incomplete inventory"],
    scopeDirectory: [{ id: "general", kind: "general", title: "FirstMate", projectIds: [], projectNames: [], planId: null },
      { id: "project-scope", kind: "project", title: "Reader", projectIds: ["project"], projectNames: ["Reader", "read"], planId: null },
      { id: "plan-scope", kind: "plan", title: "Reader pass", projectIds: ["project"], projectNames: ["Reader", "read"], planId: "reader-pass" },
      { id: "other-plan", kind: "plan", title: "Other", projectIds: ["other"], projectNames: ["Other"], planId: "other" },
      { id: "maintenance", kind: "maintenance", title: "Daily", projectIds: [], projectNames: [], planId: null }],
    planNow: ["reader-pass", "other"].map(plan => ({ plan, title: plan, question: "Review", recommendation: "", waits: [], neededBy: [] })),
    comingUp: [{ plan: "reader-pass", title: "Future", question: "Future", recommendation: "", waits: [], neededBy: [] }],
  });
  const before = JSON.stringify(snapshot), project = filterScopeInbox(snapshot, { kind: "project", id: "project-scope" });
  expect(project.planNow?.map(n => n.plan)).toEqual(["reader-pass"]);
  expect(project.comingUp).toHaveLength(1); expect(project.actionCount).toBe(4); expect(project.quarantined).toEqual(snapshot.quarantined);
  expect(filterScopeInbox(snapshot, { kind: "plan" }).planNow).toHaveLength(2);
  expect(filterScopeInbox(snapshot, { kind: "maintenance" }).planNow).toEqual([]);
  expect(filterScopeInbox(snapshot, { kind: "general" }).planNow).toHaveLength(2);
  expect(filterScopeInbox(snapshot, { kind: "project", id: "missing" }).planNow).toEqual([]);
  expect(JSON.stringify(snapshot)).toBe(before);
  for (const kind of ["all", "general", "project", "plan", "maintenance"] as const) {
    const filtered = filterScopeInbox(snapshot, { kind });
    expect(filtered.actionCount).toBe(4); expect(filtered.scopedComplete).toBe(false); expect(filtered.scopedProblems).toEqual(["Incomplete inventory"]);
  }
  const parked = (hostId: string) => ({ key: hostId, taskId: "same-slug", hostId, project: "Reader", title: "Same project name", ask: "", url: null,
    reportPath: null, gateToken: null, section: "queued" as const, disposition: "open" as const, blockedBy: null });
  const hosted = { ...snapshot, parked: [parked("local-host-id"), parked("remote-host-id")], scopeDirectory: snapshot.scopeDirectory!.map(s => ({ ...s, hostId: "local-host-id" })) };
  expect(filterScopeInbox(hosted, { kind: "project", id: "project-scope" }).parked.map(p => p.hostId)).toEqual(["local-host-id"]);
});
