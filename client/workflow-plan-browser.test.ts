import { act, createElement } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeAll, beforeEach, expect, it, vi } from "vitest";
import type { PluginTheme } from "@getpaseo/plugin";
import { compactPlansFixture } from "../test/compact-plans-fixture";
import { workflowFixture } from "../test/workflow-fixture";
import { planGraphFixture } from "../test/plan-graph-fixture";
import type { WorkflowPlan } from "../shared/workflow-plans";
import type { WorkflowSnapshot } from "../shared/workflow-rpc";
import { workflowTaskFixture } from "../test/workflow-task-fixture";
vi.mock("react-native", () => ({ Platform: { OS: "web" }, Pressable: "Pressable", Text: "Text", View: "View", ScrollView: "ScrollView" }));
vi.mock("@getpaseo/plugin/client/react-native", () => ({ TextInput: "TextInput", Modal: Object.assign(({ open, children }: any) => open ? children : null, { Content: ({ children }: any) => children }) }));
vi.mock("./ui", () => ({ IconButton: ({ label, onPress }: any) => createElement("Pressable", { accessibilityLabel: label, onPress }),
  Segmented: ({ options, onChange }: any) => createElement("View", {}, options.map((o: any) => createElement("Pressable", { key: o.value, accessibilityLabel: o.label, onPress: () => onChange(o.value) }))) }));
