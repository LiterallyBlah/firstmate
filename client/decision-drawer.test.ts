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
import { DecisionSurface, DecisionPane, useDecisionHandoff } from "./decision-surface";
import type { FleetShell } from "./shell";
import { drafts } from "./draft";
import { pendingAttachments } from "./attachments";
import { DecisionReadContext } from "./decision-read-context";
import type { DecisionReadState } from "./decision-read-state";

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
vi.mock("./fleet-query", () => ({ FLEET_QUERY_KEY: ["fleet"], useFleet: () => ({ data: {
  mate: { id: "mate", workspaceId: "home" }, mateInHome: true, suggestions: [],
} }) }));
vi.mock("./files", () => ({ FilesView: () => null }));
vi.mock("./card", () => ({ CrewCard: () => null, watchOpener() {} }));
vi.mock("./ui", () => ({ Tag: () => null }));
vi.mock("./option-picker", () => ({ OptionPicker: () => null }));
vi.mock("./markdown", () => ({ Markdown: ({ source }: { source: string }) => createElement("Text", null, source) }));
vi.mock("./decision-context", () => ({ DecisionAsk: ({ source }: { source: { ask: string } }) => createElement("Text", null, source.ask), DecisionMaterials: () => null }));
vi.mock("./decision-snooze", () => ({ DecisionSnooze: () => null }));

import { DecisionDrawer } from "./decision-drawer";
import { NeedsYouBubbles } from "./reply-bubble";
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
      onBackToFirstMate() { close(); setOpen(false); },
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

it("a complete empty All inbox explains itself and returns to FirstMate", async () => {
  await mount([], false, undefined, { initial: "all" });
  expect(words()).toContain("No decisions right now");
  await press("Back to FirstMate");
  expect(close).toHaveBeenCalledOnce();
  expect(rpc.calls).toHaveLength(0);
});

it.each(["offline", "partial", "corrupt", "unknown"])("an %s All read never claims there are no decisions", async state => {
  await mount([], false, snapshot => {
    if (state === "partial") snapshot.scopedComplete = false;
    if (state === "corrupt") snapshot.planProblems = ["Plan history could not be checked"];
    if (state === "unknown") snapshot.freshness.status = "unknown";
  }, { initial: "all", offline: state === "offline" });
  expect(words()).not.toContain("No decisions right now");
});
afterEach(async () => {
  await act(async () => renderer?.unmount());
  client?.clear();
  drafts.set("mate", "");
  pendingAttachments.set("mate", []);
});

it("includes plan reviews in the same counted queue", async () => {
  await mount(["a", "b", "c"], true, snapshot => {
    snapshot.planNow!.push({ ...planDecisionNeed(), node: undefined, decision: undefined });
    snapshot.actionCount!++;
  });
  expect(words()).toMatch(/Decisions\s+5 of 5/);
  expect(rpc.snapshot!.actionCount).toBe(5);
  expect(rpc.calls).toEqual([]);
  await press("Next decision");
  expect(words()).toMatch(/Decisions\s+1 of 5/);
  await press("Previous decision");
  await press("Previous decision");
  expect(words()).toMatch(/Decisions\s+4 of 5/);
  expect(button(`Review plan: ${planDecisionNeed().title}`)).toBeTruthy();
  expect(rpc.calls).toEqual([]);
});

