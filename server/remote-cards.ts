/**
 * Work on remote hosts, as cards in the board's columns. Pure.
 *
 * The plugin polls each saved host about once a minute (`server/remotes.ts`) and keeps what it saw —
 * every worker this first mate owns there, its status, pending permissions and the end of its text
 * log — in the remote snapshot. A backlog line names its host with `(host: …)` or `(on-host: …)`, in
 * whatever form the first mate wrote: a serverId, a label, or "Label serverId". Each such line is
 * joined to its worker on that host by the agent id it records or by the worker's `firstmate.task`;
 * whatever is left on either side is a card of its own, as with the local crew. Cards are keyed by
 * host, so the same task id on two hosts, or here and on a host, never collides.
 *
 * The snapshot can also hold the captain's own sessions the first mate follows (`followed`); they
 * are drawn like workers, marked as followed, and join a backlog line only by its agent id.
 */
import type { BacklogItem, ColumnId, CrewReportSummary, FleetCard, RemoteCard } from "../shared/fleet";
import type { RemoteHost, RemoteSnapshot, RemoteWorker } from "../shared/remotes";
import { parseCrewReport, reportUrl } from "./crew-report";
import { backlogPlacement, crewPlacement, type Placement } from "./fleet";

export type HostMatch = { kind: "local" } | { kind: "remote"; host: RemoteHost } | { kind: "unknown" };

