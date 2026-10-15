import { SHARED_TERMINAL_NAME } from "../shared/native-tools";
import { readFirstmateConfig, resolveHome } from "./config";
import { resolveMate, sameDirectory } from "./fleet";
import type { PaseoApi } from "./host-types";
import { oneAtATime, requireNoMigration } from "./mate";

/** Called only by an explicit captain action; never by polling, mounting or restoring a view. */
export function ensureSharedTerminal(paseo: PaseoApi, workspaceId: string) {
  // Serialize across clients and with role/home changes. Read config inside the lock, not from the UI.
  return oneAtATime(async () => {
    const config = await readFirstmateConfig();
    requireNoMigration(config);
    const home = resolveHome(config);
    const { agent } = await resolveMate(paseo, config);
    if (agent === null || agent.workspaceId !== workspaceId || !(await sameDirectory(agent.cwd, home))) {
      throw new Error("The first mate's home workspace has changed or is unavailable. Refresh FirstMate Home.");
    }
    const workspace = await paseo.workspaces.ref(workspaceId).refresh();
    if (
      workspace === null ||
      workspace.archivingAt != null ||
      !(await sameDirectory(workspace.workspaceDirectory, home))
    ) {
      throw new Error("The FirstMate home workspace is unavailable. Open it in Paseo before creating a terminal.");
    }
    const listed = await paseo.terminals.list({ workspaceId });
    const matches = listed.entries.filter(
      (entry) => entry.workspaceId === workspaceId && entry.name === SHARED_TERMINAL_NAME,
    );
    if (matches.length > 1) {
      throw new Error(
        `More than one terminal is named "${SHARED_TERMINAL_NAME}". Select the one you want in the workspace and rename the others.`,
      );
    }
    const existing = matches[0];
    if (existing !== undefined) {
      return { workspaceId, terminalId: existing.id, name: existing.name, created: false };
    }
    // Use the daemon's configured shell. No command replay, keystrokes, output polling or process cleanup.
    const terminal = await paseo.terminals.create({
      workspaceId,
      cwd: workspace.workspaceDirectory,
      name: SHARED_TERMINAL_NAME,
    });
    return { workspaceId, terminalId: terminal.id, name: SHARED_TERMINAL_NAME, created: true };
  });
}
