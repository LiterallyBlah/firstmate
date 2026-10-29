# Smooth update, slice 2

This slice implements “PR 2 — remove empty administration and clarify ordinary
copy” from the captain's 29 October smooth rollout report. The following
acceptance checks were recorded before changing production code.

- [x] Fresh on/off Home has one understandable setup action; upgraded on
  Home/Board starts with chat/work rather than empty owner headings. Empty Plan
  supervisors, Maintenance owners and Project mates · 0 consume no primary
  viewport space.
- [x] Existing stopped owners, failed openings and retained audits remain
  accessible when feature controls are off. Real corruption is never hidden by
  “empty.”
- [x] Six unadmitted registry rows are setup opportunities, not six decisions or
  six provisioned agents. Actual held problems name the next step. Advanced copy
  remains available to inspect exact source/epoch/provenance.
- [x] A complete empty All inbox offers “No decisions right now” and Back to
  FirstMate, rather than a blank drawer. Pending/incomplete reads do not use that
  reassurance.
- [x] At 390px, 200% text size and both themes, controls wrap without overlap;
  destructive/recovery actions keep exact behavior. Capture default, expanded
  details and genuine-problem states in both themes at desktop and phone widths.

## Boundaries

Presentation and copy only. Reuse current actions. No new provisioning or Attach
path, feature-policy storage, activation/default changes, execution authority,
guided setup, routing redesign, migration or cleanup behavior. Later slices own
those changes. Preserve exact recovery identities, cumulative spend, warnings,
unknown delivery, existing confirmations and server guards.

## Verification

| Acceptance | Evidence |
| --- | --- |
| First screen / empty inventories | `fresh-off`, `fresh-on`, `empty-home`, `home`, `board`, `plans` captures; `work-details.test.ts` checks enabled empty inventories have no layout. Fresh scope UI reuses the launch controls without adding a General composer. |
| Disabled retained history / corruption | `problem-off`, `problem-details` captures; visibility and component tests cover retired/failed plan openings, stopped projects with no agent, saved requests/spend, orphaned delivery history and cold read errors. Opening details calls only reads. |
| Registry opportunities / exact details | Six synthetic registry rows produce “6 projects available to set up,” with zero held work and unchanged decision totals. Expanded details retain exact recorded state, project/scope/version, host/folder, owner epoch and unverified attachment audit. |
| Complete empty All | `all-empty`, `all-pending`, `all-partial` captures. Drawer tests exercise the return action and refuse reassurance for offline, partial, corrupt and unknown reads. The pure guard also refuses pending reads, quarantines and pending scoped answers. |
| Wrapping / action safety | Both themes at 1440×1000 and 390×844, plus doubled text on phone. Focus returns after closing Work details. Existing attachment, project recovery/stop and maintenance admission tests still verify exact request reuse and stale/disabled action holds. |

`node docs/smooth-pr2/render.mjs` renders the real components against synthetic
read-only fixtures and baseline `d74a30c`. It captured 146 images with no page
exceptions or document overflow. A focused eight-capture confirmation checked
the enlarged project heading after its wrap fix. `contact-sheets.mjs` creates
the six review sheets below. CI repeats the full matrix and retains every
full-size image and its visible-text/RPC log in `deck-before-after`.

Local verification: typecheck; 100 focused tests in eight files; the existing
S05 discussion/answer browser harness (four theme/width cases); Impeccable scan
(no findings). The full Windows run with CI's two-worker / 20-second settings
finished with 232 files and 3,326 tests passing, three skipped, and one failure:
the known `server/launch-tool.test.ts` EPERM rename flake. Hosted CI is the full
suite gate. These browser captures do not establish native device or assistive
technology fidelity.

## Copy contract

The primary launch wording is “Welcome to FirstMate” / “Set up FirstMate,” with
model and permission review retained. Charter/worktree/adoption details remain
behind Setup details. Plan help and Routine checks live in Work details, also
reachable from settings. Routine checks explicitly says automatic cleanup is
unavailable. Registry availability is neutral, separate from actual held work
and every decision count. Discussion uses Refresh and Details; exact storage
freshness/sequence stays inspectable there, and unknown activity is labeled
Status unavailable with Refresh as the recovery action. Corruption, offline
state, uncertain sends and unverified provenance remain visible.

## Screenshots

Each comparison sheet pairs the same synthetic state before (left) and after
(right): fresh setup, Home, Board, Plans, expanded details, disabled genuine
problems, discussion details, empty All and the settings destination.

| | Desktop | Phone |
| --- | --- | --- |
| Light | [Before / after](smooth-pr2/evidence/light-desktop-comparison.png) | [Before / after](smooth-pr2/evidence/light-phone-comparison.png) |
| Dark | [Before / after](smooth-pr2/evidence/dark-desktop-comparison.png) | [Before / after](smooth-pr2/evidence/dark-phone-comparison.png) |

Enlarged text: [light](smooth-pr2/evidence/light-phone-text200.png),
[dark](smooth-pr2/evidence/dark-phone-text200.png).
