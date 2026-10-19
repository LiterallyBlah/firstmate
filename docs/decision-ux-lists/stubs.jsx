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
if (params.has("materials")) {
  const request = window.attentionSnapshot.requests.find(r => r.id === "a");
  Object.assign(request.source, {
    title: "Choose the reply to the maintainer",
    ask: "Send data/review/draft-reply.md to https://github.com/example/project/discussions/42 after reviewing data/review/spec.md?",
    specPath: "data/review/spec.md", notesPath: "data/review/notes.md", reportPath: null, url: null,
  });
  window.attentionSnapshot.answerOptions = [{ label: "Send this draft", prompt: "For a: Send data/review/draft-reply.md as written.",
    decision: { homeId: "fixture-home", requestId: "a", recordRevision: 1, actionId: "task:fixture" } }];
}
export function useRpc(contract) {
  if (contract.name === "firstmate.files.find") return async ({ paths }) => ({ files: Object.fromEntries(paths.filter(p => p in files).map(p => [p, p])) });
  if (contract.name === "firstmate.files.read") return async ({ path }) => {
    window.fixtureCalls.push({ name: contract.name, input: { path } });
    return { path, content: files[path], modifiedMs: 1, binary: false, tooLarge: false, size: files[path]?.length ?? 0 };
  };
  if (contract.name === "firstmate.files.list") return async ({ path }) => ({ path, home: "fixture", entries: [] });
  return originalRpc(contract);
}
