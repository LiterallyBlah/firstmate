/** Disabled S09 project memory: provenance-bound proposals and compare-and-set acceptance.
 * Memory is the project's context. It is never a policy source, grant, approval or evidence input (`checkPolicy`
 * refuses any memory reference), so accepting or changing it cannot authorize an effect. Nothing here wakes a scope.
 */
import { createHash, randomUUID } from "node:crypto";
import { lstat, open, stat } from "node:fs/promises";
import { resolveInHome } from "./files";
import { capacityHeld } from "../shared/supervision-capacity";
import { z } from "zod";
import { SupervisionActorSchema, SupervisionHash, SupervisionUuid, type SupervisionActor, type SupervisionStatus } from "../shared/supervision";
import { emptyProjectRows, MemoryKey, type MemoryProposal, type ProjectMemory } from "../shared/supervision-projects";
import { digest } from "./submissions";
import { SupervisionError, SUPERVISION_INDEX_LIMITS, type SupervisionMutation, type SupervisionStore } from "./supervision-store";
import { memoryId } from "./supervision-project-state";
import { boundTo, expected } from "./supervision-projects";

function refuse(code: "STALE" | "HELD" | "UNKNOWN_OWNER" | "UNSUPPORTED" | "CONFLICT", message: string): never { throw new SupervisionError(code, message); }
const rowsOf = (status: SupervisionStatus) => status.projects ?? emptyProjectRows();
const versionOf = (status: SupervisionStatus, kind: string, id: string) => status.versions.find(v => v.kind === kind && v.id === id)?.version ?? 0;
export const MEMORY_TEXT_LIMIT = 16384;
// A byte-level token ceiling for a 200k-token window, leaving >32k tokens for the
// opening envelope, workspace instructions and response. JSON escaping counts too.
export const PROJECT_CONTEXT_LIMIT = 160 * 1024;
export const PROJECT_CONVENTION_LIMIT = 128 * 1024;
const README_READ_LIMIT = 8 * 1024 * 1024, README_CONTEXT_LIMIT = 16 * 1024;

/** Optional root files only. Once opened, disappearance/change is a refusal, never absence. */
async function projectFile(directory: string, path: string, limit: number) {
  let absolute: string;
  try { absolute = (await resolveInHome(directory, path)).absolute; }
  catch { refuse("HELD", `${path} could not be located inside the project folder. Check the folder and file location, then resume setup.`); }
  // A missing optional file is fine; a dangling link or disappearance after this check is not.
  try { await lstat(absolute); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    refuse("HELD", `${path} could not be opened inside the project folder. Check its location and file access, then resume setup.`);
  }
  let handle, pathBefore;
  try { pathBefore = await stat(absolute); handle = await open(absolute, "r"); }
  catch { refuse("HELD", `${path} could not be opened. Check that the file or its link target is readable, then resume setup.`); }
  try {
    const before = await handle.stat();
    if (!before.isFile()) refuse("HELD", `${path} must be a text file. Replace it with the project's text file, then resume setup.`);
    if (before.size > limit) refuse("HELD", path === "README.md"
      ? "README.md is too large to inspect (over 8 MiB). Move detailed reference material into separate documentation files, then resume setup."
      : `${path} is too large to include in full (over 128 KiB). Keep the project rules in this file and move reference material into documentation, then resume setup.`);
    // Read at most the observed size plus one byte, even if the file grows while reading.
    const content = Buffer.alloc(before.size + 1);
    let length = 0;
    while (length < content.length) {
      const { bytesRead } = await handle.read({ buffer: content, offset: length, length: content.length - length });
      if (!bytesRead) break;
      length += bytesRead;
    }
    const after = await handle.stat(), checked = await resolveInHome(directory, path), current = await stat(checked.absolute);
    const sameFile = (a: typeof before, b: typeof before) => a.size === b.size && a.mtimeMs === b.mtimeMs && a.ctimeMs === b.ctimeMs && a.ino === b.ino;
    // Windows Node 23 path stat and fstat report different dev values for the same
    // file. Pin each API's own device identity; retain cross-API inode/time/size checks.
    if (length !== before.size || !sameFile(pathBefore, before) || !sameFile(before, after) || before.dev !== after.dev ||
      !sameFile(pathBefore, current) || pathBefore.dev !== current.dev)
      refuse("STALE", `${path} changed while setup was reading it. Wait for edits to finish, then resume setup.`);
    const bytes = content.subarray(0, length), text = bytes.toString("utf8");
    if (text.includes("\0") || !Buffer.from(text).equals(bytes))
      refuse("HELD", `${path} is not UTF-8 text. Save it as a UTF-8 text file, then resume setup.`);
    return { path, digest: createHash("sha256").update(bytes).digest("hex"), text, authority: "none" as const };
  } catch (error) {
    if (error instanceof SupervisionError) throw error;
    refuse("HELD", `${path} could not be read safely. Check that it is still inside the project folder and readable, then resume setup.`);
  } finally { await handle.close(); }
}

