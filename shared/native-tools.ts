import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";

/** Both the launcher and the first mate discover this terminal by workspace and name. */
export const SHARED_TERMINAL_NAME = "FirstMate shared";

export const ensureSharedTerminal = defineRpc({
  name: "firstmate.native.terminal",
  input: z.object({ workspaceId: z.string().min(1) }),
  output: z.object({
    workspaceId: z.string(),
    terminalId: z.string(),
    name: z.string(),
    created: z.boolean(),
  }),
});

/** The host browser accepts absolute HTTP(S) URLs, not local file paths or scripts. */
export function browserAddress(input: string): string | null {
  try {
    const url = new URL(input.trim());
    return (url.protocol === "http:" || url.protocol === "https:") && url.hostname !== "" ? url.href : null;
  } catch {
    return null;
  }
}
