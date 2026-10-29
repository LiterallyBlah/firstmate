import { createElement } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { NeedsYouSnapshot } from "../shared/needs-you";
import { attentionSnapshot, attentionTheme as theme } from "../test/attention-deck-fixture";
import { NEEDS_YOU_QUERY_KEY } from "./needs-you-query";

const mocks = vi.hoisted(() => ({ read: vi.fn(), maintenance: vi.fn(), plan: vi.fn() }));
vi.mock("@getpaseo/plugin/client", () => ({ useRpc: (rpc: { name: string }) => {
  if (rpc.name === "firstmate.scope.needs") return mocks.read;
  if (rpc.name === "firstmate.maintenance.answer-ui") return mocks.maintenance;
  if (rpc.name === "firstmate.scope.answer") return mocks.plan;
  throw new Error(`Unexpected RPC ${rpc.name}`);
} }));
vi.mock("react-native", () => ({ Pressable: "Pressable", TextInput: "TextInput", Text: "Text", View: "View" }));
vi.mock("./workflow-plans", () => ({ workflowRequestId: () => "00000000-0000-4000-8000-000000000003", useWorkflowPlans: () => ({}) }));
vi.mock("./decision-tasks", () => ({ DecisionTask: "DecisionTask" }));
import { ScopedNeeds } from "./scoped-needs";

