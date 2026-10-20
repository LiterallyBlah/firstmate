import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, expect, it } from "vitest";
import { WorkflowPlanStore } from "./workflow-plans";
import { processWorkflowRequests } from "./workflow-service";
import { readTemplate, TEMPLATES } from "./templates";

const execute = promisify(execFile);
let home: string, store: WorkflowPlanStore, timer: ReturnType<typeof setInterval>, pending: Promise<void> | undefined;
beforeEach(async () => {
  home = join(process.env.PASEO_HOME!, randomUUID()); await mkdir(join(home, "tools"), { recursive: true }); await mkdir(join(home, "data/task"), { recursive: true });
  await writeFile(join(home, "tools/workflow.mjs"), await readTemplate(TEMPLATES.workflowHelper));
  await writeFile(join(home, "tools/role.mjs"), 'console.log(process.env.PASEO_AGENT_ID === "mate" ? "first-mate" : "guest");');
  await writeFile(join(home, "data/task/brief.md"), "Do this task.");
  store = new WorkflowPlanStore(join(home, "ledger"), home);
  timer = setInterval(() => { pending ??= processWorkflowRequests(home, store, async actor => { if (actor !== "mate") throw new Error("Wrong role"); }).finally(() => { pending = undefined; }); }, 10);
});
afterEach(async () => { clearInterval(timer); await pending; });
async function run(args: string[], actor = "mate") {
  try { return JSON.parse((await execute(process.execPath, [join(home, "tools/workflow.mjs"), ...args], { cwd: home, env: { ...process.env, PASEO_AGENT_ID: actor }, windowsHide: true, timeout: 10000 })).stdout); }
  catch (e: any) { return JSON.parse(e.stdout); }
}
it("transports plans, an implicit start, records, read-only agenda and idempotent requests", async () => {
  const launch = { id: "task", title: "Task", agentTitle: "Task", project: "project", host: "local", baseBranch: "main", kind: "ship", mode: "direct-PR", brief: { file: "data/task/brief.md" }, agent: { provider: "codex/model", modeId: "full-access" }, backlog: { existing: "none" } };
  await writeFile(join(home, "data/task/request.json"), JSON.stringify(launch));
  expect(await run(["plans"], "guest")).toMatchObject({ ok: true, result: [] });
  const id = randomUUID(), args = ["start", "--file", "data/task/request.json", "--request-id", id];
  const started = await run(args); expect(started.ok).toBe(true); expect(await run(args)).toEqual(started);
  const before = await readFile(join(home, "ledger/task/00000000.json"), "utf8");
  expect((await run(["agenda", "--json"])).result[0].kind).toBe("replan"); expect(await readFile(join(home, "ledger/task/00000000.json"), "utf8")).toBe(before);
  const attempt = started.result.launch.workflow.attempt;
  expect(await run(["record", "--plan", "task", "--node", "task", "--attempt", attempt, "--state", "running", "--agent", "worker", "--workspace", "space", "--evidence", "Inspected worker"])).toMatchObject({ ok: true });
  expect((await run(["plan", "task"])).result.nodes.task.agentId).toBe("worker");
  expect(await run(["start", "--file", "data/task/request.json"], "guest")).toMatchObject({ ok: false, error: expect.stringContaining("current first mate") });
  expect(await run(["start", "--file", "../outside.json"])).toMatchObject({ ok: false });
});
