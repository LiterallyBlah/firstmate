import { act, createElement, type ReactNode } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeAll, expect, it, vi } from "vitest";
import type { PluginTheme } from "@getpaseo/plugin";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { workflowFixture } from "../test/workflow-fixture";
import { compactPlansFixture } from "../test/compact-plans-fixture";
import { attentionCard } from "../test/attention-deck-fixture";
import type { WorkflowPlan } from "../shared/workflow-plans";
vi.mock("@getpaseo/plugin/client", () => ({ useRpc: () => vi.fn() }));
vi.mock("react-native", () => ({ Pressable: "Pressable", Text: "Text", View: "View", Image: "Image", Platform: { OS: "web", select: (options: { default: unknown }) => options.default } }));
vi.mock("@getpaseo/plugin/client/ui", () => ({ SettingsRow: "SettingsRow" }));
vi.mock("@getpaseo/plugin/client/react-native", () => ({ Icon: "Icon", TextInput: "TextInput", FlatList: "FlatList", Modal: Object.assign(({ open, children }: { open: boolean; children: ReactNode }) => open ? children : null, { Content: "Content" }) }));
import { PlanChip, PlanDialog, PlanNeeds, WorkflowSurface, WORKFLOW_QUERY_KEY } from "./workflow-plans";
import { indicatorState, decisionCountText } from "./needs-you-state";
import { OptionPicker } from "./option-picker";
import { visibleText } from "../test/visible-text";
const theme = { colors: { foreground: "#ffffff", foregroundMuted: "#aaaaaa", border: "#333333", surface1: "#222222", statusWarning: "#ffff00" } } as PluginTheme;
let renderer: ReactTestRenderer | null = null;
beforeAll(() => { (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true; });
afterEach(() => { act(() => renderer?.unmount()); renderer = null; });
const plan = (): WorkflowPlan => ({ definition: workflowFixture(), revision: 1, sequence: 0, hash: "a".repeat(64), posture: "review", status: "review", approvedBudget: { agents: 2, turns: 2 }, nodes: { trial: { state: "planned" }, database: { state: "planned" }, build: { state: "planned" } }, told: [], handled: [], history: [{ revision: 1, at: "2026-10-20T12:00:00Z", by: "mate", reason: "draft" }] });
function button(label: string) { return renderer!.root.find(n => n.type === ("Pressable" as any) && n.props.accessibilityLabel === label); }
it("shows the same build-step progress on task chips as Plans, folding reviews and excluding decisions", async () => {
  const plans = compactPlansFixture(), star = plans[0]!, card = attentionCard("starpath-scheduler-slice13", "ready");
  card.project = "starpath";
  card.backlog = { id: card.taskId!, title: card.title, project: "starpath", section: "in-flight", kind: "ship", mode: null,
    agentId: null, hold: null, blockedBy: null, since: null, url: null, reportPath: null, outcome: null, host: "Remote lab", plan: star.definition.id };
  card.remote = { serverId: "sample-lab", host: "Remote lab", online: true, clockSkewSeconds: null, worker: null };
  const cache = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity } } });
  cache.setQueryData(WORKFLOW_QUERY_KEY, { homeId: "fixture", version: "1", plans, subjects: {}, now: [], comingUp: [] });
  try {
    await act(async () => { renderer = create(createElement(QueryClientProvider, { client: cache },
      createElement(WorkflowSurface, { theme, children: createElement(PlanChip, { theme, card }) }))); });
    expect(visibleText(renderer!.toJSON())).toContain("3 of 7 steps landed");
    expect(Object.values(star.nodes).filter(n => n.state === "done" || n.state === "landed")).toHaveLength(11);
    expect(star.definition.nodes).toHaveLength(22);
  } finally {
    await act(async () => renderer?.unmount()); renderer = null; cache.clear();
  }
});
it("renders without acting and binds approval to the displayed revision and subject", async () => {
  const onAct = vi.fn().mockResolvedValue(undefined);
  await act(async () => { renderer = create(createElement(PlanDialog, { theme, plan: plan(), subjectHash: "b".repeat(64), homeId: "home", stale: false, busy: false, error: null, onAct, onRefresh() {} })); });
  expect(onAct).not.toHaveBeenCalled();
  for (const label of ["Approve", "Approve with edits", "Ask for changes", "Hold", "Decline"]) expect(button(label)).toBeTruthy();
  await act(async () => button("Approve").props.onPress());
  expect(onAct).toHaveBeenCalledWith(expect.objectContaining({ action: "approve", revision: 1, subjectHash: "b".repeat(64) }));
});
it.each(["active", "held"] as const)("keeps %s plans browsable without review actions, preserving decisions and lifecycle controls", async status => {
  const p = plan(); p.status = status;
  const onAct = vi.fn();
  await act(async () => { renderer = create(createElement(PlanDialog, { theme, plan: p, subjectHash: "b".repeat(64), homeId: "home", stale: false, busy: false, error: null, onAct, onRefresh() {} })); });
  for (const label of ["Approve", "Approve with edits", "Ask for changes"]) {
    expect(renderer!.root.findAll(n => n.type === ("Pressable" as any) && n.props.accessibilityLabel === label)).toHaveLength(0);
  }
  expect(button("Hold").props.disabled).toBe(false);
  expect(button("Decline").props.disabled).toBe(false);
  expect(button("SQLite").props.disabled).toBe(false);
  expect(onAct).not.toHaveBeenCalled();
});
it.each(["active", "held"] as const)("closes an open review form when a plan becomes %s", async status => {
  const p = plan(), onAct = vi.fn();
  const props = { theme, plan: p, subjectHash: "b".repeat(64), homeId: "home", stale: false, busy: false, error: null, onAct, onRefresh() {} };
  await act(async () => { renderer = create(createElement(PlanDialog, props)); });
  await act(async () => button("Ask for changes").props.onPress());
  await act(async () => renderer!.root.findByType("TextInput" as any).props.onChangeText("Change the scope."));
  expect(button("Send changes to first mate").props.disabled).toBe(false);
  await act(async () => renderer!.update(createElement(PlanDialog, { ...props, plan: { ...p, status } })));
  expect(renderer!.root.findAllByType("TextInput" as any)).toHaveLength(0);
  expect(renderer!.root.findAll(n => n.type === ("Pressable" as any) && n.props.accessibilityLabel === "Send changes to first mate")).toHaveLength(0);
  expect(onAct).not.toHaveBeenCalled();
});
it("keeps stale actions disabled and forwards requested changes as text", async () => {
  const onAct = vi.fn().mockResolvedValue(undefined), refresh = vi.fn();
  const props = { theme, plan: plan(), subjectHash: "b".repeat(64), homeId: "home", stale: true, busy: false, error: null, onAct, onRefresh: refresh };
  await act(async () => { renderer = create(createElement(PlanDialog, props)); });
  expect(button("Approve").props.disabled).toBe(true);
  await act(async () => button("Review latest plan").props.onPress()); expect(refresh).toHaveBeenCalledOnce();
  await act(async () => renderer!.update(createElement(PlanDialog, { ...props, stale: false })));
  await act(async () => button("Ask for changes").props.onPress());
  expect(button("Send changes to first mate").props.disabled).toBe(true);
  await act(async () => renderer!.root.findByType("TextInput" as any).props.onChangeText("Use a read-only trial."));
  await act(async () => button("Send changes to first mate").props.onPress());
  expect(onAct).toHaveBeenCalledWith(expect.objectContaining({ action: "changes", text: "Use a read-only trial." }));
});
it("renders Coming up quietly without adding a count or an approval side effect", async () => {
  await act(async () => { renderer = create(createElement(PlanNeeds, { theme, snapshot: { planNow: [], comingUp: [{ plan: "scheduler", node: "database", title: "Scheduler", question: "Choose database", waits: ["Database trial"], neededBy: ["Build scheduler"], recommendation: "SQLite" }] } })); });
  expect(renderer!.root.findAll(n => n.props.testID === "workflow-now")).toHaveLength(0);
  expect(renderer!.root.findAll(n => n.props.testID === "workflow-coming-up")).toHaveLength(1);
  expect(visibleText(renderer!.toJSON())).not.toContain("Choose database");
  await act(async () => button("Coming up: 1 later decision").props.onPress());
  expect(visibleText(renderer!.toJSON())).toContain("Choose database · after earlier work is finished");
  expect(visibleText(renderer!.toJSON())).not.toContain("Needed before");
  expect(visibleText(renderer!.toJSON())).not.toContain("Scheduler:");
});
it("reports only a lower bound from plans when legacy decisions are unavailable, excluding Coming up", () => {
  const need = { plan: "scheduler", title: "Scheduler", question: "Approve", waits: [], neededBy: [], recommendation: "Review" };
  const snapshot: any = { actionCount: null, planNow: [need], comingUp: [need, need], freshness: { status: "disabled", problems: [], asOf: null } };
  expect(indicatorState(snapshot)).toMatchObject({ count: 1, badge: "1+", fresh: false, stale: true });
  expect(indicatorState({ ...snapshot, planNow: [] }).count).toBeNull();
});
it("shows completed plans as history without another approval action", async () => {
  const completed = plan(); for (const state of Object.values(completed.nodes)) state.state = "done";
  completed.nodes.build!.state = "landed";
  await act(async () => { renderer = create(createElement(PlanDialog, { theme, plan: completed, subjectHash: "b".repeat(64), homeId: "home", stale: false, busy: false, error: null, onAct: vi.fn(), onRefresh() {} })); });
  expect(JSON.stringify(renderer!.toJSON())).toContain("Completed");
  expect(renderer!.root.findAll(n => n.type === ("Pressable" as any) && n.props.accessibilityLabel === "Approve")).toHaveLength(0);
});
it("labels a known decision count as a lower bound when any plan is quarantined", () => {
  const snapshot: any = { actionCount: 2, planNow: [], planProblems: ["Plan damaged: hash chain"], freshness: { status: "fresh", problems: [], asOf: null } };
  expect(indicatorState(snapshot)).toMatchObject({ count: 2, badge: "2+", fresh: false });
  expect(decisionCountText(snapshot)).toBe("2+ · some plans unavailable");
  expect(decisionCountText({ ...snapshot, actionCount: 0 })).toBe("unavailable");
  expect(indicatorState({ ...snapshot, actionCount: 0 })).toMatchObject({ count: null, badge: "!" });
});
it("shows separate provenance for captain presses and approvals recorded from chat", async () => {
  const p = plan(); p.captainEvents = [{ id: "one", by: "mate", action: "approve", text: "Just go", at: "2026-10-20T12:00:00Z" }, { id: "two", by: "board:captain", action: "hold", text: "", at: "2026-10-20T12:00:00Z" }];
  await act(async () => { renderer = create(createElement(PlanDialog, { theme, plan: p, subjectHash: "b".repeat(64), homeId: "home", stale: false, busy: false, error: null, onAct: vi.fn(), onRefresh() {} })); });
  expect(JSON.stringify(renderer!.toJSON())).toContain("Recorded by the first mate from chat"); expect(JSON.stringify(renderer!.toJSON())).toContain("Captain pressed");
});
it("requires an explicit access-mode choice when changing to a model without the current mode", async () => {
  const onAct = vi.fn().mockResolvedValue(undefined);
  await act(async () => { renderer = create(createElement(PlanDialog, { theme, plan: plan(), subjectHash: "b".repeat(64), homeId: "home", stale: false, busy: false, error: null, onAct, onRefresh() {}, models: [{ provider: "claude/opus", label: "New model", modes: [{ id: "unrestricted", label: "Unrestricted" }, { id: "read-only", label: "Read only" }], thinking: [] }] })); });
  await act(async () => button("Approve with edits").props.onPress());
  const picker = (label: string) => renderer!.root.findAllByType(OptionPicker).find(n => n.props.label === label)!;
  await act(async () => picker("Model").props.onSelect("claude/opus"));
  expect(picker("Access mode").props.value).toBe(""); expect(button("Apply edits and approve").props.disabled).toBe(true);
  await act(async () => picker("Access mode").props.onSelect("read-only"));
  expect(button("Apply edits and approve").props.disabled).toBe(false);
  await act(async () => button("Apply edits and approve").props.onPress());
  expect(onAct).toHaveBeenCalledWith(expect.objectContaining({ edits: [{ kind: "model", node: "trial", agent: { provider: "claude/opus", modeId: "read-only" } }] }));
});
