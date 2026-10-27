/** S08 observation adapters: pull request head/check/review evidence, remote catalog fingerprints and
 * persistent scoped board submissions, routed into the S02 journal inbox of the exact owning scope.
 *
 * Exported adapters are NOT started by the plugin. Nothing here merges, releases, prompts a remote
 * host or wakes General: observations become journal events for the registered owner, unknown owners
 * stay in triage, and a source that cannot be read becomes a visible coverage gap. Titles, labels,
 * status lines and other source prose are quoted evidence; they never choose an owner or an outcome.
 */
import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { readdir, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import type { PluginLifecycleEvents, PluginLifecycleRegistration } from "@getpaseo/plugin/server";
import type { z } from "zod";
import { CAPTAIN_STEER_MESSAGE_ID_PREFIX } from "../shared/fleet";
import { SupervisionEventSchema, SupervisionUtc, type SupervisionStatus } from "../shared/supervision";
import { INBOX_LIMITS, type InboxAssignment, type InboxEvent, type InboxSource } from "../shared/supervision-inbox";
import type { RemoteHost, RemoteSnapshot, RemoteWorker } from "../shared/remotes";
import {
  PR_OBSERVATION_FORMAT, PrObservationSchema, Repository, SOURCE_LIMITS,
  type BoardSubmission, type PrCheck, type PrObservation, type PrReadiness, type RemoteCoverage, type SourceBinding,
} from "../shared/supervision-sources";
import type { PaseoApi } from "./host-types";
import { inboxRef, inboxTransaction } from "./supervision-inbox";
import { eventOwners, terminal } from "./supervision-inbox-state";
import { sourceBindingId } from "./supervision-source-state";
import { SupervisionError, SupervisionStore, type SupervisionMutation } from "./supervision-store";
import { sendWithoutInterrupting } from "./send";
import { serialized } from "./serialize";
import { canonical, digest } from "./submissions";

type Subject = z.infer<typeof SupervisionEventSchema>["subject"];
const blobId = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

/** One normalized observation from a non-hook source. `identity` decides deduplication; `consequence`
 * decides the single semantic outcome shared by every source that observed the same thing. */
export interface SourceObservation {
  kind: "pr" | "remote" | "board" | "watch"; hostId: string; agentId: string | null; scopeId?: string | null;
  /** Stable name of the source within its kind/host/agent, e.g. `owner/repo#12` or `catalog`. */
  sourceName: string; gaps: InboxSource["gaps"]; coverage: "unknown" | "gap";
  subject: Subject; identity: unknown; consequence: unknown; payload: unknown; critical: boolean;
  certainty: "reported" | "inferred";
  /** Extra immutable evidence (for example a full observation), published only when the event is new. */
  evidence?: Uint8Array[];
}
export type SourceAdmission = { eventId: string | null; written: boolean; duplicate: boolean };

const sourceRowId = (kind: string, hostId: string, agentId: string | null, name: string) => digest(["s08-source", kind, hostId, agentId, name]);
const sameGaps = (a: InboxSource | undefined, gaps: readonly string[], coverage: string, scopeId: string | null) =>
  !!a && a.coverage === coverage && digest([...a.gaps].sort()) === digest([...new Set(gaps)].sort()) && (a.scopeId ?? null) === scopeId;
const normalHost = (host: string) => host.trim().toLowerCase();

export class SupervisionSources {
  constructor(readonly store: SupervisionStore, private readonly options: { now?: () => Date } = {}) {}
  private now() { return SupervisionUtc.parse((this.options.now?.() ?? new Date()).toISOString()); }

  /** Admit one observation. Unchanged content and unchanged coverage write nothing, so quiet polls
   * cost no transaction. The source row (baseline) commits in the SAME transaction as its event. */
  async admit(o: SourceObservation, requestId: string = randomUUID(), extra?: (s: SupervisionStatus, eventId: string | null) => SupervisionMutation[]): Promise<SourceAdmission> {
    let payload = canonical(o.payload ?? null), malformed = false;
    if (Buffer.byteLength(payload) > INBOX_LIMITS.payloadBytes) { payload = canonical({ digest: digest(o.payload), bytes: Buffer.byteLength(payload), omitted: "oversized" }); malformed = true; }
    const hostId = normalHost(o.hostId), scopeId = o.scopeId ?? null, gaps = [...new Set<InboxSource["gaps"][number]>([...o.gaps, ...(malformed ? ["malformed" as const] : [])])];
    const coverage = gaps.length ? "gap" as const : o.coverage;
    const id = sourceRowId(o.kind, hostId, o.agentId, o.sourceName), observationHash = digest([o.kind, hostId, o.agentId, o.identity, digest(payload)]);
    const sourceKey = digest([o.sourceName, digest(o.identity)]);
    const quiet = (s: SupervisionStatus) => {
      const known = s.inbox.events.find(e => e.envelope.source.kind === o.kind && e.envelope.source.hostId === hostId && e.envelope.source.key === sourceKey);
      return known && sameGaps(s.inbox.sources.find(c => c.id === id), gaps, coverage, scopeId) && !extra ? known : null;
    };
    const early = quiet(await this.store.read());
    if (early) return { eventId: early.id, written: false, duplicate: true };
    let outcome: SourceAdmission = { eventId: null, written: true, duplicate: false };
    await serialized(`${this.store.root}:ingress`, () => inboxTransaction(this.store, requestId, { op: "s08-source", kind: o.kind, hostId, sourceKey, observationHash, gaps }, async s => {
      const prior = s.inbox.sources.find(c => c.id === id);
      const source: InboxSource = { id, kind: o.kind, hostId, agentId: o.agentId, epoch: null, cursor: null, maxSeq: null,
        coverage, gaps, observedAt: this.now(), version: (prior?.version ?? 0) + 1, ...(scopeId ? { scopeId } : {}) };
      const mutations: SupervisionMutation[] = [{ kind: "inbox-source", value: source }];
      const known = s.inbox.events.find(e => e.envelope.source.kind === o.kind && e.envelope.source.hostId === hostId && e.envelope.source.key === sourceKey);
      if (known) {
        outcome = { eventId: known.id, written: true, duplicate: true };
        return { mutations: [...mutations, ...(extra?.(s, known.id) ?? [])], resultIds: [known.id] };
      }
      const consequenceKey = digest(["s08", o.kind === "watch" ? "pr" : o.kind, o.consequence]);
      const primary = s.inbox.assignments.find(a => a.consequenceKey === consequenceKey && a.id === a.primaryEventId);
      const pending = s.inbox.assignments.filter(a => a.id === a.primaryEventId && !terminal(a)).length;
      if (!primary && pending >= INBOX_LIMITS.pending) {
        // Refuse admission and expose pressure; the source baseline does not advance past unadmitted data.
        outcome = { eventId: null, written: true, duplicate: false };
        return { mutations: [{ kind: "inbox-source", value: { ...source, coverage: "gap", gaps: [...new Set([...gaps, "queue-pressure" as const])] } }], resultIds: [] };
      }
      const blob = await this.store.putBlob(Buffer.from(payload)), eventId = randomUUID(), at = this.now();
      const extraBlobs = await Promise.all((o.evidence ?? []).map(bytes => this.store.putBlob(bytes)));
      const event: InboxEvent = { id: eventId, version: 1, critical: malformed || o.critical, consequenceKey, observationHash,
        envelope: SupervisionEventSchema.parse({ version: 1, eventId, source: { kind: o.kind, hostId, key: sourceKey, epoch: null, cursor: null },
          observedAt: at, subject: { ...o.subject }, certainty: malformed ? "unknown" : o.certainty, payloadRef: `blob:${blob.id}`,
          evidence: [blob, ...extraBlobs].map(b => ({ ref: `blob:${b.id}`, digest: b.id, freshness: at })) }) };
      const owners = eventOwners(event, s.tasks, s.attempts, s.sources.bindings);
      const owner = owners.length === 1 && !malformed && s.scopes.find(scope => scope.id === owners[0]!.scopeId)?.mode === "scoped" ? owners[0]! : null;
      if (owner) Object.assign(event.envelope.subject, { taskId: owner.task.id, attemptId: owner.attempt.id, planId: owner.task.planId });
      if (primary && primary.scopeId !== owner?.scopeId) { delete event.envelope.subject.taskId; delete event.envelope.subject.attemptId; delete event.envelope.subject.planId; }
      const owned = primary ? primary.scopeId : owner?.scopeId ?? null, box = owned ? s.inbox.mailboxes.find(b => b.id === owned) : undefined;
      const assignment: InboxAssignment = { id: eventId, scopeId: owned, primaryEventId: primary?.id ?? eventId, consequenceKey,
        attemptId: primary?.attemptId ?? owner?.attempt.id ?? null, resolverVersion: 1,
        reason: malformed && !primary ? "malformed" : primary ? "duplicate" : owner ? "attempt-owner" : owners.length > 1 ? "ambiguous-owner" : "unknown-owner",
        candidates: [...new Set(owners.map(x => x.scopeId))].slice(0, 64), ordinal: !primary && owned ? box?.nextOrdinal ?? 1 : null,
        state: primary ? "superseded" : malformed ? "quarantined" : owner ? event.critical ? "assigned" : "observed" : "received", offerId: null, epoch: null,
        result: !primary && owner && !event.critical ? { kind: "no-action", reason: "Bounded source metadata only; no lifecycle outcome or model wake.", evidenceIds: [blob.id] } : null, version: 1 };
      if (assignment.state === "quarantined") assignment.scopeId = null, assignment.ordinal = null, assignment.attemptId = null;
      if (!s.versions.some(v => v.kind === "blob" && v.id === blob.id)) mutations.unshift({ kind: "blob", value: blob });
      for (const b of extraBlobs) if (!s.versions.some(v => v.kind === "blob" && v.id === b.id) && b.id !== blob.id) mutations.unshift({ kind: "blob", value: b });
      mutations.push({ kind: "inbox-event", value: event }, { kind: "inbox-assignment", value: assignment });
      if (assignment.ordinal !== null) mutations.push({ kind: "inbox-mailbox", value: { id: owned!, nextOrdinal: assignment.ordinal + 1,
        watermark: assignment.state === "observed" && (box?.watermark ?? 0) === assignment.ordinal - 1 ? assignment.ordinal : box?.watermark ?? 0, version: (box?.version ?? 0) + 1 } });
      outcome = { eventId, written: true, duplicate: !!primary };
      return { mutations: [...mutations, ...(extra?.(s, eventId) ?? [])], resultIds: [eventId],
        pins: [...owners.flatMap(x => [inboxRef(s, "task", x.task.id), inboxRef(s, "attempt", x.attempt.id)]),
          ...s.sources.bindings.filter(b => b.id === (o.subject.repositoryId && o.subject.pr ? sourceBindingId(o.subject.repositoryId, o.subject.pr) : "")).map(b => inboxRef(s, "source-binding", b.id))] };
    }));
    return outcome;
  }

  /** A coverage change without an event (outage, fetch failure). Writes only when coverage changes:
   * an unchanged outage is one incident, not one transaction per poll. */
  async gap(kind: SourceObservation["kind"], hostId: string, agentId: string | null, sourceName: string, gaps: InboxSource["gaps"], scopeId: string | null = null) {
    const host = normalHost(hostId), id = sourceRowId(kind, host, agentId, sourceName), coverage = gaps.length ? "gap" : "unknown";
    if (sameGaps((await this.store.read()).inbox.sources.find(c => c.id === id), gaps, coverage, scopeId)) return false;
    await serialized(`${this.store.root}:ingress`, () => inboxTransaction(this.store, randomUUID(), { op: "s08-gap", id, gaps, at: this.now() }, s => {
      const prior = s.inbox.sources.find(c => c.id === id);
      if (sameGaps(prior, gaps, coverage, scopeId)) return { mutations: [], resultIds: [id] };
      return { mutations: [{ kind: "inbox-source", value: { id, kind, hostId: host, agentId, epoch: null, cursor: null, maxSeq: null, coverage,
        gaps: [...new Set(gaps)], observedAt: this.now(), version: (prior?.version ?? 0) + 1, ...(scopeId ? { scopeId } : {}) } }], resultIds: [id] };
    }));
    return true;
  }

  // ---- Pull requests ---------------------------------------------------------------------------

  /** Register the exact attempt that owns a pull request. A different owner is a CONFLICT, never a reroute. */
  async bindPullRequest(input: { scopeId: string; attemptId: string; repository: string; pr: number }, requestId = randomUUID()) {
    const repository = Repository.parse(input.repository.toLowerCase()), id = sourceBindingId(repository, input.pr);
    return serialized(`${this.store.root}:ingress`, () => inboxTransaction(this.store, requestId, { op: "s08-bind", ...input, repository }, s => {
      const attempt = s.attempts.find(a => a.id === input.attemptId), task = attempt ? s.tasks.find(t => t.id === attempt.taskId) : undefined;
      const scope = s.scopes.find(x => x.id === input.scopeId);
      if (!attempt || !task || task.ownerScopeId !== input.scopeId || scope?.mode !== "scoped" || scope.state === "retired")
        throw new SupervisionError("UNKNOWN_OWNER", "A pull request binds only to an exact registered attempt of an active scoped owner.");
      const prior = s.sources.bindings.find(b => b.id === id);
      if (prior && prior.state === "active" && prior.attemptId === attempt.id) return { mutations: [], resultIds: [id] };
      if (prior && (prior.scopeId !== input.scopeId || prior.taskId !== task.id)) throw new SupervisionError("CONFLICT", "This pull request already has another owner.");
      const value: SourceBinding = { id, kind: "pull-request", repository, pr: input.pr, scopeId: input.scopeId, taskId: task.id,
        attemptId: attempt.id, state: "active", version: (prior?.version ?? 0) + 1 };
      return { mutations: [{ kind: "source-binding", value }], resultIds: [id], pins: [inboxRef(s, "attempt", attempt.id), inboxRef(s, "task", task.id)] };
    }));
  }

  /** One pull request observation from the direct reader (`pr`) or the opt-in pr-watch spool (`watch`).
   * Equal semantic content from both sources is one consequence with both provenances retained. */
  async observePullRequest(raw: PrObservation, provenance: { kind: "pr" | "watch"; key: string }, requestId?: string) {
    const obs = PrObservationSchema.parse(raw);
    const status = await this.store.read(), binding = status.sources.bindings.find(b => b.id === sourceBindingId(obs.repository, obs.pr) && b.state === "active");
    const full = Buffer.from(canonical(obs)), evidence = blobId(full);
    return this.admit({ kind: provenance.kind, hostId: provenance.kind === "pr" ? "github.com" : "local", agentId: null, scopeId: binding?.scopeId ?? null,
      sourceName: `${obs.repository}#${obs.pr}`, gaps: ["no-cursor"], coverage: "unknown",
      subject: { repositoryId: obs.repository, pr: obs.pr, head: obs.head },
      identity: semanticPr(obs), consequence: [obs.repository, obs.pr, semanticPr(obs)], critical: true, certainty: "reported", evidence: [full],
      payload: { format: PR_OBSERVATION_FORMAT, observation: `blob:${evidence}`, provenance: provenance.kind, key: provenance.key.slice(0, 256),
        state: obs.state, head: obs.head, observedAt: obs.observedAt, checks: obs.checks.length, reviews: obs.reviews.length } }, requestId);
  }

  /** Every retained observation of a pull request, from every source, oldest first. */
  async pullRequestObservations(repository: string, pr: number): Promise<{ observations: PrObservation[]; events: number }> {
    const s = await this.store.read(), repo = repository.toLowerCase();
    const events = s.inbox.events.filter(e => e.envelope.subject.repositoryId === repo && e.envelope.subject.pr === pr);
    const blobs = [...new Set(events.flatMap(e => e.envelope.evidence.map(x => x.digest)))];
    const observations: PrObservation[] = [];
    for (const id of blobs) {
      const parsed = PrObservationSchema.safeParse(JSON.parse(await readFile(join(this.store.root, "blobs", id), "utf8")));
      if (parsed.success && parsed.data.repository === repo && parsed.data.pr === pr) observations.push(parsed.data);
    }
    return { observations: observations.sort((a, b) => a.observedAt.localeCompare(b.observedAt)), events: events.length };
  }

  async readiness(repository: string, pr: number, options: ReadinessOptions = {}): Promise<PrReadiness> {
    const { observations, events } = await this.pullRequestObservations(repository, pr);
    return prReadiness(repository.toLowerCase(), pr, observations, { ...options, events });
  }

  /** Reread the source immediately before an admission decision. A read failure holds; a moved head is STALE. */
  async admissionCheck(reader: PullRequestReader, input: { repository: string; pr: number; expectedHead: string } & ReadinessOptions) {
    const repository = input.repository.toLowerCase();
    let fresh: PrObservation;
    try { fresh = await reader(repository, input.pr); }
    catch {
      const binding = (await this.store.read()).sources.bindings.find(b => b.id === sourceBindingId(repository, input.pr));
      await this.gap("pr", "github.com", null, `${repository}#${input.pr}`, ["no-cursor", "fetch-failed"], binding?.scopeId ?? null);
      return { code: "HELD" as const, readiness: null, message: "The pull request could not be reread; nothing is admitted on retained evidence." };
    }
    await this.observePullRequest(fresh, { kind: "pr", key: "admission" });
    // Decide on the fresh read itself; identical content committed earlier is deduplicated, not lost.
    const { observations, events } = await this.pullRequestObservations(repository, input.pr);
    const readiness = prReadiness(repository, input.pr, [...observations, fresh], { ...input, events: events + 1 });
    return { code: readiness.state === "ready" ? null : readiness.state === "stale" ? "STALE" as const : "HELD" as const, readiness,
      message: readiness.reasons.join(" ") || "Ready at the expected head." };
  }

  /** Ingest the opt-in pr-watch spool. Each file is removed only after its event and source row commit;
   * a crash before removal re-ingests the same content, which deduplicates. */
  async ingestPrSpool(directory: string) {
    let names: string[];
    try { names = (await readdir(directory)).filter(n => /^[0-9a-z-]{1,128}\.json$/.test(n)).sort().slice(0, SOURCE_LIMITS.spoolFiles); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return { ingested: 0, rejected: 0 }; throw error; }
    let ingested = 0, rejected = 0;
    for (const name of names) {
      const path = join(directory, name), bytes = await readFile(path);
      let obs: PrObservation | null = null;
      try {
        if (bytes.length > SOURCE_LIMITS.spoolBytes) throw new Error("oversized");
        const spool = JSON.parse(bytes.toString("utf8")) as { format?: unknown; url?: unknown; observedAt?: unknown; pull?: unknown };
        if (spool.format !== "firstmate.pr-watch-spool/1" || typeof spool.url !== "string" || typeof spool.observedAt !== "string") throw new Error("format");
        const ref = parsePullRequestUrl(spool.url);
        obs = normalizePullRequest(spool.pull, ref.repository, ref.pr, SupervisionUtc.parse(spool.observedAt));
      } catch { obs = null; }
      if (!obs) {
        // Retain the bytes for inspection; the watch source shows the malformed input until it is removed by hand.
        await this.gap("watch", "local", null, "pr-watch", ["no-cursor", "malformed"]); rejected++; continue;
      }
      await this.observePullRequest(obs, { kind: "watch", key: name });
      await rm(path, { force: true }); ingested++;
    }
    return { ingested, rejected };
  }

  // ---- Remote catalog ---------------------------------------------------------------------------

  /** Observe the remote poll for registered scoped attempts only. Legacy remote crew keeps its existing
   * route (remote-watch); followed sessions are the captain's own and never admitted. */
  async observeRemote(snapshot: RemoteSnapshot, now = this.options.now?.() ?? new Date()) {
    const status = await this.store.read(), coverage = remoteCoverage(snapshot, now);
    let events = 0;
    for (const host of snapshot.hosts) {
      const hostId = normalHost(host.serverId), report = coverage.find(c => c.serverId === host.serverId)!;
      const hostGaps = report.gaps as InboxSource["gaps"];
      await this.gap("remote", hostId, null, "catalog", hostGaps);
      const registered = status.attempts.filter(a => a.worker && normalHost(a.worker.hostId) === hostId);
      for (const attempt of registered) {
        const agentId = attempt.worker!.agentId, worker = host.workers.find(w => w.id === agentId && w.followed !== true);
        const scopeId = status.tasks.find(t => t.id === attempt.taskId)?.ownerScopeId ?? null;
        if (report.state !== "fresh" || !worker) {
          // No silent coverage claim: an unreachable host or a missing worker is a gap on that worker's source.
          await this.gap("remote", hostId, agentId, "worker", [...hostGaps, ...(worker ? [] : ["fetch-failed" as const])], scopeId); continue;
        }
        const fingerprint = remoteFingerprint(worker), running = worker.status === "running";
        const prior = status.inbox.events.filter(e => e.envelope.source.kind === "remote" && e.envelope.source.hostId === hostId && e.envelope.subject.agentId === agentId);
        const consequence = ["remote", hostId, agentId, fingerprint], identity = [fingerprint, running ? null : worker.updatedAt];
        // Equal content under a different settled update may hide a new turn. The same poll repeated is not a collision.
        const collision = !running && prior.some(e => e.consequenceKey === digest(["s08", "remote", consequence]) && e.envelope.source.key !== digest(["worker", digest(identity)]));
        const admitted = await this.admit({ kind: "remote", hostId, agentId, scopeId, sourceName: "worker",
          gaps: [...hostGaps, ...(collision ? ["content-collision" as const] : [])], coverage: "unknown",
          subject: { agentId }, identity, consequence, certainty: "inferred",
          critical: !running && worker.status !== "initializing",
          payload: { format: "firstmate.remote-observation/1", status: worker.status, updatedAt: worker.updatedAt, fingerprint,
            permissions: (worker.pendingPermissions ?? []).map(p => p.id).slice(0, 32), skewSeconds: report.clockSkewSeconds,
            // Worker prose is untrusted evidence. It never completes a task, even when it reads "done:".
            lastMessage: worker.lastMessage === undefined ? null : { trust: "untrusted-worker-text", digest: digest(worker.lastMessage), quoted: JSON.stringify(worker.lastMessage.slice(0, SOURCE_LIMITS.answerChars)) } } });
        if (admitted.written && admitted.eventId && !admitted.duplicate) events++;
      }
    }
    return { coverage, events };
  }
}

// ---- Pure pull request helpers --------------------------------------------------------------------

export type PullRequestReader = (repository: string, pr: number) => Promise<PrObservation>;
export interface ReadinessOptions { expectedHead?: string; requiredApprovals?: number; excludeReviewers?: readonly string[]; allowNoChecks?: boolean; events?: number }

export function parsePullRequestUrl(url: string): { repository: string; pr: number } {
  const match = /^https:\/\/github\.com\/([\w.-]+)\/([\w.-]+)\/pull\/(\d+)$/.exec(url);
  if (!match) throw new Error("Expected a https://github.com/<owner>/<repo>/pull/<n> URL.");
  return { repository: Repository.parse(`${match[1]}/${match[2]}`.toLowerCase()), pr: Number(match[3]) };
}

const FAILED = new Set(["FAILURE", "ERROR", "TIMED_OUT", "CANCELLED", "ACTION_REQUIRED", "STARTUP_FAILURE"]);
const WAITING = new Set(["PENDING", "EXPECTED", "QUEUED", "IN_PROGRESS", "WAITING", "REQUESTED"]);
const clip = (value: unknown, max: number) => typeof value === "string" && value.length ? value.slice(0, max) : null;

/** gh's `pr view --json` shape -> the versioned observation. Unknown conclusions block readiness. */
export function normalizePullRequest(raw: unknown, repository: string, pr: number, observedAt: string): PrObservation {
  const pull = (raw ?? {}) as Record<string, unknown>;
  const checks: PrCheck[] = (Array.isArray(pull.statusCheckRollup) ? pull.statusCheckRollup : []).slice(0, 256).map((item: Record<string, unknown>) => {
    const name = clip(item.name ?? item.context, 512) ?? "unnamed check", workflow = clip(item.workflowName, 512), url = String(item.detailsUrl ?? item.targetUrl ?? "");
    const run = /\/actions\/runs\/(\d+)(?:\/attempts\/(\d+))?\/job\/(\d+)/.exec(url);
    let status: PrCheck["status"];
    if (item.__typename === "StatusContext" || (item.state && !item.status)) status = FAILED.has(String(item.state)) ? "failure" : WAITING.has(String(item.state)) ? "pending" : item.state === "SUCCESS" ? "success" : "unknown";
    else if (item.status !== "COMPLETED") status = "pending";
    else status = item.conclusion === "SUCCESS" ? "success" : item.conclusion === "NEUTRAL" ? "neutral" : item.conclusion === "SKIPPED" ? "skipped" : FAILED.has(String(item.conclusion)) ? "failure" : "unknown";
    return { id: run ? `run:${run[1]}/attempt:${run[2] ?? "?"}/job:${run[3]}` : `digest:${digest([item.__typename ?? null, name, workflow, url])}`,
      identity: run ? "run" : "digest", name, workflow, status, required: typeof item.isRequired === "boolean" ? item.isRequired : null };
  });
  const author = (pull.author as { login?: unknown } | undefined)?.login;
  return PrObservationSchema.parse({ format: PR_OBSERVATION_FORMAT, repository, pr,
    state: ["OPEN", "CLOSED", "MERGED"].includes(String(pull.state)) ? pull.state : (() => { throw new Error("Unknown pull request state."); })(),
    head: String(pull.headRefOid ?? "").toLowerCase(), author: clip(author, 256),
    checks, requiredChecks: checks.some(c => c.required !== null) ? "known" : "unknown",
    reviews: (Array.isArray(pull.reviews) ? pull.reviews : []).filter((r: Record<string, unknown>) => r.state !== "PENDING").slice(-256).map((r: Record<string, unknown>) => ({
      id: String(r.id).slice(0, 256), author: clip((r.author as { login?: unknown } | undefined)?.login, 256), state: String(r.state ?? "UNKNOWN").slice(0, 64),
      commit: /^[0-9a-f]{40,64}$/.test(String((r.commit as { oid?: unknown } | undefined)?.oid ?? "").toLowerCase()) ? String((r.commit as { oid: string }).oid).toLowerCase() : null,
      submittedAt: clip(r.submittedAt, 64) })),
    observedAt });
}

/** The content that decides deduplication and the single consequence: no provenance, time or prose. */
export function semanticPr(obs: PrObservation) {
  return { state: obs.state, head: obs.head, checks: obs.checks.map(c => [c.id, c.status, c.required]).sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
    reviews: obs.reviews.map(r => [r.id, r.state, r.commit]).sort((a, b) => String(a[0]).localeCompare(String(b[0]))) };
}

function checksOf(obs: PrObservation) {
  const relevant = obs.requiredChecks === "known" ? obs.checks.filter(c => c.required === true) : obs.checks;
  const failing = relevant.filter(c => c.status === "failure" || c.status === "unknown").map(c => c.name);
  const state = failing.length ? "failing" as const : relevant.some(c => c.status === "pending") ? "pending" as const : relevant.length ? "passing" as const : "none" as const;
  return { state, failing, coverage: obs.requiredChecks === "known" ? "required" as const : "all-observed" as const };
}
function approvalsAt(observations: readonly PrObservation[], head: string, author: string | null, exclude: readonly string[]) {
  const reviews = new Map<string, PrObservation["reviews"][number]>();
  // Duplicate observations of one review ID are one review, whichever source saw it.
  for (const obs of observations) for (const review of obs.reviews) reviews.set(review.id, review);
  const latest = new Map<string, PrObservation["reviews"][number]>(), stale: string[] = [];
  for (const review of [...reviews.values()].sort((a, b) => String(a.submittedAt).localeCompare(String(b.submittedAt)))) {
    if (review.commit !== head) { stale.push(review.id); continue; }
    if (!review.author || review.author === author || exclude.includes(review.author) || !["APPROVED", "CHANGES_REQUESTED", "DISMISSED"].includes(review.state)) continue;
    latest.set(review.author, review);
  }
  const values = [...latest.values()];
  return { approvals: values.filter(r => r.state === "APPROVED").map(r => ({ reviewId: r.id, author: r.author! })),
    changes: values.filter(r => r.state === "CHANGES_REQUESTED").map(r => r.author!), stale };
}

/** Readiness at the newest observed head. Only reviews of that exact head by distinct independent
 * reviewers count; a red or unknown check, a moved head or missing reviews never read as ready. */
export function prReadiness(repository: string, pr: number, observations: readonly PrObservation[], options: ReadinessOptions = {}): PrReadiness {
  const sorted = [...observations].sort((a, b) => a.observedAt.localeCompare(b.observedAt));
  const unique = new Map(sorted.map(o => [digest(semanticPr(o)), o]));
  const latest = sorted.at(-1) ?? null, required = options.requiredApprovals ?? 1, exclude = options.excludeReviewers ?? [];
  const base: PrReadiness = { format: "firstmate.pr-readiness/1", repository, pr, state: "unknown", head: latest?.head ?? null, reasons: [],
    checks: { state: "unknown", coverage: "all-observed", failing: [] }, approvals: [], staleReviews: [], invalidated: [],
    observations: sorted.length, duplicates: Math.max(0, (options.events ?? sorted.length) - unique.size), observedAt: latest?.observedAt ?? null };
  if (!latest) return { ...base, reasons: ["No observation of this pull request is retained."] };
  const contemporaries = sorted.filter(o => o.observedAt === latest.observedAt && o.head !== latest.head);
  const wouldBeReady = (obs: PrObservation) => obs.state === "OPEN" && checksOf(obs).state === "passing" &&
    approvalsAt(sorted.filter(o => o.observedAt <= obs.observedAt), obs.head, obs.author, exclude).approvals.length >= required;
  const invalidated: PrReadiness["invalidated"] = [];
  for (const obs of sorted) if (obs !== latest && wouldBeReady(obs)) {
    const now = checksOf(latest).state;
    if (obs.head !== latest.head) invalidated.push({ head: obs.head, observedAt: obs.observedAt, reason: "head-changed" });
    else if (now !== "passing") invalidated.push({ head: obs.head, observedAt: obs.observedAt, reason: now === "failing" ? "checks-red" : "checks-pending" });
  }
  const checks = checksOf(latest), reviews = approvalsAt(sorted, latest.head, latest.author, exclude), reasons: string[] = [];
  const result = { ...base, checks: { state: checks.state, coverage: checks.coverage, failing: checks.failing.slice(0, 32) },
    approvals: reviews.approvals, staleReviews: reviews.stale, invalidated: [...new Map(invalidated.map(i => [digest(i), i])).values()].slice(0, 32) };
  if (contemporaries.length) return { ...result, state: "unknown", reasons: ["Two observations at the same instant name different heads; reread."] };
  if (latest.state === "MERGED") return { ...result, state: "merged", reasons: ["Merged; readiness no longer applies."] };
  if (latest.state === "CLOSED") return { ...result, state: "closed", reasons: ["Closed without merging."] };
  if (options.expectedHead && options.expectedHead.toLowerCase() !== latest.head) return { ...result, state: "stale", reasons: [`Head moved from ${options.expectedHead} to ${latest.head}; evidence for the old head does not carry over.`] };
  if (checks.state === "failing") reasons.push(`Checks are red: ${checks.failing.map(n => JSON.stringify(n)).join(", ")}.`);
  if (checks.state === "pending") reasons.push("Checks are still running.");
  if (checks.state === "none" && !options.allowNoChecks) reasons.push("No checks were observed at this head.");
  if (reviews.changes.length) reasons.push(`Changes requested at this head by ${reviews.changes.length} reviewer(s).`);
  if (reviews.approvals.length < required) reasons.push(`${reviews.approvals.length} of ${required} independent approval(s) at this head.`);
  const state = checks.state === "failing" ? "red" : checks.state === "pending" ? "pending" : reasons.length ? "blocked" : "ready";
  return { ...result, state, reasons };
}

/** The production reader: one `gh pr view` per call, no comments or bodies requested. */
export function ghPullRequestReader(run: (args: string[]) => Promise<string> = ghJson, now: () => Date = () => new Date()): PullRequestReader {
  return async (repository, pr) => {
    const url = `https://github.com/${Repository.parse(repository)}/pull/${pr}`;
    const raw = JSON.parse(await run(["pr", "view", url, "--json", "number,state,headRefOid,author,reviews,statusCheckRollup"]));
    return normalizePullRequest(raw, repository, pr, SupervisionUtc.parse(now().toISOString()));
  };
}
function ghJson(args: string[]): Promise<string> {
  return new Promise((resolve, reject) => execFile("gh", args, { timeout: 20_000, maxBuffer: 16 * 1024 * 1024, windowsHide: true },
    (error, stdout) => error ? reject(new Error("gh could not read the pull request.")) : resolve(String(stdout))));
}

// ---- Pure remote helpers --------------------------------------------------------------------------

/** Status, final words and pending permission IDs. Equal content can hide a new turn: it is inferred. */
export function remoteFingerprint(worker: Pick<RemoteWorker, "status" | "lastMessage" | "output" | "pendingPermissions">) {
  return digest(["firstmate.remote-fingerprint/1", worker.status, digest(worker.lastMessage ?? worker.output ?? ""), (worker.pendingPermissions ?? []).map(p => p.id).sort()]);
}

/** An honest per-host statement. Never "complete": the poll has no cursor and no turn identity. */
export function remoteCoverage(snapshot: RemoteSnapshot, now = new Date()): RemoteCoverage[] {
  return snapshot.hosts.map((host: RemoteHost) => {
    const checked = host.checkedAt ? Date.parse(host.checkedAt) : NaN, ageMs = Number.isFinite(checked) ? Math.max(0, now.getTime() - checked) : null;
    const skew = host.clockSkew?.seconds ?? null, gaps: InboxSource["gaps"] = ["no-cursor"];
    const state = !host.online ? "offline" : ageMs === null || ageMs > SOURCE_LIMITS.staleRemoteMs ? "stale" : "fresh";
    if (state === "offline") gaps.push("outage"); else if (state === "stale") gaps.push("stale"); else gaps.push("fingerprint-only");
    if (skew !== null && Math.abs(skew) >= SOURCE_LIMITS.clockSkewSeconds) gaps.push("clock-skew");
    return { serverId: host.serverId, label: host.label, state, checkedAt: host.checkedAt, ageMs, clockSkewSeconds: skew,
      claim: state === "fresh" ? "fingerprint-only" : "none", gaps, workers: host.workers.filter(w => w.followed !== true).length,
      followedExcluded: host.workers.filter(w => w.followed === true).length,
      // The host's error text can carry credentials or pairing links; only its presence is reported.
      error: host.error !== null };
  });
}

/** True when a host/agent pair is (or, on a held journal, may be) a scoped attempt. Fail closed like hasScopedWorker. */
export function isScopedSourceWorker(status: SupervisionStatus, hostId: string, agentId: string): boolean {
  const host = normalHost(hostId);
  return [{ attempts: status.attempts, tasks: status.tasks }, ...status.retainedOwnership].some(s => s.attempts.some(a =>
    a.worker && normalHost(a.worker.hostId) === host && a.worker.agentId === agentId &&
    s.tasks.some(t => t.id === a.taskId && (status.scopes.find(scope => scope.id === t.ownerScopeId)?.mode === "scoped" || status.freshness === "held"))));
}
/** Remote mutation of scoped work is disabled until S11's qualified receiver contract. */
export function refuseScopedRemoteMutation(status: SupervisionStatus, serverId: string, agentId: string): void {
  if (isScopedSourceWorker(status, serverId, agentId)) throw new SupervisionError("UNSUPPORTED",
    "This remote worker belongs to a scoped supervisor. Remote steer, interrupt and end stay disabled until a qualified receiver contract exists.");
}

// ---- Scoped board steer -------------------------------------------------------------------------

/** The captain's board words to a scoped worker: persisted before the send with the target attempt and
 * epoch, correlated to the turn that read them, and admitted to that scope's inbox — never to General. */
export class ScopedBoardSteer {
  constructor(readonly store: SupervisionStore, readonly sources: SupervisionSources,
    private readonly send: typeof sendWithoutInterrupting = sendWithoutInterrupting, private readonly options: { now?: () => Date } = {}) {}
  private now() { return SupervisionUtc.parse((this.options.now?.() ?? new Date()).toISOString()); }

  /** The exact current scoped attempt of a local agent. Labels and titles are not consulted. */
  owner(status: SupervisionStatus, agentId: string) {
    const matches = status.attempts.filter(a => a.worker?.hostId.trim().toLowerCase() === "local" && a.worker.agentId === agentId).flatMap(attempt => {
      const task = status.tasks.find(t => t.id === attempt.taskId && t.currentAttempt === attempt.id);
      const scope = task ? status.scopes.find(s => s.id === task.ownerScopeId) : undefined, binding = scope ? status.bindings.find(b => b.scopeId === scope.id) : undefined;
      return task && scope?.mode === "scoped" && scope.state === "active" && binding && binding.state !== "retired" ? [{ attempt, task, scope, binding }] : [];
    });
    if (status.freshness !== "current" || matches.length !== 1) throw new SupervisionError(status.freshness !== "current" ? "HELD" : "UNKNOWN_OWNER",
      "This worker has no single current scoped attempt; the board will not guess an owner or fall back to General.");
    return matches[0]!;
  }

  async steer(paseo: PaseoApi, agentId: string, text: string): Promise<BoardSubmission> {
    const words = text.trim();
    if (!words) throw new Error("Nothing to send.");
    const blob = await this.store.putBlob(Buffer.from(words)), id = randomUUID(), messageId = `${CAPTAIN_STEER_MESSAGE_ID_PREFIX}${id}`;
    let submission!: BoardSubmission;
    await serialized(`${this.store.root}:ingress`, () => inboxTransaction(this.store, id, { op: "s08-board-reserve", agentId, text: blob.id }, s => {
      const { attempt, task, binding } = this.owner(s, agentId);
      submission = { id, messageId, scopeId: task.ownerScopeId, taskId: task.id, attemptId: attempt.id, epoch: binding.epoch, hostId: "local", agentId,
        textDigest: blob.id, payloadRef: `blob:${blob.id}`, state: "reserved", createdAt: this.now(), correlation: null, version: 1 };
      return { mutations: [...(s.versions.some(v => v.kind === "blob" && v.id === blob.id) ? [] : [{ kind: "blob" as const, value: blob }]),
        { kind: "board-submission", value: submission }], resultIds: [id],
        pins: [inboxRef(s, "attempt", attempt.id), inboxRef(s, "task", task.id), inboxRef(s, "binding", task.ownerScopeId), inboxRef(s, "scope", task.ownerScopeId)] };
    }));
    let state: BoardSubmission["state"];
    try { await this.send(paseo, agentId, words, { messageId }, { channel: "crew-steer", actor: "captain" }); state = "accepted"; }
    catch { state = "uncertain"; }
    await this.settle(submission.id, state);
    if (state === "uncertain") throw new SupervisionError("UNCERTAIN", "The send's outcome is unknown. It is recorded and will not be resent automatically.");
    return { ...submission, state, version: 2 };
  }

  private settle(id: string, state: BoardSubmission["state"]) {
    return serialized(`${this.store.root}:ingress`, () => inboxTransaction(this.store, randomUUID(), { op: "s08-board-settle", id, state }, s => {
      const row = s.sources.submissions.find(x => x.id === id);
      if (!row || row.state !== "reserved") return { mutations: [], resultIds: [id] };
      return { mutations: [{ kind: "board-submission", value: { ...row, state, version: row.version + 1 } }], resultIds: [id] };
    }));
  }

  /** Correlate a finished turn to the submissions it read. A typed clientMessageId is verified; a text
   * match is inferred and grants nothing more than an inferred observation. */
  async turnEnded(event: Pick<PluginLifecycleEvents["agent.turn_ended"], "agent" | "turnId" | "outcome" | "timeline">, paseo?: PaseoApi) {
    if (event.outcome.kind === "canceled") return [];
    const status = await this.store.read();
    const open = status.sources.submissions.filter(x => x.agentId === event.agent.id && !x.correlation && ["accepted", "uncertain"].includes(x.state));
    if (!open.length) return [];
    let items = event.timeline as readonly { type: string; text?: string; clientMessageId?: string }[];
    if (!items.length && paseo) {
      try { items = (await paseo.agents.ref(event.agent.id).timeline.refetch({ direction: "tail", limit: 32, projection: "canonical" })).entries.map(e => e.item as typeof items[number]); }
      catch { await this.sources.gap("board", "local", event.agent.id, "board", ["fetch-failed"], open[0]!.scopeId); return []; }
    }
    const users = items.filter(i => i.type === "user_message"), answer = closing(items);
    const admitted: string[] = [];
    for (const row of open) {
      const words = await readFile(join(this.store.root, "blobs", row.textDigest), "utf8");
      const certainty = users.some(u => u.clientMessageId === row.messageId) ? "verified" as const : users.some(u => (u.text ?? "").includes(words)) ? "inferred" as const : null;
      if (!certainty) continue;
      const result = await this.sources.admit({ kind: "board", hostId: "local", agentId: row.agentId, scopeId: row.scopeId, sourceName: row.messageId,
        gaps: ["no-cursor", ...(certainty === "inferred" ? ["fingerprint-only" as const] : [])], coverage: "unknown",
        subject: { agentId: row.agentId, attemptId: row.attemptId, ...(event.turnId ? { turnId: event.turnId } : {}) },
        identity: [row.messageId, event.turnId ?? null], consequence: [row.messageId], critical: true, certainty: certainty === "verified" ? "reported" : "inferred",
        payload: { format: "firstmate.board-exchange/1", messageId: row.messageId, submissionId: row.id, turnId: event.turnId ?? null, correlation: certainty,
          // The worker's answer is untrusted evidence for the scope owner: quoted, capped, never a status-line completion.
          answer: answer === null ? null : { trust: "untrusted-worker-text", digest: digest(answer), quoted: JSON.stringify(answer.slice(0, SOURCE_LIMITS.answerChars)), clipped: answer.length > SOURCE_LIMITS.answerChars } } },
        undefined, (s, eventId) => {
          const current = s.sources.submissions.find(x => x.id === row.id);
          if (!eventId || !current || current.correlation) return [];
          return [{ kind: "board-submission", value: { ...current, state: certainty === "verified" ? "accepted" : current.state,
            correlation: { turnId: event.turnId ?? null, eventId, certainty }, version: current.version + 1 } }];
        });
      if (result.eventId) admitted.push(result.eventId);
    }
    return admitted;
  }
}

function closing(items: readonly { type: string; text?: string }[]): string | null {
  const tail: string[] = [];
  for (let i = items.length - 1; i >= 0 && items[i]!.type === "assistant_message"; i--) tail.unshift(items[i]!.text ?? "");
  return tail.length ? tail.join("") : null;
}

/** Explicit future attachment seam, like registerLocalSupervisionIngress. index.server does not call it. */
export function registerScopedBoardIngress(server: PluginLifecycleRegistration, board: ScopedBoardSteer) {
  return server.on("agent.turn_ended", (event, { paseo }) => board.turnEnded(event, paseo).then(() => {}));
}
