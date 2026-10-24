import { randomUUID } from "node:crypto";
import type { SupervisionExpected } from "../shared/supervision";
import { SupervisionScopeSchema } from "../shared/supervision";
import type { SupervisionMutation } from "../server/supervision-store";

export const ids = { scope: "00000000-0000-4000-8000-000000000001", project: "00000000-0000-4000-8000-000000000002",
  task: "00000000-0000-4000-8000-000000000003", attempt: "00000000-0000-4000-8000-000000000004",
  effect: "00000000-0000-4000-8000-000000000005" };
export const hash = "a".repeat(64);
export const scope = (homeId: string) => SupervisionScopeSchema.parse({ id: ids.scope, homeId, kind: "plan", projectIds: [ids.project],
  sponsorId: null, version: 1, mode: "scoped", state: "held" });
export function seed(homeId: string): SupervisionMutation[] {
  return [{ kind: "scope", value: { ...scope(homeId), state: "active" } },
    { kind: "binding", value: { scopeId: ids.scope, epoch: 1, hostId: "local", agentId: "fixture-supervisor", workspaceId: "fixture-workspace",
      profileDigest: hash, state: "prepared", checkpointHash: hash, acknowledgedSeq: 0, heartbeatDue: null } },
    { kind: "backend", value: { planId: "plan", ownerScopeId: ids.scope, backend: "scoped", state: "active", sourceHash: null, version: 1 } },
    { kind: "task", value: { id: ids.task, ownerScopeId: ids.scope, planId: "plan", nodeId: "build", projectId: ids.project,
      hostId: "local", version: 1, currentAttempt: ids.attempt } },
    { kind: "attempt", value: { id: ids.attempt, taskId: ids.task, ordinal: 1, briefHash: hash, launchEffectId: ids.effect, worker: null,
      originalNotificationOwner: null, notificationStatus: "unknown", spentAgents: 1, spentTurns: 1, state: "starting", evidenceIds: [], version: 1 } },
    { kind: "effect", value: { id: ids.effect, logicalKey: "plan/build/attempt-1/create", requestId: randomUUID(), requestHash: hash,
      scopeId: ids.scope, epoch: 1, attemptId: ids.attempt, operation: "agent.create", planRevision: 1, subjectHash: hash,
      policyVector: [], evidenceVector: [], approvalId: null, resourceIds: ["workspace:fixture"], state: "reserved",
      receiverKey: null, receiptRef: null, version: 1 } }];
}
export function expected(mutations: SupervisionMutation[], version = 0): SupervisionExpected[] {
  return mutations.map(m => ({ kind: m.kind, id: m.kind === "workflow" ? m.event.plan : m.kind === "retirement" ? m.receipt.plan :
    m.kind === "binding" ? m.value.scopeId : m.kind === "backend" ? m.value.planId : m.value.id, version }));
}
