/**
 * The board's "5 listed, it says 8": real backlog text through the real detector, ledger and plan join.
 * The count and the rows List and Board draw must be the same number, whatever the backlog holds.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { act, createElement } from "react";
import { create } from "react-test-renderer";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, expect, it, vi } from "vitest";
import { activeDecisions } from "../client/task-presentation";
import { TaskBoard } from "../client/task-board";
import { TaskList } from "../client/task-list";
import { DEFAULT_TASK_LAYOUT } from "../shared/task-layout";
import { attentionTheme } from "../test/attention-deck-fixture";
import { unreadableHolds, type NeedsYouSnapshot } from "../shared/needs-you";
import { planDecisionNeed } from "../test/plan-decision-fixture";
import { observeNeedsYou } from "./needs-you-detect";
import { emptyLedger, mutateNeedsYou, needsYouSnapshot, reconcileNeedsYou, type NeedsYouLedger } from "./needs-you-ledger";
import { withWorkflowNeeds } from "./workflow-board";

vi.mock("react-native", () => ({ Platform: { OS: "web", select: (o: { web?: unknown; default?: unknown }) => o.web ?? o.default }, Pressable: "Pressable", Text: "Text", TextInput: "TextInput", ScrollView: "ScrollView", View: "View" }));
vi.mock("@getpaseo/plugin/client", () => ({ useRpc: () => async () => { throw new Error("No RPC in this test"); } }));
vi.mock("@getpaseo/plugin/client/react-native", () => ({ Icon: "Icon" }));
vi.mock("../client/card", () => ({ CrewCard: (props: object) => createElement("CrewCard", props) }));
vi.mock("../client/decision-tasks", async importActual => ({
  ...await importActual<typeof import("../client/decision-tasks")>(),
  DecisionTask: (props: object) => createElement("DecisionTask", props), DecisionQueueNote: () => null,
}));
vi.mock("../client/workflow-plans", () => ({ PlanNeeds: () => null, useWorkflowPlans: () => ({}), workflowRequestId: () => "id" }));

const HOME_ID = "3f1839ce-c64f-4744-8878-6579ba5904b5";
const catalog = { localServerId: "local-server", localLabel: null, hosts: [] };
const fresh = { status: "fresh" as const, checkedAt: 1, asOf: 1, problems: [] };
const homes: string[] = [];
afterEach(() => { for (const home of homes.splice(0)) rmSync(home, { recursive: true, force: true }); });

const backlog = (flight: string[], done: string[] = []) => ["## In flight", ...flight, "## Queued", "## Done", ...done, ""].join("\n");
const hold = (id: string, ask = "Which one?") => `- [ ] ${id} - Decide ${id} (project: site) (kind: captain) (hold: ${ask})`;
function observe(ledger: NeedsYouLedger, markdown: string, now: number) {
  return reconcileNeedsYou(ledger, observeNeedsYou(markdown, catalog as never), now);
}
async function board(ledger: NeedsYouLedger, markdown: string, plans = 0, owned: string[] = []): Promise<NeedsYouSnapshot> {
  const home = mkdtempSync(join(tmpdir(), "needs-you-count-")); homes.push(home);
  mkdirSync(join(home, "data")); writeFileSync(join(home, "data", "backlog.md"), markdown);
  const now = [...Array.from({ length: plans }, (_, i) => `plan-node-${i}`), ...owned].map(node => ({ ...planDecisionNeed(), node }));
  const view = owned.length ? [{ definition: { id: "pilot", nodes: owned.map(id => ({ kind: "decision", id })) } }] : [];
  return withWorkflowNeeds(needsYouSnapshot(ledger, fresh), home, { homeId: HOME_ID, version: "v", plans: view, subjects: {}, now, comingUp: [], problems: [], warnings: [], ruleRefusals: [] } as never);
}
/** The rows actually mounted under Needs you, in List and in Board. */
async function listed(snapshot: NeedsYouSnapshot) {
  const props = { cards: [], allCards: [], snapshot, theme: attentionTheme, compact: false, offline: false, density: "comfortable" as const,
    conversing: null, onConverse() {}, onChanged() {}, showDone: false, onShowDone() {},
    layout: { ...DEFAULT_TASK_LAYOUT, collapsed: [] }, layoutDisabled: false, onLayout() {} };
  const drawn: number[] = [];
  for (const view of [TaskList, TaskBoard]) {
    let tree!: ReturnType<typeof create>;
    await act(async () => { tree = create(createElement(QueryClientProvider, { client: new QueryClient() }, createElement(view as never, props as never))); });
    const rows = tree.root.findAllByType("DecisionTask" as never).length + tree.root.findAll(n => n.props.testID === "unreadable-hold" && typeof n.type === "string").length;
    await act(async () => tree.unmount());
    drawn.push(rows);
  }
  expect(drawn[1]).toBe(drawn[0]);
  return drawn[0];
}

