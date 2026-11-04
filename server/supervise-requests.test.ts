import { randomUUID } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { beforeEach, expect, it, vi } from "vitest";
import { SuperviseRequestSchema } from "../shared/supervise";
import { updateFirstmateConfig } from "./config";
import { SuperviseRequests } from "./supervise-requests";
import { workflowHomeIdentity } from "./workflow-ownership";
import type { PaseoApi } from "./host-types";

let home: string, calls: { name: string; input: unknown; actor?: unknown }[];
const api = {} as PaseoApi;
function service() {
  calls = [];
  const record = (name: string) => async (input: unknown, _paseo?: unknown, actor?: unknown) => { calls.push({ name, input, actor }); return { name }; };
  const activation = {
    planHelp: vi.fn(async (homeId: string, plan: string) => { calls.push({ name: "planHelp", input: { homeId, plan } }); return { plan }; }),
    evidence: vi.fn(record("evidence")), readBackup: vi.fn(record("readBackup")), read: vi.fn(record("read")),
    saveBackup: vi.fn(async (input: unknown, provenance?: unknown) => { calls.push({ name: "saveBackup", input, actor: provenance }); return { saved: true }; }),
    migrate: vi.fn(async (input: unknown, actor?: unknown) => { calls.push({ name: "migrate", input, actor }); return { migrated: true }; }),
    attach: vi.fn(record("attach")),
  };
  const projects = { provision: vi.fn(record("provision")) };
  const supervise = new SuperviseRequests({ activation: activation as never, projects: projects as never });
  supervise.remember(api);
  return supervise;
}
const request = (command: unknown, actor = "general", id = randomUUID()) => SuperviseRequestSchema.parse({ id, actor, command });
beforeEach(async () => {
  process.env.PASEO_HOME = join(process.env.PASEO_HOME!, randomUUID());
  home = join(process.env.PASEO_HOME, "home");
  await mkdir(join(home, "data"), { recursive: true });
  await updateFirstmateConfig({ home, mateAgentId: "", migration: null, mateLaunch: null });
  await updateFirstmateConfig({ mateAgentId: "general" });
});
it("strict commands refuse unknown fields and captain-only handover endings before any server path", async () => {
  expect(() => request({ op: "attach", attach: { plan: "scheduler" }, actor: "captain" })).toThrow();
  expect(() => request({ op: "retire" })).toThrow();
  const supervise = service(), homeId = workflowHomeIdentity(home);
  await expect(supervise.execute(request({ op: "migrate", command: { op: "abort", homeId, migrationId: randomUUID(), reason: "stop" } })))
    .rejects.toMatchObject({ code: "UNSUPPORTED" });
  await expect(supervise.execute(request({ op: "migrate", command: { op: "resolve-hold", homeId, migrationId: randomUUID(), dispositionId: randomUUID(), route: "already-handled", evidence: { ref: "x", digest: "a".repeat(64) } } })))
    .rejects.toMatchObject({ code: "UNSUPPORTED" });
  expect(calls).toEqual([]);
});
it("only the configured first mate reaches the checked paths, recorded as that mate", async () => {
  const supervise = service(), homeId = workflowHomeIdentity(home);
  for (const actor of ["crewmate-7", "bound-supervisor", "guest", ""]) {
    if (!actor) continue;
    await expect(supervise.execute(request({ op: "activation" }, actor))).rejects.toMatchObject({ code: "UNKNOWN_OWNER" });
    await expect(supervise.execute(request({ op: "project-provision", provision: { projectId: randomUUID(), projectVersion: 2 } }, actor))).rejects.toMatchObject({ code: "UNKNOWN_OWNER" });
  }
  expect(calls).toEqual([]);
  await supervise.execute(request({ op: "plan-help", plan: "scheduler" }));
  const attachId = randomUUID(), provisionId = randomUUID(), backupId = randomUUID();
  await supervise.execute(request({ op: "attach", attach: { plan: "scheduler", planHash: "a".repeat(64), scopeId: randomUUID(), scopeVersion: 3,
    supervisorId: randomUUID(), profile: { provider: "codex/test", modeId: "full-access" }, opening: "Look after scheduler." } }, "general", attachId));
  await supervise.execute(request({ op: "project-provision", provision: { projectId: randomUUID(), projectVersion: 2 } }, "general", provisionId));
  await supervise.execute(request({ op: "backup-set", expectedRevision: 0, backup: { destination: "D:\\backups", retention: "30 days" } }, "general", backupId));
  const mate = { kind: "mate-chat", id: "general", source: "supervise tool (same-user role convention, unverified)" };
  expect(calls.find(c => c.name === "planHelp")?.input).toEqual({ homeId, plan: "scheduler" });
  expect(calls.find(c => c.name === "attach")).toMatchObject({ input: { homeId, requestId: attachId, plan: "scheduler" }, actor: mate });
  expect(calls.find(c => c.name === "provision")).toMatchObject({ input: { homeId, requestId: provisionId, projectVersion: 2 }, actor: mate });
  expect(calls.find(c => c.name === "saveBackup")).toMatchObject({ input: { homeId, requestId: backupId, expectedRevision: 0 }, actor: "first mate tool (unverified)" });
});
it("request files reply once; deleting the reply replays the same id and bytes as a lost-reply retry", async () => {
  const supervise = service(), directory = join(home, "data/supervise-requests");
  await mkdir(directory, { recursive: true });
  const id = randomUUID(), body = JSON.stringify({ id, actor: "general", command: { op: "activation" } });
  await writeFile(join(directory, `${id}.json`), body);
  await supervise.processRequests();
  expect(JSON.parse(await readFile(join(directory, `${id}.reply.json`), "utf8")).ok).toBe(true);
  await supervise.processRequests();
  expect(calls.filter(c => c.name === "read")).toHaveLength(1);
  await rm(join(directory, `${id}.reply.json`));
  await supervise.processRequests();
  expect(calls.filter(c => c.name === "read")).toHaveLength(2);
  // A different body under an existing id never overwrites the recorded request routing.
  const other = randomUUID();
  await writeFile(join(directory, `${other}.json`), JSON.stringify({ id, actor: "general", command: { op: "activation" } }));
  await supervise.processRequests();
  expect(JSON.parse(await readFile(join(directory, `${other}.reply.json`), "utf8")).ok).toBe(false);
});
