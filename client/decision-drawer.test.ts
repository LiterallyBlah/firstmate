import { act, createElement, useState } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { Pressable, TextInput } from "react-native";
import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import { afterEach, expect, it, vi } from "vitest";
import type { NeedsYouSnapshot } from "../shared/needs-you";
import { attentionRequest, attentionSnapshot, attentionTheme } from "../test/attention-deck-fixture";
import type { DecisionDestination } from "./needs-you-state";
import { planDecisionNeed } from "../test/plan-decision-fixture";
import type { PlanCaptainCommand } from "../shared/workflow-plans";

const rpc = vi.hoisted(() => ({
  snapshot: null as NeedsYouSnapshot | null,
  outcome: "accepted" as "accepted" | "failed" | "uncertain" | "refused",
  calls: [] as string[],
  delay: null as Promise<void> | null,
  planActions: [] as PlanCaptainCommand[],
  planHomes: [] as string[],
}));
vi.mock("react-native", () => Object.fromEntries(
  ["View", "Text", "Pressable", "ScrollView", "TextInput", "SafeAreaView"].map(name => [name, name]),
));
vi.mock("@getpaseo/plugin/client", () => ({
  useRpc: (contract: { name: string }) => async (input: { homeId: string; requestId: string; command?: PlanCaptainCommand }) => {
    rpc.calls.push(contract.name);
    if (contract.name === "firstmate.needs-you.read") return structuredClone(rpc.snapshot!);
    if (contract.name === "firstmate.workflow.act") {
      if (rpc.outcome === "refused") throw new Error("Plan changed");
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
    return { outcome: rpc.outcome, snapshot };
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
async function mount(ids = ["a", "b", "c"], planDecision = false, configure?: (snapshot: NeedsYouSnapshot) => void) {
  close.mockClear();
  rpc.calls = [];
  rpc.outcome = "accepted";
  rpc.delay = null;
  rpc.planActions = [];
  rpc.planHomes = [];
  rpc.snapshot = attentionSnapshot(ids.map(id => attentionRequest(id)));
  if (planDecision) {
    rpc.snapshot.planNow = [planDecisionNeed()];
    rpc.snapshot.comingUp = [{ ...planDecisionNeed(), node: "later", question: "Later decision" }];
    rpc.snapshot.actionCount!++;
  }
  configure?.(rpc.snapshot);
  selectedId = planDecision ? "plan-decision:reader-pass:checks" : rpc.snapshot.requests[0]!.id;
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  function Origin() {
    const [destination, select] = useState<DecisionDestination>({ requestId: selectedId });
    const [open, setOpen] = useState(true);
    const query = useQuery({ queryKey: NEEDS_YOU_QUERY_KEY, queryFn: async () => rpc.snapshot! });
    return open && query.data ? createElement(DecisionDrawer, {
      theme: attentionTheme, snapshot: query.data, offline: false, destination,
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
function words() { return JSON.stringify(renderer.toJSON()); }
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
    String(node.props.accessibilityLabel).startsWith(`${last ? "a" : "b"} · `))[0]!;
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
  expect(selectedId).toBe("plan-decision:reader-pass:checks");
  expect(button("Keep both checks")).toBeTruthy();
  expect(close).not.toHaveBeenCalled();
});

it("uses the plan question and recommendation without an optional brief", async () => {
  await mount([], true, snapshot => { delete snapshot.planNow![0]!.decision!.brief; });
  expect(words()).toContain("Keep the reader pass spoiler-safe");
  expect(words()).toContain("Keep both checks — preserve reader confidence.");
  await press("Keep both checks");
  expect(close).toHaveBeenCalledOnce();
});
