/** Explicit independent destination, operator retention, byte verification. No restore/delete path. */
import { createHash } from "node:crypto";
import { mkdir, lstat, readFile, readdir, realpath } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { z } from "zod";
import type { MigrationReceipt } from "../shared/supervision-migration";
import { digest, publish, publishBytes } from "./submissions";
import { refuse } from "./supervision-effects";
import { resolveInHome } from "./files";
import type { SupervisionStore } from "./supervision-store";
type Reference = NonNullable<MigrationReceipt["prerequisites"]["snapshot"]>;
const hash = z.string().regex(/^[0-9a-f]{64}$/), count = z.number().int().nonnegative();
const Manifest = z.object({ format: z.literal("firstmate.migration-snapshot/1"), homeId: z.string(), migrationId: z.uuid(), planId: z.string(),
  sequence: count, journalHash: hash.nullable(), retention: z.string().min(1).max(2048), at: z.iso.datetime(),
  restore: z.literal("External effects since this sequence require explicit reconciliation; this snapshot grants no restore or budget-reset authority."),
  files: z.array(z.object({ name: z.string().min(1).max(2048), bytes: count, digest: hash }).strict()).max(50000), hash }).strict();
const sha = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const contains = (root: string, path: string) => { const rel = relative(root, path); return !rel || !rel.startsWith("..") && !isAbsolute(rel); };
export class MigrationSnapshots {
  constructor(private readonly approvedRoot: string, private readonly retention: string) {}
  static async validateDestination(destination: string, sources: string[]) {
    const root = await realpath(destination);
    for (const source of sources) {
      let path = resolve(source);
      try { path = await realpath(source); } catch (e) { if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e; }
      if (contains(path, root) || contains(root, path)) refuse("HELD", "Choose a separate backup folder outside FirstMate's home and saved work. A folder inside them cannot protect this handover.");
    }
    return root;
  }
  async capture(store: SupervisionStore, legacyRoot: string, home: string, migrationId: string, planId: string): Promise<Reference> {
    z.uuid().parse(migrationId);
    if (!isAbsolute(this.approvedRoot) || !this.retention.trim()) refuse("HELD", "Configure an approved independent snapshot destination and retention before migration.");
    const root = await realpath(this.approvedRoot), destination = join(root, migrationId);
    const sources = [await realpath(store.root), await realpath(legacyRoot), await realpath(home)];
    if (sources.some(source => contains(source, destination) || contains(destination, source))) refuse("HELD", "Migration snapshot must be independent of the journal, legacy plans and home.");
    return store.exportSnapshot(async status => {
      let exists = false;
      try { await lstat(destination); exists = true; } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
      if (exists) {
        try {
        const reference = await this.reference(destination);
        await this.verify(reference, { homeId: store.homeId, migrationId, planId });
        if (reference.sequence !== status.sequence || reference.hash !== status.hash) refuse("STALE", "An earlier snapshot exists at another prefix; inspect it and use a new migration identity.");
        return reference;
        } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") refuse("HELD", "An incomplete snapshot is retained; inspect it and use a new migration identity."); throw error; }
      }
      await mkdir(destination, { recursive: false, mode: 0o700 });
      if (await realpath(destination) !== destination) refuse("HELD", "Snapshot destination changed during preparation.");
      const files: { name: string; bytes: number; digest: string }[] = []; let total = 0;
      const copy = async (source: string, name: string) => {
        const before = await lstat(source);
        if (before.isSymbolicLink()) refuse("HELD", "Snapshot refuses symlinks/junctions.");
        if (before.isDirectory()) {
          for (const child of (await readdir(source)).sort()) {
            if (child.endsWith(".tmp")) continue; // Inert unpublished staging files grant nothing.
            await copy(join(source, child), `${name}/${child}`);
          }
          return;
        }
        if (!before.isFile() || files.length >= 50000 || total + before.size > 256 * 1024 * 1024) refuse("HELD", "Migration snapshot inventory exceeds its reviewed bounds.");
        const bytes = await readFile(source), after = await lstat(source);
        if (["size", "mtimeMs", "ctimeMs", "ino"].some(k => before[k as keyof typeof before] !== after[k as keyof typeof after])) refuse("STALE", "Snapshot source changed during capture.");
        const target = join(destination, ...name.split("/")); await mkdir(dirname(target), { recursive: true });
        await publishBytes(target, bytes);
        files.push({ name, bytes: bytes.length, digest: sha(bytes) }); total += bytes.length;
      };
      await copy(store.root, "journal"); await copy(legacyRoot, "legacy");
      for (const source of status.policySources) await copy((await resolveInHome(home, source.path)).absolute, `policy/${source.id}`);
      const body = { format: "firstmate.migration-snapshot/1" as const, homeId: store.homeId, migrationId, planId, sequence: status.sequence,
        journalHash: status.hash, retention: this.retention, at: new Date().toISOString(),
        restore: "External effects since this sequence require explicit reconciliation; this snapshot grants no restore or budget-reset authority." as const, files };
      await publish(join(destination, "manifest.json"), { ...body, hash: digest(body) });
      const reference = await this.reference(destination); await this.verify(reference, { homeId: store.homeId, migrationId, planId }); return reference;
    });
  }
  private async reference(path: string): Promise<Reference> {
    const info = await lstat(join(path, "manifest.json"));
    if (!info.isFile() || info.isSymbolicLink() || info.size > 8 * 1024 * 1024) refuse("HELD", "Snapshot manifest is not a bounded independent regular file.");
    const bytes = await readFile(join(path, "manifest.json")), m = Manifest.parse(JSON.parse(bytes.toString("utf8")));
    const { hash: checksum, ...body } = m; if (digest(body) !== checksum) refuse("HELD", "Snapshot manifest checksum failed.");
    return { path, manifestDigest: sha(bytes), sequence: m.sequence, hash: m.journalHash, retention: m.retention };
  }
  async find(expected: { homeId: string; migrationId: string; planId: string }) {
    z.uuid().parse(expected.migrationId);
    const reference = await this.reference(join(await realpath(this.approvedRoot), expected.migrationId));
    await this.verify(reference, expected); return reference;
  }
  async verify(reference: Reference, expected: { homeId: string; migrationId: string; planId: string }) {
    const root = await realpath(this.approvedRoot), path = await realpath(reference.path);
    if (path !== join(root, expected.migrationId) || await realpath(dirname(path)) !== root) refuse("HELD", "Snapshot is outside the approved independent destination.");
    const original = await this.reference(path);
    if (digest(original) !== digest(reference) || original.retention !== this.retention) refuse("HELD", "Snapshot identity or approved retention changed.");
    const bytes = await readFile(join(path, "manifest.json"));
    if (sha(bytes) !== reference.manifestDigest) refuse("HELD", "Snapshot manifest digest changed.");
    const manifest = Manifest.parse(JSON.parse(bytes.toString("utf8")));
    if (manifest.homeId !== expected.homeId || manifest.migrationId !== expected.migrationId || manifest.planId !== expected.planId) refuse("HELD", "Snapshot belongs to another home/migration/plan.");
    if (new Set(manifest.files.map(f => f.name)).size !== manifest.files.length) refuse("HELD", "Duplicate snapshot inventory path.");
    if (manifest.files.reduce((sum, f) => sum + f.bytes, 0) > 256 * 1024 * 1024) refuse("HELD", "Snapshot exceeds its reviewed byte bound.");
    for (const file of manifest.files) {
      const target = resolve(path, ...file.name.split("/"));
      if (!contains(path, target) || file.name.split("/").some(segment => !segment || segment === "." || segment === ".." || segment.includes("\\"))) refuse("HELD", "Snapshot path escapes its inventory.");
      let current = path;
      for (const segment of file.name.split("/")) { current = join(current, segment); if ((await lstat(current)).isSymbolicLink()) refuse("HELD", "Snapshot contains a link."); }
      const info = await lstat(target); if (!info.isFile() || info.size !== file.bytes) refuse("HELD", "Snapshot artifact size/type changed.");
      const content = await readFile(target); if (content.length !== file.bytes || sha(content) !== file.digest) refuse("HELD", "Snapshot artifact is missing or changed.");
    }
    return reference;
  }
}
