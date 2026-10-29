# Individual project setup

Slice 6 of the smooth-update report: choose one project, review its checked source,
profile, limits and effects, create its mate, and inspect the saved result.

## Acceptance checks recorded before implementation

- A valid unadmitted local project can be reviewed/admitted and get one persistent
  mate using only app controls. One creation confirmation authorizes the session
  and opening.
- Missing folder, duplicate canonical path, changed alias, unsupported remote host,
  changed registry/source/profile and insufficient General headroom each produce a
  precise repair path before native effects.
- Reload after admission, lost create reply and lost opening reply use the original
  saved request/profile/identity. No duplicate agent, blind resend, budget reset,
  refund or cleanup occurs.
- Existing mates offer Open conversation; stopped/uncertain mates offer the exact
  recovery path. Provider/model failure cannot silently choose another model or
  permission mode.

## Boundaries

No batch/select-all (slice 7), plan handover/Attach (slice 9), routine checks or
upgrade introduction (slice 10). Existing default-off policy, source authority,
capacity/headroom, profile and lifecycle checks remain mandatory. D4 reuses valid
reviewed profiles; exact suggested preset values require captain approval and must
not be invented here. App provenance remains unverified.

## Result

Settings' **Set up project mates** opens the shared chooser when project controls
are enabled. An explicit enable-only save opens the same destination immediately;
there is no environment edit or restart. One project is selected at a time.
Existing mates offer their native conversation. No project is preselected.

An existing valid reviewed model, permissions, source vector, limits and allocation
are reused. Otherwise the user explicitly chooses supported settings and limits.
**D4 preset approval is still required:** no numeric preset or model-name default
has been invented. The separate capacity review remains in Help settings.

The app can save deliberately authored project instructions before setup. This is
an explicit, immutable, idempotent text save; it creates no supervision journal,
source acceptance, admission, session or opening. Final review selects and checks
the actual durable source bytes through `checkPolicySource`. Project lists,
backlog and memory cannot become source authority through this chooser. Source
acceptance records dedicated unverified app provenance, never a claimed captain
identity or the helper's role convention.

Preview returns the home/registry fingerprint, project identity/version, exact
source vector, profile, limits, allocation, spend, capacity, opening and review
digest. Commit re-derives the review, records its exact request before admission,
then uses Build A's provisioning service. Reservation and every native effect
recheck current source/registry/profile/capability guards. Admission receipts and
provisioning receipts remain separate. Unknown operations retain their identity
and spend; Check saved setup is read-only. Explicit continuation uses the saved
request and cannot replay an uncertain opening.

Lost creation replies now have a separate read-only recovery classification: the
same recorded request may reconcile its create only while its opening is still
reserved (never armed). The saved-setup button remains available for this case.
An uncertain opening remains held; status and Check saved setup perform no
reconciliation or send.

The app review and older Advanced creation path also compare request ownership
under the same journal append boundary. A concurrently accepted older request
cannot be adopted as the new review's child. The loser retains the original
operation rather than creating or pinning another setup identity.

Adding a folder invokes a native folder picker on the host (Windows/macOS/Linux
with Zenity), validates its canonical local identity and updates the registry
through its existing content-CAS writer. Canceling changes nothing. There is no
helper/CLI transport for the new setup actions, and no new Attach path.

An unavailable unadmitted local folder shows its original path and an explicit
replacement action. The action checks the reviewed registry digest, original
row/name/path, current ownership and canonical duplicates before changing only
that row's location. It preserves flags, descriptions and comments. Folder
correction and admission share one registry boundary, outside the native picker;
correction acquires no journal writer. Setup then requires a fresh preview and
confirmation. Admitted projects, retained aliases and saved setup identities
cannot be rebound: the app shows the original path and restoration instructions.

## Shared destination for slice 10

Branch: `fm/fm-smooth-pr6`. File: `client/project-setup.tsx`.
`ProjectSetup` is exported with controlled `open` / `onClose`, plus `theme`,
`compact`, canonical `home`, `hostId`, optional `navigation` and `online` props.
The additive optional `initialProjectName` opens a named eligible project without
previewing, admitting or creating anything. Existing callers remain compatible.
Home's welcome card can mount it on an explicit press; Settings already uses this
same component. It remounts on host/home changes and reads only while open.
Opening a conversation calls the supplied host navigation explicitly; setup never
changes Home's transcript or send target. A Home entry while controls are off
receives a named Help-settings step; enablement is never inferred from opening it.

## Acceptance mapping

