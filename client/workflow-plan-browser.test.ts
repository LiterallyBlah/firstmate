import { act, createElement } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeAll, expect, it, vi } from "vitest";
import type { PluginTheme } from "@getpaseo/plugin";
import { workflowFixture } from "../test/workflow-fixture";
import type { WorkflowPlan } from "../shared/workflow-plans";
import type { WorkflowSnapshot } from "../shared/workflow-rpc";
vi.mock("react-native", () => ({ Pressable: "Pressable", Text: "Text", View: "View", ScrollView: "ScrollView" }));
vi.mock("@getpaseo/plugin/client/react-native", () => ({ TextInput: "TextInput" }));
vi.mock("./ui", () => ({ IconButton: ({ label, onPress }: any) => createElement("Pressable", { accessibilityLabel: label, onPress }) }));
vi.mock("./workflow-plans", () => ({ useWorkflowPlans: vi.fn() }));
import { WorkflowPlanBrowser, WorkflowPlansView } from "./workflow-plan-browser";
import { useWorkflowPlans } from "./workflow-plans";
const theme = { colors: { foreground: "#fff", foregroundMuted: "#aaa", border: "#333", surface1: "#222", statusWarning: "#ff0", statusDanger: "#f00" } } as PluginTheme;
let renderer: ReactTestRenderer;
beforeAll(() => { (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true; });
afterEach(() => { act(() => renderer?.unmount()); vi.clearAllMocks(); });
function plan(id = "scheduler", implicit = false): WorkflowPlan {
  const definition = workflowFixture(); definition.id = id; definition.title = id; definition.implicit = implicit;
  if (implicit) definition.nodes = [definition.nodes[0]!];
  return { definition, revision: 1, sequence: 0, hash: "a".repeat(64), posture: "review", status: "active", approvedBudget: { agents: 2, turns: 2 },
    nodes: { trial: { state: "planned" }, database: { state: "planned" }, build: { state: "planned" } }, told: [], handled: [], history: [] };
}
const snapshot = (plans: WorkflowPlan[], extra = {}): WorkflowSnapshot => ({ homeId: "fixture", version: "one", plans, subjects: {}, now: [], comingUp: [], ...extra });
const renderedText = () => JSON.stringify(renderer.toJSON());
const button = (label: string) => renderer.root.find(n => n.type === ("Pressable" as any) && n.props.accessibilityLabel === label);
async function mount(data: WorkflowSnapshot | undefined, extra = {}) {
  act(() => renderer?.unmount());
  const onOpen = vi.fn(), onRefresh = vi.fn();
  await act(async () => { renderer = create(createElement(WorkflowPlanBrowser, { theme, snapshot: data, loading: false, error: null, onRefresh, onOpen, ...extra })); });
  return { onOpen, onRefresh };
}
it("shows posture, runs, worker and host, dependencies, decisions and budget; opens the existing surface by id", async () => {
  const p = plan(); p.status = "review";
  p.nodes.trial = { state: "running", agentId: "worker-42", attempt: "one", spent: 1 };
  const { onOpen } = await mount(snapshot([p]));
  for (const text of ["Awaiting approval", "Posture: ", "Review before starting", "running", "Worker: ", "worker-42", "Host: ", "This machine", "needs its evidence", "needs your answer", "SQLite", "Postgres", "Recommendation: ", "Budget used / approved: "]) expect(renderedText()).toContain(text);
  expect(onOpen).not.toHaveBeenCalled();
  await act(async () => button("Open plan: scheduler").props.onPress());
  expect(onOpen).toHaveBeenCalledExactlyOnceWith("scheduler");
});
it("folds automatic plans and pages ten at a time, expanding matching search results", async () => {
  await mount(snapshot([plan(), ...Array.from({ length: 27 }, (_, i) => plan(`automatic-${i.toString().padStart(2, "0")}`, true))]));
  expect(renderer.root.findAll(n => String(n.props.testID ?? "").startsWith("workflow-plan-"))).toHaveLength(1);
  await act(async () => button("Automatic one-run plans (27)").props.onPress());
  expect(renderer.root.findAll(n => n.props.testID === "workflow-plan-automatic-00")).toHaveLength(1);
  expect(renderer.root.findAll(n => n.props.testID === "workflow-plan-automatic-10")).toHaveLength(0);
  await act(async () => button("Show 10 more plans (17 remaining)").props.onPress());
  expect(renderer.root.findAll(n => n.props.testID === "workflow-plan-automatic-10")).toHaveLength(1);
  await act(async () => renderer.root.findByType("TextInput" as any).props.onChangeText("automatic-26"));
  expect(renderer.root.findAll(n => n.props.testID === "workflow-plan-automatic-26")).toHaveLength(1);
  expect(renderer.root.findAll(n => n.props.testID === "workflow-plan-scheduler")).toHaveLength(0);
});
it("places open plans ahead of finished history and exposes automatic plans awaiting approval", async () => {
  const closed = plan("finished"); for (const node of Object.values(closed.nodes)) node.state = "landed";
  const automatic = plan("review automatic", true); automatic.status = "review";
  await mount(snapshot([closed, automatic]));
  expect(renderedText().indexOf("Open plans")).toBeLessThan(renderedText().indexOf("Recently finished"));
  expect(button("Open plan: review automatic")).toBeTruthy();
});
it("uses the provider's existing snapshot, open handler and retry without another query", async () => {
  const state = { snapshot: snapshot([plan()]), loading: false, error: null, refresh: vi.fn(), open: vi.fn() };
  vi.mocked(useWorkflowPlans).mockReturnValue(state);
  await act(async () => { renderer = create(createElement(WorkflowPlansView, { theme })); });
  await act(async () => button("Open plan: scheduler").props.onPress());
  await act(async () => button("Refresh plans").props.onPress());
  expect(state.open).toHaveBeenCalledExactlyOnceWith("scheduler"); expect(state.refresh).toHaveBeenCalledOnce();
});
it("reveals an automatic approval arriving on a later poll", async () => {
  const p = plan("automatic", true), state = { snapshot: snapshot([p]), loading: false, error: null, refresh: vi.fn(), open: vi.fn() };
  vi.mocked(useWorkflowPlans).mockReturnValue(state);
  await act(async () => { renderer = create(createElement(WorkflowPlansView, { theme })); });
  expect(renderer.root.findAll(n => n.props.testID === "workflow-plan-automatic")).toHaveLength(0);
  const updated = structuredClone(p); updated.status = "review";
  vi.mocked(useWorkflowPlans).mockReturnValue({ ...state, snapshot: snapshot([updated]) });
  await act(async () => renderer.update(createElement(WorkflowPlansView, { theme })));
  expect(button("Open plan: automatic")).toBeTruthy();
});
it("distinguishes loading, empty, failed and partial snapshots, keeping stale results visible", async () => {
  await mount(undefined, { loading: true }); expect(renderedText()).toContain("Loading plans");
  await mount(snapshot([])); expect(renderedText()).toContain("No plans yet");
  const { onRefresh } = await mount(undefined, { error: "Offline" });
  expect(renderedText()).toContain("Plans could not be refreshed"); expect(renderedText()).not.toContain("No plans yet");
  await act(async () => button("Refresh plans").props.onPress()); expect(onRefresh).toHaveBeenCalledOnce();
  await mount(snapshot([], { problems: ["Quarantined plan"] }));
  expect(renderedText()).toContain("This list is incomplete"); expect(renderedText()).not.toContain("No plans yet");
  await mount(snapshot([plan()]), { error: "Offline" });
  expect(renderedText()).toContain("Showing the last received plans"); expect(button("Open plan: scheduler")).toBeTruthy();
  await act(async () => renderer.root.findByType("TextInput" as any).props.onChangeText("missing"));
  expect(renderedText()).toContain("No plans match this search");
});
