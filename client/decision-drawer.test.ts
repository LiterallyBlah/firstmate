import { act, createElement, useState } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { Pressable, TextInput, View } from "react-native";
import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import { afterEach, expect, it, vi } from "vitest";
import type { NeedsYouSnapshot } from "../shared/needs-you";
import { attentionRequest, attentionSnapshot, attentionTheme } from "../test/attention-deck-fixture";
import type { DecisionDestination } from "./needs-you-state";
import { planDecisionNeed } from "../test/plan-decision-fixture";
import type { PlanCaptainCommand } from "../shared/workflow-plans";
import { visibleText } from "../test/visible-text";
import { DecisionTask } from "./decision-tasks";
import { TaskList } from "./task-list";
import { TaskBoard } from "./task-board";
import { DEFAULT_TASK_LAYOUT } from "../shared/task-layout";
import { DecisionSurface } from "./decision-surface";

const rpc = vi.hoisted(() => ({
  snapshot: null as NeedsYouSnapshot | null,
  outcome: "accepted" as "accepted" | "failed" | "uncertain" | "refused",
  calls: [] as string[],
  delay: null as Promise<void> | null,
  planActions: [] as PlanCaptainCommand[],
  planHomes: [] as string[],
  answerSnapshot: null as NeedsYouSnapshot | null,
  refuseWithChange: false,
  readFailure: false,
  pollSnapshot: null as NeedsYouSnapshot | null,
}));
vi.mock("react-native", () => Object.fromEntries(
  ["View", "Text", "Pressable", "ScrollView", "TextInput", "SafeAreaView"].map(name => [name, name]),
));
vi.mock("@getpaseo/plugin/client", () => ({
  useSettings: () => ({ status: "ready", values: { hostTab: "all", tagFilter: [] } }),
  useRpc: (contract: { name: string }) => async (input: { homeId: string; requestId: string; command?: PlanCaptainCommand }) => {
    rpc.calls.push(contract.name);
    if (contract.name === "firstmate.needs-you.read") {
      if (rpc.readFailure) throw new Error("Snapshot unavailable");
      return structuredClone(rpc.snapshot!);
    }
    if (contract.name === "firstmate.workflow.act") {
      if (rpc.outcome === "refused") {
        if (rpc.refuseWithChange) {
          const next = structuredClone(rpc.snapshot!);
          next.planNow![0]!.decision!.subjectHash = "c".repeat(64);
          next.planNow![0]!.question = "Updated reader checks";
          rpc.snapshot = next;
        }
        throw new Error("Plan changed");
      }
      rpc.planActions.push(input.command!);
      rpc.planHomes.push(input.homeId);
      rpc.snapshot!.planNow = [];
      if (rpc.snapshot!.actionCount !== null) rpc.snapshot!.actionCount--;
      return { homeId: rpc.snapshot!.homeId, plans: [], now: [], comingUp: [], subjects: {} };
    }
    if (!contract.name.endsWith(".answer")) throw new Error(`Unexpected RPC: ${contract.name}`);
    if (rpc.outcome === "refused") throw new Error("Decision changed");
    const snapshot = structuredClone(rpc.snapshot!);
    if (rpc.outcome !== "failed") {
      const request = snapshot.requests.find(r => r.id === input.requestId)!;
      request.state = rpc.outcome === "accepted" ? "answer-sent" : "delivery-uncertain";
      snapshot.actionCount = (snapshot.actionCount ?? 0) - 1;
      snapshot.version++;
    }
    rpc.snapshot = snapshot;
    if (rpc.delay) await rpc.delay;
    const { planNow: _now, comingUp: _later, planProblems: _problems, ...ledger } = snapshot;
    ledger.actionCount = ledger.requests.filter(r => r.state === "new" || r.state === "seen").length;
    rpc.answerSnapshot = ledger; // Production answerDecision returns the backlog ledger, not the combined read.
    return { outcome: rpc.outcome, snapshot: ledger };
  },
}));
vi.mock("@getpaseo/plugin/client/react-native", () => ({
  Icon: () => null,
  useToast: () => ({ error() {} }),
  Modal: Object.assign(({ open, children }: { open: boolean; children: unknown }) => open ? children : null,
    { Content: ({ children }: { children: unknown }) => children }),
}));
vi.mock("./web", () => ({
  webAttributes: () => ({}), focusWebElement() {}, cycleWebFocus() {},
  bindWebKeys: () => () => {}, webSurfaceVisible: () => false,
}));
vi.mock("./keyboard", () => ({ useKeyboardOverlap: () => 0 }));
vi.mock("./fleet-query", () => ({ FLEET_QUERY_KEY: ["fleet"], useFleet: () => ({ data: null }) }));
vi.mock("./files", () => ({ FilesView: () => null }));
vi.mock("./card", () => ({ CrewCard: () => null, watchOpener() {} }));
vi.mock("./ui", () => ({ Tag: () => null }));
vi.mock("./option-picker", () => ({ OptionPicker: () => null }));
vi.mock("./markdown", () => ({ Markdown: ({ source }: { source: string }) => createElement("Text", null, source) }));
vi.mock("./decision-context", () => ({ DecisionAsk: ({ source }: { source: { ask: string } }) => createElement("Text", null, source.ask), DecisionMaterials: () => null }));
vi.mock("./decision-snooze", () => ({ DecisionSnooze: () => null }));

