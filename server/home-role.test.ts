import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";
import { FirstmateConfigSchema } from "../shared/fleet";
import { readFirstmateConfig, resolveHome, updateFirstmateConfig } from "./config";
import { prepareHome } from "./home";
import { loadFleet, ReportCache, sameDirectory } from "./fleet";
import type { PaseoApi } from "./host-types";
import { listCandidates } from "./mate";

const execute = promisify(execFile);
const previousHome = process.env.PASEO_HOME;
let scratch: string, home: string, configPath: string;
beforeEach(async () => {
  scratch = await mkdtemp(join(tmpdir(), "firstmate-role-"));
  process.env.PASEO_HOME = scratch;
  home = join(scratch, "plugin-data/firstmate/home");
  configPath = join(scratch, "plugin-data/firstmate/config.json");
  await prepareHome(home, FirstmateConfigSchema.parse({}));
});
afterEach(async () => {
  if (previousHome === undefined) delete process.env.PASEO_HOME; else process.env.PASEO_HOME = previousHome;
  await rm(scratch, { recursive: true, force: true });
});
const role = async (id = "mate", extra: NodeJS.ProcessEnv = {}, directory = home) => (await execute(process.execPath, [join(directory, "tools/role.mjs")], {
  cwd: directory, env: { ...process.env, PASEO_AGENT_ID: id, ...extra }, windowsHide: true,
})).stdout.trim();

it("requires current config, never a label, old opening or cached role env; release/adoption take effect", async () => {
  expect(await role("mate", { FIRSTMATE_ROLE: "first-mate" })).toBe("guest");
  await updateFirstmateConfig({ mateAgentId: "mate" });
  expect(await role()).toBe("first-mate");
  expect(await role("other", { FIRSTMATE_ROLE: "first-mate" })).toBe("guest");
  expect(await role("")).toBe("guest");
  await updateFirstmateConfig({ mateAgentId: "adopted" });
  expect(await role()).toBe("guest"); expect(await role("adopted")).toBe("first-mate");
  await updateFirstmateConfig({ mateAgentId: "" });
  expect(await role("adopted")).toBe("guest");
});

it("matches the plugin's default and legacy config/home precedence", async () => {
  const legacy = join(scratch, "plugins/firstmate"); await mkdir(legacy, { recursive: true });
  await writeFile(join(legacy, "config.json"), JSON.stringify({ mateAgentId: "mate" }));
  expect(resolveHome(await readFirstmateConfig())).toBe(home);
  expect(await role()).toBe("first-mate");
  await writeFile(configPath, JSON.stringify({ home: "", mateAgentId: "other" }));
  expect(await role()).toBe("guest"); expect(await role("other")).toBe("first-mate");
  // Corrupt current config never falls back to a valid legacy identity.
  await writeFile(configPath, "{"); expect(await role()).toBe("guest");
  await rm(configPath); await rm(home, { recursive: true, force: true });
  home = join(legacy, "home"); await prepareHome(home, FirstmateConfigSchema.parse({}));
  expect(resolveHome(await readFirstmateConfig())).toBe(home);
  expect(await role()).toBe("first-mate");
});

it("fails closed on unreadable, missing, ambiguous and malformed identity", async () => {
  for (const config of [null, {}, { home: "relative", mateAgentId: "mate" }, { home: "", mateAgentId: ["mate"] },
    { home: "", mateAgentId: "mate", crewProvider: 7 },
    { home: "", mateAgentId: "mate", mateLaunch: { agentId: "other", state: "sending" } },
    { home: "", mateAgentId: "mate", migration: { sourceId: "other", agentId: "replacement" } }]) {
    await writeFile(configPath, JSON.stringify(config)); expect(await role()).toBe("guest");
  }
  await rm(configPath); await mkdir(configPath); expect(await role()).toBe("guest");
});

