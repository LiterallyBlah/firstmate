import { expect, it } from "vitest";
import { planGraphFixture } from "../test/plan-graph-fixture";
import { compactPlansFixture } from "../test/compact-plans-fixture";
import { GRAPH_CARD, planGraph } from "./workflow-plan-graph";

it("layers an out-of-order diamond by longest prerequisite path and preserves directed reasons/outcomes", () => {
  const plan = planGraphFixture(); plan.definition.nodes.reverse();
  const before = JSON.stringify(plan), graph = planGraph(plan, [plan]);
  expect(graph.problem).toBe("");
  expect(graph.levels.map(level => level.map(n => n.id).sort())).toEqual([["root"], ["left", "right"], ["join"], ["finish"]]);
  expect(graph.edges.map(({ node, to, reason, on }) => [node, to, reason, on])).toEqual(expect.arrayContaining([
    ["root", "left", "needs-evidence", "done"], ["root", "right", "builds-on", "landed"],
    ["right", "join", "shared-state", "done"], ["join", "finish", "decision", "answered"],
  ]));
  expect(graph.nodes.find(n => n.id === "left")!.y).toBe(graph.nodes.find(n => n.id === "right")!.y);
  expect(JSON.stringify(plan)).toBe(before);
});

it("includes paths through other plans before declaring steps parallel, and routes long edges outside cards", () => {
  const plan = planGraphFixture(), external = planGraphFixture();
  external.definition.id = "external";
  external.definition.nodes = [{ ...external.definition.nodes[0]!, id: "bridge", after: [{ node: "left", reason: "needs-evidence", on: "done" }] }];
  plan.definition.nodes.find(n => n.id === "right")!.after = [{ node: "bridge", reason: "builds-on", on: "done" }];
  const graph = planGraph(plan, [plan, external]);
  expect(graph.nodes.find(n => n.id === "bridge")).toMatchObject({ external: true, level: 2 });
  expect(graph.nodes.find(n => n.id === "right")!.level).toBe(3);
  const long = graph.edges.find(e => e.node === "left" && e.to === "join")!;
  expect(long.points).toHaveLength(6);
  const lane = long.points[2]!.x;
  expect(graph.nodes.every(n => n.x + GRAPH_CARD.width < lane)).toBe(true);
});

it("retains missing prerequisites, flags incomplete topology, and safely falls back for cycles or excessive graphs", () => {
  const plan = planGraphFixture();
  plan.definition.nodes[0]!.after = [{ node: "missing", reason: "builds-on", on: "landed" }];
  const graph = planGraph(plan, [plan]);
  expect(graph.incomplete).toBe(true);
  expect(graph.nodes.find(n => n.id === "missing")).toMatchObject({ external: true, node: undefined });
  plan.definition.nodes[0]!.after = [{ node: "finish", reason: "builds-on", on: "landed" }];
  expect(planGraph(plan, [plan]).problem).toContain("cycle");
  const source = plan.definition.nodes[0]!;
  plan.definition.nodes = Array.from({ length: 61 }, (_, i) => ({ ...source, id: `step-${i}`, after: [] }));
  expect(planGraph(plan, [plan]).problem).toContain("too large");
  plan.definition.nodes = Array.from({ length: 17 }, (_, i) => ({ ...source, id: `step-${i}`, after: Array.from({ length: i }, (_, j) => ({ node: `step-${j}`, reason: "builds-on" as const, on: "done" as const })) }));
  expect(planGraph(plan, [plan]).problem).toContain("too many dependencies");
});

it("lays out real-shaped scheduler and reader-pass plans, including all reviews and external work", () => {
  const plans = compactPlansFixture();
  for (const plan of plans.slice(0, 2)) {
    const graph = planGraph(plan, plans);
    expect(graph.problem).toBe(""); expect(graph.incomplete).toBe(false);
    expect(graph.nodes.filter(n => !n.external)).toHaveLength(plan.definition.nodes.length);
    for (const edge of graph.edges) {
      expect(graph.nodes.find(n => n.id === edge.node)!.level).toBeLessThan(graph.nodes.find(n => n.id === edge.to)!.level);
      for (const point of edge.points) { expect(point.x).toBeGreaterThanOrEqual(0); expect(point.x).toBeLessThan(graph.width); expect(point.y).toBeLessThan(graph.height); }
    }
  }
});
