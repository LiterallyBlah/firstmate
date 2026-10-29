/** Append-only guided reviews. Corrections retain the original input and its independent snapshot. */
import { mkdir, readFile, readdir, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { MigrationCommandSchema, type MigrationCommand } from "../shared/supervision-activation";
import { digest, publish } from "./submissions";
import { refuse } from "./supervision-effects";
import { workflowHomeIdentity } from "./workflow-ownership";
type Preparation = Extract<MigrationCommand, { op: "prepare" | "resume" }>;
export class PlanHelpPreparations {
  constructor(private readonly root: string) {}
  path(home: string, plan: string) { return join(this.root, "plan-help-preparations", digest(workflowHomeIdentity(home)), `${digest(plan)}.json`); }
  private async records(home: string, plan: string) {
    const path = this.path(home, plan), inputs: Preparation[] = [];
    const read = async (file: string, previous?: Preparation) => {
      if ((await stat(file)).size > 32768) refuse("HELD", "Saved handover review exceeds its bounds.");
      const raw = JSON.parse(await readFile(file, "utf8")), input = MigrationCommandSchema.parse(raw.input);
      if ((input.op !== "prepare" && input.op !== "resume") || input.homeId !== workflowHomeIdentity(home) || input.plan !== plan || digest(input) !== raw.hash ||
        Object.keys(raw).sort().join() !== (previous ? "hash,input,previous" : "hash,input") ||
        previous && (raw.previous !== digest(previous) || input.replacesReview !== previous.reviewHash))
        refuse("HELD", "Saved handover review couldn't be checked. Inspect Advanced work details before continuing.");
      inputs.push(input);
    };
    try { await read(path); } catch (e) { if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e; }
    let names: string[];
    try { names = await readdir(`${path}.reviews`); } catch (e) { if ((e as NodeJS.ErrnoException).code === "ENOENT") return inputs; throw e; }
    const files = names.filter(n => /^\d{8}\.json$/.test(n)).sort();
    if (!inputs.length || files.length > 64 || names.some(n => !/^\d{8}\.json(?:\.[\w-]+\.tmp)?$/.test(n))) refuse("HELD", "Saved handover correction history couldn't be checked.");
    for (const [i, file] of files.entries()) {
      if (file !== `${String(i + 1).padStart(8, "0")}.json`) refuse("HELD", "Saved handover correction history is incomplete.");
      await read(join(`${path}.reviews`, file), inputs.at(-1));
    }
    return inputs;
  }
  async read(home: string, plan: string) { return (await this.records(home, plan)).at(-1) ?? null; }
  /** Caller holds the activation lock and freshly proves no freeze or receipt exists. */
  async save(home: string, input: Preparation) {
    const records = await this.records(home, input.plan), previous = records.at(-1), path = this.path(home, input.plan);
    if (previous && digest({ ...previous, op: "prepare" }) === digest({ ...input, op: "prepare" })) return;
    if (previous && input.replacesReview !== previous.reviewHash) refuse("CONFLICT", "Check the saved handover, then explicitly review its correction before continuing.");
    if (!previous && input.replacesReview) refuse("STALE", "The previous handover review couldn't be found. Refresh before continuing.");
    if (records.length > 64) refuse("HELD", "This handover has reached its review limit. Inspect Advanced work details.");
    const target = previous ? join(`${path}.reviews`, `${String(records.length).padStart(8, "0")}.json`) : path;
    await mkdir(dirname(target), { recursive: true });
    await publish(target, { input, hash: digest(input), ...(previous ? { previous: digest(previous) } : {}) });
  }
}
