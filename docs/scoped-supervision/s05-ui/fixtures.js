import { ScopeSnapshotSchema } from "../../../shared/supervision-rpc";
import { scopeConversationKey } from "../../../shared/scope-discussion";
export const homeId = "C:/fixture/FirstMate", projectId = "00000000-0000-4000-8000-000000000201", planId = "00000000-0000-4000-8000-000000000101";
const at = "2026-10-26T12:00:00.000Z", hash = "a".repeat(64);
const target = (scopeId, agentId, epoch = 1) => ({ homeId, scopeId, agentId, epoch, scopeVersion: scopeId === "general" ? 0 : 1 });
const goal = { scopeId: planId, planId: "reader-pass", title: "Reader pass", state: "needs-planning", owner: "plan-session", ownerEpoch: 1,
  responsible: "scope-owner", next: "Review accepted; the outcome still needs a follow-up task.", due: true, activeWorkers: 0, activeEffects: 0, uncertainEffects: 0,
  offers: { pending: 0, uncertain: 0 }, evidenceAt: at, evidenceAgeMs: 180000, projectIds: [projectId], lastSupervisorFailure: null };
const summary = (id, title, kind, agentId, session, goals = []) => ({ id, title, kind, aliases: [id === "general" ? "firstmate" : kind === "plan" ? "reader-pass" : "reader"],
  planId: kind === "plan" ? "reader-pass" : null, discussionOnly: kind === "project", target: target(id, agentId, agentId ? 1 : 0),
  hostId: "local", workspaceId: agentId ? `${agentId}-ws` : null, state: agentId ? "active" : "dormant", coverage: "unknown", session, observedAt: agentId ? at : null,
  goals, activeWorkers: 0, activeEffects: 0, uncertainEffects: 0, lastEffectFailure: null });
export const snapshot = ScopeSnapshotSchema.parse({ homeId, sequence: 23, freshness: "current", asOf: at, uiEnabled: true, executionEnabled: true, problems: [],
  projects: [{ id: projectId, name: "reader" }], scopes: [summary("general", "FirstMate", "general", "general-session", "awake", [goal]),
    summary(projectId, "Reader project", "project", "project-session", "dormant", [goal]), summary(planId, "Reader pass", "plan", "plan-session", "dormant", [goal]),
    summary("00000000-0000-4000-8000-000000000102", "New trial", "plan", null, "not-created")] });
const entry = (id, scope, text, reply) => ({ id, text, reply, agentId: scope.target.agentId, kind: "discuss", delivery: "sent", createdAt: at,
  route: { target: scope.target, recipient: scope.title, projectIds: [projectId], conversationId: "main", replyTo: null } });
export const threads = new Map(snapshot.scopes.map(s => [s.id, { key: scopeConversationKey(homeId, s.id), title: s.title, messages: [] }]));
threads.get("general").messages.push(entry("general-note", snapshot.scopes[0], "What remains for the reader?", "The review is accepted. The goal remains open; its owner needs to plan the next bounded step."));
threads.get(planId).messages.push(entry("plan-note", snapshot.scopes[2], "Explain the next step before doing any work.", "I will keep the outcome open and propose a bounded follow-up. Discussion grants no dispatch authority."));
export const needs = { homeId, version: 1, actionCount: 1, newCount: 0, pendingAnswerCount: 0, snoozedCount: 0, delivery: "off", requests: [], parked: [],
  freshness: { status: "fresh", checkedAt: Date.parse(at), asOf: Date.parse(at), problems: [] }, scopedSequence: 23, scopedComplete: true, scopedAnswersEnabled: true,
  scopedHolds: [], scopedProblems: [], scopedPendingAnswerCount: 0, scopedDecisions: [{ ready: true, waitingFor: null, ownerEpoch: 1,
    decision: { id: "00000000-0000-4000-8000-000000000301", version: 1, ownerScopeId: planId, planId: "reader-pass", nodeId: "choose", revision: 1, subjectHash: hash,
      state: "pending", title: "Choose the follow-up", question: "Should the reader follow-up cover both narrow and wide layouts?", options: [{ id: "both", label: "Both layouts" }, { id: "narrow", label: "Narrow first" }],
      sourceVector: [{ kind: "workflow", id: "reader-pass", version: 1, digest: hash }], answer: null },
    answerContext: { homeId, scopeId: planId, epoch: 1, scopeVersion: 1, expectedPlanHash: hash, revision: 1, subjectHash: hash,
      decisionId: "00000000-0000-4000-8000-000000000301", dependencyBindings: [], policyVector: [], modelPolicyVector: [], evidenceVector: [], approvalId: null, head: null, artifactHash: null, briefHash: null } }] };
