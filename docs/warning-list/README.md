# Historical warning reporting

Home previously repeated three kinds of retained diagnostics as global alerts: optional crew
history reads after accepted task progress, a successful scoped cutover's legacy-copy notice,
and immutable rule refusals preceding later accepted progress.

The reporting projection now distinguishes that history from current warnings. Exact local
agent/task/project identity and an unheld, valid, evidence-bearing done/landed node are required
before a crew report alert can become card context. An ambiguous or reused session, native
error/permission/running state, held/incomplete read or missing evidence keeps its warning.
The latest session report remains unknown; no report or successful outcome is invented.

A refusal becomes historical only for the same scoped plan/owner/node after later accepted
progress, and its attempt must remain in that node's lineage when named. Original records
remain in the existing plan dialog under **Show recorded rule refusals**. A committed legacy
notice disappears only when the current scoped plan is readable. The legacy writer's refusal
is unchanged. No journal, policy, authority, card placement or count is rewritten.

`node docs/warning-list/render.mjs` builds both the pinned baseline and current production
projections, then the real Home UI, using synthetic records in disposable homes. It captures
both themes and desktop/phone widths for historical, current-warning and clean cases, including
retained card and refusal details. Every host API is stubbed; it does not use a live plugin or
the captain's browser. Outputs are ignored under `.local/warning-list/`.

Dependencies are the root lockfile and the existing `docs/board-list` lockfile. Focused regressions:
`node node_modules/vitest/vitest.mjs run server/workflow-warning-list.test.ts client/workflow-plans.test.ts --maxWorkers=2`.
