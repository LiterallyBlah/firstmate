import { act, createElement, useState } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { Pressable, TextInput } from "react-native";
import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import { afterEach, expect, it, vi } from "vitest";
import type { NeedsYouSnapshot } from "../shared/needs-you";
import { attentionRequest, attentionSnapshot, attentionTheme } from "../test/attention-deck-fixture";
import type { DecisionDestination } from "./needs-you-state";

const rpc = vi.hoisted(() => ({
  snapshot: null as NeedsYouSnapshot | null,
  outcome: "accepted" as "accepted" | "failed" | "uncertain" | "refused",
  calls: [] as string[],
}));
vi.mock("react-native", () => Object.fromEntries(
  ["View", "Text", "Pressable", "ScrollView", "TextInput", "SafeAreaView"].map(name => [name, name]),
));
vi.mock("@getpaseo/plugin/client", () => ({
  useRpc: (contract: { name: string }) => async (input: { requestId: string }) => {
    rpc.calls.push(contract.name);
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
vi.mock("./workflow-plans", () => ({ PlanNeeds: () => null }));
vi.mock("./decision-context", () => ({ DecisionAsk: () => null, DecisionMaterials: () => null }));
vi.mock("./decision-brief", () => ({ briefFor: () => null, DecisionBrief: () => null, DecisionSummary: () => null }));
vi.mock("./decision-snooze", () => ({ DecisionSnooze: () => null }));

import { DecisionDrawer } from "./decision-drawer";
import { NEEDS_YOU_QUERY_KEY } from "./needs-you-query";

let renderer: ReactTestRenderer;
let client: QueryClient;
let selectedId: string;
const close = vi.fn();
async function mount(ids = ["a", "b", "c"]) {
  close.mockClear();
  rpc.calls = [];
  rpc.outcome = "accepted";
  rpc.snapshot = attentionSnapshot(ids.map(id => attentionRequest(id)));
  selectedId = rpc.snapshot.requests[0]!.id;
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
