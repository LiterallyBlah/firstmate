import { act, createElement, useState } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeAll, expect, it, vi } from "vitest";
import { attentionRequest, attentionSnapshot, attentionTheme } from "../test/attention-deck-fixture";
import { workflowTaskFixture } from "../test/workflow-task-fixture";
vi.mock("react-native", () => ({ Platform: { OS: "web" }, Pressable: "Pressable", View: "View", Text: "Text", ScrollView: "ScrollView" }));
const rpc = vi.hoisted(() => vi.fn(async () => { throw new Error("No daemon mutation is permitted in this fixture"); }));
vi.mock("@getpaseo/plugin/client", () => ({ useRpc: () => rpc, openExternalUrl: rpc }));
vi.mock("@getpaseo/plugin/client/react-native", () => ({ Icon: "Icon", TextInput: "TextInput", useToast: () => ({ error() {} }) }));
vi.mock("./ui", () => ({
  IconButton: (props: { label: string; onPress(): void }) => createElement("Pressable", { accessibilityLabel: props.label, onPress: props.onPress }),
  Tag: () => null, Chip: () => null, errorText: String,
}));
vi.mock("./decision-drawer", () => ({ DecisionButton: () => null }));
vi.mock("./workflow-plans", () => ({ PlanNeeds: () => null, PlanChip: () => null, useWorkflowPlans: () => ({ open() {} }) }));
vi.mock("./item-tags", () => ({ ItemTagEditor: () => null }));
vi.mock("./web", () => ({ webTitle: () => ({}), webAttributes: () => ({}) }));
import { TaskList } from "./task-list";
import { taskSourceKey } from "./task-presentation";

let renderer: ReactTestRenderer;
beforeAll(() => { (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true; });
afterEach(async () => { await act(async () => renderer?.unmount()); vi.clearAllMocks(); });

it.each(["in-hand", "later", "done", "needs-you"])("Show task expands and measures the real %s card without a daemon action", async group => {
  const { card } = workflowTaskFixture(); card.key += group;
  if (group === "later") { card.column = "queued"; card.backlog!.section = "queued"; card.agent = null; card.backlog!.agentId = null; }
  if (group === "done") { card.column = "done"; card.backlog!.section = "done"; }
  const request = attentionRequest(card.taskId!); request.source.key = taskSourceKey(card)!;
  const snapshot = attentionSnapshot(group === "needs-you" ? [request] : []);
  const scrollTo = vi.fn(), inner = {}, measureLayout = vi.fn((_relative: unknown, success: (x: number, y: number) => void) => success(0, 620));
  await act(async () => { renderer = create(createElement(TaskList, {
    cards: [card], snapshot, theme: attentionTheme, compact: true, density: "comfortable", conversing: null,
    onConverse: vi.fn(), onChanged: vi.fn(), showDone: false, onShowDone: vi.fn(), showLater: false, onShowLater: vi.fn(),
    reveal: { card: card.key, request: {} },
  }), { createNodeMock: element => element.type === "ScrollView" ? { scrollTo, getInnerViewNode: () => inner } : element.type === "View" ? { measureLayout } : null }); });
  expect(measureLayout).toHaveBeenCalledWith(inner, expect.any(Function), expect.any(Function));
  expect(scrollTo).toHaveBeenCalledWith({ y: 612, animated: false });
  const json = JSON.stringify(renderer.toJSON());
  // The real CrewCard exposes its action controls only after expansion.
  if (group === "later") expect(renderer.root.find(node => node.type === ("Pressable" as never) && node.props.accessibilityLabel?.endsWith("Hide details and actions")).props.accessibilityState.expanded).toBe(true);
  else expect(json).toContain("Relaunch");
  if (group === "needs-you") expect(renderer.root.findByProps({ accessibilityLabel: `Details for decision ${request.source.title}` }).props.accessibilityState.expanded).toBe(true);
  expect(rpc).not.toHaveBeenCalled();
});

it.each(["done", "later"] as const)("uses a %s reveal once, preserving a later collapse and fold across List remounts", async group => {
  const { card } = workflowTaskFixture(); card.key += `once-${group}`;
  card.column = group === "done" ? "done" : "queued"; card.backlog!.section = card.column;
  if (group === "later") { card.agent = null; card.backlog!.agentId = null; }
  const scrollTo = vi.fn(), onShow = vi.fn(), consumed = vi.fn();
  const measureLayout = vi.fn((_relative: unknown, success: (x: number, y: number) => void) => success(0, 620));
  function Harness({ visible, request }: { visible: boolean; request: object }) {
    const [used, setUsed] = useState<object | null>(null);
    const [show, setShow] = useState(false);
    const onShowGroup = (next: boolean) => { onShow(next); setShow(next); };
    const props = {
      cards: [card], snapshot: attentionSnapshot([]), theme: attentionTheme, compact: true, density: "comfortable" as const, conversing: null,
      onConverse: vi.fn(), onChanged: vi.fn(), showDone: group === "done" && show, onShowDone: onShowGroup, showLater: group === "later" && show, onShowLater: onShowGroup,
      reveal: used === request ? null : { card: card.key, request },
      onRevealed: (request: object) => { consumed(request); setUsed(request); },
    };
    return visible ? createElement(TaskList, props) : null;
  }
  const first = {}, second = {};
  async function show(visible: boolean, request = first) {
    await act(async () => renderer.update(createElement(Harness, { visible, request })));
  }
  const header = () => renderer.root.findByProps({ testID: `task-group-${group}` }).findAll(node => node.type === ("Pressable" as never))[0]!;
  const toggle = (label: string) => renderer.root.find(node => node.type === ("Pressable" as never) && node.props.accessibilityLabel?.endsWith(label));
  await act(async () => { renderer = create(createElement(Harness, { visible: true, request: first }), {
    createNodeMock: element => element.type === "ScrollView" ? { scrollTo, getInnerViewNode: () => ({}) } : element.type === "View" ? { measureLayout } : null,
  }); });
  expect(scrollTo).toHaveBeenCalledExactlyOnceWith({ y: 612, animated: false });
  expect(header().props.accessibilityState.expanded).toBe(true);
  expect(toggle("Hide details and actions").props.accessibilityState.expanded).toBe(true);
  expect(onShow).not.toHaveBeenCalled();
  await act(async () => toggle("Hide details and actions").props.onPress());
  await act(async () => header().props.onPress());
  expect(header().props.accessibilityState.expanded).toBe(false);
  await show(false); await show(true);
  expect(header().props.accessibilityState.expanded).toBe(false);
  expect(scrollTo).toHaveBeenCalledTimes(1);
  // Reopening the group is the captain's choice; the previously collapsed card stays closed.
  await act(async () => header().props.onPress());
  await show(false); await show(true);
  expect(toggle("Show details and actions").props.accessibilityState.expanded).toBe(false);
  expect(scrollTo).toHaveBeenCalledTimes(1);
  // A new explicit handoff still opens and scrolls to the same task.
  await act(async () => renderer.update(createElement(Harness, { visible: true, request: second })));
  expect(header().props.accessibilityState.expanded).toBe(true);
  expect(toggle("Hide details and actions").props.accessibilityState.expanded).toBe(true);
  expect(scrollTo).toHaveBeenCalledTimes(2);
  expect(consumed.mock.calls).toEqual([[first], [second]]);
  expect(rpc).not.toHaveBeenCalled();
});