it("agrees on a backlog with only readable holds and plan decisions", async () => {
  const markdown = backlog([hold("alpha"), hold("beta")]);
  const snapshot = await board(observe(emptyLedger(HOME_ID, "C:/home"), markdown, 10), markdown, 3);
  expect(snapshot.actionCount).toBe(5);
  expect(await listed(snapshot)).toBe(5);
});

it("lists every unreadable hold it counts, the way the reported board had 3 more counted than drawn", async () => {
  const healthy = [hold("alpha"), hold("beta")];
  const broken = "- [ ] damaged - Unreadable (project: site) (hold: Choose (A)?)";
  let ledger = observe(emptyLedger(HOME_ID, "C:/home"), backlog(healthy), 10);
  ledger = observe(ledger, backlog([...healthy, broken]), 20);
  // Its line is then deleted: removal is never an answer, so the entry stays, and must stay visible.
  const markdown = backlog(healthy);
  ledger = observe(ledger, markdown, 30);
  const snapshot = await board(ledger, markdown, 3);
  expect(activeDecisions(snapshot)).toHaveLength(5);
  expect(unreadableHolds(snapshot).map(row => row.taskId)).toEqual(["damaged"]);
  expect(snapshot.actionCount).toBe(6);
  expect(await listed(snapshot)).toBe(6);
});

it("does not ask the captain again about a gate already answered and since removed", async () => {
  const gate = hold("gate", "LXC or VM?"), other = hold("alpha");
  let ledger = observe(emptyLedger(HOME_ID, "C:/home"), backlog([gate, other]), 10);
  const request = ledger.requests.find(r => r.source.taskId === "gate")!;
  ledger = mutateNeedsYou(ledger, { homeId: HOME_ID, id: request.id, revision: request.revision }, { kind: "answer", submissionId: "s1", outcome: "accepted", messageHash: "a".repeat(64) }, 20);
  const markdown = backlog([other]);
  ledger = observe(ledger, markdown, 30);
  expect(ledger.quarantined.map(row => row.taskId)).toEqual(["gate"]);
  const snapshot = await board(ledger, markdown);
  expect(snapshot.pendingAnswerCount).toBe(1);
  expect(unreadableHolds(snapshot)).toEqual([]);
  expect(snapshot.actionCount).toBe(1);
  expect(await listed(snapshot)).toBe(1);
});

it.each(["accepted", "uncertain"] as const)("counts and draws a new unreadable question on a gate whose earlier answer was %s", async outcome => {
  const first = hold("gate", "LXC or VM?");
  let ledger = observe(emptyLedger(HOME_ID, "C:/home"), backlog([first]), 10);
  const request = ledger.requests[0]!;
  ledger = mutateNeedsYou(ledger, { homeId: HOME_ID, id: request.id, revision: request.revision }, { kind: "answer", submissionId: "s1", outcome, messageHash: "a".repeat(64) }, 20);
  const rewritten = backlog([hold("gate", "Second question: rack A (top) or rack B?")]);
  ledger = observe(ledger, rewritten, 30);
  const snapshot = await board(ledger, rewritten);
  expect(unreadableHolds(snapshot).map(row => row.taskId)).toEqual(["gate"]);
  expect(snapshot.actionCount).toBe(1);
  expect(await listed(snapshot)).toBe(1);
  // Removing that unreadable line does not answer the new question either.
  const gone = backlog([]);
  ledger = observe(ledger, gone, 40);
  const after = await board(ledger, gone);
  expect(after.actionCount).toBe(1);
  expect(await listed(after)).toBe(1);
});

it("gives a plan decision with an unreadable backlog line one row", async () => {
  const line = (ask: string) => `- [ ] checks - Reader checks (kind: captain) (plan: pilot) (hold: ${ask})`;
  let ledger = observe(emptyLedger(HOME_ID, "C:/home"), backlog([line("Which one?")]), 10);
  const markdown = backlog([line("Rack A (top) or rack B?")]);
  ledger = observe(ledger, markdown, 20);
  expect(ledger.quarantined.map(row => row.taskId)).toEqual(["checks"]);
  const snapshot = await board(ledger, markdown, 0, ["checks"]);
  expect(snapshot.actionCount).toBe(1);
  expect(await listed(snapshot)).toBe(1);
});
