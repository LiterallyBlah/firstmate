import { act, createElement, type ReactNode } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeAll, expect, it, vi } from "vitest";
import type { PluginTheme } from "@getpaseo/plugin";
import { workflowFixture } from "../test/workflow-fixture";
import type { WorkflowPlan } from "../shared/workflow-plans";
vi.mock("react-native", () => ({ Pressable: "Pressable", Text: "Text", View: "View", Image: "Image", Platform: { OS: "web" } }));
vi.mock("@getpaseo/plugin/client/ui", () => ({ SettingsRow: "SettingsRow" }));
vi.mock("@getpaseo/plugin/client/react-native", () => ({ Icon: "Icon", TextInput: "TextInput", FlatList: "FlatList", Modal: Object.assign(({ open, children }: { open: boolean; children: ReactNode }) => open ? children : null, { Content: "Content" }) }));
import { PlanDialog, PlanNeeds } from "./workflow-plans";
import { indicatorState } from "./needs-you-state";
const theme = { colors: { foreground: "#ffffff", foregroundMuted: "#aaaaaa", border: "#333333", surface1: "#222222", statusWarning: "#ffff00" } } as PluginTheme;
let renderer: ReactTestRenderer | null = null;
beforeAll(() => { (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true; });
afterEach(() => { act(() => renderer?.unmount()); renderer = null; });
const plan = (): WorkflowPlan => ({ definition: workflowFixture(), revision: 1, sequence: 0, hash: "a".repeat(64), posture: "review", status: "review", approvedBudget: { agents: 2, turns: 2 }, nodes: { trial: { state: "planned" }, database: { state: "planned" }, build: { state: "planned" } }, told: [], handled: [], history: [{ revision: 1, at: "2026-10-20T12:00:00Z", by: "mate", reason: "draft" }] });
function button(label: string) { return renderer!.root.find(n => n.type === ("Pressable" as any) && n.props.accessibilityLabel === label); }
it("renders without acting and binds approval to the displayed revision and subject", async () => {
  const onAct = vi.fn().mockResolvedValue(undefined);
  await act(async () => { renderer = create(createElement(PlanDialog, { theme, plan: plan(), subjectHash: "b".repeat(64), homeId: "home", stale: false, busy: false, error: null, onAct, onRefresh() {} })); });
  expect(onAct).not.toHaveBeenCalled();
  for (const label of ["Approve", "Approve with edits", "Ask for changes", "Hold", "Decline"]) expect(button(label)).toBeTruthy();
  await act(async () => button("Approve").props.onPress());
  expect(onAct).toHaveBeenCalledWith(expect.objectContaining({ action: "approve", revision: 1, subjectHash: "b".repeat(64) }));
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
  expect(JSON.stringify(renderer!.toJSON())).toContain("Needed before Build scheduler");
});
it("reports only a lower bound from plans when legacy decisions are unavailable, excluding Coming up", () => {
  const need = { plan: "scheduler", title: "Scheduler", question: "Approve", waits: [], neededBy: [], recommendation: "Review" };
  const snapshot: any = { actionCount: null, planNow: [need], comingUp: [need, need], freshness: { status: "disabled", problems: [], asOf: null } };
  expect(indicatorState(snapshot)).toMatchObject({ count: 1, badge: "1+", fresh: false, stale: true });
  expect(indicatorState({ ...snapshot, planNow: [] }).count).toBeNull();
});
it("shows completed plans as history without another approval action", async () => {
  const completed = plan(); for (const state of Object.values(completed.nodes)) state.state = "done";
  await act(async () => { renderer = create(createElement(PlanDialog, { theme, plan: completed, subjectHash: "b".repeat(64), homeId: "home", stale: false, busy: false, error: null, onAct: vi.fn(), onRefresh() {} })); });
  expect(JSON.stringify(renderer!.toJSON())).toContain("Completed");
  expect(renderer!.root.findAll(n => n.type === ("Pressable" as any) && n.props.accessibilityLabel === "Approve")).toHaveLength(0);
});