import { DecisionDrawer } from "./decision-drawer";
import { NEEDS_YOU_QUERY_KEY } from "./needs-you-query";

let renderer: ReactTestRenderer;
let client: QueryClient;
let selectedId: string;
const close = vi.fn();
async function mount(ids = ["a", "b", "c"], planDecision = false, configure?: (snapshot: NeedsYouSnapshot) => void,
  options: { offline?: boolean; initial?: string; filtered?: boolean } = {}) {
  close.mockClear();
  rpc.calls = [];
  rpc.outcome = "accepted";
  rpc.delay = null;
  rpc.planActions = [];
  rpc.planHomes = [];
  rpc.refuseWithChange = false;
  rpc.readFailure = false;
  rpc.pollSnapshot = null;
  rpc.snapshot = attentionSnapshot(ids.map(id => attentionRequest(id)));
  if (planDecision) {
    rpc.snapshot.planNow = [planDecisionNeed()];
    rpc.snapshot.comingUp = [{ ...planDecisionNeed(), node: "later", question: "Later decision" }];
    rpc.snapshot.actionCount!++;
  }
  configure?.(rpc.snapshot);
  selectedId = options.initial ?? (planDecision ? "plan-decision:reader-pass:checks" : rpc.snapshot.requests[0]!.id);
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  function Origin() {
    const [destination, select] = useState<DecisionDestination>({ requestId: selectedId });
    const [open, setOpen] = useState(true);
    const query = useQuery({ queryKey: NEEDS_YOU_QUERY_KEY, queryFn: async () => rpc.pollSnapshot ?? rpc.snapshot! });
    return open && query.data ? createElement(DecisionDrawer, {
      theme: attentionTheme, snapshot: query.data, offline: options.offline ?? false, filtered: options.filtered ?? false, destination,
      onSelect(next) { selectedId = next.requestId; select(next); },
      onClose() { close(); setOpen(false); },
      mateId: "mate", suggestions: [], compact: false, returnLabel: "Board",
    }) : createElement("Text", null, "Original Board");
  }
  await act(async () => {
    client.setQueryData(NEEDS_YOU_QUERY_KEY, rpc.snapshot);
    renderer = create(createElement(QueryClientProvider, { client }, createElement(Origin)));
  });
}
function button(label: string) {
  return renderer.root.findAll(node => node.type === Pressable && node.props.accessibilityLabel === label)[0]!;
}
async function press(label: string) {
  await act(async () => { button(label).props.onPress(); });
}
async function answer() {
  await act(async () => {
    renderer.root.findByType(TextInput).props.onChangeText("Choose the cautious option");
  });
  await press("Send answer");
}
function words() { return visibleText(renderer.toJSON()); }
afterEach(async () => {
  await act(async () => renderer?.unmount());
  client?.clear();
});

it("advances in session order and keeps answered holds out of navigation after a refresh", async () => {
  await mount();
  await answer();
  expect(selectedId).toBe("local:b");
  expect(words()).toContain("Answer sent.");
  expect(words()).not.toContain("The first mate will lift the hold");
  const answered = rpc.snapshot!.requests[0]!;
  expect(answered.source.ask).toBe("Which option should we take?"); // The hold still exists.
  expect(answered.state).toBe("answer-sent");
  await act(async () => { await client.invalidateQueries({ queryKey: NEEDS_YOU_QUERY_KEY }); });
  await press("Previous decision");
  expect(selectedId).toBe("local:c");
  await press("Next decision");
  expect(selectedId).toBe("local:b");
  await press("All decisions");
  expect(words()).toContain("Answered · waiting for the first mate");
  expect(rpc.calls.filter(name => name.endsWith(".answer"))).toHaveLength(1);
});