const id = "00000000-0000-4000-8000-000000000001", hash = "a".repeat(64);
let renderer: ReactTestRenderer | undefined, cache: QueryClient, snapshot: NeedsYouSnapshot;
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.resetAllMocks(); cache = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const homeId = `maintenance-ui-${crypto.randomUUID()}`;
  snapshot = { ...attentionSnapshot([]), homeId, actionCount: 1, scopedComplete: true, scopedSequence: 1,
    scopeFiltersEnabled: true, scopedAnswersEnabled: false, maintenanceAnswersEnabled: true, scopedPendingAnswerCount: 0,
    scopedDecisions: [{ ready: true, waitingFor: null, ownerEpoch: 1,
      decision: { id, version: 1, ownerScopeId: id, planId: id, nodeId: id, revision: 2, subjectHash: hash, state: "pending", title: "Storage authority", question: "Keep held?",
        options: [{ id: "hold", label: "Keep held" }, { id: "plan", label: "Request a reviewed plan" }], sourceVector: [{ kind: "maintenance-job", id, version: 1, digest: hash }], answer: null,
        maintenance: { kind: "authority", jobId: id, jobVersion: 1, incidentId: id, generation: 1, ownerEpoch: 1, ownerAgentId: "owner", recommendation: "hold", evidence: [{ ref: "checked/authority", digest: hash }] } },
      maintenanceAnswerContext: { homeId, decisionId: id, revision: 2, subjectHash: hash, evidence: [{ ref: "checked/authority", digest: hash }] } }] };
});
afterEach(async () => { await act(async () => renderer?.unmount()); renderer = undefined; cache.clear(); });
const button = (label: string) => renderer!.root.find(n => n.type === "Pressable" as never && n.props.accessibilityLabel === label);
const notes = () => renderer!.root.find(n => n.type === "TextInput" as never);
function Consumer() {
  const query = useQuery({ queryKey: NEEDS_YOU_QUERY_KEY, queryFn: mocks.read, initialData: snapshot, staleTime: Infinity });
  return createElement(ScopedNeeds, { snapshot: query.data, theme });
}
async function mount() {
  await act(async () => { renderer = create(createElement(QueryClientProvider, { client: cache }, createElement(Consumer))); });
  await act(async () => renderer!.root.findByType("DecisionTask" as never).props.onAnswer());
}
async function choose() {
  await act(async () => { button("Keep held").props.onPress(); notes().props.onChangeText("Retain the hold."); });
}
function commit(input: { submissionId: string; option: string; text: string }) {
  const next = structuredClone(snapshot), row = next.scopedDecisions![0]!;
  row.ready = false; row.decision.state = "answered";
  row.decision.answer = { ...input, at: "2026-10-29T00:00:00Z", provenance: { kind: "plugin-ui-unverified", id: "fixture", source: "fixture" }, outboxId: input.submissionId };
  delete row.maintenanceAnswerContext;
  next.scopedSequence!++; next.actionCount = 0; next.pendingAnswerCount = next.scopedPendingAnswerCount = 1;
  return next;
}
it("maintenance uses its checked context and app RPC with C execution off; confirmed answer stays disabled until the combined reread succeeds", async () => {
  let committed: NeedsYouSnapshot;
  mocks.maintenance.mockImplementation(async input => { committed = commit(input); return { decisions: committed.scopedDecisions!.map(row => row.decision) }; });
  mocks.read.mockRejectedValue(new Error("combined read unavailable"));
  await mount(); expect(mocks.maintenance).not.toHaveBeenCalled(); expect(button("Submit scoped answer").props.disabled).toBe(true);
  await choose(); await act(async () => { const press = button("Submit scoped answer").props.onPress; press(); press(); });
  expect(mocks.maintenance).toHaveBeenCalledTimes(1); expect(mocks.plan).not.toHaveBeenCalled();
  expect(mocks.maintenance.mock.calls[0]![0]).toEqual({ ...snapshot.scopedDecisions![0]!.maintenanceAnswerContext, submissionId: "00000000-0000-4000-8000-000000000003", option: "hold", text: "Retain the hold." });
  expect(button("Answer unconfirmed · original submission retained").props.disabled).toBe(true); expect(notes().props.editable).toBe(false);
  await act(async () => renderer!.unmount()); renderer = undefined; await mount();
  expect(notes().props.value).toBe("Retain the hold."); expect(button("Answer unconfirmed · original submission retained").props.disabled).toBe(true);
  mocks.read.mockImplementation(async () => committed!);
  await act(async () => button("Refresh scoped decisions").props.onPress());
  await vi.waitFor(() => expect(cache.getQueryData<NeedsYouSnapshot>(NEEDS_YOU_QUERY_KEY)).toMatchObject({ actionCount: 0, pendingAnswerCount: 1, scopedPendingAnswerCount: 1 }));
  await vi.waitFor(async () => { await act(async () => { await new Promise(done => setTimeout(done, 0)); }); expect(button("Answer committed").props.disabled).toBe(true); });
  expect(mocks.maintenance).toHaveBeenCalledTimes(1);
});
it("a lost maintenance reply retains the original submission through refresh and remount without a plan/backlog resend", async () => {
  mocks.maintenance.mockRejectedValue(new Error("lost reply")); mocks.read.mockResolvedValue(snapshot);
  await mount(); await choose(); await act(async () => button("Submit scoped answer").props.onPress());
  await act(async () => button("Refresh scoped decisions").props.onPress());
  await act(async () => renderer!.unmount()); renderer = undefined; await mount();
  expect(button("Answer unconfirmed · original submission retained").props.disabled).toBe(true);
  expect(notes().props.value).toBe("Retain the hold."); expect(mocks.maintenance).toHaveBeenCalledTimes(1); expect(mocks.plan).not.toHaveBeenCalled();
});
it.each(["off", "missing-context"])("maintenance %s never falls back to the plan transport even with C execution enabled", async state => {
  snapshot.scopedAnswersEnabled = true;
  if (state === "off") snapshot.maintenanceAnswersEnabled = false;
  else delete snapshot.scopedDecisions![0]!.maintenanceAnswerContext;
  await mount(); expect(button("Submit scoped answer").props.disabled).toBe(true);
  expect(mocks.plan).not.toHaveBeenCalled(); expect(mocks.maintenance).not.toHaveBeenCalled();
});
it("ordinary scoped plan answers retain their own transport and combined pending accounting", async () => {
  const row = snapshot.scopedDecisions![0]!;
  delete row.decision.maintenance; delete row.maintenanceAnswerContext;
  row.answerContext = { homeId: snapshot.homeId!, scopeId: id, decisionId: id, revision: 2, subjectHash: hash,
    expectedPlanHash: hash, scopeVersion: 1, epoch: 1, policyVector: [], modelPolicyVector: [], evidenceVector: [], dependencyBindings: [],
    approvalId: null, head: null, artifactHash: null, briefHash: null };
  snapshot.scopedAnswersEnabled = true; snapshot.maintenanceAnswersEnabled = false;
  mocks.plan.mockImplementation(async input => { const next = commit(input); mocks.read.mockResolvedValue(next); return next; });
  await mount(); await choose(); await act(async () => button("Submit scoped answer").props.onPress());
  expect(mocks.plan).toHaveBeenCalledTimes(1); expect(mocks.maintenance).not.toHaveBeenCalled();
});