| Report acceptance | Evidence |
| --- | --- |
| Unadmitted local project, app-only admission and one persistent mate | Production chooser → supported profile/limits → actual recorded or app-authored instructions → read-only preview → explicit Create → result. `server/project-setup.test.ts` verifies one workspace/session/opening, exact opening bytes, durable unverified app audit and no Attach. `client/project-setup.test.ts` proves preview/cancel create nothing. The browser harness walks the actual Settings and setup components. |
| Precise identity/source/profile/capacity holds before effects | Server tests cover missing folders, duplicate canonical paths, renamed registry, remote URLs, source changes, unavailable models/modes, changed General/home, insufficient headroom and invalid allocations. The final dispatch test changes source after workspace creation and proves no agent or opening follows; reserved spend stays. The ordinary UI names the next step and keeps diagnostics secondary. |
| Reload after admission, lost create/opening reply, original request | Tests restart the actual owned runtime after admission and after lost native replies. Saved review/profile/source vector and deterministic provision request survive; create/opening call counts remain one. Status has no native calls. Duplicate/two-client confirmation and changed-body/request reuse cannot allocate a second identity. The browser and component tests check read-only recovery and exact-request continuation. |
| Existing/stopped/uncertain owners and no silent fallback | Existing conversations open explicitly. Stopped/older setups link to retained Advanced work details. Lost creates offer exact-request reconciliation while uncertain openings hold continuation. Tests verify valid reviewed profiles are reused exactly, unsupported models/modes refuse, and the old helper/policy-import role guards still refuse the new app provenance without the dedicated seam. |

## Independent review fixes

Both P2 reproductions at `8f05e974` are regression tests now. The exported
`ProjectSetup` component retains every existing prop for slice 10.

| Review finding | Acceptance and regression evidence |
| --- | --- |
| Lost-create recovery disabled | `server/project-setup.test.ts` loses a real synthetic create reply, verifies read-only status advertises only the exact recoverable request, restarts the owned runtime, reconciles the same agent and proves one create/one opening with retained spend. The lost-send variant advertises no recovery and sends once. `client/project-setup.test.ts` presses the enabled saved continuation with the original request; Check stays read-only and the existing uncertain-opening assertion stays disabled. |
| Missing-folder repair blocked | Server regression corrects the original missing alpha row, retains its flags/description, creates no journal or native work, then obtains a fresh preview. Changed registry/row fingerprint, duplicate canonical folder, a folder restored during the picker, admitted name and retained alias all refuse correction. Component regression checks the original path, exact correction token and fresh review; retained identities show restoration requirements without a replacement button. |

The browser compares the actual component at `8f05e974` with the corrected
component for both reproductions and retained-folder protection in both themes
and widths. The injected picker and synthetic host create no real project work.

## Captain's live Work details feedback

Read-only inspection used `$PASEO_CLI project ls --json` and the existing
`firstmate.projects.read` RPC. The native project list and FirstMate registry are
distinct; no same-name remote-to-local ownership was inferred. The final census
had four admitted local projects, one unadmitted local project, two remote
projects, and 60 legacy plan membership warnings. An optional project-memory
read refused the existing bounded-context limit; that guard was retained and
the read was not retried. No live files or project/session state were changed.

Work details is a compact header entry with only a neutral actionable count.
The full-width bottom strip is removed. Project mates has an obvious chevron,
starts collapsed, and summarizes ready-to-create, ready-to-set-up and remote
projects. Each compact row names its status and keeps its existing primary
action. Unadmitted local projects open the shared `ProjectSetup`; admitted
projects retain the existing explicit creation confirmation and native guards.
Remote hosts and missing paths are explained in each project's Details, with
the supported next step. No refresh is proposed for an unsupported remote host.

Project identity, path, saved state, versions and scope are under Details. Plans
expand from a count. Expected legacy association warnings become one muted
"Some older plans aren't linked to a project. No action needed." line with the
full list under Technical details. The RPC still returns every original problem
and all guard behavior; additive presentation metadata identifies only known
legacy association warnings. Actual read/corruption failures remain blocking.
Refreshes are silent while pending, following the captain's newer standing rule
over the report's suggested Updating label.

| Live feedback acceptance | Regression evidence |
| --- | --- |
| Compact header, full chat and board height | `live-render.mjs` compares actual Home at installed `fbdf3ae0` against this branch; checks entry geometry, header ancestry and increased chat/board height in both themes and widths. |
| Concrete project reasons and primary actions | `project-readiness.test.ts` covers remote host/URL, missing paths, ready, active, stopped and uncertain state. Component and browser checks open the named shared setup without native effects; admitted Create still opens the existing confirmation. |
| Collapsed section, compact rows, nested plan/technical disclosures | Component regression uses four admitted projects, two remote projects and 60 warnings. Browser fixture matches the live seven-row census and 28 associated Ariadne plans; metadata and plan titles remain hidden until requested. |
| Silent refresh and unchanged safety | Deferred-read test retains the Refresh details label with no Refreshing/Updating text. Read-only runtime regression preserves original warnings and remote identity, with zero native calls and no journal events. Existing recovery/provision tests still pass. |