it("closes after the last answer and restores the opening view", async () => {
  await mount(["a"]);
  await answer();
  expect(close).toHaveBeenCalledOnce();
  expect(words()).toContain("Original Board");
});

it("keeps an accepted backlog reply disabled while the combined read fails and polling still shows the old gate", async () => {
  await mount(["a"]);
  rpc.pollSnapshot = structuredClone(rpc.snapshot!);
  rpc.readFailure = true;
  await answer();
  await act(async () => { await client.invalidateQueries({ queryKey: NEEDS_YOU_QUERY_KEY }); });
  expect(words()).toContain("Answer sent. Refresh decisions to continue.");
  expect((client.getQueryData(NEEDS_YOU_QUERY_KEY) as NeedsYouSnapshot).requests[0]!.state).toBe("new");
  expect(close).not.toHaveBeenCalled();
  // A new draft removes the empty-input guard; only the accepted-answer gate can block this reply.
  await act(async () => { renderer.root.findByType(TextInput).props.onChangeText("A second answer"); });
  expect(button("Send answer").props.disabled).toBe(true);
  await press("Send answer");
  expect(rpc.calls.filter(name => name.endsWith(".answer"))).toHaveLength(1);
});

it("uses the newer same-home poll when the last answer's accepted response arrives late", async () => {
  await mount(["a"]);
  let release!: () => void;
  rpc.delay = new Promise<void>(resolve => { release = resolve; });
  await answer();
  expect(selectedId).toBe("local:a");
  expect(close).not.toHaveBeenCalled();

  const newer = structuredClone(rpc.snapshot!);
  newer.requests.push(attentionRequest("b"));
  newer.actionCount = 1;
  newer.version++;
  newer.freshness.checkedAt++;
  rpc.snapshot = newer;
  await act(async () => { await client.invalidateQueries({ queryKey: NEEDS_YOU_QUERY_KEY }); });
  await act(async () => { release(); });

  expect(client.getQueryData(NEEDS_YOU_QUERY_KEY)).toEqual(newer);
  expect(close).not.toHaveBeenCalled();
  expect(selectedId).toBe("local:b");
  expect(words()).toContain("Answer sent.");
});

it.each([false, true])("advances or closes after selecting a question in All (last=%s)", async last => {
  await mount(last ? ["a"] : ["a", "b", "c"]);
  await press("All decisions");
  const row = renderer.root.findAll(node => node.type === Pressable &&
    String(node.props.accessibilityLabel).startsWith(`Answer: ${last ? "a" : "b"}.`))[0]!;
  await act(async () => row.props.onPress());
  await answer();
  if (last) expect(close).toHaveBeenCalledOnce();
  else {
    expect(selectedId).toBe("local:c");
    expect(close).not.toHaveBeenCalled();
    await press("Previous decision");
    expect(selectedId).toBe("local:a");
  }
});

it.each(["failed", "refused", "uncertain"] as const)("stays on the question with its draft when delivery is %s", async outcome => {
  await mount(["a"]);
  rpc.outcome = outcome;
  await answer();
  expect(selectedId).toBe("local:a");
  expect(close).not.toHaveBeenCalled();
  expect(words()).toContain(outcome === "failed" ? "The answer was not sent" :
    outcome === "refused" ? "Could not confirm this submission" : "Delivery not confirmed");
  if (outcome !== "uncertain")
    expect(renderer.root.findByType(TextInput).props.value).toBe("Choose the cautious option");
});

it.each([false, true])("renders and answers a due plan card through the plan action, then advances or closes (last=%s)", async last => {
  await mount(last ? [] : ["backlog"], true);
  expect(words()).toContain("Spoiler and foreshadowing checks");
  expect(words()).toContain("Keep the reader pass spoiler-safe");
  expect(words()).toContain("Recommended reader checks");
  expect(button("Keep both checks")).toBeTruthy();
  expect(rpc.calls).not.toContain("firstmate.needs-you.seen");
  await press("Keep both checks");
  expect(rpc.planActions).toEqual([expect.objectContaining({ op: "captain", action: "answer", plan: "reader-pass", node: "checks", option: "both", revision: 3, subjectHash: "b".repeat(64) })]);
  expect(rpc.planHomes).toEqual(["workflow-home-hash"]); // The ledger's UUID is a different home identity.
  expect(rpc.calls).not.toContain("firstmate.needs-you.answer");
  if (last) expect(close).toHaveBeenCalledOnce();
  else expect(selectedId).toBe("local:backlog");
});