const norm = (value: string) => value.trim().toLowerCase();
const words = (value: string) => norm(value).split(/[\s,;()[\]"'`|/]+/).filter((word) => word !== "");

/**
 * Which host a backlog line's host value names. Exact serverId, then exact label, then a serverId
 * among its words ("Light srv_abc"), then a label among its words — each only when exactly one host
 * matches, so an ambiguous value is never guessed. This machine's own serverId is local work.
 */
export function resolveHost(value: string, snapshot: Pick<RemoteSnapshot, "localServerId" | "hosts"> | null): HostMatch {
  const wanted = norm(value);
  if (wanted === "" || snapshot === null) return { kind: "unknown" };
  const local = norm(snapshot.localServerId);
  if (local !== "" && wanted === local) return { kind: "local" };
  const only = (hosts: RemoteHost[]): HostMatch | null => (hosts.length === 1 ? { kind: "remote", host: hosts[0]! } : null);
  const exact =
    only(snapshot.hosts.filter((host) => norm(host.serverId) === wanted)) ??
    only(snapshot.hosts.filter((host) => norm(host.label) === wanted));
  if (exact !== null) return exact;
  const tokens = words(value);
  if (local !== "" && tokens.includes(local)) return { kind: "local" };
  const phrase = ` ${tokens.join(" ")} `;
  return (
    only(snapshot.hosts.filter((host) => tokens.includes(norm(host.serverId)))) ??
    only(snapshot.hosts.filter((host) => words(host.label).length > 0 && phrase.includes(` ${words(host.label).join(" ")} `))) ?? {
      kind: "unknown",
    }
  );
}

/**
 * The worker's status line, from the text log the poll keeps (`paseo logs --filter text`). Assistant
 * text is printed bare and the captain's or the first mate's words as `[User] …`, reasoning as
 * `[Thought] …`, each entry a paragraph — so only what follows the last of those is the worker's own
 * closing message, and a status word in a prompt is never taken for a report.
 */
export function remoteReport(output: string): CrewReportSummary | null {
  let text = output;
  // An older poll could keep the log JSON-quoted.
  if (/^\s*"/.test(text)) {
    try {
      const parsed: unknown = JSON.parse(text);
      if (typeof parsed === "string") text = parsed;
    } catch {
      /* Kept as written. */
    }
  }
  const blocks = text.replace(/\r\n?/g, "\n").split(/\n{2,}/);
  const closing: string[] = [];
  for (let index = blocks.length - 1; index >= 0; index -= 1) {
    const block = blocks[index] ?? "";
    if (/^\s*\[(?:User|Thought)\]/.test(block)) break;
    closing.unshift(block);
  }
  return parseCrewReport(closing.join("\n\n"));
}

/**
 * The worker's status line: from its last message alone where the poll keeps one (`lastMessage`),
 * otherwise from the log tail.
 */
export function workerReport(worker: RemoteWorker): CrewReportSummary | null {
  return worker.lastMessage === undefined ? remoteReport(worker.output) : parseCrewReport(worker.lastMessage);
}

/** How many permissions the worker waits on: the count, or the detailed list where it is longer. */
function pendingCount(worker: RemoteWorker): number {
  return Math.max(worker.permissions, worker.pendingPermissions?.length ?? 0);
}

/** Where a remote worker belongs: the same rules as a local crewmate (`crewPlacement`). */
export function remotePlacement(worker: RemoteWorker, report: CrewReportSummary | null): Placement {
  return crewPlacement({ pendingPermissions: pendingCount(worker), status: worker.status }, report);
}

export function remoteColumn(worker: RemoteWorker, report: CrewReportSummary | null): ColumnId {
  return remotePlacement(worker, report).column;
}

/** Whether a backlog line's recorded agent id names this worker: the whole id, or a prefix of 7 or more, as `paseo` accepts. */
function namesWorker(agentId: string | null, worker: RemoteWorker): boolean {
  if (agentId === null) return false;
  const id = agentId.trim();
  return id === worker.id || (id.length >= 7 && worker.id.startsWith(id));
}

function remoteOf(host: RemoteHost, worker: RemoteWorker | null): RemoteCard {
  return {
    serverId: host.serverId,
    host: host.label,
    online: host.online,
    clockSkewSeconds: host.clockSkew?.seconds ?? null,
    worker:
      worker === null
        ? null
        : {
            id: worker.id,
            name: worker.name,
            status: worker.status,
            updatedAt: worker.updatedAt,
            pendingPermissions: pendingCount(worker),
            permissionDetails: (worker.pendingPermissions ?? []).map((permission) => ({ ...permission })),
            recentTools: pendingCount(worker) > 0 ? [...(worker.recentTools ?? [])] : [],
            followed: worker.followed === true,
          },
  };
}

function itemCard(key: string, item: BacklogItem, remote: RemoteCard): FleetCard {
  return {
    key,
    ...backlogPlacement(item),
    taskId: item.id,
    title: item.title,
    project: item.project,
    kind: item.kind,
    backlog: item,
    agent: null,
    report: null,
    url: item.url,
    remote,
  };
}

/**
 * Cards for the backlog lines that name a host other than this one, and for every worker the
 * snapshot has on a saved host. `items` are lines with a `host`; lines naming this machine's own
 * serverId are the caller's to treat as local.
 */
export function buildRemoteCards(items: readonly BacklogItem[], snapshot: RemoteSnapshot | null): FleetCard[] {
  const cards: FleetCard[] = [];
  const byHost = new Map<string, Array<{ item: BacklogItem; index: number }>>();
  items.forEach((item, index) => {
    const match = resolveHost(item.host ?? "", snapshot);
    if (match.kind === "remote") {
      byHost.set(match.host.serverId, [...(byHost.get(match.host.serverId) ?? []), { item, index }]);
    } else if (match.kind === "unknown") {
      const host = (item.host ?? "").trim();
      cards.push(
        itemCard(`remote:?${norm(host)}:backlog:${item.section}:${item.id}:${index}`, item, {
          serverId: null,
          host,
          online: false,
          clockSkewSeconds: null,
          worker: null,
        }),
      );
    }
  });

  for (const host of snapshot?.hosts ?? []) {
    const lines = byHost.get(host.serverId) ?? [];
    const claimed = new Set<number>();
    const workers = [...host.workers].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    for (const worker of workers) {
      const found = lines.find(
        ({ item }, position) =>
          !claimed.has(position) &&
          item.section !== "done" &&
          (namesWorker(item.agentId, worker) || (worker.followed !== true && worker.task !== undefined && item.id === worker.task)),
      );
      const item = found?.item ?? null;
      if (found !== undefined) claimed.add(lines.indexOf(found));
      const report = workerReport(worker);
      cards.push({
        key: `remote:${host.serverId}:agent:${worker.id}`,
        ...remotePlacement(worker, report),
        taskId: worker.task ?? item?.id ?? null,
        title: item?.title ?? (worker.name === "-" ? null : worker.name) ?? worker.task ?? "Untitled worker",
        project: item?.project ?? null,
        kind: item?.kind ?? null,
        backlog: item,
        agent: null,
        report,
        url: (report === null ? null : reportUrl(report.text)) ?? item?.url ?? null,
        remote: remoteOf(host, worker),
      });
    }
    lines.forEach(({ item, index }, position) => {
      if (claimed.has(position)) return;
      cards.push(itemCard(`remote:${host.serverId}:backlog:${item.section}:${item.id}:${index}`, item, remoteOf(host, null)));
    });
  }
  return cards;
}

/**
 * The tasks on `host` worth one label-filtered lookup: unfinished backlog lines naming it whose
 * worker is not known by the agent id they record or by a task already learned.
 */
export function remoteTaskQueries(backlog: readonly BacklogItem[], host: RemoteHost, localServerId = ""): string[] {
  const snapshot = { localServerId, hosts: [host] };
  return backlog
    .filter((item) => item.host !== undefined && item.section !== "done")
    .filter((item) => {
      const match = resolveHost(item.host ?? "", snapshot);
      return match.kind === "remote";
    })
    .filter(
      (item) => !host.workers.some((worker) => worker.task === item.id || namesWorker(item.agentId, worker)),
    )
    .map((item) => item.id);
}
