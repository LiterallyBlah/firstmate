/** Routing lives in daemon storage, never in executable script instructions. */
import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { z } from "zod";
import { ManagedWatchSchema, WatchNameSchema, WatchRoutingSchema, type ManagedWatch, type WatchRouting } from "../shared/watch-routing";
import { serialized } from "./serialize";
import { parseSchedule } from "./watch-schedule";

const StoreSchema = z.object({ version: z.literal(1), watches: z.array(ManagedWatchSchema),
  scripts: z.record(WatchNameSchema, WatchRoutingSchema), receipts: z.record(z.string().uuid(), z.string()).default({}) }).strict();
export type WatchConfig = z.infer<typeof StoreSchema>;
export async function atomicJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${randomUUID()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rename(temporary, path);
}
export class WatchConfigStore {
  constructor(readonly path: string) {}
  async read(): Promise<WatchConfig> {
    let raw: string;
    try { raw = await readFile(this.path, "utf8"); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return { version: 1, watches: [], scripts: {}, receipts: {} }; throw error; }
    // Corrupt routing must fail visibly, never reset watches or accidentally wake the main session.
    const saved = StoreSchema.parse(JSON.parse(raw));
    if (new Set(saved.watches.map((watch) => watch.name)).size !== saved.watches.length) throw new Error("Duplicate managed watch names.");
    saved.watches.forEach((watch) => parseSchedule(watch.schedule));
    return saved;
  }
  change(edit: (saved: WatchConfig) => void | Promise<void>): Promise<void> {
    return serialized(this.path, async () => {
      const saved = await this.read(); await edit(saved); await atomicJson(this.path, StoreSchema.parse(saved));
    });
  }
  async create(watch: ManagedWatch, requestId?: string): Promise<void> {
    const valid = ManagedWatchSchema.parse(watch); parseSchedule(valid.schedule);
    return this.change((saved) => {
      const signature = JSON.stringify(valid);
      if (requestId && saved.receipts[requestId]) {
        if (saved.receipts[requestId] !== signature) throw new Error("That request ID was used with different creation fields.");
        return;
      }
      if (saved.watches.some((entry) => entry.name === valid.name) || saved.scripts[valid.name]) throw new Error("A watch already has that name.");
      saved.watches.push(valid);
      if (requestId) saved.receipts[requestId] = signature;
    });
  }
  script(name: string, routing: WatchRouting): Promise<void> {
    return this.change((saved) => { saved.scripts[WatchNameSchema.parse(name)] = WatchRoutingSchema.parse(routing); });
  }
}
