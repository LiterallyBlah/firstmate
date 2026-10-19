/** Strict observations alongside the board's deliberately lenient parser. Pure. */
import type { BacklogItem } from "../shared/fleet";
import { quarantinesSource, type QuarantinedTask, type DecisionSource } from "../shared/needs-you";
import type { RemoteSnapshot } from "../shared/remotes";
import { parseBacklog } from "./backlog";
import { resolveHost } from "./remote-cards";

export type HostCatalog = Pick<
  RemoteSnapshot,
  "localServerId" | "localLabel" | "hosts"
> | null;
export interface NeedsYouDetection {
  valid: boolean;
  problems: string[];
  sources: DecisionSource[];
  quarantined?: QuarantinedTask[];
}

export const normalizeAsk = (text: string) =>
  text
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase()
    .replace(/[.!?]+$/, "");

/** No worker, column, permission, suggestion or report is an input to this rule. */
export function decisionDisposition(
  item: BacklogItem,
): DecisionSource["disposition"] {
  if (item.section === "done") return "done";
  if (item.hold?.trim()) return item.blockedBy?.trim() ? "parked" : "open";
  return item.kind === "captain" ? "parked" : "in-hand";
}

export function detectNeedsYou(
  backlog: readonly BacklogItem[],
  catalog: HostCatalog,
  lineNumbers: readonly number[] = [],
): NeedsYouDetection {
  const problems: string[] = [];
  const sources: DecisionSource[] = [];
  const keys = new Set<string>();
  const quarantined: QuarantinedTask[] = [];
  let valid = true;
  for (const [index, item] of backlog.entries()) {
    const location = lineNumbers[index] ? ` at line ${lineNumbers[index]}` : "";
    const host = item.host?.trim()
      ? resolveHost(item.host, catalog)
      : { kind: "local" as const };
    if (host.kind === "unknown") {
      const key = JSON.stringify(["unresolved", item.host?.trim().toLowerCase(), item.project, item.id]);
      if (keys.has(key)) {
        problems.push(`Duplicate task identity${location}: ${item.id}.`);
        valid = false;
      }
      keys.add(key);
      const problem = `Task ${item.id}: host is unknown or matches more than one machine.`;
      problems.push(problem);
      quarantined.push({ line: 0, taskId: item.id, key: null, hasHold: !!item.hold?.trim(), problem });
      continue;
    }
    const hostId = host.kind === "local" ? "local" : host.host.serverId;
    // Same scope as itemTagKey. Section, title, agent and file position are absent.
    const key = JSON.stringify([
      hostId === "local" ? ["local"] : ["remote", hostId],
      item.project ?? "",
      item.id,
    ]);
    if (keys.has(key)) {
      problems.push(`Duplicate task identity${location}: ${item.id}.`);
      valid = false;
    }
    keys.add(key);
    sources.push({
      key,
      taskId: item.id,
      hostId,
      project: item.project,
      title: item.title,
      ask: item.hold?.trim() ?? "",
      url: item.url,
      reportPath: item.reportPath,
      gateToken: null,
      section: item.section,
      disposition: decisionDisposition(item),
      blockedBy: item.blockedBy?.trim() || null,
    });
  }
  return {
    valid,
    problems,
    sources: valid ? sources.filter(source => !quarantinesSource(quarantined, source)) : [],
    ...(quarantined.length ? { quarantined } : {}),
  };
}

/**
 * Fail closed on uncertain structure. All three sections must be present;
 * unreadable rows are quarantined separately. Absence still cannot
 * resolve a known gate, even after repeated valid reads.
 */
