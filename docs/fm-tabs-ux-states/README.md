# Files and status follow-up

This batch addresses the remaining Files, error/status and empty-state findings in the
22 October FirstMate frontend audit, preserving the current design. It began at exact reviewed
batch2 head `26a7baeece4ce2fec58d0f18322a891e034269c4` and is stacked on `fm/fm-tabs-ux-plans`.
Plan navigation and browsing state come from that parent; this batch uses its existing filter.

## Behavior

- Fleet errors offer Retry, disabled during a read. Repeated presses reuse the shared query's
  in-flight request. First-load Home/Chat errors can still render the independent chat when
  the existing config and SDK identify a live configured mate. No mate is inferred from labels.
- File listing/open errors offer Retry. Conflict recovery offers Copy my text and Load theirs
  immediately, and Overwrite only after a refused version-checked save. Copy uses Paseo's host
  clipboard API. The unsaved guard, server confinement and optimistic save contract remain.
  Save/create presses are synchronously gated, and typing during a save stays unsaved.
- Files labels name Up to home and New file name. The editor has a theme-colored border;
  compact save status occupies its own line.
- Unreachable workers' activity reads Last seen, with the existing corrected worker timestamp.
  Local decision records and backlog outcomes keep their own meaning. Reachability/action rules
  are unchanged.
- List/summary Board explain when every filtered match is already in Needs you, counting a task
  once even if it has several workers. Global decisions remain visible. Unfolded empty Board
  columns have calm text. Expanded cards show tags only in their editor.
- Settled raised decisions become short receipts with Open and the existing revision-bound
  destination. Answered/delivery-uncertain states retain their distinct wording. This changes
  rendering only; neither timeline nor decision history is rewritten.

## Verification and evidence

The source audit is at
`C:/Users/micha/.paseo/plugin-data/firstmate/home/data/fm-tabs-ux-review/report.md`;
its `evidence-manifest.md` and screenshots are preserved. Relevant baseline images inspected:
S26 (offline activity), S37 (conflict), S41 (empty filtered Board), S42 (tags), S43 (first load),
S44 (settled cards), S50 (compact Files). These establish the old state, not the new layout.
The audit's static send echo/count/time artifacts are not treated as bugs.

Behavior regressions reproduce the old offline/settled-card/decision-only-empty behavior and
compare working online/active/ordinary-task paths. Actual Files component tests exercise failed
read Retry, repeated clicks, copying the exact draft, loading the other writer's version,
deliberate overwrite, typing during a save and the compact unsaved guard. Recovery component
tests cover shared config/SDK reads and absent/archived mates. The affected suite also covers
the parent's plan navigation and the existing shared send gate.

Local evidence lives in ignored `.local/states/`: affected-test and typecheck logs, compiler/Hermes
output, and the stopped broad run's partial `full-tests.log`. The broad run hit five-second
timeouts and a pending parent no-host-read regression; it was stopped on instruction. It is not
a passing full-suite result, and no broad rerun or full baseline comparison is claimed. Test
limits and repository checks are unchanged. Repository CI remains the full-suite check.

Paseo's current public plugin quickstart/reference were fetched on 22 October and retained in
that evidence folder. Client changes use host SDK/UI, React Native primitives and theme tokens.
The existing compiler check `node docs/attention-deck/compile.mjs` compiles both real entries and
parses the client under RN 0.81 Hermes without bundling Pixi or art.

## Prepared visual fixtures; capture deferred

Fresh actual-component synthetic preview sources are retained at `.local/states-preview/` in
this task worktree. They reuse the original audit harness and repo stubs, without modifying the
audit worktree. Its files writes/tags stay in page memory; no captain records are used. Bundle:
`node .local/states-preview/serve.mjs 48739 --bundle-only`. This does not start a browser.

Pending manual capture matrix: 1440×900 and 390×844, `theme=paseo-dark` and `theme=paseo-light`.
Scenarios include `fleet-error` (with/without `unknown-mate`), `files-list-error`,
`files-read-error`, normal Files editing/conflict, Atlas offline, `clear` for settled receipts,
and `tags=release,ui` on List and Board. Existing synthetic fixture controls allow recovery,
conflicts, tag edits and route switches. No real sends or writes should be used.

Fresh captures are explicitly deferred by the captain and still gate landing. No browser
connection/reconnect attempt or direct Playwright fallback was made. Native phones, native tab
focus, screen-reader output and installed-daemon behavior remain unproved. This batch does not
install/reload, merge, or change product policy.

## R1: lifecycle recovery identity

The scoped Astra review at `7868158927883402853a28ad48f9bb1208fe947d` found that a successful
Restart could leave the recovery chat on the retired mate while fleet reads kept failing. Its
synthetic restart probe reproduced the mismatch; its config-refresh control passed. Both the
original failing log and the passing comparison are retained under ignored `.local/r1/`.

Recovery's lifecycle callback now resets and rereads the installation's config and known-mate
queries before asking the fleet to refresh. The old composer is withdrawn during that identity
check. The recovered chat is keyed by mate id, as the normal chat is, so a replacement cannot
inherit the retired timeline's component state. Shared draft/attachment stores and the send gate
are unchanged.

`client/fleet-recovery-restart.test.ts` exercises real recovery, chat, session controls, streaming
and send hooks with synthetic host APIs. It checks replacement while fleet remains failed,
pending identity/timeline reads, Full conversation routing, per-mate draft/attachment retention,
duplicate-send prevention across remount, and unconfigured/archived/missing mates. Only affected
tests, typecheck, compiler/Hermes and final-head repository CI are required for this correction;
previous broader evidence is retained. No browser check or further general review was performed.
