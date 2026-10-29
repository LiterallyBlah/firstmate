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

Adding a folder invokes a native folder picker on the host (Windows/macOS/Linux
with Zenity), validates its canonical local identity and updates the registry
through its existing content-CAS writer. Canceling changes nothing. There is no
helper/CLI transport for the new setup actions, and no new Attach path.

## Shared destination for slice 10

Branch: `fm/fm-smooth-pr6`. File: `client/project-setup.tsx`.
`ProjectSetup` is exported with controlled `open` / `onClose`, plus `theme`,
`compact`, canonical `home`, `hostId`, optional `navigation` and `online` props.
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
| Existing/stopped/uncertain owners and no silent fallback | Existing conversations open explicitly. Stopped/older setups link to retained Advanced work details; uncertain new setups keep their exact saved request and hold continuation. Tests verify valid reviewed profiles are reused exactly, unsupported models/modes refuse, and the old helper/policy-import role guards still refuse the new app provenance without the dedicated seam. |

## Validation

- Typecheck and `git diff --check` pass.
- Focused acceptance: 48 tests across project setup, settings and template inventory.
- The existing slice 5 Settings harness passes all 72 captures/assertion cases,
  retaining its persistence assertions after returning from the new chooser.
- `node docs/smooth-pr6/render.mjs`: 44 captures/assertion cases across light/dark,
  1440×1000 and 390×844. Includes actual chooser/profile/review/result, capacity,
  instruction save, lost reply, uncertain opening and 200% text. No page exceptions
  or document overflow; controls meet 44×44 and keyboard focus returns.
- The Impeccable mechanical scan reported no findings in the changed UI targets.
- Final frozen-tree full local suite and hosted checks are pending at this update.
  An earlier default-worker run hit Windows timing failures. A later two-worker run
  passed 3,438 tests with four skipped and one template-inventory mismatch because
  its module was loaded before a template was added during that run; the final
  focused inventory passes. The final run uses CI's two-worker/20s Windows settings.

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

Copy follows the report: available projects are setup opportunities rather than
decisions; ordinary labels use Ready to review, Already set up, Saved setup and
Checking whether setup finished. Full source vectors, digest, opening and
unverified provenance are in Setup details. Actual model permission power,
cumulative limits, allocation, spend and effects stay in the main creation review.
No setup opportunity or progress item is added to Needs-you.
