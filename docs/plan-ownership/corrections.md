# PO1–PO4 correction receipt

This extends the original [ownership receipt](receipt.md) on `fm/fm-plan-ownership`. Review target before correction: `719b125f5e51aa1dd6dd4ae88a8c70ef37fb3c1f`. The independent failing fixtures and readbacks remain intact in FirstMate home `data/fm-plan-ownership-review/`.

| Finding | Corrected source | Regression and positive control |
| --- | --- | --- |
| PO1 scout promotion through revision | `server/workflow-plans.ts` pins an existing run's scout/ship kind and includes workflow/kind in the delegated scope fingerprint. A new ship run cannot enter a scout-only scope. | `server/workflow-plan-owner.test.ts` and `server/supervision-commands.test.ts` refuse the promotion and admit a second in-scope scout. |
| PO2 removed Captain gate edge | `server/workflow-plans.ts` preserves direct and indirect dependency routes to Captain decisions and authority runs on retained nodes. Added runs in a protected scope carry its Captain prerequisites. | Both test files refuse removing one of two consumer edges; the legacy test also refuses an ungated added run and admits a gated one. Routine title revisions remain available. |
| PO3 S03 start bypass | The legacy workflow store and S03 `SupervisionCommands` now call the same append-only admission helper before creating an event. Historical event replay does not reapply the new policy. | S03 refuses a start with an unanswered explicit authority gate without committing a transaction; an answered Captain prerequisite admits the gated start. Existing legacy and replay controls pass. |
| PO4 S03 delegated decision mismatch | `server/supervision-commands.ts` checks a delegated answer as `decision.answer`, requires exact prerequisite bindings, and records the accepted option, evidence, actor and answer outbox in the scoped decision. `server/needs-you-service.ts` omits FirstMate-owned choices from Captain Needs-you. | S03 test verifies zero Captain actions before and after answer, durable `answered` state, agent provenance, matching `decision.answer` outbox, pending consequence count and idempotent replay. Existing Captain answer tests remain green. |

The corrective tests first ran against the delivered head and failed in four cases corresponding to PO1–PO4; baseline output is retained locally at `.local/plan-ownership/corrections-baseline.log`. No separate journal, timer, runner, S04/S05 behavior, live plan mutation or installation was added.

One unrelated close-review case exceeded Vitest's five-second default under full-suite Windows filesystem load. Its isolated 10-test file passed in 1.83 seconds; that case now has a 15-second limit, with assertions unchanged. The initial full-run output is retained at `.local/plan-ownership/corrections-full.log`.

Verification commands: Node 24 TypeScript typecheck; focused workflow and scoped tests; full Vitest suite with `FIRSTMATE_RECEIPT_JOURNAL=1`; repository visual render checks; `git diff --check`. Exact totals, final head and CI results are recorded in FirstMate home `data/fm-plan-ownership-corrections/report.md` after completion.