## Validation

The rebase onto `3b1c1967` keeps both Settings setup destinations and combines
PR 176's silent refreshes and plain routine checks with the compact project-mates
drawer. The routine-check and decision-refresh implementations are unchanged
from main. Affected tests: 232 passed; combined browser checks: Settings 72,
project drawer 52, routine-check drawer 28, quiet refresh 24, and navigation/layout
regressions 32. The live comparison sheets show the combined drawer.

- Typecheck and `git diff --check` pass.
- Focused project setup/runtime/component checks: **81 passed**, including a regression that
  first reproduced the concurrent older-request adoption and passes with the
  atomic guard. Component recovery, settings and template checks also pass.
- The existing slice 5 Settings harness passes all 72 captures/assertion cases,
  retaining its persistence assertions after returning from the new chooser.
- `node docs/smooth-pr6/render.mjs`: 68 captures/assertion cases across light/dark,
  1440×1000 and 390×844. Includes actual chooser/profile/review/result, capacity,
  instruction save, lost reply, uncertain opening, lost-create recovery,
  missing-folder correction, retained-folder restoration and 200% text. No page exceptions
  or document overflow; controls meet 44×44 and keyboard focus returns.
- The Impeccable mechanical scan reported no findings in the changed UI targets.
- `node docs/smooth-pr6/live-render.mjs`: 52 actual Home/board/details/setup
  captures with before/after geometry assertions, light/dark, 1440×1000 and
  390×844, plus 638px/900px headers with a nonempty Needs-you indicator. These
  assert a single row and no overlapping controls. The hosted Needs-you polish
  check first caught the narrow desktop regression. Narrow desktop uses the
  compact Details label without a count badge, retaining its count in the
  accessibility hint and project summary; this leaves room for wider platform
  font metrics. Geometry assertions stay strict. `live-evidence.mjs` produces
  the committed comparison sheets.
- Existing Home harness: 146 capture/assertion cases; review regressions: 32 cases.
- Full local suites use CI's two-worker/60s Windows settings. The missing-folder
  fixture uses an absolute path under its temporary home on both Windows and
  Linux. Final full-suite results are recorded on the PR alongside hosted checks.
- Current hosted results are attached to [PR #174's checks](https://github.com/LiterallyBlah/firstmate/pull/174/checks).

The browser host and receiver are synthetic. No real project/session/timer was
created, no live plugin was reloaded, and no source was written in the captain's
home. Native picker cancellation/path admission is exercised through an injected
picker; an actual desktop dialog, native phone keyboard and screen-reader checks
are not claimed. The non-technical live opt-in release matrix remains slice 10.

## Visual evidence and copy

Each comparison contains the actual pinned-before Settings review and current
chooser, permission/spend review and result. The model and budgets in the fixture
are illustrative, never production defaults.

| Theme and width | Before → choose → review → result |
| --- | --- |
| Light desktop | [Screenshots](smooth-pr6/evidence/light-desktop.png) |
| Dark desktop | [Screenshots](smooth-pr6/evidence/dark-desktop.png) |
| Light phone | [Screenshots](smooth-pr6/evidence/light-phone.png) |
| Dark phone | [Screenshots](smooth-pr6/evidence/dark-phone.png) |

| Review fixes: before `8f05e974` and after | Lost create, missing folder and retained identity |
| --- | --- |
| Light desktop | [Screenshots](smooth-pr6/evidence/review-light-desktop.png) |
| Dark desktop | [Screenshots](smooth-pr6/evidence/review-dark-desktop.png) |
| Light phone | [Screenshots](smooth-pr6/evidence/review-light-phone.png) |
| Dark phone | [Screenshots](smooth-pr6/evidence/review-dark-phone.png) |

| Captain live feedback: before installed `fbdf3ae0` and after | Home, board, collapsed/expanded project details |
| --- | --- |
| Light desktop | [Screenshots](smooth-pr6/evidence/live-light-desktop.png) |
| Dark desktop | [Screenshots](smooth-pr6/evidence/live-dark-desktop.png) |
| Light phone | [Screenshots](smooth-pr6/evidence/live-light-phone.png) |
| Dark phone | [Screenshots](smooth-pr6/evidence/live-dark-phone.png) |

Narrow desktop before/after: [light](smooth-pr6/evidence/live-narrow-light.png),
[dark](smooth-pr6/evidence/live-narrow-dark.png).

Copy follows the report: available projects are setup opportunities rather than
decisions; ordinary labels use Ready to review, Already set up, Saved setup and
Checking whether setup finished. Full source vectors, digest, opening and
unverified provenance are in Setup details. Actual model permission power,
cumulative limits, allocation, spend and effects stay in the main creation review.
No setup opportunity or progress item is added to Needs-you.
