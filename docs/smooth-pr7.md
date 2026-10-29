# Reviewed project batch setup

Slice 7 extends the existing individual project setup. It keeps the captain's
explicit selection, original General conversation and all existing safety checks.

## Acceptance checks recorded before implementation

- One project and all 2 eligible projects both work; all 6 valid projects remain
  selectable when only 3 fit, with a truthful capacity step. Existing/invalid
  projects are counted separately. No implicit capacity or plan-budget increase.
- Duplicate confirm, two clients, request/body mismatch, app reload and daemon
  restart reconcile the exact batch and child inputs. A completed child is never
  recreated because another child's reply was lost.
- Mixed success, changed source, offline host, exhausted admission capacity and
  uncertain opening show separate outcomes. Read-only Check saved setup does not
  retry unknown sends. Explicit cancellation affects only undispatched work and
  preserves identity/spend.
- After success, Home still shows the original General transcript; opening a new
  mate is explicit. Routine incidents and batch progress never inflate
  captain-decision totals.

## Boundaries

At most 64 canonical projects; explicit Select all eligible, no initial selection.
Aggregate capacity includes General's retained headroom. A shortfall retains all
selection and requires a separate reviewed capacity change or fewer projects.
Reuse valid reviewed profiles; no unapproved numeric preset. Each independent
native effect keeps its existing queues, source/profile/cap/policy guards and
authoritative receipts. Results are individual, without transactional rollback.
No Attach, plan cap changes, background retry, cleanup, budget refund or rollout
default changes. App provenance remains unverified. Refreshes stay silent.

## Implementation and acceptance mapping

The existing Home/Settings chooser now offers explicit selection and Select all
eligible projects. Nothing is selected on opening. Project settings reuse each
valid reviewed profile; otherwise the existing individual editor records the
actual model, permissions, cumulative limits, allocation and instructions. No
numeric preset is invented. Identical reviewed profiles share concise review
copy, with existing spend still listed individually and exact sources/openings
available in Details.

The app's batch preview/commit/status/continue/cancel RPCs retain a home-bound,
immutable manifest in plugin data. A content digest binds the batch ID,
registry/policy fingerprints, aggregate capacity observation and all exact child
requests. Publication is exclusive and precedes every child's admission/native
effects. A second batch cannot replace waiting child identities. Intent and
failure diagnostics are not claimed as native outcomes: each result is rebuilt
from the existing individual setup receipts, project binding and effect state.

Only final capacity observation/publication shares the scoped admission queue.
Model/source review and per-project work never borrow General's conversation
lock. Each child still enters the existing app setup service and its sorted,
scoped provisioning queues, policy/source/profile/cap checks and fresh native
effect guards. No batch executor, independent outcome ledger or model wake is
added to reads.

| Report acceptance | Evidence |
| --- | --- |
| One/all eligible; six remain selected with room for three; separate existing/invalid counts | Server tests exercise one and two actual synthetic creations and six-project capacity refusal before publication. Component/browser tests check explicit selection, zero-selection guard, existing/invalid exclusion and retained six-project selection. Review capacity reuses the existing checked capacity-impact review inside setup; it retains selection and changes no provider quota or plan cap. |
| Duplicate/two-client confirmation, mismatched body, reload/restart, exact children | Server tests confirm exact retries and two service instances produce one agent/opening per child. Changed bodies and overlapping batch IDs refuse. Restart reconstructs the same manifest/requests; completed siblings are skipped. Corrupt manifests remain held. |
| Mixed success, changed source, offline/provider refusal, capacity exhaustion, unknown opening, cancellation | Tests cover per-child refusal/uncertainty, a source/capacity change after a sibling succeeds, read-only status with no receiver calls, and cancellation while a native effect is in flight. That effect settles; later undispatched projects are cancelled. Batch continuation refuses uncertain creates/openings and failed/cancelled effects. Exact identities and spend remain. |
| Original General chat, explicit opening, no decision-count inflation | No Home transcript, sender, decision projection or routine-check transport changes. Server tests assert no attachment audit or captain decision. Browser checks assert no implicit navigation after results, and native conversation links require an explicit press. |

## Verification and copy

- Typecheck, focused setup/runtime/headroom/settings/component checks and
  `git diff --check` pass. Final full-suite/hosted results are recorded on PR #178.
- `node docs/smooth-pr7/render.mjs` exercises the actual pinned-before and current
  components in light/dark at 1440×1000 and 390×844: chooser, review, results,
  capacity-impact review, unknown opening, lost reply and 200% text. It checks
  keyboard selection, focus return, 44px controls, no page exceptions/overflow,
  exact one confirmation and read-only checking. Its captures/logs stay ignored
  under `.local/smooth-pr7/`; CI also runs it and uploads the evidence.
- The Impeccable mechanical scan returned no findings. Ordinary copy uses Ready,
  Waiting to start, Needs a change and Checking whether setup finished. Technical
  fingerprints and unverified provenance stay in Details; actual permissions,
  spending limits and effects remain prominent. Refreshes are silent.

The initial full local Windows run saw an EPERM config rename in the existing
`server/migration.test.ts`; that unchanged file passes independently. Initial
contract/label assertions found during implementation were corrected and pass
focused checks. No live home, plugin, project, session or timer was changed.
Browser fixtures do not establish native phone/screen-reader fidelity.

| Before → select → review → results, shortfall and uncertain sibling | Screenshots |
| --- | --- |
| Light desktop | [Comparison](smooth-pr7/evidence/light-desktop.png) |
| Dark desktop | [Comparison](smooth-pr7/evidence/dark-desktop.png) |
| Light phone | [Comparison](smooth-pr7/evidence/light-phone.png) |
| Dark phone | [Comparison](smooth-pr7/evidence/dark-phone.png) |