it("distinguishes reservation from authority and supports migration before/after switch", async () => {
  const launch = { agentId: "mate", home, target: { provider: "claude", modeId: "plan", thinkingOptionId: "" }, prompt: "opening", state: "prepared" as const };
  await updateFirstmateConfig({ mateAgentId: "mate", mateLaunch: launch });
  expect(await role()).toBe("guest");
  await updateFirstmateConfig({ mateLaunch: { ...launch, state: "sending" } });
  expect(await role()).toBe("first-mate");
  await updateFirstmateConfig({ mateLaunch: { ...launch, home: scratch, state: "sending" } });
  expect(await role()).toBe("guest");
  await updateFirstmateConfig({ mateLaunch: null, migration: { sourceId: "mate", agentId: "replacement", sourceRevision: "old", target: launch.target, prompt: "handover", handoffPath: "data/handoff.md" } });
  expect(await role()).toBe("first-mate"); expect(await role("replacement")).toBe("guest");
  await updateFirstmateConfig({ mateLaunch: { ...launch, state: "sending" } });
  expect(await role()).toBe("guest");
  await updateFirstmateConfig({ mateLaunch: null });
  await updateFirstmateConfig({ mateAgentId: "replacement" });
  expect(await role()).toBe("guest"); expect(await role("replacement")).toBe("first-mate");
});

it("canonicalizes aliases and Windows case; a missing or changed home cannot grant authority", async () => {
  const alias = join(scratch, "alias"); await symlink(home, alias, process.platform === "win32" ? "junction" : "dir");
  await updateFirstmateConfig({ home: alias });
  await updateFirstmateConfig({ mateAgentId: "mate" });
  expect(await role()).toBe("first-mate"); expect(await role("mate", {}, alias)).toBe("first-mate");
  expect(await sameDirectory(home, alias)).toBe(true);
  if (process.platform === "win32") {
    await writeFile(configPath, JSON.stringify({ home: home.toUpperCase(), mateAgentId: "mate" }));
    expect(await role()).toBe("first-mate"); expect(await sameDirectory(home.toUpperCase(), home)).toBe(true);
  }
  expect(await sameDirectory(join(scratch, "missing"), join(scratch, "missing"))).toBe(false);
  await writeFile(configPath, JSON.stringify({ home: join(scratch, "missing"), mateAgentId: "mate" }));
  expect(await role()).toBe("guest");
  await writeFile(configPath, JSON.stringify({ home: "", mateAgentId: "mate" }));
  expect(await role("mate", { PASEO_HOME: join(scratch, "missing") })).toBe("guest");
});

it("keeps the identity warning even with a customized charter", async () => {
  await writeFile(join(home, "data/charter.md"), "Custom captain charter.");
  await prepareHome(home, FirstmateConfigSchema.parse({}));
  expect(await readFile(join(home, "AGENTS.md"), "utf8")).toMatch(/Check the role[\s\S]*Custom captain charter/);
});

it("lists other home sessions as guests, including a released mate with a stale role label", async () => {
  const snapshot = (id: string, cwd = home, archivedAt: string | null = null) => ({
    id, cwd, archivedAt, provider: "claude", title: id, model: null, status: "idle", workspaceId: "home-workspace",
    pendingPermissions: [], updatedAt: "2026-10-13", labels: { "firstmate.role": "first-mate" },
  });
  const agents = [snapshot("mate"), snapshot("released"), snapshot("archived", home, "date"), snapshot("outside", scratch)];
  const paseo = { agents: { ref: () => ({ refresh: async () => ({ agent: agents[0] }) }),
    list: async () => ({ entries: agents.map(agent => ({ agent })), pageInfo: { nextCursor: null } }) },
    config: { get: async () => ({ config: { mcp: { injectIntoAgents: true } } }) } } as unknown as PaseoApi;
  const fleet = await loadFleet(paseo, FirstmateConfigSchema.parse({ mateAgentId: "mate" }), new ReportCache());
  expect(fleet.homeGuests?.map(a => a.id)).toEqual(["released"]);
  expect(fleet.cards).toEqual([]);
});

it("keeps advisers and inspectors out of the adoption list", async () => {
  const agents = ["topic-adviser", "watch-inspector", "crew", "first-mate", "guest"].map(role => ({
    id: role, cwd: home, archivedAt: null, provider: "claude", model: null, title: role, status: "idle",
    pendingPermissions: [], updatedAt: "2026-10-13", labels: { "firstmate.role": role },
  }));
  const paseo = { agents: { list: async () => ({ entries: agents.map(agent => ({ agent })), pageInfo: {} }) } } as unknown as PaseoApi;
  expect((await listCandidates(paseo)).agents.map(agent => agent.id)).toEqual(["first-mate", "guest"]);
});