it("puts the plan card once in Waiting for you in All, before folded future decisions, without changing the count", async () => {
  await mount(["backlog"], true);
  await press("All decisions");
  expect(words()).toContain("Waiting for you");
  expect(words()).not.toContain("Now · plans");
  expect(words()).not.toContain("Later decision");
  expect(rpc.snapshot!.actionCount).toBe(2);
  const card = renderer.root.findAll(n => n.type === Pressable && n.props.accessibilityLabel === "Answer: Spoiler and foreshadowing checks. Keep the reader pass spoiler-safe");
  expect(card).toHaveLength(2); // Title and Answer button on one shared DecisionTask card.
  await act(async () => card[0]!.props.onPress());
  await press("Keep both checks");
  expect(selectedId).toBe("local:backlog");
});

it("keeps a stale or refused plan answer on the decision", async () => {
  await mount([], true);
  rpc.outcome = "refused";
  await press("Keep both checks");
  expect(words()).toContain("Plan changed");
  expect(close).not.toHaveBeenCalled();
  expect(rpc.planActions).toEqual([]);
});

it("uses the plan home identity when the backlog observer is disabled", async () => {
  await mount([], true, snapshot => {
    snapshot.homeId = null; snapshot.actionCount = null; snapshot.freshness.status = "disabled";
  });
  expect(button("Keep both checks").props.disabled).toBe(false);
  await press("Keep both checks");
  expect(rpc.planHomes).toEqual(["workflow-home-hash"]);
  expect(close).toHaveBeenCalledOnce();
});

it("advances from a backlog answer to the remaining plan decision", async () => {
  await mount(["backlog"], true);
  await press("Next decision");
  expect(selectedId).toBe("local:backlog");
  await answer();
  expect(rpc.answerSnapshot!.planNow).toBeUndefined();
  expect(selectedId).toBe("plan-decision:reader-pass:checks");
  expect(button("Keep both checks")).toBeTruthy();
  expect(close).not.toHaveBeenCalled();
});

it("shows a due decision only once and before all quiet plan content in All", async () => {
  await mount(["backlog"], true, snapshot => {
    snapshot.planNow!.push({ plan: "review", title: "A separate plan", question: "Approve this plan", waits: [], neededBy: [], recommendation: "Review" });
    snapshot.actionCount!++;
  }, { filtered: true });
  await press("All decisions");
  const text = words();
  for (const marker of ["Waiting for you", "Spoiler and foreshadowing checks", "backlog", "Review plan: A separate plan", "Coming up: 1 later decision", "Filters don’t hide decisions"]) expect(text).toContain(marker);
  expect(text.split("Spoiler and foreshadowing checks")).toHaveLength(2);
  expect(text).not.toContain("Review plan: Build the reader pass");
  expect(text.indexOf("Waiting for you")).toBeLessThan(text.indexOf("Review plan: A separate plan"));
  expect(text.indexOf("Spoiler and foreshadowing checks")).toBeLessThan(text.indexOf("Review plan: A separate plan"));
  expect(text.indexOf("backlog")).toBeLessThan(text.indexOf("Coming up: 1 later decision"));
  expect(text.indexOf("backlog")).toBeLessThan(text.indexOf("Filters don’t hide decisions"));
  await press("Coming up: 1 later decision");
  expect(words()).toContain("Later decision · after earlier work is finished");
  expect(words()).not.toContain("Build the reader pass into chapter-making and roll it out:");
  expect(words().split("Keep the reader pass spoiler-safe")).toHaveLength(2);
});

it("uses the plan question and recommendation without an optional brief", async () => {
  await mount([], true, snapshot => { delete snapshot.planNow![0]!.decision!.brief; });
  expect(words()).toContain("Keep the reader pass spoiler-safe");
  expect(words()).toContain("Keep both checks — preserve reader confidence.");
  await press("All decisions");
  expect(words()).toContain("Keep both checks — preserve reader confidence.");
  await press("Back to Needs you");
  await press("Keep both checks");
  expect(close).toHaveBeenCalledOnce();
});

