# Slice 8: contextual discussion and plain shared decisions

## Scope

Implement only PR 8 of the captain-approved smooth-rollout report (29 October 2026). D5 keeps Home on the original FirstMate transcript and opens an explicit named conversation with Back to FirstMate. Preserve captured targets, owner epochs, per-recipient drafts, first-send checks and checked outboxes. Maintenance and unqualified remote conversations remain read-only. No new Attach, provisioning, policy enablement, migration or authority path.

## Acceptance checks (recorded before implementation)

- [x] Switching recipient, returning from a decision, restoring a scoped draft after reload, and a failed scope read preserve the captured send target. General and owner drafts/history remain separate and recoverable.
- [x] Optional @recipient/#context syntax shows its actual resolved recipient before sending. Ambiguous/unsupported addresses refuse and retain the draft.
- [x] Filters show human project/plan names, make no mutation/model turn, retain the global total and unknown quarantines. Coming up/setup never enter counts; missing sources retain lower-bound/unknown semantics.
- [x] Backlog/plan, scoped plan and maintenance answers use their existing origin-specific services and current revision/subject/evidence. Changed subjects refuse; lost replies remain disabled and reconcile the original answer before navigation.
- [x] New discussion creation gets a concise review before the first effect. Loading an empty thread creates nothing. Maintenance/remote routes remain read-only with useful conversation/original-host navigation.
- [x] Both themes at 1440×1000 and 390×844: before/after evidence, plain copy, 44px controls, keyboard/focus and wrapping checks. Exact diagnostic/provenance information remains in Details.

## Validation and evidence

| Acceptance | Evidence |
| --- | --- |
| Captured routes, separate drafts/history, reload and failed read | `client/scope-discussion.test.ts`, `client/chat-discussion.test.ts`; S05 restored-read, recipient-switch and in-flight-send browser cases |
| Actual To label; optional, ambiguous and unsupported addresses | Same component tests, `shared/scope-discussion.test.ts`, S05 address/refusal cases |
| Global totals, named filters, retained unknown warnings, partial counts | `shared/scope-inbox.test.ts`, `client/decision-drawer.test.ts`; Build C six-filter browser matrix; `needs-partial` and `needs-warning` screenshots |
| Correct origin, revision/subject/evidence, no uncertain replay | `client/scoped-needs.test.ts`, `server/scope-runtime.test.ts`, `server/decision-answer.test.ts`; existing plan/backlog drawer tests; S05 plan and maintenance lost-response cases |
| First effect requires review; target changes invalidate it; read-only destinations | `client/scope-discussion.test.ts`; new browser harness checks zero effects during reads/review, changed target hold, draft retention, focus return and one explicit send |
| Copy, Details, themes and widths | [80 before/after captures](evidence.md), six 200% text captures, 44px changed-control assertions, no page exceptions/document-width overflow; Impeccable detector `[]` |

Local validation: typecheck and 141 focused tests pass. The full Windows suite passed with 3,384 tests passed and four skipped, using CI's two-worker/20s settings; all 90 launch-tool tests passed. The existing S05, Build C, Needs-you and Deck browser checks pass, as does the 146-capture slice-2 matrix. The final keyboard-focus addition also passes the focused conversation tests and the full 80-capture browser matrix. Hosted checks are tracked on the PR.

Run `node docs/smooth-pr8/render.mjs` after installing the root and `docs/board-list` dependencies. It compares `60d377fc` with current components, writes only ignored `.local/smooth-pr8/ui/`, and uses synthetic host/RPC data. The committed evidence is an intentionally selected copy of that output. CI runs this matrix on Windows and Ubuntu and uploads all captures/results.

Copy follows the report: named To and Show controls, one named discussion action, read-only Refresh, and Details for storage/owner/provenance. Warnings remain visible in every filter. “Answer saved” describes a committed choice without claiming delivery; an uncertain reply says “Answer not confirmed” and cannot be resent. No capability default, server transport, reservation, Attach path or authority guard changes.

Browser keyboard/focus and measured native keyboard padding are covered; this component harness does not establish native-device or screen-reader fidelity. Those integrated checks remain slice 10's explicit scope.
