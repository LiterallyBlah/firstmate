# Final parent integration

This continues PR141 on `fm/fm-tabs-ux-mobile`. The original mobile implementation,
report and review evidence remain attributed to
`80400ccd42b06db1bbd8aaf5928711cb1f989d84`. No original commit was rewritten.
FirstMate authorized ordinary local feature merges of the two exact verified
parents below. No parent branch or PR is changed by this assembly.

## Pinned ancestry

Every row is retained as an ancestor of the final assembly. Commit and tree IDs
are separate; the final submitted commit/tree and ancestry results are recorded
in the qualification receipt and PR141 body.

| Reviewed batch | Commit | Tree |
| --- | --- | --- |
| PR138 labels/counts | `da554c911a527caaf7fb2766847f6d3f8dd3c075` | `5b2f091371d9ab6d8c0f89e9640feefc6e45a59e` |
| PR139 discussion | `26a7baeece4ce2fec58d0f18322a891e034269c4` | `8e91d2d4223501f56c466a1b00e960d1ef974f93` |
| PR140 Plans | `3bb688a4d030884b185f4e1269ca3da7aa9756de` | `503822b04bbba6e664175eeef12654ba5161e2a7` |
| Original PR141 mobile | `80400ccd42b06db1bbd8aaf5928711cb1f989d84` | `eb2b3eed9b254e1b88ca0749acdeed168bd1553c` |
| PR142 states/recovery | `19bc66832ee639a40a215d4d65f50cf319d5b5dd` | `0145cf3a3176d986048cac04cbabb08e0e7b9669` |
| Corrected PR143 decisions | `6fe8f98e157d24d9315fd8388118c6c5c0308634` | `69dfd85706f49c67adfd59ee0d4659cfc83bf0b5` |

Decisions was merged first in
`fe9c520c12457420c7883697f16694b66742d275`
(tree `49c0df0f5af4f1535bff35eed46f4e0f1744a775`). States then merged cleanly in
`ebff81d34f87351e056b5eace0664f3e1f0edd6c`
(tree `4aefba456f5582d73a10c8461fff39f5c34b2f33`). These are local feature-branch
merge commits, not merges of PRs or the default branch.

## Conflict and consequence inventory

The Decisions merge had four conflicted files. The original conflict stages,
unresolved text and resolved remerge diff remain under ignored
`.local/mobile-integration/`.

| File | Resolution |
| --- | --- |
| `client/decision-drawer.tsx` | Keep mobile heading levels and focused-heading outline behavior; add the parent plan context and Open plan action. Keep the unified plan-review queue, readiness and readable content boundaries. |
| `client/task-list.tsx` | Keep section heading wrappers and levels; retain consumed reveal identity and clear the transient revealed group on a manual fold. |
| `client/workflow-plan-browser.tsx` | Retain scoped search/folds/paging/scroll and task links while passing compact sizing and heading levels through the same browser. Do not restore per-mount browsing state. |
| `client/workflow-plan-browser.test.ts` | Retain the parent's navigation fixture and the mobile test's Platform mock. |

States required no conflict resolution. Its Files/empty/error states and lifecycle
identity recovery remain intact. The direct post-merge sizing consequence is in
`client/chat.tsx`: the newly inherited return-to-decision action and dismiss
button use the same existing compact targets as the rest of the composer.

The first union attempt at `0b89f20` retained 621 passing tests, six failed reveal
assertions and an uncollected empty-state suite. Both causes were fixture exports
needed by the combined components: `webAttributes` in the reveal mock and `Platform`
in the empty-state mock. Only those two mock definitions were repaired; assertions
and limits remain unchanged. The failed JSON/log/source manifest is retained as
attempt 1, separate from final qualification. No new product-behavior regression
test was needed, and this is not represented as a passing first attempt.

The corrected `PlansControl` guard remains
`if (!plans.length && !selected) return null;`. Its real-component selected-filter
clear/approval regression is included in qualification. Due-only UI/server/store
gates, historical answer/idempotent replay behavior and shipped workflow guidance
are inherited from corrected PR143, without another policy change. Plan-ready chat
deduplication and New-only sidebar routing remain inherited as well.

## Qualification and attribution

The one affected union is enumerated in
[`integration-tests.json`](integration-tests.json): all 25 tests changed across the
six batches, plus 15 directly affected dependency/store/template tests. It includes
real Chat, Home, List, Board, Plans, drawer, Files and lifecycle recovery tests;
scoped matching, navigation/reveal consumption and browsing state; labels/counts,
permission attribution, queue/readiness/history/retries and the selected-filter
regression. It is not a fresh local full suite.

```powershell
$integrationTests = Get-Content docs/mobile-accessibility/integration-tests.json -Raw | ConvertFrom-Json
npm.cmd test -- @integrationTests --reporter=json --outputFile=.local/mobile-integration/union.json
npm.cmd run typecheck
node docs/shell-phase1/check-bundle.mjs
git diff --check
```

The qualification receipt binds the actual tested commit/tree and working source
hashes to each test/log/compiler receipt. A final submission receipt compares
those source hashes with the submitted tree; no parent test totals are added to
the fresh result. Any first attempts and subsequent targeted fixes stay separate.
Repository CI must pass on the final submitted head. The integration self-review
compares the assembled tree against original PR141 and both pinned parents, with
special checks on conflict resolutions and the unchanged reviewed gates.

Original PR141's 195-test/code/CI and existing CI-image evidence remain at
`80400cc` in `.local/mobile-accessibility/`. Parent reports retain their original
head attributions: PR143's original 424 tests/reviews belong to `d45aae0`; its
corrected 50-test run and FirstMate's direct verification belong to `6fe8f98`.
The original broad-run failures and all original reviewer evidence are preserved.
Fresh integration results are reported separately in PR141 and
`.local/mobile-integration/`; the original PR body and delivery record are copied
there for provenance, with source-to-receipt hashes. No new review round is claimed.

## Remaining gates

Capture remains explicitly parked. No browser/connection attempt, reconnect
question, local render script or direct Playwright fallback is authorized by this
integration. A separate actual-component synthetic fixture can be bundled against
the assembled tree without opening a browser; bundling is not layout verification.
Original audit and mobile fixture evidence remains untouched.

Fresh wide/phone light/dark captures including Paseo's real palettes, DOM checks
and desktop keyboard traversal remain landing gates. They must cover the assembled
discussion return flow, Plans navigation/selected-filter recovery, due-only queue,
plan-ready reference, Files/recovery states and mobile controls together. Prior
fixtures cannot prove this combined experience. Native devices, screen readers,
native tab focus and installed-daemon behavior remain unverified. No merge of a
PR/default branch, install/reload, daemon restart or live prompt/decision/permission
action is performed. Independent landing and installation authority stays with
FirstMate/captain.
