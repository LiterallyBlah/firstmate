export * from "../needs-you/stubs.jsx";
import { useRpc as originalRpc } from "../needs-you/stubs.jsx";

const params = new URLSearchParams(location.search);
if (params.has("six")) {
  const snapshot = window.attentionSnapshot;
  const names = ["Land the board changes", "Choose the reply to the maintainer", "Review the workshop plan", "Approve the next test run", "Choose the new setting", "Close the rollout review"];
  snapshot.requests = names.map((title, i) => ({
    ...structuredClone(snapshot.requests[0]), id: `six-${i}`, state: i < 2 ? "new" : "seen",
    detectedAt: Date.now() - (i + 1) * 8 * 60000,
    source: { ...snapshot.requests[0].source, key: `six-${i}`, taskId: `six-${i}`, title,
      ask: ["May the first mate land the reviewed pull request?", "Send the draft as written, or revise it first?", "Which of the two approaches should the crew build?"][i % 3] },
  }));
  snapshot.actionCount = 6; snapshot.newCount = 2;
  const failed = window.fixtureFleet.cards.find(c => c.key === "failure-example");
  if (failed?.agent) failed.agent.updatedAt = new Date(Date.now() - 45 * 60000).toISOString();
}
const files = {
  "data/review/spec.md": "# Review scope\nReview the current proposal.",
  "data/review/notes.md": "# Notes\nUse the existing answer path.",
  "data/review/draft-reply.md": "Thanks for reviewing the proposal.\nThe changes preserve the existing workflow.\nThe crew has checked both themes.\nThe draft is ready for review.\nThis fifth line must stay out of the preview.",
};
export function useRpc(contract) {
  if (contract.name === "firstmate.files.find") return async ({ paths }) => ({ files: Object.fromEntries(paths.filter(p => p in files).map(p => [p, p])) });
  if (contract.name === "firstmate.files.read") return async ({ path }) => ({ path, content: files[path], version: "fixture" });
  return originalRpc(contract);
}