it.each(["held", "stale", "plan-problems", "offline"])("disables the %s plan decision and refuses direct presses", async guard => {
  await mount([], true, snapshot => {
    if (guard === "held") snapshot.planNow![0]!.decision!.held = true;
    if (guard === "stale") snapshot.freshness.status = "stale";
    if (guard === "plan-problems") snapshot.planProblems = ["Some plan evidence is unavailable"];
  }, { offline: guard === "offline" });
  expect(button("Keep both checks").props.disabled).toBe(true);
  await press("Keep both checks");
  expect(rpc.calls).not.toContain("firstmate.workflow.act");
});

it.each(["stale", "offline"])("puts the %s warning before the selected card and All's waiting cards", async state => {
  await mount(["backlog"], true, snapshot => {
    if (state === "stale") snapshot.freshness.status = "stale";
  }, { offline: state === "offline" });
  expect(words()).toContain("Showing the list from");
  expect(words().indexOf("Showing the list from")).toBeLessThan(words().indexOf("Spoiler and foreshadowing checks"));
  await press("All decisions");
  expect(words().indexOf("Showing the list from")).toBeLessThan(words().indexOf("Waiting for you"));
});

it("retains a refusal after a refreshed subject remounts the plan card", async () => {
  await mount([], true);
  rpc.outcome = "refused"; rpc.refuseWithChange = true;
  await press("Keep both checks");
  await act(async () => { await client.invalidateQueries({ queryKey: NEEDS_YOU_QUERY_KEY }); await new Promise(resolve => setTimeout(resolve, 0)); });
  expect(words()).toContain("Updated reader checks");
  expect(words()).toContain("Plan changed");
  expect(close).not.toHaveBeenCalled();
});

it.each(["next", "empty"])("resolves the drawer's %s destination to its due plan card", async initial => {
  await mount([], true, undefined, { initial });
  expect(words()).toContain("Spoiler and foreshadowing checks");
  await press("Keep both checks");
  expect(close).toHaveBeenCalledOnce();
});

it("resolves the surface's next action to the actual plan request identity", async () => {
  await mount([], true);
  await act(async () => {
    renderer.unmount();
    renderer = create(createElement(QueryClientProvider, { client }, createElement(DecisionSurface, {
      theme: attentionTheme, compact: false, params: { decision: "next" }, children: createElement("Text", null, "Home"),
    })));
  });
  await act(async () => { renderer.root.findAll(n => n.type === View && typeof n.props.onLayout === "function")[0]!.props.onLayout({ nativeEvent: { layout: { width: 1440 } } }); });
  expect(renderer.root.findByType(DecisionDrawer).props.destination.requestId).toBe("plan-decision:reader-pass:checks");
});

it("uses the same shared card component and style for plan and backlog decisions in All", async () => {
  await mount(["backlog"], true, snapshot => { snapshot.requests[0]!.state = "seen"; });
  await press("All decisions");
  expect(renderer.root.findAllByType(DecisionTask)).toHaveLength(2);
  const cards = renderer.root.findAll(n => n.type === View && n.props.testID === "decision-task");
  expect(cards.map(c => [c.props.style.borderWidth, c.props.style.borderRadius, c.props.style.padding])).toEqual([[1, 8, 12], [1, 8, 12]]);
});

it("does not claim a backlog decision has no worker when All has no worker inventory", async () => {
  await mount(["backlog"]);
  await press("All decisions");
  await press("Details for decision backlog");
  expect(words()).toContain("Waiting since");
  expect(words()).not.toContain("No worker card is attached to this decision.");
});

it.each(["List", "Board"])("omits Coming up from the real %s component", async view => {
  await mount([], true);
  const props = { cards: [], allCards: [], snapshot: rpc.snapshot!, offline: false, theme: attentionTheme, compact: false, density: "comfortable" as const,
    conversing: null, onConverse() {}, onChanged() {}, showDone: false, onShowDone() {}, layout: DEFAULT_TASK_LAYOUT, layoutDisabled: false, onLayout() {} };
  await act(async () => {
    renderer.unmount();
    renderer = create(createElement(QueryClientProvider, { client }, view === "List" ? createElement(TaskList, props) : createElement(TaskBoard, props)));
  });
  expect(words()).toContain("Spoiler and foreshadowing checks");
  expect(words()).not.toContain("Coming up");
  expect(words()).not.toContain("Later decision");
  expect(words()).not.toContain("Review plan: Build the reader pass");
});
