import { expect, it } from "vitest";
import type { ActivationSnapshot } from "../shared/supervision-activation";
import type { ProjectRuntimeSnapshot } from "../shared/project-runtime";
import type { MaintenanceRuntimeSnapshot } from "../shared/maintenance-runtime";
import { activationHasHistory, maintenanceHasHistory, projectHasHistory, projectHasProblem, projectSetupAvailable } from "./ownership-state";
import { completeEmptyInbox } from "./needs-you-state";
import { attentionSnapshot } from "../test/attention-deck-fixture";

const project: ProjectRuntimeSnapshot["projects"][number] = {
  name: "Reader", projectId: null, scopeId: null, hostId: "local", directory: "C:/Reader",
  state: "unadmitted", version: 0, reason: "Awaiting reviewed admission and allocation.", aliases: [],
  agentId: null, workspaceId: null, provisionRequestId: null, sessions: 0, turns: 0, uncertain: 0,
  memoryPending: 0, profile: null, limits: null, plans: [],
};
it("six registry projects are six setup opportunities and no held work", () => {
  const rows = Array.from({ length: 6 }, (_, i) => ({ ...project, name: `Project ${i}` }));
  expect(rows.filter(projectSetupAvailable)).toHaveLength(6);
  expect(rows.filter(projectHasProblem)).toHaveLength(0);
  expect(projectHasHistory({ projects: rows } as ProjectRuntimeSnapshot)).toBe(false);
});
it.each([
  { state: "held", reason: "Registry row is malformed; explicit correction is required." },
  { state: "stopped", version: 2, agentId: null },
  { provisionRequestId: "saved-request", sessions: 1, agentId: null },
  { uncertain: 1, turns: 1, agentId: null },
])("an unavailable/undispatched project stays inspectable without an agent: %j", saved => {
  const row = { ...project, ...saved };
  expect(projectSetupAvailable(row)).toBe(false);
  expect(projectHasHistory({ projects: [row] } as ProjectRuntimeSnapshot)).toBe(true);
});
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
