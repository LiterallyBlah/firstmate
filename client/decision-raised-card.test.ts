import { act, createElement } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import { observeNeedsYou } from "../server/needs-you-detect";
import { emptyLedger, mutateNeedsYou, needsYouSnapshot, reconcileNeedsYou } from "../server/needs-you-ledger";
import type { NeedsYouSnapshot } from "../shared/needs-you";
import { attentionTheme } from "../test/attention-deck-fixture";
import { decisionDraftKey, decisionSession } from "./needs-you-state";
import { DecisionReadContext } from "./decision-read-context";

vi.mock("react-native", () => ({ Pressable: "Pressable", Text: "Text", View: "View" }));
vi.mock("@getpaseo/plugin/client/react-native", () => ({ useToast: () => ({ show() {}, error() {} }) }));
/** The answer RPC's next result, set by each test. */
const rpc = vi.hoisted(() => ({ answer: vi.fn() }));
const openDecision = vi.hoisted(() => vi.fn());
vi.mock("./decision-action", () => ({ useOpenDecision: () => openDecision }));
vi.mock("@getpaseo/plugin/client", () => ({
  useRpc: (contract: { name: string }) => (contract.name === "firstmate.needs-you.answer" ? rpc.answer : async () => ({})),
}));
vi.mock("./decision-drawer", async () => {
  const { createElement } = await import("react");
  return {
    DecisionButton: (props: { label: string; onPress(): void; disabled?: boolean }) =>
      createElement("Pressable", { accessibilityLabel: props.label, onPress: props.onPress, disabled: props.disabled }, props.label),
  };
});
vi.mock("./decision-brief", async () => {
  const { createElement } = await import("react");
  return {
    DecisionSummary: (props: { request: { source: { ask: string } } }) => createElement("Text", null, props.request.source.ask),
  };
});
import { DecisionRaisedCard } from "./decision-raised-card";

const backlog = (fields: string) =>
  `## In flight\n## Queued\n- [ ] host - Choose the Windows host (kind: captain) ${fields}\n## Done\n`;
const observe = (fields: string) => observeNeedsYou(backlog(fields), null);
function raised() {
  const baseline = reconcileNeedsYou(emptyLedger("home", "/home"), observe(""), 1000);
  return reconcileNeedsYou(baseline, observe("(hold: Light or Atlas?)"), 5000);
}
function snapshotWithChoice(): NeedsYouSnapshot {
  const snapshot = needsYouSnapshot(raised(), { status: "fresh", asOf: 9000, checkedAt: 9000, problems: [] });
  const request = snapshot.requests[0]!;
  snapshot.answerOptions = [{
    label: "Atlas",
    prompt: "For host: I choose option 1.",
    decision: { homeId: "home", requestId: request.id, recordRevision: request.revision, actionId: "brief:atlas" },
  }];
  return snapshot;
}

let renderer: ReactTestRenderer | undefined;
const client = new QueryClient();
afterEach(async () => {
  if (renderer) await act(async () => renderer!.unmount());
  renderer = undefined;
  client.clear();
  rpc.answer.mockReset();
});
async function render(snapshot: NeedsYouSnapshot, offline = false) {
  await act(async () => {
    renderer = create(createElement(QueryClientProvider, { client },
      createElement(DecisionRaisedCard, {
        theme: attentionTheme, request: snapshot.requests[0]!, snapshot, mateId: "mate", compact: false, offline,
      })));
  });
  return renderer!;
}
const text = (tree: ReactTestRenderer) => JSON.stringify(tree.toJSON());
const warning = (tree: ReactTestRenderer) => tree.root.findAll((node) => node.props.testID === "decision-raised-warning");

it("retains the question and timestamp during refresh, and disables answers after a confirmed read failure", async () => {
  const snapshot = snapshotWithChoice();
  const tree = (error: boolean) => createElement(QueryClientProvider, { client }, createElement(DecisionReadContext.Provider, { value: { fetching: !error, error } },
    createElement(DecisionRaisedCard, { theme: attentionTheme, request: snapshot.requests[0]!, snapshot, mateId: "mate", compact: true })));
  await act(async () => { renderer = create(tree(false)); });
  expect(text(renderer!)).not.toContain("Updating…"); expect(text(renderer!)).not.toContain("as of"); expect(text(renderer!)).not.toContain("Last updated");
  expect(text(renderer!)).toContain("Light or Atlas?");
  await act(async () => renderer!.update(tree(true)));
  expect(renderer!.root.findByProps({ accessibilityLabel: "Choose: Atlas" }).props.disabled).toBe(true);
  expect(rpc.answer).not.toHaveBeenCalled();
});

