/** Strict observations alongside the board's deliberately lenient parser. Pure. */
import type { BacklogItem } from "../shared/fleet";
import type { DecisionSource } from "../shared/needs-you";
import type { RemoteSnapshot } from "../shared/remotes";
import { parseBacklog } from "./backlog";
import { resolveHost } from "./remote-cards";

export type HostCatalog = Pick<
  RemoteSnapshot,
  "localServerId" | "hosts"
> | null;
export interface NeedsYouDetection {
  valid: boolean;
  problems: string[];
  sources: DecisionSource[];
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
): NeedsYouDetection {
  const problems: string[] = [];
  const sources: DecisionSource[] = [];
  const keys = new Set<string>();
  for (const item of backlog) {
    const host = item.host?.trim()
      ? resolveHost(item.host, catalog)
      : { kind: "local" as const };
    if (host.kind === "unknown") {
      problems.push(`Unresolved or ambiguous host for task ${item.id}.`);
      continue;
    }
    const hostId = host.kind === "local" ? "local" : host.host.serverId;
    // Same scope as itemTagKey. Section, title, agent and file position are absent.
    const key = JSON.stringify([
      hostId === "local" ? ["local"] : ["remote", hostId],
      item.project ?? "",
      item.id,
    ]);
    if (keys.has(key)) problems.push(`Duplicate task identity: ${key}.`);
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
    valid: problems.length === 0,
    problems,
    sources: problems.length ? [] : sources,
  };
}

/**
 * Fail closed on uncertain structure. All three sections must be present, every
 * candidate row must parse, metadata must be unambiguous. Absence still cannot
 * resolve a known gate, even after repeated valid reads.
 */
export function observeNeedsYou(
  markdown: string,
  catalog: HostCatalog,
): NeedsYouDetection {
  const problems: string[] = [];
  const headings = new Set<string>();
  const items: BacklogItem[] = [];
  const tokens: Array<string | null> = [];
  let heading: string | null = null;
  let section: BacklogItem["section"] | null = null;
  // Comments may contain examples; reject them rather than disagreeing with the board parser.
  if (/<!--|-->|\x00/.test(markdown))
    problems.push("Unsupported comment or NUL in backlog.");
  for (const [index, line] of markdown
    .replace(/\r\n?/g, "\n")
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
        problems.push(`Unexpected content at line ${index + 1}.`);
      continue;
    }
    const row = /^\s*[-*]\s+\[([ xX~-])\]\s+([\w.-]{1,64})\s+[-–—]\s+\S/.exec(
      line,
    );
    const parsed = heading === null ? [] : parseBacklog(`${heading}\n${line}`);
    if (!row || parsed.length !== 1 || section === null) {
      problems.push(`Malformed backlog row at line ${index + 1}.`);
      continue;
    }
    if (section !== "done" && row[1] !== " ")
      problems.push(`Conflicting completion marker at line ${index + 1}.`);
    const metadata = /\(([a-zA-Z][\w-]*)\s*:\s*([^()]*)\)/g;
    const fields = new Map<string, string>();
    for (const match of line.matchAll(metadata)) {
      const name = match[1]!
        .toLowerCase()
        .replace(/^repo$/, "project")
        .replace(/^on-host$/, "host")
        .replace(/^crewmate$/, "agent");
      if (fields.has(name) && name !== "tags")
        problems.push(`Repeated metadata at line ${index + 1}.`);
      fields.set(name, match[2]!.trim());
    }
    const rest = line.replace(metadata, "");
    if (fields.get("host") === "" || fields.get("project") === "")
      problems.push(`Empty identity metadata at line ${index + 1}.`);
    if (
      /\([a-zA-Z][\w-]*\s*:/.test(rest) ||
      (rest.match(/\(/g)?.length ?? 0) !== (rest.match(/\)/g)?.length ?? 0)
    ) {
      problems.push(`Malformed metadata at line ${index + 1}.`);
    }
    // Bare blocked-by is supported by the board. Other bare fields are unsafe.
    if (/\b(?:hold|host|on-host|project|repo|kind|gate)\s*:/i.test(rest))
      problems.push(`Unparsed metadata at line ${index + 1}.`);
    if (
      /\bblocked-by\s*:/i.test(rest) &&
      (fields.has("blocked-by") ||
        !/\bblocked-by:\s*[\w.-]+/i.test(rest) ||
        (rest.match(/\bblocked-by\s*:/gi)?.length ?? 0) > 1)
    ) {
      problems.push(`Ambiguous blocker at line ${index + 1}.`);
    }
    items.push(parsed[0]!);
    tokens.push(fields.get("gate") || null);
  }
  if (headings.size !== 3)
    problems.push("Backlog must contain In flight, Queued and Done sections.");
  const detected = detectNeedsYou(items, catalog);
  problems.push(...detected.problems);
  return {
    valid: problems.length === 0,
    problems,
    sources: problems.length
      ? []
      : detected.sources.map((source, index) => ({
          ...source,
          gateToken: tokens[index] ?? null,
        })),
  };
}
