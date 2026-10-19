/** A durable reservation precedes the existing lifecycle-guarded mate send. Never retries delivery. */
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type {
  SubmitDecisionAnswer,
  NeedsYouSnapshot,
} from "../shared/needs-you";
import type { PaseoApi } from "./host-types";
import { askMate } from "./mate";
import {
  readConfiguredDecisionHome,
  type NeedsYouService,
} from "./needs-you-service";
import { parseSuggestions } from "./suggestions";
import { message, TEMPLATES } from "./templates";
import { serialized } from "./serialize";

export async function answerDecision(
  paseo: PaseoApi,
  service: NeedsYouService,
  input: SubmitDecisionAnswer,
) {
  return serialized("firstmate.needs-you.answer", async () => {
    const target = {
      homeId: input.homeId,
      id: input.requestId,
      revision: input.recordRevision,
    };
    const hash = createHash("sha256")
      .update(JSON.stringify([target, input.text, input.suggestion ?? null]))
      .digest("hex");
    let snapshot = await service.read();
    if (snapshot.homeId !== input.homeId)
      throw new Error("The FirstMate home changed. Refresh the decision.");
    const prior = snapshot.requests
      .flatMap((request) =>
        request.submissions.map((submission) => ({ request, submission })),
      )
      .find(({ submission }) => submission.submissionId === input.submissionId);
    if (prior) {
      if (
        prior.request.id !== input.requestId ||
        prior.submission.revision !== input.recordRevision ||
        prior.submission.messageHash !== hash
      )
        throw new Error("This submission id belongs to another answer.");
      return { outcome: prior.submission.outcome, snapshot };
    }
    let reserved = false;
    const outgoing = {
      text: "",
      messageId: `firstmate-answer-${input.submissionId}`,
    };
    try {
      await askMate(paseo, outgoing, async () => {
        // askMate holds the same lifecycle lock as config/home/role changes here.
        snapshot = await service.read();
        const request = snapshot.requests.find(
          (entry) => entry.id === input.requestId,
        );
        if (
          snapshot.homeId !== input.homeId ||
          snapshot.freshness.status !== "fresh" ||
          !request ||
          request.revision !== input.recordRevision ||
          request.state === "resolved"
        )
          throw new Error(
            "This decision changed or is stale. Refresh before answering.",
          );
        if (input.suggestion) {
          const suggestions = parseSuggestions(
            await readFile(
              join(
                await readConfiguredDecisionHome(),
                "data",
                "suggestions.md",
              ),
              "utf8",
            ),
          );
          const matches = suggestions.filter(
            (entry) =>
              entry.decision?.homeId === input.homeId &&
              entry.decision.requestId === input.requestId &&
              entry.decision.recordRevision === input.recordRevision &&
              entry.decision.actionId === input.suggestion!.actionId,
          );
          if (
            matches.length !== 1 ||
            matches[0]!.label !== input.suggestion.label ||
            matches[0]!.prompt !== input.text
          )
            throw new Error(
              "That answer option changed. Refresh the decision.",
            );
        }
        outgoing.text = await message(TEMPLATES.decisionAnswer, {
          context: JSON.stringify({
            ...target,
            submissionId: input.submissionId,
            task: request.source.taskId,
            title: request.source.title,
            host: request.source.hostId,
            project: request.source.project,
            ask: request.source.ask,
            url: request.source.url,
            report: request.source.reportPath,
          }),
          answer: input.text,
        });
        snapshot = await service.mutate(target, {
          kind: "answer",
          submissionId: input.submissionId,
          outcome: "uncertain",
          messageHash: hash,
          onlyNew: true,
        });
        reserved = true;
      });
    } catch (error) {
      if (!reserved) throw error; // A definite pre-delivery refusal leaves the draft retryable.
      return { outcome: "uncertain" as const, snapshot: await service.read() };
    }
    // A source edit or lost commit after acceptance must never turn into a second send.
    try {
      snapshot = await service.mutate(target, {
        kind: "answer",
        submissionId: input.submissionId,
        outcome: "accepted",
      });
    } catch {
      snapshot = await service.read();
    }
    return { outcome: "accepted" as const, snapshot };
  });
}