describe("a raised decision's card, when its data may be out of date", () => {
  it("warns beside the retained question when this task's line could not be read, and disables its answers", async () => {
    const snapshot = snapshotWithChoice();
    snapshot.quarantined = [{ line: 4, taskId: "host", key: null, hasHold: true, problem: "Line 4, task host: Could not read metadata; check parentheses." }];
    const tree = await render(snapshot);
    expect(warning(tree)).toHaveLength(1);
    expect(text(tree)).toContain("Some backlog lines need repair");
    expect(text(tree)).toContain("Couldn't read this task: host. Check the Board and data/backlog.md, line 4.");
    expect(text(tree)).toContain("Light or Atlas?");
    expect(tree.root.findByProps({ accessibilityLabel: "Choose: Atlas" }).props.disabled).toBe(true);
  });

  it("says how old a stale snapshot is, and warns when offline", async () => {
    const stale = snapshotWithChoice();
    stale.freshness = { status: "stale", asOf: new Date(2026, 9, 21, 9, 5).getTime(), checkedAt: 9000, problems: ["Backlog changed while it was read."] };
    let tree = await render(stale);
    expect(text(tree)).toContain("This decision may be out of date. You can answer once FirstMate can read the backlog again.");
    expect(text(tree)).toContain("Backlog changed while it was read.");
    await act(async () => renderer!.unmount());
    tree = await render(snapshotWithChoice(), true);
    expect(text(tree)).toContain("Could not refresh decision data. Check the host connection.");
  });

  it("shows no warning while the snapshot is current", async () => {
    expect(warning(await render(snapshotWithChoice()))).toHaveLength(0);
  });
});

describe("answering from a raised decision's card", () => {
  it.each(["resolved", "answer-sent", "delivery-uncertain"] as const)("keeps a compact %s receipt that opens the original decision without sending", async state => {
    const snapshot = snapshotWithChoice();
    const request = snapshot.requests[0]!;
    request.state = state;
    const before = structuredClone(snapshot);
    const tree = await render(snapshot);
    expect(text(tree)).not.toContain("Light or Atlas?");
    expect(text(tree)).toContain("Choose the Windows host");
    await act(async () => tree.root.findByProps({ accessibilityLabel: "Open the decision" }).props.onPress());
    expect(openDecision).toHaveBeenLastCalledWith({ homeId: snapshot.homeId, requestId: request.id, recordRevision: request.revision });
    expect(rpc.answer).not.toHaveBeenCalled();
    expect(snapshot).toEqual(before);
  });
  it("keeps the exact words in the drawer's draft for this revision, so Send again… has them after an uncertain delivery", async () => {
    const snapshot = snapshotWithChoice();
    const request = snapshot.requests[0]!;
    const uncertain = needsYouSnapshot(
      mutateNeedsYou(raised(), { homeId: "home", id: request.id, revision: request.revision }, { kind: "answer", submissionId: "s", outcome: "uncertain" }, 6000),
      { status: "fresh", asOf: 9000, checkedAt: 9000, problems: [] },
    );
    rpc.answer.mockResolvedValue({ outcome: "uncertain", snapshot: uncertain });
    const tree = await render(snapshot);
    await act(async () => tree.root.findByProps({ accessibilityLabel: "Choose: Atlas" }).props.onPress());
    expect(rpc.answer).toHaveBeenCalledWith(expect.objectContaining({ text: "For host: I choose option 1.", recordRevision: request.revision }));
    expect(decisionSession(client).drafts.get(decisionDraftKey("home", request))).toBe("For host: I choose option 1.");
  });

  it("clears that draft once the answer is accepted, as the drawer does", async () => {
    const snapshot = snapshotWithChoice();
    const request = snapshot.requests[0]!;
    rpc.answer.mockResolvedValue({ outcome: "accepted", snapshot });
    const tree = await render(snapshot);
    await act(async () => tree.root.findByProps({ accessibilityLabel: "Choose: Atlas" }).props.onPress());
    expect(rpc.answer).toHaveBeenCalledTimes(1);
    expect(decisionSession(client).drafts.has(decisionDraftKey("home", request))).toBe(false);
  });
});
