import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { parseDecisionBrief } from "../shared/decision-brief";
import {
  quarantinesSource,
  type NeedsYouSnapshot,
  type DecisionAnswerOption,
  type NeedsYouRequest,
} from "../shared/needs-you";
import { resolveInHome } from "./files";

/** Conventional task briefs are optional. Ambiguous task ids cannot select a home file. */
export async function decisionBriefs(home: string, snapshot: {
  requests: readonly Pick<NeedsYouRequest, "id" | "revision" | "source">[];
  parked: NeedsYouSnapshot["parked"];
}, budget = 512 * 1024) {
  const briefs: NonNullable<NeedsYouSnapshot["briefs"]> = [];
  let remaining = budget;
  for (const request of snapshot.requests) {
    const id = request.source.taskId;
    if (
      !/^[\w.-]{1,64}$/.test(id) ||
      id === "." ||
      id === ".." ||
      new Set(
        [...snapshot.requests.map((r) => r.source), ...snapshot.parked]
          .filter((source) => source.taskId === id)
          .map((source) => source.key),
      ).size !== 1
    )
      continue;
    const path = `data/${id}/decision.md`;
    try {
      const { absolute } = await resolveInHome(home, path);
      const info = await stat(absolute);
      if (!info.isFile() || info.size > Math.min(64 * 1024, remaining))
        continue;
      const content = await readFile(absolute, "utf8");
      const after = await stat(absolute);
      if (
        info.size !== after.size ||
        info.mtimeMs !== after.mtimeMs ||
        info.ctimeMs !== after.ctimeMs ||
        info.ino !== after.ino
      )
        continue;
      if (
        content.includes("\0") ||
        Buffer.byteLength(content) > Math.min(64 * 1024, remaining)
      )
        continue;
      remaining -= Buffer.byteLength(content);
      briefs.push({
        requestId: request.id,
        recordRevision: request.revision,
        path,
        content,
      });
    } catch {
      /* Missing, unreadable or outside the home: use the recorded question. */
    }
  }
  return briefs;
}

export function briefAnswerOptions(
  snapshot: NeedsYouSnapshot,
): DecisionAnswerOption[] {
  if (!snapshot.homeId || snapshot.freshness.status !== "fresh") return [];
  return (snapshot.briefs ?? []).flatMap((brief) => {
    const request = snapshot.requests.find(
      (r) => r.id === brief.requestId && r.revision === brief.recordRevision,
    );
    if (
      !request ||
      !["new", "seen", "snoozed"].includes(request.state) ||
      quarantinesSource(snapshot.quarantined ?? [], request.source)
    )
      return [];
    return parseDecisionBrief(brief.content)
      .options.map((option) => ({
        label: option.label,
        prompt: `For ${request.source.taskId}: I choose option ${option.number}.\n\n${option.body}`,
        decision: {
          homeId: snapshot.homeId!,
          requestId: request.id,
          recordRevision: request.revision,
          actionId: `brief:${createHash("sha256")
            .update(
              JSON.stringify([
                snapshot.homeId,
                request.id,
                request.revision,
                brief.path,
                brief.content,
                option.number,
              ]),
            )
            .digest("hex")}`,
        },
      }))
      .filter((option) => option.prompt.length <= 32000);
  });
}
