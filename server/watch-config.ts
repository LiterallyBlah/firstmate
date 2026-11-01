/** Routing lives in daemon storage, never in executable script instructions. */
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { z } from "zod";
import { ManagedWatchSchema, WatchNameSchema, WatchRoutingSchema, type ManagedWatch, type WatchRouting } from "../shared/watch-routing";
import { serialized } from "./serialize";
import { parseSchedule } from "./watch-schedule";
import { WatchAssignmentSchema, WatchAssignmentTargetSchema, type WatchAssignmentTarget } from "../shared/watch-routing";
import type { CutoverGate } from "./supervision-gate";
import { digest } from "./submissions";
import { SupervisorInspectionProfileSchema } from "../shared/supervisor-inspection";

const StoreSchema = z.object({ version: z.literal(1), watches: z.array(ManagedWatchSchema),
  scripts: z.record(WatchNameSchema, WatchRoutingSchema), receipts: z.record(z.string().uuid(), z.string()).default({}),
  assignments: z.record(WatchNameSchema, WatchAssignmentSchema).default({}),
  inspectionProfiles: z.record(WatchNameSchema, SupervisorInspectionProfileSchema).default({}) }).strict();
export type WatchConfig = z.infer<typeof StoreSchema>;
type RouteAction = { requestId: string; signature: string; assignmentDigest: string };
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
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return { version: 1, watches: [], scripts: {}, receipts: {}, assignments: {}, inspectionProfiles: {} }; throw error; }
    // Corrupt routing must fail visibly, never reset watches or accidentally wake the main session.
    const saved = StoreSchema.parse(JSON.parse(raw));
    if (new Set(saved.watches.map((watch) => watch.name)).size !== saved.watches.length) throw new Error("Duplicate managed watch names.");
    saved.watches.forEach((watch) => parseSchedule(watch.schedule));
    return saved;
  }
  /** SHA-256 of the stored bytes, or null when absent: a read-only before/after comparison for timer inventories. */
  async fingerprint(): Promise<string | null> {
    try { return createHash("sha256").update(await readFile(this.path)).digest("hex"); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw error; }
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

/** Small cutover over the existing config and delivery gate. Pending entries stay in their original
 * queue; this record retains the review inventory and never fabricates a send disposition. */
export class WatchRouteHandoff {
  constructor(private readonly options: { config: WatchConfigStore; gate: CutoverGate; definition(name: string): Promise<string>;
    pending(name: string): Promise<unknown[]>; bind(target: WatchAssignmentTarget, requestId: string): Promise<unknown>;
    validate?: (target: WatchAssignmentTarget) => Promise<void>;
    bindingState?: (requestId: string) => Promise<"absent" | "committed" | "unknown"> }) {}
  async prepare(input: { requestId: string; expectedGeneration: number; target: WatchAssignmentTarget }) {
    const target = WatchAssignmentTargetSchema.parse(input.target), signature = digest(input);
    return this.options.gate.run(async () => {
      let accepted: z.infer<typeof WatchAssignmentSchema> | undefined;
      await this.options.config.change(async saved => {
        const old = saved.assignments[target.name];
        let prior = old;
        while (prior) {
          if (prior.requestId === input.requestId) { if (prior.signature !== signature) throw Error("Request identity has different fields."); accepted = prior; return; }
          prior = prior.previous ? WatchAssignmentSchema.parse(prior.previous) : undefined;
        }
        if ((old?.generation ?? 0) !== input.expectedGeneration || old && old.stage !== "aborted") throw Error("Assignment conflict; reread the current route.");
        if (await this.options.definition(target.name) !== target.definitionDigest) throw Error("Watch definition changed; review the exact definition.");
        const pending = await this.options.pending(target.name);
        await this.options.validate?.(target);
        await this.options.gate.watchRoute(target.name, input.requestId, "prepared", pending);
        saved.assignments[target.name] = { requestId: z.uuid().parse(input.requestId), signature, generation: input.expectedGeneration + 1,
          stage: "prepared", target, pending, ...(old ? { previous: old } : {}) };
      });
      return accepted ?? (await this.options.config.read()).assignments[target.name]!;
    });
  }
  async commit(requestId: string, action?: RouteAction) {
    return this.options.gate.run(async () => {
      const row = Object.values((await this.options.config.read()).assignments).find(r => r.requestId === requestId);
      if (!row || !["prepared", "committed"].includes(row.stage)) throw Error("No prepared watch assignment.");
      if (action && digest(row) !== action.assignmentDigest) throw Error("The reviewed assignment changed.");
      if (row.stage === "committed") { await this.options.gate.watchRoute(row.target.name, requestId, "committed"); return row; }
      if (await this.options.definition(row.target.name) !== row.target.definitionDigest) throw Error("Watch definition changed; route remains held.");
      if ((await this.options.pending(row.target.name)).length) throw Error("Old pending/uncertain deliveries must drain with evidence before commit.");
      // An accepted journal association is immutable. Finish that same cross-store receipt after a
      // lost reply; current plan progress must not reinterpret or revalidate its historical request.
      if (await this.options.bindingState?.(requestId) !== "committed") await this.options.validate?.(row.target);
      // Journal receipt precedes config commit. Recovery reuses the same request/target. Once binding
      // starts, abort is refused: a crashed cross-store commit requires forward reconciliation.
      await this.options.gate.watchRoute(row.target.name, requestId, "committing");
      await this.options.bind(row.target, requestId);
      await this.options.config.change(saved => { saved.assignments[row.target.name]!.stage = "committed";
        if (action) { saved.assignments[row.target.name]!.lastActionId = action.requestId; saved.receipts[action.requestId] = action.signature; } });
      await this.options.gate.watchRoute(row.target.name, requestId, "committed");
      return (await this.options.config.read()).assignments[row.target.name]!;
    });
  }
  async abort(requestId: string, action?: RouteAction) {
    return this.options.gate.run(async () => {
      const row = Object.values((await this.options.config.read()).assignments).find(r => r.requestId === requestId);
      if (!row || !["prepared", "aborted"].includes(row.stage)) throw Error("Committed routing needs forward reconciliation.");
      if (action && digest(row) !== action.assignmentDigest) throw Error("The reviewed assignment changed.");
      const route = await this.options.gate.readWatchRoute(row.target.name);
      if (route?.stage === "committed" || route?.stage === "committing" && await this.options.bindingState?.(requestId) !== "absent")
        throw Error("Binding commit began; forward reconciliation is required.");
      await this.options.config.change(saved => { saved.assignments[row.target.name]!.stage = "aborted";
        if (action) { saved.assignments[row.target.name]!.lastActionId = action.requestId; saved.receipts[action.requestId] = action.signature; } });
      await this.options.gate.watchRoute(row.target.name, requestId, "aborted");
    });
  }
}
