/** Read-only CLI: node --experimental-strip-types server/attention-report.ts <attention.jsonl> */
import { readFile, readdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { AttentionEvent } from "../shared/attention.ts";

const KINDS = new Set(["start", "gap", "permission-requested", "permission-resolved", "worker-ended", "lead-started", "lead-ended", "action", "remote-status", "state-enter", "state-exit"]);
const STATES = ["ready", "dependencies-met", "hold", "queued", "followed", "permission", "failure"] as const;
type Bounds = { minMs: number | null; maxMs: number | null; observedMs: number };
const key = (event: AttentionEvent) => `${event.subject}:${event.request}`;
const duration = (start: AttentionEvent, end: AttentionEvent): Bounds => ({
  // Sampled appearance/disappearance are intervals, not remote wall-clock event timestamps.
  minMs: start.baseline ? null : Math.max(0, (end.since ?? end.at) - start.at),
  maxMs: start.baseline ? null : end.at - (start.since ?? start.at),
  observedMs: end.at - start.at,
});
function summary(values: number[]) {
  values.sort((a, b) => a - b);
  const percentile = (fraction: number) => values.length ? values[Math.max(0, Math.ceil(values.length * fraction) - 1)]! : null;
  return { count: values.length, medianMs: percentile(0.5), p95Ms: percentile(0.95), maxMs: values.at(-1) ?? null };
}

/** Malformed/partial lines and clock regressions split pairing; never silently stitch through data loss. */
export function parseAttentionLog(text: string) {
  const events: AttentionEvent[] = [];
  const invalidLines: number[] = [];
  let last: AttentionEvent | null = null;
  let boundary = 0;
  for (const [index, line] of text.replace(/^\uFEFF/, "").split(/\r?\n/).entries()) {
    if (!line.trim()) continue;
    try {
      const event = JSON.parse(line) as AttentionEvent;
      if (!event || event.version !== 1 || !KINDS.has(event.kind) || typeof event.run !== "string" ||
        typeof event.id !== "string" || typeof event.lead !== "string" || !Number.isFinite(event.at) ||
        !["hook", "fleet", "catalog", "observer", "receipt"].includes(event.source) ||
        (event.since != null && (!Number.isFinite(event.since) || event.since > event.at)) ||
        (event.actionSince != null && (!Number.isFinite(event.actionSince) || event.actionSince > event.at)) ||
        (["permission-requested", "permission-resolved"].includes(event.kind) && (typeof event.subject !== "string" || typeof event.request !== "string")) ||
        (["state-enter", "state-exit"].includes(event.kind) && (!event.state || !STATES.includes(event.state) || typeof event.subject !== "string")) ||
        (["worker-ended", "lead-ended"].includes(event.kind) && !["completed", "failed", "canceled"].includes(event.outcome ?? "")) ||
        (event.kind === "action" && (typeof event.subject !== "string" || typeof event.call !== "string"))) throw Error();
      if (last && event.at < last.at) { invalidLines.push(index + 1); boundary++; }
      last = event;
      events.push({ ...event, run: `${event.run}:${boundary}` });
    } catch { invalidLines.push(index + 1); boundary++; }
  }
  return { events, invalidLines };
}

/** Consume the helper's existing metadata receipts; never execute or collect remote work again. */
export function remoteReceiptActions(events: readonly AttentionEvent[], receipts: readonly unknown[]) {
  const hash = (...parts: string[]) => createHash("sha256").update(JSON.stringify(parts)).digest("hex");
  const valid = receipts.filter((value): value is Record<string, unknown> => {
    if (!value || typeof value !== "object") return false;
    const row = value as Record<string, unknown>;
    return row.version === 1 && ["started", "succeeded", "failed", "uncertain"].includes(String(row.phase)) &&
      ["steer", "archive", "stop", "dispatch", "answer-permission"].includes(String(row.action)) &&
      ["actorId", "targetId", "serverId"].every(field => row[field] === null || typeof row[field] === "string") &&
      ["requestId", "at"].every(field => typeof row[field] === "string") && Number.isFinite(Date.parse(row.at as string));
  });
  const actions: AttentionEvent[] = [];
  let unpaired = valid.filter(row => row.phase === "started" && !valid.some(other => other.requestId === row.requestId && other.phase !== "started")).length;
  for (const receipt of valid.filter(row => row.phase === "succeeded")) {
    const at = Date.parse(receipt.at as string);
    let previous: AttentionEvent | undefined;
    for (let index = events.length - 1; index >= 0; index--) if (events[index]!.at <= at) { previous = events[index]; break; }
    if (!previous || at > (events.at(-1)?.at ?? -Infinity) || ["dispatch", "answer-permission"].includes(String(receipt.action)) ||
      ["actorId", "targetId", "serverId"].some(field => typeof receipt[field] !== "string" || !receipt[field])) { unpaired++; continue; }
    const starts = valid.filter(row => row.phase === "started" && row.requestId === receipt.requestId && row.actorId === receipt.actorId &&
      row.serverId === receipt.serverId && row.targetId === receipt.targetId && row.action === receipt.action);
    const startedAt = starts.length === 1 ? Date.parse(starts[0]!.at as string) : null;
    if (startedAt === null || startedAt > at) { unpaired++; continue; }
    actions.push({ version: 1, run: previous.run, id: hash("remote-receipt", receipt.requestId as string), at, kind: "action", source: "receipt",
      lead: hash(receipt.actorId as string), subject: hash("worker", receipt.serverId as string, receipt.targetId as string),
      call: hash(receipt.requestId as string), tool: `remote-${receipt.action}`, actionSince: startedAt });
  }
  return { actions, invalid: receipts.length - valid.length, unpaired,
    failed: valid.filter(row => row.phase === "failed").length, uncertain: valid.filter(row => row.phase === "uncertain").length };
}

async function readRemoteReceipts(directory: string) {
  try {
    const files = (await readdir(directory)).filter(file => /^[a-f0-9-]{36}\.(started|succeeded|failed|uncertain)\.json$/.test(file));
    const receipts: unknown[] = [];
    for (const file of files) {
      try { receipts.push(JSON.parse(await readFile(join(directory, file), "utf8"))); }
      catch { receipts.push(null); }
    }
    return { receipts, available: true };
  } catch { return { receipts: [], available: false }; }
}

export function attentionReport(events: readonly AttentionEvent[], invalidLines: number[] = []) {
  const permissionPairs: Array<{ request: string; source: string; opened: string; closed: string; latency: Bounds; clockSkewSeconds: number | null }> = [];
  const unpaired: Array<{ event: string; kind: string; reason: string }> = [];
  const leadTurns: Array<{ start: string | null; end: string; outcome: string; durationMs: number | null; associatedEvent: string | null }> = [];
  const incidents: Array<{ event: string; category: string; source: string; baseline: boolean; nextLeadTurnMs: number | null;
    action: string | null; actionSource: string | null; actionLatency: Bounds | null; residenceMs: number | null }> = [];
  const actions: AttentionEvent[] = [];
  const starts: AttentionEvent[] = [];
  const permissions = new Map<string, AttentionEvent>();
  const turns = new Map<string, AttentionEvent>();
  const states = new Map<string, AttentionEvent>();
  const ends = new Map<string, AttentionEvent>();
  let segment = "";
  let segmentIncidents: AttentionEvent[] = [];
  let gapCount = 0;
  const gaps: Array<{ event: string; reason: string }> = [];
  const flush = () => {
    for (const event of segmentIncidents) {
      const next = starts.find(start => start.lead === event.lead && start.at >= event.at);
      // A hook timeline has no trustworthy per-call clock. Only turns starting AFTER the incident
      // give an unambiguous temporal order; overlapping turns remain unpaired.
      const action = actions.find(candidate => candidate.subject === event.subject && candidate.lead === event.lead &&
        candidate.actionSince != null && candidate.actionSince >= event.at &&
        (!ends.has(event.id) || candidate.at <= ends.get(event.id)!.at));
      const category = event.kind === "state-enter" ? event.state! : event.kind === "worker-ended" ? `worker-${event.outcome}` :
        event.kind === "remote-status" ? `remote-${event.status}` : "permission";
      incidents.push({ event: event.id, category, source: event.source, baseline: event.baseline ?? false,
        nextLeadTurnMs: next ? next.at - event.at : null, action: action?.id ?? null, actionSource: action?.source ?? null,
        actionLatency: action ? { minMs: event.baseline ? null : action.actionSince! - event.at,
          maxMs: event.baseline ? null : action.at - (event.since ?? event.at), observedMs: action.at - event.at } : null,
        residenceMs: ends.has(event.id) ? ends.get(event.id)!.at - event.at : null });
      if (!action) unpaired.push({ event: event.id, kind: "action", reason: "no-unambiguous-targeted-lead-action" });
    }
    for (const event of permissions.values()) unpaired.push({ event: event.id, kind: event.kind, reason: "no-resolution-in-continuous-observation" });
    for (const event of turns.values()) unpaired.push({ event: event.id, kind: event.kind, reason: "no-end-in-continuous-observation" });
    for (const event of states.values()) unpaired.push({ event: event.id, kind: event.kind, reason: "no-exit-in-continuous-observation" });
    permissions.clear(); turns.clear(); states.clear(); ends.clear();
    segmentIncidents = []; actions.length = 0; starts.length = 0;
  };
  const seen = new Set<string>();
  for (const event of events) {
    if (seen.has(event.id)) continue;
    seen.add(event.id);
    if (event.run !== segment || event.kind === "start" || event.kind === "gap") {
      flush(); segment = event.run;
      if (event.kind === "gap") { gapCount++; gaps.push({ event: event.id, reason: event.reason ?? "unknown" }); }
    }
    if (event.kind === "permission-requested" && event.subject && event.request) {
      const previous = permissions.get(key(event));
      if (previous) unpaired.push({ event: previous.id, kind: previous.kind, reason: "duplicate-request" });
      permissions.set(key(event), event); segmentIncidents.push(event);
    } else if (event.kind === "permission-resolved") {
      const start = permissions.get(key(event));
      if (start && event.at >= start.at) {
        permissionPairs.push({ request: event.request!, source: event.source, opened: start.id, closed: event.id,
          latency: duration(start, event), clockSkewSeconds: event.clockSkewSeconds ?? null });
        ends.set(start.id, event);
        permissions.delete(key(event));
      } else unpaired.push({ event: event.id, kind: event.kind, reason: "no-request-in-continuous-observation" });
    } else if (event.kind === "lead-started") {
      starts.push(event);
      // Null turn IDs cannot safely pair two separate turns.
      if (event.turn) turns.set(event.turn, event);
      else unpaired.push({ event: event.id, kind: event.kind, reason: "missing-turn-id" });
    } else if (event.kind === "lead-ended") {
      const start = event.turn ? turns.get(event.turn) : undefined;
      leadTurns.push({ start: start?.id ?? null, end: event.id, outcome: event.outcome ?? "unknown",
        durationMs: start ? event.at - start.at : null, associatedEvent: event.associatedEvent ?? null });
      if (!start) unpaired.push({ event: event.id, kind: event.kind, reason: "no-start-in-continuous-observation" });
      if (event.turn) turns.delete(event.turn);
    } else if (event.kind === "action") actions.push(event);
    else if (event.kind === "state-enter" && event.state && event.subject) {
      states.set(`${event.subject}:${event.state}`, event); segmentIncidents.push(event);
    } else if (event.kind === "state-exit") {
      const stateKey = `${event.subject}:${event.state}`, start = states.get(stateKey);
      if (start) { ends.set(start.id, event); states.delete(stateKey); }
      else unpaired.push({ event: event.id, kind: event.kind, reason: "no-entry-in-continuous-observation" });
    } else if (event.kind === "worker-ended" || event.kind === "remote-status") segmentIncidents.push(event);
  }
  flush();
  const categories = [...new Set([...STATES, ...incidents.map(incident => incident.category)])];
  const byCategory = categories.map(category => {
    const rows = incidents.filter(incident => incident.category === category);
    return { category, observed: rows.length, baseline: rows.filter(row => row.baseline).length,
      sources: Object.fromEntries(["hook", "fleet", "catalog"].map(source => [source, rows.filter(row => row.source === source).length])),
      pairedActions: rows.filter(row => row.action !== null).length, unpairedActions: rows.filter(row => row.action === null).length,
      // Summaries are explicitly upper bounds; baseline and unmatched events do not enter them as zeros.
      actionUpperBound: summary(rows.flatMap(row => row.actionLatency?.maxMs != null ? [row.actionLatency.maxMs] : [])),
      nextLeadTurnAssociation: summary(rows.flatMap(row => row.nextLeadTurnMs !== null ? [row.nextLeadTurnMs] : [])) };
  }).sort((a, b) => (b.actionUpperBound.p95Ms ?? -1) - (a.actionUpperBound.p95Ms ?? -1));
  return { version: 1, observation: { from: events[0]?.at ?? null, to: events.at(-1)?.at ?? null,
    targetDays: 14, events: seen.size, gapCount, invalidLines }, byCategory,
    permissions: { pairs: permissionPairs, exactWait: summary(permissionPairs.filter(pair => pair.source === "hook").map(pair => pair.latency.observedMs)) },
    leadTurns, incidents, unpaired, gaps,
    limitations: ["Hook timestamps are local receipt times. Native notification delivery is not observable.",
      "Next lead turn and nearest event before cancellation are associations, never causes or proof of action.",
      "Action bounds require an explicitly successful targeted tool in a later lead turn or paired remote helper receipts; they do not prove the state was resolved.",
      "Shell, verbal and file-only actions are not attributed; inspect existing collector evidence for these unpaired events. Remote actions require paired helper receipts with matching actor and target.",
      "Polled baselines are left-censored; intermediate states may be missed. Poll bounds use local clocks, not remote updatedAt.",
      "Fleet samples are non-atomic. Dependencies are recognized only for a unique same-host/project task ID marked Done.",
      "State exits are observed changes, not proof the lead acted. Missing matches and baseline durations never enter action latency statistics as zero."] };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const file = process.argv[2];
  if (!file || process.argv.length !== 3) { console.error("Usage: node --experimental-strip-types server/attention-report.ts <attention.jsonl>"); process.exitCode = 1; }
  else {
    try {
      const parsed = parseAttentionLog(await readFile(file, "utf8"));
      const remote = await readRemoteReceipts(resolve(dirname(file), "..", "remote-action-receipts"));
      const imported = remoteReceiptActions(parsed.events, remote.receipts);
      const events = parsed.invalidLines.length ? parsed.events : [...parsed.events, ...imported.actions].sort((a, b) => a.at - b.at);
      console.log(JSON.stringify({ ...attentionReport(events, parsed.invalidLines), remoteReceipts: {
        available: remote.available, actions: parsed.invalidLines.length ? 0 : imported.actions.length,
        refusedBecauseLogIncomplete: parsed.invalidLines.length > 0,
        invalid: imported.invalid, unpaired: imported.unpaired, failed: imported.failed, uncertain: imported.uncertain,
      } }, null, 2));
    }
    catch { console.error("Could not read the attention log."); process.exitCode = 1; }
  }
}
