# Plan decisions — audit batch 5

Implements finding 5 of the FirstMate frontend audit at
`d94082c28a677da17b514f4019928b3f99fc8d04` and the captain's three recorded
23 October policies: future answers stay read-only until approval and evidence;
one compact plan-ready chat reference; sidebar drawer entry for New only.
The canonical policy record and audit evidence remain untouched under the
FirstMate home's `data/fm-tabs-ux-decisions/` and `data/fm-tabs-ux-review/`.

The branch is stacked on PR140's exact reviewed head
`3bb688a4d030884b185f4e1269ca3da7aa9756de`, which includes reviewed batch 2.
It also merges PR138 at `da554c911a527caaf7fb2766847f6d3f8dd3c075`.
The integration retained batch 1's optional Plans heading and filter labels,
but incorrectly dropped batch 3's guard that keeps a selected plan filter
clearable when its plan is absent from the menu. The accepted correction below
restores that guard alongside batch 3's scoped browsing state and task navigation.
No parent branch was changed. Final ancestry/retargeting after parent landings
and integration with the mobile batch stay with the first mate.

Plan reviews now project into the same Needs-you queue as backlog and due plan
decisions. List, Board and All use the existing decision row/card with a Plans
icon, waiting time and Review action. The drawer counts a review in its queue
position and opens the existing plan dialog; it never sends a review through
the backlog answer RPC. The Deck popover uses that same projection once.
Plan decision details name their parent, list the steps they unblock and open
the existing plan dialog using batch 3's shared workflow context. Approve uses
the theme accent; Decline sits separately; empty history headings are omitted.

New answers require an active approved plan, an unanswered unheld decision and
all exact dependency milestones, including cross-plan evidence. The shared
gate drives the dialog, server Needs-you projection and serialized store append.
Waiting time includes the latest approval that made the decision actionable.
Revision, subject hash, home identity, request-id idempotency and existing role
authorization remain enforced. No run, merge, deployment or permission authority
is added. Tests construct only isolated synthetic homes.

Compatibility is additive: `review` metadata and `decision.ready` are optional
RPC fields. New clients keep drawer answers read-only if an older host cannot
confirm readiness; the plan dialog derives readiness from its plan snapshot.
An older client may still display enabled early options, but an updated server
refuses their new submissions. Historical early answers remain readable and
accepted request retries replay before the new append gate; neither the ledger
format nor historical reducer semantics are migrated. A committed legacy-log
regression verifies read, replay and refusal to replace the historical answer.

The chat reference is derived from durable plan identity/history and keyed by
home plus plan, never appended by a polling effect. It contains title and Review
only, becomes an Open reference after review, and uses the existing tenure and
loaded-history boundaries. Repeated snapshots, reconnects and revisions produce
one row. The whole sidebar row opens the drawer only for fresh New decisions;
otherwise it opens Home, where the existing Needs-you control is one press away.
There is no claim of a separately pressable native sidebar badge.

Validation evidence is in ignored `.local/tabs-decisions/`. Before-fix checks
against the reviewed parent tree reproduced four failures: early store acceptance,
missing review queue membership and enabled future choices on active/held plans.
Working-path controls passed. The original affected run at
`d45aae0dde6e70240148008c4d1d516f2109fe0f` covers 23 files and 424
assertions, including actual Chat, PlanDialog, List, Board and drawer components,
stale devices, readiness compatibility, historical replay and parent navigation.
Typecheck and Paseo 0.11 compiler/Hermes checks pass. The full diff, including
the parent integration, was self-reviewed; the initial reviews then identified
the two corrections below. Repository CI is recorded in the PR.
The existing Plans fixture assertion was updated to require read-only future
options; it was not run locally while capture is parked.

The two initial independent reviews remain recorded at the original `d45aae0`
head: Astra approved; Opus requested two corrections, both accepted by the first
mate. This continuation restores exactly the reviewed parent guard
`if (!plans.length && !selected) return null;` while keeping the Plan filter
labels. A selected implicit plan keeps its control after it leaves the menu,
including on approval, and All plans and tasks clears the shared filter without
another workflow action. The shipped `templates/data/workflows.md` now teaches
the same due-only rule as the UI/store, with historical early answers and
accepted request-id/body replay retained. No canonical home guide was edited.

Separate correction evidence is under
`.local/tabs-decisions/initial-review-fixes/`; all original evidence and reviewer
probes are preserved. The qualified before run at `d45aae0` has two filter
failures and a passing no-filter control. The same three regressions pass with
the reviewed `3bb688a` parent file. Source and regression hashes accompany both
receipts. Earlier harness receipts are also retained: the mock first needed
the existing dimension API, and the parent control needed a label-independent
opener because its older labels differ. The corrected scoped run passes 50
assertions across the new PlansControl regression, existing workflow-plans,
fleet-plans and home tests. The unchanged 424-pass evidence above is reused at
its original head, not represented as a fresh corrected-head broad run.
Corrected-head typecheck, compiler/Hermes and CI results are recorded separately
in the PR. The scoped delta is self-reviewed; no new independent review round
is claimed. The first mate retains direct verification of these two repairs.

Baseline screenshots S07, S15 and S24 were inspected with their manifest; they
show the queue mismatch, detached review button and flat plan actions. They are
baseline evidence only. Fresh changed-screen wide/phone light/dark captures,
including Paseo's real palettes, remain **pending landing gates**, as do mobile
and parent integration. Component assertions do not prove visual layout. No
browser retry, direct Playwright, installation/reload, daemon restart, live prompt,
real decision/permission answer or canonical-home write was performed. Native
tab focus, native phone behavior and installed-daemon behavior remain unverified.
