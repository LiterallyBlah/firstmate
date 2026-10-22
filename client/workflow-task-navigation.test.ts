import { expect, it } from "vitest";
import { workflowTaskFixture } from "../test/workflow-task-fixture";
import { workflowTaskRoute, workflowTaskTarget, routeWorkflowTask } from "./workflow-task-navigation";
import { planSessionKey } from "./workflow-plan-state";

it.each([false, true])("matches recorded task scope and carries the saved worker identity (remote=%s)", remote => {
  const { plan, node, card, worker } = workflowTaskFixture(remote);
  const target = workflowTaskTarget(plan, node, [card]);
  expect(target.card).toBe(card);
  expect(target.worker).toBe(remote ? `remote:lab-server-id:${worker.id}` : worker.id);
  expect(target.explanation).toBeNull();
  const request = { scope: "scope", plan: plan.definition.id, node: node.id, card: card.key, worker: target.worker! };
  expect(routeWorkflowTask(workflowTaskRoute(request).params)).toEqual(request);
  expect(routeWorkflowTask({ taskPlan: plan.definition.id })).toBeNull();
});
it("refuses title matches, another host/project/plan/task, and ambiguous cards", () => {
  const { plan, node, card } = workflowTaskFixture(true);
  const others = [
    { ...card, taskId: "other" }, { ...card, project: "other" },
    { ...card, backlog: { ...card.backlog!, plan: "other" } },
    { ...card, remote: { ...card.remote!, serverId: "other" }, backlog: { ...card.backlog!, host: "other" } },
  ];
  for (const other of others) expect(workflowTaskTarget(plan, node, [other]).card).toBeNull();
  expect(workflowTaskTarget(plan, node, [card, { ...card, key: "duplicate" }])).toMatchObject({ card: null, worker: null });
});
it("keeps Show task available while explaining missing, archived, mismatched and unavailable workers", () => {
  const { plan, node, card } = workflowTaskFixture(true);
  const cases = [
    { ...card, remote: { ...card.remote!, worker: null } },
    { ...card, remote: { ...card.remote!, worker: { ...card.remote!.worker!, status: "archived" } } },
    { ...card, remote: { ...card.remote!, worker: { ...card.remote!.worker!, id: "another-attempt" } } },
    { ...card, remote: { ...card.remote!, serverId: null } },
    { ...card, remote: { ...card.remote!, online: false } },
  ];
  for (const unavailable of cases) {
    const result = workflowTaskTarget(plan, node, [unavailable]);
    expect(result.card).toBe(unavailable); expect(result.worker).toBeNull(); expect(result.explanation).toBeTruthy();
  }
  const local = workflowTaskFixture(); local.card.agent!.status = "closed";
  expect(workflowTaskTarget(local.plan, local.node, [local.card]).worker).toBeNull();
});
it("separates session state by the selected host, absolute home, mate and workflow home", () => {
  const key = planSessionKey("host", "/home", "mate", "home-id");
  for (const args of [["other", "/home", "mate", "home-id"], ["host", "/other", "mate", "home-id"], ["host", "/home", "other", "home-id"], ["host", "/home", "mate", "other"]]) {
    expect(planSessionKey(args[0], args[1], args[2], args[3])).not.toBe(key);
  }
  expect(planSessionKey("host", "/home", undefined, "home-id")).toBeNull();
});
