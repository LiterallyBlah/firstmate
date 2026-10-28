export const plan = { plan: "scheduler", title: "Scheduler", hash: "a".repeat(64), scopeId: "00000000-0000-4000-8000-000000000001",
  scopeVersion: 1, supervisorId: "00000000-0000-4000-8000-000000000002", canAttach: true, binding: null, opening: null };
export const snapshot = { enabled: !location.search.includes("off"), homeId: "fixture-home", problems: [],
  plans: [plan], audits: [{ at: "2026-10-28T12:00:00Z", plan: "reader-pass", supervisor: "00000000-0000-4000-8000-000000000004",
    source: "client UI (unverified)", authorization: "by convention, not verified" }], migrations: [], dispositions: [] };
if (!snapshot.enabled) snapshot.audits = [];