it("opens the mixed healthy-and-unreadable footer directly in All with repair controls", async () => {
  rpc.snapshot = attentionSnapshot([attentionRequest("healthy")]);
  rpc.snapshot.actionCount = 2;
  rpc.snapshot.quarantined = [{ line: 5, taskId: "damaged-task", key: null, hasHold: true, problem: "Task scope could not be read." }];
  rpc.snapshot.freshness.problems = [rpc.snapshot.quarantined[0]!.problem];
  rpc.calls = [];
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  function FromDeck() {
    const [destination, select] = useState<DecisionDestination | null>(null);
    return destination ? createElement(DecisionDrawer, {
      theme: attentionTheme, snapshot: rpc.snapshot!, offline: false, destination, onSelect: select,
      onClose: () => select(null), mateId: "mate", suggestions: [], compact: false, returnLabel: "Deck",
    }) : createElement(NeedsYouBubbles, {
      snapshot: rpc.snapshot!, theme: attentionTheme,
      place: { left: 0, top: 0, width: 280, maxHeight: 400, side: "below", tail: 140 },
      holdRef: null, onClose() {}, onOpen: select,
    });
  }
  await act(async () => { renderer = create(createElement(QueryClientProvider, { client }, createElement(FromDeck))); });
  expect(button("Open decision: healthy")).toBeDefined();
  expect(button("Open Needs you: 1 more item")).toBeDefined();
  await press("Open Needs you: 1 more item");
  expect(renderer.root.findAll(node => (node.type as unknown) === "Text" && node.props.accessibilityRole === "header").some(node => node.children.join("") === "All")).toBe(true);
  expect(words()).toContain("Couldn't read this task: damaged-task.");
  expect(button("Ask the first mate to fix it")).toBeDefined();
  expect(renderer.root.findAllByType(TextInput)).toHaveLength(0);
  expect(button("Send answer")).toBeUndefined();
  expect(rpc.calls).toEqual([]);
  await press("Back to Deck");
  expect(button("Open Needs you: 1 more item")).toBeDefined();
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
  for (const marker of ["Waiting for you", "Spoiler and foreshadowing checks", "backlog", "A separate plan", "Coming up: 1 later decision", "Filters don’t hide decisions"]) expect(text).toContain(marker);
  expect(text.split("Spoiler and foreshadowing checks")).toHaveLength(2);
  expect(text).not.toContain("Review plan: Build the reader pass");
  expect(text.indexOf("Waiting for you")).toBeLessThan(text.indexOf("A separate plan"));
  expect(text.split("A separate plan")).toHaveLength(2);
  expect(button("Review plan: A separate plan")).toBeTruthy();
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

it.each(["held", "stale", "plan-problems", "offline", "not-ready", "older-host"])("disables the %s plan decision and refuses direct presses", async guard => {
  await mount([], true, snapshot => {
    if (guard === "held") snapshot.planNow![0]!.decision!.held = true;
    if (guard === "not-ready") snapshot.planNow![0]!.decision!.ready = false;
    if (guard === "older-host") delete snapshot.planNow![0]!.decision!.ready;
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

it("keeps Home's selected decision beside its existing chat when Discuss first is pressed", async () => {
  await mount(["release"]);
  const shell: FleetShell = { openView: vi.fn(), openHome: vi.fn(), openDecision: vi.fn() };
  await act(async () => {
    renderer.unmount();
    renderer = create(createElement(QueryClientProvider, { client }, createElement(DecisionSurface, {
      theme: attentionTheme, compact: false, params: { decision: "local:release", decisionHome: "sample-home", decisionRevision: "1" },
      shell, children: createElement(DecisionPane, { children: createElement("Text", null, "Tasks beside chat") }),
    })));
  });
  await act(async () => { renderer.root.findAll(n => n.type === View && typeof n.props.onLayout === "function")[0]!.props.onLayout({ nativeEvent: { layout: { width: 1440 } } }); });
  await press("Discuss first");
  expect(shell.openView).not.toHaveBeenCalled();
  expect(shell.openHome).not.toHaveBeenCalled();
  expect(renderer.root.findByType(DecisionDrawer).props.destination).toEqual({ homeId: "sample-home", requestId: "local:release", recordRevision: 1 });
});

let handoff: ReturnType<typeof useDecisionHandoff>;
function HandoffProbe({ pane }: { pane: boolean }) {
  handoff = useDecisionHandoff();
  return pane ? createElement(DecisionPane, { children: createElement("Text", null, "Tasks") }) : createElement("Text", null, "Chat");
}
const releaseParams = { decision: "local:release", decisionHome: "sample-home", decisionRevision: "1" };
async function surface(width: number, view: "home" | "chat" | "crew" = "home", params: Readonly<Record<string, string>> = releaseParams) {
  const shell: FleetShell = { openView: vi.fn(), openHome: vi.fn(), openDecision: vi.fn() };
  await act(async () => {
    renderer.unmount();
    renderer = create(createElement(QueryClientProvider, { client }, createElement(DecisionSurface, {
      theme: attentionTheme, compact: false, view, params, shell,
      children: createElement(HandoffProbe, { pane: view !== "chat" }),
    })));
  });
  await resizeSurface(width);
  return shell;
}
async function resizeSurface(width: number) {
  await act(async () => { renderer.root.findAll(n => n.type === View && typeof n.props.onLayout === "function")[0]!.props.onLayout({ nativeEvent: { layout: { width } } }); });
}

it.each([900, 1440])("keeps the discussion local on a %s-point Home", async width => {
  await mount(["release"]);
  const shell = await surface(width);
  await press("Discuss first");
  expect(renderer.root.findByType(DecisionDrawer).props.destination).toEqual(expect.objectContaining(releaseParamsToDestination()));
  expect(handoff.discussion).toEqual({ ...releaseParamsToDestination(), mateId: "mate" });
  expect(drafts.get("mate")).toBe("About «release»: ");
  expect(shell.openDecision).not.toHaveBeenCalled();
  expect(rpc.calls).not.toContain("firstmate.mate.ask");
});
function releaseParamsToDestination() { return { homeId: "sample-home", requestId: "local:release", recordRevision: 1 }; }

it("suspends the phone cover to discuss and returns to that exact decision", async () => {
  await mount(["release"]);
  await surface(390);
  expect(renderer.root.findByType(DecisionDrawer).props.modal).toBe(true);
  await press("Discuss first");
  expect(renderer.root.findAllByType(DecisionDrawer)).toHaveLength(0);
  await act(async () => handoff.resume());
  expect(renderer.root.findByType(DecisionDrawer).props.destination).toEqual(releaseParamsToDestination());
});

it("retains the discussion across resizing without reseeding a cleared draft", async () => {
  await mount(["release"]);
  await surface(1440);
  await press("Discuss first");
  const reference = handoff.discussion;
  drafts.set("mate", "");
  await resizeSurface(390);
  expect(renderer.root.findAllByType(DecisionDrawer)).toHaveLength(0);
  expect(handoff.discussion).toBe(reference);
  await resizeSurface(900);
  expect(renderer.root.findByType(DecisionDrawer).props.destination.requestId).toBe("local:release");
  expect(drafts.get("mate")).toBe("");
});

it.each(["revision", "resolved", "missing"])("does not resume a phone discussion after its decision is %s", async change => {
  await mount(["release"]);
  await surface(390);
  await press("Discuss first");
  const next = structuredClone(rpc.snapshot!);
  if (change === "revision") next.requests[0]!.revision++;
  if (change === "resolved") next.requests[0]!.state = "resolved";
  if (change === "missing") next.requests = [];
  next.version++;
  rpc.snapshot = next;
  await act(async () => { client.setQueryData(NEEDS_YOU_QUERY_KEY, next); await new Promise(resolve => setTimeout(resolve, 0)); });
  await act(async () => handoff.resume());
  expect(renderer.root.findAllByType(DecisionDrawer)).toHaveLength(0);
  await act(async () => handoff.dismiss());
  expect(renderer.root.findAllByType(DecisionDrawer)).toHaveLength(0);
  expect(handoff.discussion).toBeNull();
});

it("lets Chat dock at 1100 points and discusses locally below that width", async () => {
  await mount(["release"]);
  const shell = await surface(1100, "chat");
  expect(renderer.root.findByType(DecisionDrawer).props.modal).toBe(false);
  await resizeSurface(1099);
  expect(renderer.root.findByType(DecisionDrawer).props.modal).toBe(true);
  await press("Discuss first");
  expect(renderer.root.findAllByType(DecisionDrawer)).toHaveLength(0);
  await act(async () => handoff.resume());
  expect(renderer.root.findByType(DecisionDrawer).props.destination).toEqual(releaseParamsToDestination());
  expect(shell.openView).not.toHaveBeenCalled();
});

it("hands a surface without chat to Home with the selected revision and mate", async () => {
  await mount(["release"]);
  const shell = await surface(1440, "crew");
  await press("Discuss first");
  expect(shell.openDecision).toHaveBeenCalledExactlyOnceWith(releaseParamsToDestination(), { discussWith: "mate" });
  expect(shell.openView).not.toHaveBeenCalled();
});

it.each(["fresh", "stale"] as const)("keeps %s uncertain-delivery chat recovery local without preparing another answer", async freshness => {
  await mount(["release"], false, snapshot => { snapshot.requests[0]!.state = "delivery-uncertain"; snapshot.freshness.status = freshness; });
  const shell = await surface(390);
  await press("Open the first mate’s chat");
  expect(handoff.discussion?.requestId).toBe("local:release");
  expect(renderer.root.findAllByType(DecisionDrawer)).toHaveLength(0);
  expect(drafts.get("mate")).toBe("");
  expect(shell.openView).not.toHaveBeenCalled();
});

it.each(["home", "chat", "crew"] as const)("opens unreadable holds in Home's Board from %s", async view => {
  await mount(["release"], false, snapshot => {
    snapshot.quarantined = [{ line: 5, taskId: "damaged-task", key: null, hasHold: true, problem: "Task scope could not be read." }];
    snapshot.freshness.problems = [snapshot.quarantined[0]!.problem];
  });
  const shell = await surface(1440, view, { decision: "all", decisionHome: "sample-home" });
  await press("Open Board");
  if (view === "home") expect(handoff.boardRequest).not.toBeNull();
  else expect(shell.openDecision).toHaveBeenCalledExactlyOnceWith({ requestId: "all", homeId: "sample-home" }, { board: true });
  expect(renderer.root.findAllByType(DecisionDrawer)).toHaveLength(0);
  expect(shell.openView).not.toHaveBeenCalled();
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

it.each(["List", "Board"])("shows one review row within the real %s Needs-you total", async view => {
  await mount([], true, snapshot => {
    snapshot.planNow!.push({ plan: "review", title: "Storage proposal", question: "Review the plan", waits: [], neededBy: [], recommendation: "Review", review: { revision: 1, at: "2026-10-23T06:00:00Z" } });
    snapshot.actionCount!++;
  });
  const props = { cards: [], allCards: [], snapshot: rpc.snapshot!, offline: false, theme: attentionTheme, compact: true, density: "comfortable" as const,
    conversing: null, onConverse() {}, onChanged() {}, showDone: false, onShowDone() {}, layout: DEFAULT_TASK_LAYOUT, layoutDisabled: false, onLayout() {} };
  await act(async () => { renderer.unmount(); renderer = create(createElement(QueryClientProvider, { client }, view === "List" ? createElement(TaskList, props) : createElement(TaskBoard, props))); });
  expect(words()).toContain("Needs you · 2");
  expect(words().split("Storage proposal")).toHaveLength(2);
  expect(renderer.root.findAllByType(DecisionTask)).toHaveLength(2);
  expect(button("Review plan: Storage proposal")).toBeTruthy();
  expect(rpc.calls).not.toContain("firstmate.workflow.act");
});

it.each(["List", "Board", "Drawer"])("keeps %s pending neutral, partial counts held, and retained totals dated", async view => {
  rpc.calls = [];
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const props = { cards: [], allCards: [], offline: false, theme: attentionTheme, compact: true, density: "comfortable" as const,
    conversing: null, onConverse() {}, onChanged() {}, showDone: false, onShowDone() {}, layout: DEFAULT_TASK_LAYOUT, layoutDisabled: false, onLayout() {} };
  const render = (snapshot: NeedsYouSnapshot | undefined, read: DecisionReadState) => createElement(QueryClientProvider, { client },
    createElement(DecisionReadContext.Provider, { value: read }, view === "List" ? createElement(TaskList, { ...props, snapshot }) : view === "Board" ? createElement(TaskBoard, { ...props, snapshot }) : createElement(DecisionDrawer, {
      theme: attentionTheme, snapshot, offline: !!read.error, destination: { requestId: "all", homeId: "sample-home" }, onSelect() {}, onClose() {}, mateId: null, suggestions: [], compact: true,
    })));
  await act(async () => { renderer = create(render(undefined, { pending: true, fetching: true })); });
  expect(words()).toContain("Loading decisions…"); expect(words()).not.toContain("unavailable"); expect(words()).not.toContain("Can't read");
  expect(words()).not.toContain("Nothing needs");
  const partial = { ...attentionSnapshot([]), scopedComplete: false, scopedProblems: ["Some work could not be checked"] };
  await act(async () => renderer.update(render(partial, { readiness: "partial" })));
  expect(words()).not.toContain("Nothing needs"); expect(words()).not.toContain("Needs you · 0");
  const old = attentionSnapshot(); old.freshness.status = "stale";
  await act(async () => renderer.update(render(old, { error: true })));
  expect(words()).toContain(view === "Drawer" ? "Showing the list from" : "as of");
  expect(rpc.calls.filter(name => !name.endsWith(".read"))).toEqual([]);
});
