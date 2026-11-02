import { expect, it } from "vitest";
import type { ActivationSnapshot } from "../shared/supervision-activation";
import type { MaintenanceRuntimeSnapshot } from "../shared/maintenance-runtime";
import { activationHasHistory, maintenanceHasHistory } from "./ownership-state";
import { completeEmptyInbox } from "./needs-you-state";
import { attentionSnapshot } from "../test/attention-deck-fixture";

it("plan recovery and migration records survive even without an audit or current binding", () => {
  const empty: ActivationSnapshot = { enabled: false, homeId: "fixture", problems: [], audits: [], plans: [], migrations: [], dispositions: [] };
  expect(activationHasHistory(empty)).toBe(false);
  expect(activationHasHistory({ ...empty, plans: [{ binding: null, opening: "failed" } as ActivationSnapshot["plans"][number]] })).toBe(true);
  expect(activationHasHistory({ ...empty, resumeMigrations: [{} as NonNullable<ActivationSnapshot["resumeMigrations"]>[number]] })).toBe(true);
  expect(activationHasHistory({ ...empty, dispositions: [{} as ActivationSnapshot["dispositions"][number]] })).toBe(true);
});
it.each(["owners", "incidents", "reservations", "deliveries", "outbox"] as const)("disabled checks retain %s even with no running owner", field => {
  const data = { owners: [], jobs: [], occurrences: [], hosts: [], incidents: [], reservations: [], deliveries: [], captainDecisions: [], decisions: [], outbox: [] };
  expect(maintenanceHasHistory(data as unknown as MaintenanceRuntimeSnapshot)).toBe(false);
  expect(maintenanceHasHistory({ ...data, [field]: [{}] } as unknown as MaintenanceRuntimeSnapshot)).toBe(true);
});
it("pending, lower-bound and quarantined reads cannot produce empty-inbox reassurance", () => {
  const data = attentionSnapshot([]);
  expect(completeEmptyInbox(data)).toBe(true);
  expect(completeEmptyInbox(undefined)).toBe(false);
  expect(completeEmptyInbox(data, false, true)).toBe(false);
  expect(completeEmptyInbox({ ...data, scopedComplete: false })).toBe(false);
  expect(completeEmptyInbox({ ...data, actionCount: null })).toBe(false);
  expect(completeEmptyInbox({ ...data, scopedPendingAnswerCount: 1 })).toBe(false);
  expect(completeEmptyInbox({ ...data, quarantined: [{ line: 1, taskId: null, key: null, hasHold: true, problem: "Hash mismatch" }] })).toBe(false);
});
