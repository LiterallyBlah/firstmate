import type { PlanNeed } from "../shared/workflow-rpc";

export function planDecisionNeed(): PlanNeed {
  return { plan: "reader-pass", node: "checks", title: "Build the reader pass into chapter-making and roll it out",
    question: "Spoiler and foreshadowing checks", waits: [], neededBy: ["Roll out the reader pass"], recommendation: "Keep both checks — preserve reader confidence.",
    decision: { homeId: "workflow-home-hash", revision: 3, subjectHash: "b".repeat(64), ask: "Keep the reader pass spoiler-safe", at: "2026-10-22T10:00:00Z", ready: true,
      options: [{ id: "both", label: "Keep both checks", consequence: "Check spoilers and foreshadowing before sharing." }, { id: "spoilers", label: "Only spoilers", consequence: "Skip the foreshadowing check." }],
      brief: { path: "data/checks/decision.md", content: "# Reader checks\n\n## Question\nKeep the reader pass spoiler-safe\n\n## Recommendation\nRecommended reader checks: keep both.\n\n## Background\nProtect the reader’s first experience." } } };
}