vi.mock("./workflow-plans", () => ({ useWorkflowPlans: vi.fn(() => ({ loading: false, error: null, refresh() {}, open() {} })) }));
import { WorkflowPlanBrowser, WorkflowPlansView } from "./workflow-plan-browser";
import { useWorkflowPlans } from "./workflow-plans";
const theme = { colors: { foreground: "#fff", foregroundMuted: "#aaa", border: "#333", surface0: "#111", surface1: "#222", accent: "#080", statusSuccess: "#0f0", statusWarning: "#ff0", statusDanger: "#f00" } } as PluginTheme;
let renderer: ReactTestRenderer;
const scrollHandles = new Map<string, { scrollTo: ReturnType<typeof vi.fn> }>();
beforeAll(() => { (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true; });
beforeEach(() => { vi.mocked(useWorkflowPlans).mockReturnValue({ loading: false, error: null, refresh() {}, open() {} }); });
afterEach(() => { act(() => renderer?.unmount()); vi.clearAllMocks(); });
function plan(id = "scheduler", implicit = false): WorkflowPlan {
  const definition = workflowFixture(); definition.id = id; definition.title = id; definition.implicit = implicit;
  if (implicit) {
    const node = definition.nodes[0]!; if (node.kind !== "run") throw new Error("fixture");
    definition.nodes = [{ ...node, id, launch: { ...node.launch, id, brief: { file: `data/${id}/brief.md` } } }];
  }
  return { definition, revision: 1, sequence: 0, hash: "a".repeat(64), posture: "review", status: "active", approvedBudget: { agents: 2, turns: 2 },
    nodes: implicit ? { [id]: { state: "planned" } } : { trial: { state: "planned" }, database: { state: "planned" }, build: { state: "planned" } }, told: [], handled: [], history: [] };
}
const snapshot = (plans: WorkflowPlan[], extra = {}): WorkflowSnapshot => ({ homeId: "fixture", version: "one", plans, subjects: {}, now: [], comingUp: [], ...extra });
const renderedText = () => JSON.stringify(renderer.toJSON());
const button = (label: string) => renderer.root.find(n => n.type === ("Pressable" as any) && n.props.accessibilityLabel === label);
async function mount(data: WorkflowSnapshot | undefined, extra = {}) {
  act(() => renderer?.unmount());
  const onOpen = vi.fn(), onRefresh = vi.fn();
  await act(async () => { renderer = create(createElement(WorkflowPlanBrowser, { theme, snapshot: data, loading: false, error: null, onRefresh, onOpen, ...extra }), {
    createNodeMock: node => {
      if (node.type !== "ScrollView") return null;
      const handle = { scrollTo: vi.fn() }; scrollHandles.set((node.props as { accessibilityLabel?: string }).accessibilityLabel ?? "plans", handle); return handle;
    },
  }); });
  return { onOpen, onRefresh };
}
it("shows posture, runs, worker and host, dependencies, decisions and budget; opens the existing surface by id", async () => {
  const p = plan(); p.status = "review";
  p.nodes.trial = { state: "running", agentId: "worker-42", attempt: "one", spent: 1 };
  const { onOpen } = await mount(snapshot([p]));
  await act(async () => button("List").props.onPress());
  await act(async () => button("Expand plan: scheduler").props.onPress());
  for (const text of ["Awaiting approval", "Posture: ", "Review before starting", "running", "Worker: ", "worker-42", "Host: ", "This machine", "waiting on Database trial", "waiting on Choose the database", "SQLite", "Recommended", "Budget used / approved: "]) expect(renderedText()).toContain(text);
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

it("starts with one summary per plan, expands reviews as chips, hides unstarted worker details and opens the existing dialog only on demand", async () => {
  const plans = compactPlansFixture(), star = plans[0]!, onOpen = vi.fn();
  const snapshot = { homeId: "fixture", version: "1", plans, subjects: {}, now: [], comingUp: [] };
  await act(async () => { renderer = create(createElement(WorkflowPlanBrowser, { theme, snapshot, loading: false, error: null, onRefresh() {}, onOpen })); });
  await act(async () => button("List").props.onPress());
  const json = () => JSON.stringify(renderer!.toJSON());
  expect(renderer!.root.findAll(n => n.props.testID?.startsWith("workflow-step-"))).toHaveLength(0);
  expect(json()).toContain("3 of 7 steps landed");
  expect(json()).not.toContain("Worker:");
  expect(renderer!.root.findAll(n => n.props.testID === "workflow-plan-ariadne-reader-pass-s4")).toHaveLength(0);
  await act(async () => button(`Expand plan: ${star.definition.title}`).props.onPress());
  expect(renderer!.root.findAll(n => n.props.testID?.startsWith("workflow-step-"))).toHaveLength(8); // Seven builds and a decision.
  expect(renderer!.root.findAll(n => n.props.testID?.includes("workflow-step-") && n.props.testID?.includes("review-"))).toHaveLength(0);
  expect(json()).toContain("Astra"); expect(json()).toContain("✓"); expect(json()).toContain("pending");
  expect(json()).toContain("fixture-opus"); expect(json()).not.toContain("unassigned");
  expect(json()).toContain("waiting on Build scheduler slice 13");
  expect(onOpen).not.toHaveBeenCalled();
  await act(async () => button(`Collapse plan: ${star.definition.title}`).props.onPress());
  expect(json()).not.toContain("Worker:");
  await act(async () => button(`Open plan: ${star.definition.title}`).props.onPress());
  expect(onOpen).toHaveBeenCalledExactlyOnceWith(star.definition.id);
});
it("shows unresolved, invalidated, failed and awaiting-landing steps in collapsed attention", async () => {
  const plans = compactPlansFixture(), p = plans[0]!;
  const builds = p.definition.nodes.filter(n => n.kind === "run" && n.launch.kind === "ship").slice(0, 4);
  builds.forEach((node, i) => { node.title = ["Lost worker", "Stale evidence", "Failed build", "Ready change"][i]!; });
  p.nodes[builds[0]!.id] = { state: "unresolved" };
  p.nodes[builds[1]!.id] = { state: "landed", invalidated: "Head changed" };
  p.nodes[builds[2]!.id] = { state: "failed" };
  p.nodes[builds[3]!.id] = { state: "done" };
  await mount(snapshot(plans));
  expect(renderer.root.findAll(n => String(n.props.testID ?? "").startsWith("workflow-step-"))).toHaveLength(0);
  const attention = renderer.root.find(n => n.type === ("Text" as any) && n.props.children?.[0] === "Attention: ");
  for (const text of ["Lost worker — unresolved", "Stale evidence — evidence uncertain", "Failed build — failed", "Ready change — awaiting landing"]) {
    expect(attention.props.children[1]).toContain(text);
  }
});

it("defaults to graph, exposes parallelism and edge reasons, opens step details and preserves the list toggle without actions", async () => {
  const plan = planGraphFixture(), before = JSON.stringify(plan);
  const { onOpen } = await mount(snapshot([plan]));
  await act(async () => button(`Expand plan: ${plan.definition.title}`).props.onPress());
  expect(renderer.root.findAll(n => n.props.testID?.startsWith("workflow-node-"))).toHaveLength(5);
  expect(renderer.root.findAll(n => n.props.testID?.startsWith("workflow-edge-"))).toHaveLength(5);
  for (const text of ["2 independent", "builds-on", "needs-evidence", "shared-state", "decision", "running", "done", "landed", "Decision", "Scout / review"]) expect(renderedText()).toContain(text);
  await act(async () => button("Step: Choose the rollout · waiting on Build the independent adapter").props.onPress());
  expect(renderedText()).toContain("Recommended"); expect(renderedText()).toContain("SQLite");
  expect(renderedText()).toContain("shares mutable state"); expect(renderedText()).toContain("once done");
  expect(onOpen).not.toHaveBeenCalled();
  await act(async () => button("Open plan details").props.onPress());
  expect(onOpen).toHaveBeenCalledExactlyOnceWith("diamond");
  await act(async () => button("List").props.onPress());
  expect(renderer.root.findAll(n => n.props.testID?.startsWith("workflow-node-"))).toHaveLength(0);
  expect(renderer.root.findAll(n => n.props.testID?.startsWith("workflow-step-"))).toHaveLength(5);
  await act(async () => button("Graph").props.onPress());
  expect(renderer.root.findAll(n => n.props.testID?.startsWith("workflow-node-"))).toHaveLength(5);
  expect(JSON.stringify(plan)).toBe(before);
});

it("renders held, invalidated, failed and planned states, and falls back without losing step access", async () => {
  const plan = planGraphFixture(); plan.nodes.left = { state: "done", held: true }; plan.nodes.right = { state: "failed" };
  plan.nodes.root = { state: "landed", invalidated: "Evidence changed" };
  await mount(snapshot([plan]));
  await act(async () => button(`Expand plan: ${plan.definition.title}`).props.onPress());
  for (const text of ["on hold", "failed", "uncertain", "waiting on"]) expect(renderedText()).toContain(text);
  for (const [label, ink] of [["on hold", theme.colors.statusWarning], ["uncertain", theme.colors.statusWarning], ["failed", theme.colors.statusDanger]]) {
    expect(renderer.root.find(n => n.type === ("Text" as any) && n.props.children === label).props.style.color).toBe(ink);
  }
  plan.definition.nodes[0]!.after = [{ node: "missing", reason: "builds-on", on: "landed" }];
  await mount(snapshot([plan]));
  await act(async () => button(`Expand plan: ${plan.definition.title}`).props.onPress());
  expect(renderedText()).toContain("Parallelism cannot be confirmed"); expect(renderedText()).not.toContain("can run in parallel");
  plan.definition.nodes[0]!.after = [{ node: "finish", reason: "builds-on", on: "landed" }];
  await mount(snapshot([plan]));
  await act(async () => button(`Expand plan: ${plan.definition.title}`).props.onPress());
  expect(renderedText()).toContain("cycle prevents a graph");
  await act(async () => button("Show steps as list").props.onPress());
  expect(renderer.root.findAll(n => n.props.testID?.startsWith("workflow-step-"))).toHaveLength(5);
});

it("names removed prerequisites and opens their retained details without an unavailable-data warning", async () => {
  const plan = planGraphFixture(), node = plan.definition.nodes.shift()!;
  plan.removed = [{ node, state: plan.nodes[node.id]! }]; delete plan.nodes[node.id];
  const { onOpen } = await mount(snapshot([plan]));
  await act(async () => button(`Expand plan: ${plan.definition.title}`).props.onPress());
  expect(renderedText()).not.toContain("Parallelism cannot be confirmed");
  await act(async () => button(`Step: ${node.title} · removed`).props.onPress());
  expect(renderedText()).toContain("Removed from this plan; retained as a prerequisite.");
  expect(onOpen).not.toHaveBeenCalled();
});

it("retains search, expanded plans and List mode after leaving and reopening the same home", async () => {
  const data = snapshot([plan()]), extra = { sessionKey: "audit-round-trip" };
  await mount(data, extra);
  await act(async () => renderer.root.findByType("TextInput" as any).props.onChangeText("scheduler"));
  await act(async () => button("List").props.onPress());
  await act(async () => button("Expand plan: scheduler").props.onPress());
  expect(renderer.root.findAll(n => n.props.testID === "workflow-step-trial")).toHaveLength(1);
  await mount(data, extra);
  expect(renderer.root.findByType("TextInput" as any).props.value).toBe("scheduler");
  expect(renderer.root.findAll(n => n.props.testID === "workflow-step-trial")).toHaveLength(1);
});

it("links graph details and List rows to the exact task and saved remote conversation", async () => {
  const { plan, node, card, worker } = workflowTaskFixture(true), navigate = vi.fn();
  const state = { snapshot: snapshot([plan]), loading: false, error: null, refresh() {}, open() {}, scope: "scope", canNavigate: true, navigate,
    fleet: { cards: [card] } as any };
  vi.mocked(useWorkflowPlans).mockReturnValue(state);
  await mount(state.snapshot);
  await act(async () => button(`Expand plan: ${plan.definition.title}`).props.onPress());
  await act(async () => button(`Step: ${node.title} · running`).props.onPress());
  await act(async () => button("Show task").props.onPress());
  expect(navigate).toHaveBeenLastCalledWith({ scope: "scope", plan: plan.definition.id, node: node.id, card: card.key });
  await act(async () => button(`Step: ${node.title} · running`).props.onPress());
  await act(async () => button("Converse").props.onPress());
  expect(navigate).toHaveBeenLastCalledWith({ scope: "scope", plan: plan.definition.id, node: node.id, card: card.key, worker: `remote:lab-server-id:${worker.id}` });
  await act(async () => button("List").props.onPress());
  await act(async () => button("Show task").props.onPress());
  expect(navigate).toHaveBeenCalledTimes(3);
});

it("restores graph and browser scroll, folds and paging in the same session and starts fresh in another", async () => {
  const p = planGraphFixture(), data = snapshot([p, ...Array.from({ length: 12 }, (_, i) => plan(`auto-${i}`, true))]);
  const scope = { sessionKey: "scroll-and-pages" };
  await mount(data, scope);
  await act(async () => button(`Expand plan: ${p.definition.title}`).props.onPress());
  await act(async () => button("Automatic one-run plans (12)").props.onPress());
  await act(async () => button("Show 2 more plans (2 remaining)").props.onPress());
  const graphLabel = `Dependency graph: ${p.definition.title}`;
  const graph = () => renderer.root.find(n => n.type === ("ScrollView" as any) && n.props.accessibilityLabel === graphLabel);
  const browser = () => renderer.root.find(n => n.type === ("ScrollView" as any) && !n.props.horizontal);
  await act(async () => graph().props.onLayout({ nativeEvent: { layout: { width: 350 } } }));
  await act(async () => graph().props.onScroll({ nativeEvent: { contentOffset: { x: 127, y: 0 } } }));
  await act(async () => browser().props.onContentSizeChange());
  await act(async () => browser().props.onScroll({ nativeEvent: { contentOffset: { x: 0, y: 512 } } }));
  await mount(data, scope);
  await act(async () => graph().props.onLayout({ nativeEvent: { layout: { width: 350 } } }));
  await act(async () => browser().props.onContentSizeChange());
  expect(scrollHandles.get(graphLabel)!.scrollTo).toHaveBeenLastCalledWith({ x: 127, animated: false });
  expect(scrollHandles.get("plans")!.scrollTo).toHaveBeenLastCalledWith({ y: 512, animated: false });
  expect(button("Open plan: auto-11")).toBeTruthy();
  expect(button(`Collapse plan: ${p.definition.title}`)).toBeTruthy();
  await mount(data, { sessionKey: "another-home" });
  expect(button(`Expand plan: ${p.definition.title}`)).toBeTruthy();
  expect(renderer.root.findAll(n => n.props.testID === "workflow-plan-auto-11")).toHaveLength(0);
});