/** Exact Markdown excerpts, never a generated summary. Ignore headings inside fenced code. */
function readmeContext(file: NonNullable<Awaited<ReturnType<typeof projectFile>>>) {
  const sourceBytes = Buffer.byteLength(file.text), readFullFile = `Read the full ${file.path} in your project workspace when you need more detail. The digest identifies the full source file.`;
  if (sourceBytes <= README_CONTEXT_LIMIT) return { ...file, sourceBytes, projection: "full" as const, readFullFile };
  const lines = file.text.split(/(?<=\n)/), headings: { offset: number; text: string }[] = [];
  let fence: { marker: string; length: number } | null = null, offset = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!, marker = /^ {0,3}(`{3,}|~{3,})/.exec(line)?.[1];
    if (marker) {
      if (!fence) fence = { marker: marker[0]!, length: marker.length };
      else if (marker[0] === fence.marker && marker.length >= fence.length && new RegExp(`^ {0,3}${fence.marker}{${fence.length},}\\s*$`).test(line)) fence = null;
    } else if (!fence) {
      if (/^ {0,3}#{1,6}(?:\s|$)/.test(line)) headings.push({ offset, text: line.trimEnd() });
      else if (i > 0 && /^ {0,3}(?:=+|-+)\s*$/.test(line) && lines[i - 1]!.trim() && !/^\s/.test(lines[i - 1]!))
        headings.push({ offset: offset - lines[i - 1]!.length, text: lines[i - 1]!.trimEnd() + "\n" + line.trimEnd() });
    }
    offset += line.length;
  }
  // The first heading can be the title. Keep its opening prose up to the next section.
  const openingEnd = headings[1]?.offset ?? file.text.length;
  const opening = new TextDecoder().decode(Buffer.from(file.text.slice(0, openingEnd)).subarray(0, 8 * 1024), { stream: true });
  const selected: string[] = [];
  let remaining = README_CONTEXT_LIMIT - Buffer.byteLength(opening) - Buffer.byteLength("\n\nHeadings from README.md:\n");
  for (const heading of headings) {
    const size = Buffer.byteLength(heading.text) + 1;
    if (size > remaining) break;
    selected.push(heading.text); remaining -= size;
  }
  return { ...file, sourceBytes, text: `${opening}\n\nHeadings from README.md:\n${selected.join("\n")}`,
    projection: "opening-and-headings" as const, openingComplete: opening.length === openingEnd,
    headingsIncluded: selected.length, headingsTotal: headings.length, readFullFile };
}
export const MemoryProposeSchema = z.object({ projectId: SupervisionUuid, key: MemoryKey, expectedVersion: z.number().int().min(0),
  text: z.string().min(1).max(MEMORY_TEXT_LIMIT), evidence: z.array(z.object({ ref: z.string().min(1).max(1024), digest: SupervisionHash }).strict()).max(32) }).strict();
export const MemoryDecideSchema = z.object({ proposalId: SupervisionUuid, proposalVersion: z.number().int().positive(),
  decision: z.enum(["accept", "reject"]), memoryVersion: z.number().int().min(0) }).strict();

export class SupervisionMemory {
  constructor(readonly store: SupervisionStore, private readonly options: { enabled?: boolean; now?: () => string } = {}) {}
  private enabled() { if (!this.options.enabled) refuse("UNSUPPORTED", "S09 project memory is disabled."); }

  /** Anyone with provenance may propose (a worker's report included). The words are stored as committed, quoted
   * evidence, bound to the entry version they were written against. A proposal changes nothing on its own.
   */
  async propose(actorInput: SupervisionActor, raw: z.input<typeof MemoryProposeSchema>, requestId: string = randomUUID()): Promise<{ proposalId: string }> {
    this.enabled();
    const input = MemoryProposeSchema.parse(raw), actor = structuredClone(SupervisionActorSchema.parse(actorInput));
    const bytes = Buffer.from(input.text, "utf8");
    if (bytes.length > MEMORY_TEXT_LIMIT) refuse("HELD", "Memory text is over its 16 KiB bound.");
    const blob = await this.store.putBlob(bytes);
    await this.store.transactCommand(requestId, digest({ op: "memory.propose", input }), actor, async status => {
      if (status.freshness !== "current" || capacityHeld(status, "admissions", SUPERVISION_INDEX_LIMITS.admissions)) refuse("HELD", "Memory proposals wait while the journal is held or past its admission bound.");
      const project = rowsOf(status).projects.find(p => p.id === input.projectId);
      if (!project) refuse("UNKNOWN_OWNER", "Memory belongs to an admitted project.");
      if (project.state !== "admitted") refuse("HELD", `Admissions for ${project.name} are stopped; existing memory and proposals are retained.`);
      if (input.expectedVersion > versionOf(status, "project-memory", memoryId(project.id, input.key))) refuse("STALE", "That memory version does not exist; reread the entry.");
      if (actor.kind === "system") refuse("UNSUPPORTED", "A proposal needs a named proposer.");
      const proposal: MemoryProposal = { id: requestId, version: 1, scopeId: project.scopeId, projectId: project.id, key: input.key,
        expectedVersion: input.expectedVersion, textDigest: blob.id, bytes: blob.bytes, evidence: input.evidence, provenance: actor, state: "proposed", decision: null };
      const mutations: SupervisionMutation[] = [...(status.versions.some(v => v.kind === "blob" && v.id === blob.id) ? [] : [{ kind: "blob" as const, value: blob }]),
        { kind: "memory-proposal", value: proposal }];
      return { expectedVersions: expected(status, mutations), mutations,
        result: { planId: null, planHash: null, decisionId: null, outboxId: null } };
    });
    return { proposalId: requestId };
  }

  /** Accept (compare-and-set) or reject one proposal. Only the project's bound owner or the captain decides.
   * Accepting requires the entry to still be at the version the proposal was written against; otherwise STALE,
   * and the proposal stays pending for a fresh proposal against the current text. No outbox, offer or wake.
   */
  async decide(requestId: string, actorInput: SupervisionActor, raw: z.input<typeof MemoryDecideSchema>) {
    this.enabled();
    const input = MemoryDecideSchema.parse(raw), actor = structuredClone(SupervisionActorSchema.parse(actorInput));
    return this.store.transactCommand(requestId, digest({ op: "memory.decide", input }), actor, async status => {
      const proposal = rowsOf(status).memoryProposals.find(p => p.id === input.proposalId);
      if (!proposal) refuse("UNKNOWN_OWNER", "No such memory proposal.");
      if (proposal.version !== input.proposalVersion || proposal.state !== "proposed") refuse("STALE", "This proposal was already decided or changed.");
      const project = rowsOf(status).projects.find(p => p.id === proposal.projectId);
      if (!project) refuse("UNKNOWN_OWNER", "The project is not admitted.");
      if (!(actor.kind === "captain-ui" || actor.kind === "mate-chat" || boundTo(status, actor, [project.scopeId])))
        refuse("UNKNOWN_OWNER", "Only the project's bound owner or the captain decides its memory.");
      const decided: MemoryProposal = { ...proposal, version: proposal.version + 1, state: input.decision === "accept" ? "accepted" : "rejected",
        decision: { actor, at: this.options.now?.() ?? new Date().toISOString() } };
      const mutations: SupervisionMutation[] = [{ kind: "memory-proposal", value: decided }];
      if (input.decision === "accept") {
        if (project.state !== "admitted" || capacityHeld(status, "admissions", SUPERVISION_INDEX_LIMITS.admissions)) refuse("HELD", "Memory acceptance waits while project admissions are stopped or the journal is past its admission bound.");
        const id = memoryId(project.id, proposal.key), current = versionOf(status, "project-memory", id);
        if (current !== input.memoryVersion || current !== proposal.expectedVersion) refuse("STALE", "The memory entry changed since this proposal was written; propose again against the current text.");
        const entry: ProjectMemory = { id, version: current + 1, scopeId: project.scopeId, projectId: project.id, key: proposal.key,
          proposalId: proposal.id, textDigest: proposal.textDigest, authority: "none" };
        mutations.push({ kind: "project-memory", value: entry });
      }
      return { expectedVersions: expected(status, mutations),
        mutations, result: { planId: null, planHash: null, decisionId: null, outboxId: null } };
    });
  }
}

/** Read-only: one project's accepted entries (by content digest) and pending proposals. */
export function projectMemory(status: SupervisionStatus, projectId: string) {
  const rows = rowsOf(status);
  return { entries: rows.memory.filter(m => m.projectId === projectId).sort((a, b) => a.key.localeCompare(b.key)),
    pending: rows.memoryProposals.filter(p => p.projectId === projectId && p.state === "proposed") };
}

/** Full conventions, explicit documentation excerpts, accepted memory. All carry authority=none. */
export async function readProjectContext(store: SupervisionStore, projectId: string) {
  const status = await store.read();
  if (status.freshness !== "current") refuse("HELD", "Project records need checking. Close setup, recover project records in Work details, then resume setup.");
  const project = rowsOf(status).projects.find(p => p.id === projectId);
  if (!project) refuse("UNKNOWN_OWNER", "The project is not admitted.");
  const entries = projectMemory(status, projectId).entries;
  if (entries.length > 32) refuse("HELD", "There are too many saved memory entries to include (over 32). Review the project's saved memory before resuming setup.");
  const conventions = [];
  const documentation = [];
  if (project.owner) {
    for (const path of ["AGENTS.md", "CLAUDE.md"]) {
      const file = await projectFile(project.owner.directory, path, PROJECT_CONVENTION_LIMIT);
      if (file) conventions.push(file);
    }
    const readme = await projectFile(project.owner.directory, "README.md", README_READ_LIMIT);
    if (readme) documentation.push(readmeContext(readme));
  }
  const memory = [];
  for (const entry of entries) {
    const bytes = await store.readBlob(entry.textDigest, MEMORY_TEXT_LIMIT);
    const text = Buffer.from(bytes).toString("utf8");
    if (text.includes("\0") || !Buffer.from(text).equals(Buffer.from(bytes))) refuse("HELD", "Project memory must be valid UTF-8 text.");
    memory.push({ key: entry.key, version: entry.version, digest: entry.textDigest, text, authority: "none" as const });
  }
  const current = await store.read();
  // Independent projects may publish while these confined files/blobs are read. Pin this
  // project's complete owner row and accepted memory, without borrowing a global quiet period.
  if (current.freshness !== "current" || digest(rowsOf(current).projects.find(p => p.id === projectId) ?? null) !== digest(project) ||
    digest(projectMemory(current, projectId).entries) !== digest(entries)) refuse("STALE", "The project's saved context changed while reading it. Resume setup to read the latest version.");
  const context = { projectId, scopeId: project.scopeId, name: project.name, aliases: project.aliases, conventions, documentation, memory, authority: "none" as const };
  // Count the actual escaped JSON placed in the opening, not just source bytes.
  if (Buffer.byteLength(JSON.stringify(context).replace(/</g, "\\u003c")) > PROJECT_CONTEXT_LIMIT)
    refuse("HELD", "The project rules and saved memory together are too large for the mate's opening (over 160 KiB). Keep all active rules, move reference material into documentation and review saved memory, then resume setup.");
  return context;
}
