import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { beforeEach, expect, it, vi } from "vitest";
import { FirstmateConfigSchema } from "../shared/fleet";
import { SHARED_TERMINAL_NAME } from "../shared/native-tools";
import { updateFirstmateConfig } from "./config";
import { renderCharter } from "./charter";
import type { PaseoApi } from "./host-types";
import { ensureSharedTerminal } from "./native-tools";

let home: string;
beforeEach(async () => {
  home = await mkdtemp(join(process.env.PASEO_HOME!, "native-tools-"));
  await updateFirstmateConfig(FirstmateConfigSchema.parse({ home }));
  await updateFirstmateConfig({ mateAgentId: "mate" });
});

function host() {
  const agent = { id: "mate", cwd: home, workspaceId: "home", archivedAt: null as string | null };
  const workspace = { id: "home", workspaceDirectory: home, archivingAt: null as string | null };
  const entries: Array<{ id: string; workspaceId: string; name: string; cwd: string }> = [];
  const refreshAgent = vi.fn(async () => ({ agent }));
  const refreshWorkspace = vi.fn(async () => workspace as typeof workspace | null);
  const list = vi.fn(async () => ({ entries, requestId: "list" }));
  const create = vi.fn(async (options: { workspaceId: string; cwd: string; name: string }) => {
    const terminal = { id: `terminal-${entries.length}`, ...options };
    entries.push(terminal);
    return { id: terminal.id };
  });
  const paseo = {
    agents: { ref: vi.fn(() => ({ refresh: refreshAgent })) },
    workspaces: { ref: vi.fn(() => ({ refresh: refreshWorkspace })) },
    terminals: { list, create },
  } as unknown as PaseoApi;
  return { paseo, agent, workspace, entries, create, list, refreshAgent, refreshWorkspace };
}

it("creates one default-shell terminal across simultaneous clients and rediscovers it after reopening", async () => {
  const h = host();
  expect(h.create).not.toHaveBeenCalled();
  const results = await Promise.all([ensureSharedTerminal(h.paseo, "home"), ensureSharedTerminal(h.paseo, "home")]);
  expect(results.map((r) => r.created)).toEqual([true, false]);
  expect(results[0]!.terminalId).toBe(results[1]!.terminalId);
  expect(h.create).toHaveBeenCalledExactlyOnceWith({ workspaceId: "home", cwd: home, name: SHARED_TERMINAL_NAME });
  expect(h.list).toHaveBeenCalledWith({ workspaceId: "home" });
  expect((await ensureSharedTerminal(h.paseo, "home")).created).toBe(false);
  // A killed terminal is recreated only on a later explicit request, without replaying any command.
  h.entries.length = 0;
  expect(h.create).toHaveBeenCalledTimes(1);
  expect((await ensureSharedTerminal(h.paseo, "home")).created).toBe(true);
  expect(h.create).toHaveBeenCalledTimes(2);
});

it("does not adopt a terminal with the same name from another workspace or a differently named terminal", async () => {
  const h = host();
  h.entries.push({ id: "other-host-scope", workspaceId: "other", cwd: home, name: SHARED_TERMINAL_NAME });
  h.entries.push({ id: "captains-own", workspaceId: "home", cwd: home, name: "Captain" });
  const result = await ensureSharedTerminal(h.paseo, "home");
  expect(result.created).toBe(true);
  expect(result.terminalId).not.toBe("other-host-scope");
  expect(h.entries).toHaveLength(3);
});

it("refuses ambiguous names without creating or taking over either terminal", async () => {
  const h = host();
  for (const id of ["a", "b"]) h.entries.push({ id, workspaceId: "home", cwd: home, name: SHARED_TERMINAL_NAME });
  await expect(ensureSharedTerminal(h.paseo, "home")).rejects.toThrow("More than one terminal");
  expect(h.create).not.toHaveBeenCalled();
});

it("validates current role, workspace and canonical home before using the terminal API", async () => {
  const h = host();
  await expect(ensureSharedTerminal(h.paseo, "old-home")).rejects.toThrow("changed or is unavailable");
  h.agent.cwd = join(home, "missing");
  await expect(ensureSharedTerminal(h.paseo, "home")).rejects.toThrow("changed or is unavailable");
  h.agent.cwd = home;
  h.agent.archivedAt = "2026-10-15";
  await expect(ensureSharedTerminal(h.paseo, "home")).rejects.toThrow("changed or is unavailable");
  h.agent.archivedAt = null;
  h.workspace.workspaceDirectory = join(home, "missing");
  await expect(ensureSharedTerminal(h.paseo, "home")).rejects.toThrow("workspace is unavailable");
  h.workspace.workspaceDirectory = home;
  h.workspace.archivingAt = "2026-10-15";
  await expect(ensureSharedTerminal(h.paseo, "home")).rejects.toThrow("workspace is unavailable");
  h.refreshWorkspace.mockResolvedValue(null);
  await expect(ensureSharedTerminal(h.paseo, "home")).rejects.toThrow("workspace is unavailable");
  await updateFirstmateConfig({ mateAgentId: "" });
  await expect(ensureSharedTerminal(h.paseo, "home")).rejects.toThrow("changed or is unavailable");
  expect(h.list).not.toHaveBeenCalled();
  expect(h.create).not.toHaveBeenCalled();
});

it("does not turn an offline listing into a new process, and releases its lock after failure", async () => {
  const h = host();
  h.list.mockRejectedValueOnce(new Error("Host is offline"));
  await expect(ensureSharedTerminal(h.paseo, "home")).rejects.toThrow("Host is offline");
  expect(h.create).not.toHaveBeenCalled();
  expect((await ensureSharedTerminal(h.paseo, "home")).created).toBe(true);
});

it("rediscovers a terminal if its creation response was lost", async () => {
  const h = host();
  h.create.mockImplementationOnce(async (options) => {
    h.entries.push({ id: "created-before-disconnect", ...options });
    throw new Error("Connection lost");
  });
  await expect(ensureSharedTerminal(h.paseo, "home")).rejects.toThrow("Connection lost");
  expect((await ensureSharedTerminal(h.paseo, "home")).terminalId).toBe("created-before-disconnect");
  expect(h.create).toHaveBeenCalledTimes(1);
});

it("gives the first mate the same resource name and existing-tab browser discovery instructions", async () => {
  const charter = await renderCharter({ home, crewProvider: "", crewModeId: "" });
  expect(charter).toContain(`**${SHARED_TERMINAL_NAME}**`);
  expect(charter).toContain("browser_list_tabs");
  expect(charter).toContain("Capture before typing");
  expect(charter).not.toContain("{{sharedTerminalName}}");
});
