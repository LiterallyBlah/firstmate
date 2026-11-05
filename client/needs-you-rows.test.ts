/** Needs you's header count is the rows drawn under it: backlog, plan and scoped decisions and paused plans. */
import { act, createElement } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, expect, it, vi } from "vitest";
import { attentionRequest, attentionSnapshot, attentionTheme } from "../test/attention-deck-fixture";
import { planDecisionNeed } from "../test/plan-decision-fixture";
import { withScopedNeeds } from "../test/scoped-needs-fixture";
import { visibleText } from "../test/visible-text";
import { DEFAULT_TASK_LAYOUT } from "../shared/task-layout";
import type { NeedsYouSnapshot } from "../shared/needs-you";
import { indicatorState } from "./needs-you-state";
import { needsYouQueue, scopedEntries } from "./scoped-queue";
vi.mock("react-native", () => ({ Platform: { OS: "web" }, Pressable: "Pressable", Text: "Text", TextInput: "TextInput", ScrollView: "ScrollView", View: "View" }));
vi.mock("@getpaseo/plugin/client", () => ({ useRpc: () => async () => { throw new Error("No RPC in this test"); } }));
vi.mock("./card", () => ({ CrewCard: (props: object) => createElement("CrewCard", props) }));
vi.mock("./decision-tasks", () => ({
  DecisionTask: (props: object) => createElement("DecisionTask", props), DecisionQueueNote: () => null,
}));
vi.mock("./workflow-plans", () => ({ PlanNeeds: () => null, useWorkflowPlans: () => ({}), workflowRequestId: () => "id" }));
import { TaskList } from "./task-list";
import { TaskBoard } from "./task-board";

function mixed(scoped: boolean): NeedsYouSnapshot {
  const base = attentionSnapshot([attentionRequest("a"), attentionRequest("b", "seen"), attentionRequest("answered", "answer-sent")]);
  base.planNow = [planDecisionNeed(), { ...planDecisionNeed(), node: undefined, decision: undefined }];
  base.actionCount! += 2;
  return scoped ? withScopedNeeds(base) : base;
}
let tree: ReactTestRenderer | undefined;
afterEach(async () => { await act(async () => tree?.unmount()); tree = undefined; });
async function render(view: "List" | "Board", snapshot: NeedsYouSnapshot) {
  const props = { cards: [], allCards: [], snapshot, theme: attentionTheme, compact: false, offline: false, density: "comfortable" as const,
    conversing: null, onConverse() {}, onChanged() {}, showDone: false, onShowDone() {},
    layout: { ...DEFAULT_TASK_LAYOUT, collapsed: [] }, layoutDisabled: false, onLayout() {} };
  const element = view === "List" ? createElement(TaskList, props) : createElement(TaskBoard, props);
  await act(async () => { tree = create(createElement(QueryClientProvider, { client: new QueryClient() }, element)); });
  return tree!;
}
const rows = (tree: ReactTestRenderer) => tree.root.findAllByType("DecisionTask" as never).length +
  tree.root.findAll(n => n.props.testID === "scoped-hold" && typeof n.type === "string").length;

it.each([["List", false], ["List", true], ["Board", false], ["Board", true]] as const)("%s draws exactly the counted rows (scoped: %s)", async (view, scoped) => {
  const snapshot = mixed(scoped), count = indicatorState(snapshot).count;
  const tree = await render(view, snapshot);
  expect(count).toBe(scoped ? 7 : 4);
  expect(rows(tree)).toBe(count);
  expect(visibleText(tree.toJSON())).toMatch(new RegExp(`Needs you · \\s*${count}\\b`));
  if (scoped) {
    // The ready decision is drawn with its own answer path; the waiting one is left for All.
    const titles = tree.root.findAllByType("DecisionTask" as never).map(n => n.props.request.source.title);
    expect(titles).toContain("Worker launch is broken");
    expect(titles).not.toContain("Install the release");
  }
});

it("the drawer queue holds exactly the counted entries, scoped ones last and never as backlog requests", () => {
  const snapshot = mixed(true), queue = needsYouQueue(snapshot);
  expect(queue).toHaveLength(indicatorState(snapshot).count!);
  expect(queue.slice(-3).map(r => r.id)).toEqual(scopedEntries(snapshot).map(e => e.id));
  expect(snapshot.requests.some(r => queue.slice(-3).some(q => q.id === r.id))).toBe(false);
});
