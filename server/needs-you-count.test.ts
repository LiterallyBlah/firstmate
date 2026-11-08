/**
 * The board's "5 listed, it says 8": real backlog text through the real detector, ledger and plan join.
 * The count and the rows List and Board draw must be the same number, whatever the backlog holds.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { activeDecisions } from "../client/task-presentation";
import { unreadableHolds, type NeedsYouSnapshot } from "../shared/needs-you";
import { planDecisionNeed } from "../test/plan-decision-fixture";
import { observeNeedsYou } from "./needs-you-detect";
import { emptyLedger, mutateNeedsYou, needsYouSnapshot, reconcileNeedsYou, type NeedsYouLedger } from "./needs-you-ledger";
import { withWorkflowNeeds } from "./workflow-board";

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
async function board(ledger: NeedsYouLedger, markdown: string, plans = 0): Promise<NeedsYouSnapshot> {
  const home = mkdtempSync(join(tmpdir(), "needs-you-count-")); homes.push(home);
  mkdirSync(join(home, "data")); writeFileSync(join(home, "data", "backlog.md"), markdown);
  const now = Array.from({ length: plans }, (_, i) => ({ ...planDecisionNeed(), node: `plan-node-${i}` }));
  return withWorkflowNeeds(needsYouSnapshot(ledger, fresh), home, { homeId: HOME_ID, version: "v", plans: [], subjects: {}, now, comingUp: [], problems: [], warnings: [], ruleRefusals: [] } as never);
}
const listed = (snapshot: NeedsYouSnapshot) => activeDecisions(snapshot).length + unreadableHolds(snapshot).length;

it("agrees on a backlog with only readable holds and plan decisions", async () => {
  const markdown = backlog([hold("alpha"), hold("beta")]);
  const snapshot = await board(observe(emptyLedger(HOME_ID, "C:/home"), markdown, 10), markdown, 3);
  expect(snapshot.actionCount).toBe(5);
  expect(listed(snapshot)).toBe(5);
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
  expect(listed(snapshot)).toBe(6);
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
  expect(listed(snapshot)).toBe(1);
});
