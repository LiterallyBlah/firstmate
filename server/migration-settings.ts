/** Home-bound immutable configuration, read without creating a journal/coordinator or backup. */
import { mkdir, readFile, readdir, realpath, stat } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";
import { z } from "zod";
import { MigrationBackupSchema, MigrationSettingsInputSchema, type MigrationSettingsInput, type MigrationSettingsSnapshot } from "../shared/migration-settings";
import { digest, publish } from "./submissions";
import { serialized } from "./serialize";
import { workflowHomeIdentity } from "./workflow-ownership";
import { MigrationSnapshots } from "./migration-snapshot";
import { workflowStore } from "./workflow-service";
import { SupervisionStore } from "./supervision-store";
import { refuse } from "./supervision-effects";
const RecordSchema = z.object({ format: z.literal("firstmate.migration-settings/1"), homeId: z.string(), revision: z.number().int().positive(),
  previous: z.string().nullable(), request: MigrationSettingsInputSchema, at: z.iso.datetime(),
  canonicalDestination: z.string(), provenance: z.literal("client UI (unverified)"), hash: z.string() }).strict();
type Record = z.infer<typeof RecordSchema>;
const name = (revision: number) => `${String(revision).padStart(12, "0")}.json`;
export class MigrationSettings {
  constructor(private readonly root: string, private readonly legacy?: { homeId: string; destination: string; retention: string } | Promise<{ homeId: string; destination: string; retention: string }>) {}
  directory(home: string) { return join(resolve(this.root), "migration-settings", digest(workflowHomeIdentity(home))); }
  private async records(home: string): Promise<Record[]> {
    let files: string[];
    try { files = await readdir(this.directory(home)); }
    catch (e) { if ((e as NodeJS.ErrnoException).code === "ENOENT") return []; throw e; }
    if (!files.length || files.some(f => !/^\d{12}\.json(?:\.[\w-]+\.tmp)?$/.test(f))) refuse("HELD", "Saved backup settings couldn't be checked. Inspect their records before changing them.");
    const records: Record[] = [];
    for (const [index, file] of files.filter(f => /^\d{12}\.json$/.test(f)).sort().entries()) {
      const path = join(this.directory(home), file);
      if ((await stat(path)).size > 32768) refuse("HELD", "Saved backup settings exceed their bounds.");
      const row = RecordSchema.parse(JSON.parse(await readFile(path, "utf8"))), { hash, ...body } = row;
      if (file !== name(index + 1) || row.revision !== index + 1 || row.homeId !== workflowHomeIdentity(home) || row.request.homeId !== row.homeId ||
        row.request.expectedRevision !== index || row.previous !== (records.at(-1)?.hash ?? null) || hash !== digest(body) || records.some(r => r.request.requestId === row.request.requestId))
        refuse("HELD", "Saved backup settings are damaged. Inspect their records before changing them.");
      records.push(row);
    }
    if (!records.length) refuse("HELD", "A backup settings save was interrupted. Inspect its records before continuing.");
    return records;
  }
  async validate(home: string, backup: z.infer<typeof MigrationBackupSchema>) {
    if (!isAbsolute(backup.destination)) refuse("HELD", "Choose an existing backup folder with its full path.");
    if (!backup.retention.trim()) refuse("HELD", "Describe how long you will keep these backups before saving.");
    let destination: string;
    try { destination = await realpath(backup.destination); if (!(await stat(destination)).isDirectory()) throw new Error(); }
    catch { refuse("HELD", "The backup folder isn't available. Choose an existing folder you can access."); }
    await MigrationSnapshots.validateDestination(destination!, [home, new SupervisionStore(this.root, home).root, workflowStore(home).root]);
    return { ...backup, destination: destination! };
  }
  private async snapshot(home: string, records: Record[]): Promise<MigrationSettingsSnapshot> {
    const original = await this.legacy;
    const last = records.at(-1), legacy = original?.homeId === workflowHomeIdentity(home) ? original : null;
    return { homeId: workflowHomeIdentity(home), revision: last?.revision ?? 0, requestId: last?.request.requestId ?? null,
      backup: last?.request.backup ?? (legacy && (legacy.destination || legacy.retention) ? { destination: legacy.destination, retention: legacy.retention } : null),
      source: last ? "saved" : legacy && (legacy.destination || legacy.retention) ? "legacy-environment" : "default", problems: [] };
  }
  private async checked(home: string) {
    const records = await this.records(home), snapshot = await this.snapshot(home, records);
    try { if (snapshot.backup) {
      const checked = await this.validate(home, snapshot.backup);
      if (records.at(-1) && checked.destination !== records.at(-1)!.canonicalDestination)
        refuse("HELD", "The backup folder now points somewhere else. Review and save its location again before continuing.");
    } }
    catch (e) { snapshot.problems.push(e instanceof Error ? e.message : String(e)); }
    return { snapshot, canonicalDestination: records.at(-1)?.canonicalDestination };
  }
  async read(home: string): Promise<MigrationSettingsSnapshot> { return (await this.checked(home)).snapshot; }
  async set(home: string, raw: MigrationSettingsInput) {
    const input = MigrationSettingsInputSchema.parse(raw);
    if (input.homeId !== workflowHomeIdentity(home)) refuse("STALE", "FirstMate's home changed. Reopen this review before saving.");
    return serialized(this.directory(home), async () => {
      const records = await this.records(home), old = records.find(r => r.request.requestId === input.requestId);
      if (old) {
        if (digest(old.request) !== digest(input)) refuse("CONFLICT", "This saved request has different backup settings. Reopen the review.");
        return this.snapshot(home, records.slice(0, old.revision));
      }
      if ((records.at(-1)?.revision ?? 0) !== input.expectedRevision) refuse("STALE", "Backup settings changed in another window. Refresh and review before saving.");
      // Preserve the exact reviewed path in the receipt; re-resolve at every capture/verification.
      const checked = await this.validate(home, input.backup);
      const body = { format: "firstmate.migration-settings/1" as const, homeId: input.homeId, revision: records.length + 1,
        previous: records.at(-1)?.hash ?? null, request: input, canonicalDestination: checked.destination, at: new Date().toISOString(), provenance: "client UI (unverified)" as const };
      await mkdir(this.directory(home), { recursive: true });
      try { await publish(join(this.directory(home), name(body.revision)), { ...body, hash: digest(body) }); }
      catch (e) {
        if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
        const current = await this.records(home), same = current.find(r => r.request.requestId === input.requestId);
        if (same && digest(same.request) === digest(input)) return this.snapshot(home, current.slice(0, same.revision));
        refuse("STALE", "Backup settings changed in another window. Refresh and review before saving.");
      }
      return this.snapshot(home, [...records, { ...body, hash: digest(body) }]);
    });
  }
  async service(home: string) {
    const { snapshot: state, canonicalDestination } = await this.checked(home);
    if (!state.backup || state.problems.length) refuse("HELD", state.problems.join(" ") || "Choose a backup folder and retention in this plan's help review before handing it over.");
    return new MigrationSnapshots(state.backup.destination, state.backup.retention, canonicalDestination);
  }
}