export function observeNeedsYou(
  markdown: string,
  catalog: HostCatalog,
): NeedsYouDetection {
  const problems: string[] = [];
  const headings = new Set<string>();
  const items: BacklogItem[] = [];
  const tokens = new Map<string, string | null>();
  const context = new Map<string, Pick<DecisionSource, "specPath" | "notesPath">>();
  const quarantined: QuarantinedTask[] = [];
  const identities: BacklogItem[] = [];
  const identityLines: number[] = [];
  function quarantine(line: string, number: number, reasons: string[], key: string | null = null) {
    const taskId = /^\s*[-*+]\s+\[[^\]]*\]\s+([\w.-]{1,64})(?=\s|$)/.exec(line)?.[1] ?? null;
    const problem = `Line ${number}${taskId ? `, task ${taskId}` : ""}: ${reasons.join(" ")}`;
    problems.push(problem);
    quarantined.push({ line: number, taskId, key, hasHold: /\(\s*hold\b|\bhold\s*:/i.test(line), problem });
  }
  let heading: string | null = null;
  let section: BacklogItem["section"] | null = null;
  // Comments may contain examples; reject them rather than disagreeing with the board parser.
  if (/<!--|-->|\x00/.test(markdown))
    problems.push("Unsupported comment or NUL in backlog.");
  for (const [index, line] of markdown
    .replace(/\r\n/g, "\n")
    .split("\n")
    .entries()) {
    const title = /^#{2,}\s+(.*)$/.exec(line);
    if (title) {
      heading = line;
      section =
        parseBacklog(`${line}\n- [ ] probe - Probe`)[0]?.section ?? null;
      if (section === null || headings.has(section))
        problems.push(`Unknown or repeated section at line ${index + 1}.`);
      if (section !== null) headings.add(section);
      continue;
    }
    const candidate = /^\s*[-*+]|^\s*\[/.test(line);
    if (!candidate) {
      if (section !== null && line.trim() !== "")
        quarantine(line, index + 1, ["Unexpected text; could not read this task."]);
      continue;
    }
    const row = /^\s*[-*]\s+\[([ xX~-])\]\s+([\w.-]{1,64})\s+[-–—]\s+\S/.exec(
      line,
    );
    const parsed = heading === null ? [] : parseBacklog(`${heading}\n${line}`);
    // Inventory a recoverable identity even when its checkbox or title is broken.
    // This probe is never a decision source; it can only reject a duplicate.
    const identityRow = /^\s*[-*+]\s+\[[^\]]*\]\s+([\w.-]{1,64})(?=\s|$)/.exec(line);
    const identityItem = heading !== null && identityRow
      ? parseBacklog(`${heading}\n${line.replace(/^\s*[-*+]\s+\[[^\]]*\]\s+/, "- [ ] ")}`)[0]
      : undefined;
    if (identityItem && identityItem.id === identityRow?.[1]) {
      identities.push(identityItem);
      identityLines.push(index + 1);
    }
    if (!row || parsed.length !== 1 || section === null) {
      quarantine(line, index + 1, ["Could not read the task checkbox, id or title."]);
      continue;
    }
    const rowProblems: string[] = [];
    if (line.includes("\r")) rowProblems.push("Unexpected carriage return inside the task.");
    if (section !== "done" && row[1] !== " ")
      rowProblems.push("Checked task is outside Done.");
    const metadata = /\(([a-zA-Z][\w-]*)\s*:\s*([^()]*)\)/g;
    const fields = new Map<string, string>();
    let identityUncertain = false;
    for (const match of line.matchAll(metadata)) {
      const name = match[1]!
        .toLowerCase()
        .replace(/^repo$/, "project")
        .replace(/^on-host$/, "host")
        .replace(/^crewmate$/, "agent");
      if (fields.has(name) && name !== "tags") {
        rowProblems.push("Repeated metadata field.");
        if (name === "host" || name === "project") identityUncertain = true;
      }
      fields.set(name, match[2]!.trim());
    }
    const rest = line.replace(metadata, "");
    if (fields.get("host") === "" || fields.get("project") === "")
      rowProblems.push("Host or project is empty.");
    if (
      /\([a-zA-Z][\w-]*\s*:/.test(rest) ||
      (rest.match(/\(/g)?.length ?? 0) !== (rest.match(/\)/g)?.length ?? 0)
    ) {
      rowProblems.push("Could not read metadata; check parentheses.");
    }
    // Bare blocked-by is supported by the board. Other bare fields are unsafe.
    if (/\b(?:hold|host|on-host|project|repo|kind|gate)\s*:/i.test(rest))
      rowProblems.push("Metadata must be inside parentheses.");
    if (
      /\bblocked-by\s*:/i.test(rest) &&
      (fields.has("blocked-by") ||
        !/\bblocked-by:\s*[\w.-]+/i.test(rest) ||
        (rest.match(/\bblocked-by\s*:/gi)?.length ?? 0) > 1)
    ) {
      rowProblems.push("Could not read the task dependency.");
    }
    if (rowProblems.length) {
      const identity = detectNeedsYou(parsed, catalog).sources[0];
      const trusted = !identityUncertain && fields.get("host") !== "" && fields.get("project") !== "" &&
        !/\b(?:host|on-host|project|repo)\s*:/i.test(rest);
      quarantine(line, index + 1, rowProblems, trusted ? identity?.key ?? null : null);
      continue;
    }
    const detected = detectNeedsYou(parsed, catalog);
    if (detected.quarantined?.length) {
      quarantine(line, index + 1, ["Host is unknown or matches more than one machine."]);
      continue;
    }
    const key = detected.sources[0]!.key;
    items.push(parsed[0]!);
    tokens.set(key, fields.get("gate") || null);
    context.set(key, { specPath: fields.get("spec") || null, notesPath: fields.get("notes") || null });
  }
  if (headings.size !== 3)
    problems.push("Backlog must contain In flight, Queued and Done sections.");
  const detected = detectNeedsYou(items, catalog);
  // Check identities even on rows whose non-identity metadata is malformed.
  const duplicates = detectNeedsYou(identities, catalog, identityLines);
  if (!duplicates.valid) problems.push(...duplicates.problems.filter(p => p.startsWith("Duplicate")));
  const structural = problems.filter(p => !quarantined.some(row => row.problem === p));
  return {
    valid: structural.length === 0,
    problems,
    quarantined,
    sources: structural.length ? [] : detected.sources
      .filter(source => !quarantinesSource(quarantined.filter(row => row.taskId !== null), source))
      .map(source => ({ ...source, ...context.get(source.key), gateToken: tokens.get(source.key) ?? null })),
  };
}
