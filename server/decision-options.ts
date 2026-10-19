/** Current suggestions bound for display. Only the captain's explicit press can send one. */
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { Suggestion } from "../shared/fleet";
import { quarantinesSource, type DecisionAnswerOption, type NeedsYouSnapshot } from "../shared/needs-you";
import { parseSuggestions } from "./suggestions";
import { briefAnswerOptions, decisionBriefs } from "./decision-brief";

export function decisionAnswerOptions(snapshot: NeedsYouSnapshot, suggestions: readonly Suggestion[]): DecisionAnswerOption[] {
  if (!snapshot.homeId || snapshot.freshness.status !== "fresh") return [];
  const live = snapshot.requests.filter(r => r.state !== "resolved");
  const options: DecisionAnswerOption[] = [];
  for (const suggestion of suggestions) {
    const taskId = /^For ([\w.-]{1,64}):(?:\s|$)/.exec(suggestion.prompt)?.[1];
    const matches = suggestion.decision
      ? live.filter(r => suggestion.decision!.homeId === snapshot.homeId &&
          suggestion.decision!.requestId === r.id && suggestion.decision!.recordRevision === r.revision)
      : taskId ? live.filter(r => r.source.taskId === taskId) : [];
    // Task ids may repeat across projects/machines. Never guess at that ambiguity.
    if (matches.length !== 1 || (!suggestion.decision && snapshot.parked.some(s => s.taskId === taskId))) continue;
    if (!suggestion.decision && snapshot.quarantined?.some(row => row.hasHold && (row.taskId === null || row.taskId === taskId))) continue;
    const request = matches[0]!;
    if (!["new", "seen", "snoozed"].includes(request.state) ||
        quarantinesSource(snapshot.quarantined ?? [], request.source)) continue;
    const decision = suggestion.decision ?? {
      homeId: snapshot.homeId,
      requestId: request.id,
      recordRevision: request.revision,
      actionId: `task:${createHash("sha256").update(JSON.stringify([
        snapshot.homeId, request.id, request.revision, suggestion.label, suggestion.prompt,
      ])).digest("hex")}`,
    };
    options.push({ label: suggestion.label, prompt: suggestion.prompt, decision });
  }
  return options.filter(option => options.filter(other =>
    other.decision.requestId === option.decision.requestId &&
    other.decision.actionId === option.decision.actionId).length === 1);
}

export async function withDecisionOptions(home: string, snapshot: NeedsYouSnapshot): Promise<NeedsYouSnapshot> {
  let suggestions: Suggestion[] = [];
  if (snapshot.freshness.status === "fresh") {
    try { suggestions = parseSuggestions(await readFile(join(home, "data", "suggestions.md"), "utf8")); }
    catch { /* Optional context never changes the ledger's count or freshness. */ }
  }
  const context = { ...snapshot, briefs: await decisionBriefs(home, snapshot) };
  return { ...context, answerOptions: [...decisionAnswerOptions(context, suggestions), ...briefAnswerOptions(context)] };
}
