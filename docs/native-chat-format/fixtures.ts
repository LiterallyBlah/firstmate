export const watch = `<firstmate-watch-dropped count="3"/>

<firstmate-watch name="pr-watch" ran="2026-10-16T12:00:00Z">
PR #42: checks green. The captain's requested review is ready.
</firstmate-watch>

<firstmate-watch name="health" ran="2026-10-16T12:00:00Z" failed="exit 1">
Remote host unavailable. Last response: connection refused.
</firstmate-watch>`;

export const board = `<firstmate-board>
The captain spoke to crewmate crew-17 (Fix login) directly from the FirstMate board. Their words are authoritative: reconcile the brief and the backlog with them.

Captain: Keep the fix limited to the login redirect.
Crewmate: The redirect fix is ready, and the unrelated cleanup has been removed.
done: PR https://example.test/pull/42 checks green
</firstmate-board>`;

export const system = `<paseo-system>
Agent crew-17 (Fix login) finished.
The redirect fix is ready for review.
</paseo-system>`;
