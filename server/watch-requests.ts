/** The home tool transports typed creation/configuration fields to the same handlers as the UI. */
import { readFile, readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { createWatch, configureWatch } from "../shared/watch-routing";
import { atomicJson } from "./watch-config";
import { serialized } from "./serialize";

export const WatchRequestSchema = z.discriminatedUnion("operation", [
  z.object({ id: z.string().uuid(), operation: z.literal("create"), input: createWatch.input }).strict(),
  z.object({ id: z.string().uuid(), operation: z.literal("configure"), input: configureWatch.input }).strict(),
]);
export async function processWatchRequests(home: string, handle: (request: z.infer<typeof WatchRequestSchema>) => Promise<void>) {
  const directory = join(home, "data", "watch-requests");
  return serialized(directory, async () => {
    let files;
    try { files = await readdir(directory, { withFileTypes: true }); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return; throw error; }
    let handled = 0;
    for (const file of files.filter((entry) => entry.isFile() && /^[0-9a-f-]{36}\.json$/.test(entry.name)).sort((a, b) => a.name.localeCompare(b.name))) {
      const path = join(directory, file.name); const reply = join(directory, `${file.name.slice(0, -5)}.reply.json`);
      try { await stat(reply); continue; } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
      if (handled++ >= 20) break;
      let result: { ok: boolean; error?: string };
      try {
        if ((await stat(path)).size > 24000) throw new Error("Watch request exceeds 24,000 bytes.");
        const request = WatchRequestSchema.parse(JSON.parse(await readFile(path, "utf8")));
        if (request.id !== file.name.slice(0, -5)) throw new Error("Watch request ID does not match its filename.");
        await handle(request); result = { ok: true };
      } catch (error) { result = { ok: false, error: error instanceof Error ? error.message : String(error) }; }
      await atomicJson(reply, result);
    }
  });
}
