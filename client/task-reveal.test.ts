import { act, createElement } from "react";
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
vi.mock("./workflow-plans", () => ({ PlanNeeds: () => null, PlanChip: () => null }));
vi.mock("./item-tags", () => ({ ItemTagEditor: () => null }));
vi.mock("./web", () => ({ webTitle: () => ({}) }));
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
