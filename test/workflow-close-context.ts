/** Per-test ownership: a timed-out case never borrows the next case's mutable globals. */
import { randomUUID } from "node:crypto";
import { workflowFixture } from "./workflow-fixture";
import type { PlanDefinition, WorkflowCommand } from "../shared/workflow-plans";
import { WorkflowPlanStore } from "../server/workflow-plans";

export function definition(id: string, nodeId = id): PlanDefinition {
  const source = workflowFixture(), node = source.nodes.find(n => n.kind === "run" && n.launch.kind === "ship")!;
  if (node.kind !== "run") throw new Error("fixture");
  return { ...source, id, request: { ...source.request, posture: "sail", quote: "Sail within this approved trial." }, nodes: [
    { ...node, id: nodeId, after: [], launch: { ...node.launch, id: nodeId, brief: { file: `data/${nodeId}/brief.md` } } },
  ] };
}

export function workflowCloseContext({ home, root, store, signal }: { home: string; root: string; store: WorkflowPlanStore; signal?: AbortSignal }) {
  const pending = new Set<Promise<unknown>>();
  async function execute(command: WorkflowCommand) {
    if (signal?.aborted) throw new Error("Fixture deadline expired");
    const result = store.execute(command, randomUUID(), "mate");
    pending.add(result);
    try { return await result; } finally { pending.delete(result); }
  }
  async function start(kind: "ship" | "scout" = "ship", state: "done" | "running" | "unresolved" = "done") {
    const plan = definition("trial", "build"), node = plan.nodes[0]!;
    if (node.kind !== "run") throw new Error("fixture");
    node.launch.kind = kind; node.workflow = kind === "ship" ? "task@1" : "scout@1";
    await execute({ op: "draft", definition: plan });
    const result: any = await execute({ op: "start", plan: "trial", node: "build" });
    const attempt = result.launch.workflow.attempt;
    await execute({ op: "record", plan: "trial", node: "build", attempt, state, evidence: "Inspected trial report and worker.",
      ...(state === "running" ? { agentId: "worker", workspaceId: "workspace" } : {}) });
    return attempt as string;
  }
  async function close(attempt: string) {
    return execute({ op: "close", plan: "trial", node: "build", attempt, expected: (await store.get("trial"))!.hash, evidence: "Verified evidence-only trial; nothing to land." });
  }

  return { home, root, store, execute, start, close, async drain() { await Promise.allSettled([...pending]); } };
}
