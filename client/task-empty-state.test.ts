import { act, createElement } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { expect, it, vi } from "vitest";
import { attentionCard, attentionRequest, attentionSnapshot, attentionTheme } from "../test/attention-deck-fixture";
import { DEFAULT_TASK_LAYOUT } from "../shared/task-layout";
import { taskSourceKey } from "./task-presentation";
vi.mock("react-native", () => ({ Pressable: "Pressable", Text: "Text", ScrollView: "ScrollView", View: "View" }));
vi.mock("./card", () => ({ CrewCard: (props: object) => createElement("CrewCard", props) }));
vi.mock("./decision-tasks", () => ({
  DecisionTask: (props: object) => createElement("DecisionTask", props), DecisionQueueNote: () => null,
}));
vi.mock("./workflow-plans", () => ({ PlanNeeds: () => null }));
import { TaskList } from "./task-list";
import { TaskBoard } from "./task-board";

it.each(["List", "Board"] as const)("explains decision-only filter matches and retains all decisions in %s", async view => {
  const card = attentionCard("match", "working");
  const matching = attentionRequest("match"); matching.source.key = taskSourceKey(card)!;
  const snapshot = attentionSnapshot([matching, attentionRequest("other-host", "new", "elsewhere")]);
  let tree: ReactTestRenderer;
  const props = { cards: [card], allCards: [card], snapshot, filtered: true, theme: attentionTheme, compact: false,
    offline: false, density: "comfortable" as const, conversing: null, onConverse() {}, onChanged() {},
    showDone: false, onShowDone() {}, layout: { ...DEFAULT_TASK_LAYOUT, collapsed: [] }, layoutDisabled: false, onLayout() {} };
  const render = (cards = props.cards) => view === "List" ? createElement(TaskList, { ...props, cards }) : createElement(TaskBoard, { ...props, cards });
  await act(async () => { tree = create(render()); });
  expect(JSON.stringify(tree!.toJSON())).toContain("1 matching task is in Needs you");
  expect(tree!.root.findAllByType("DecisionTask" as never)).toHaveLength(2);
  await act(async () => tree!.update(render([])));
  expect(JSON.stringify(tree!.toJSON())).not.toContain("matching task is in Needs you");
  expect(tree!.root.findAllByType("DecisionTask" as never)).toHaveLength(2);
  await act(async () => tree!.update(render([card, attentionCard("ordinary", "working")])));
  expect(JSON.stringify(tree!.toJSON())).not.toContain("matching task is in Needs you");
  await act(async () => tree!.unmount());
});
