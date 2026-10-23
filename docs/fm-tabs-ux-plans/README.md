# Plans navigation and browsing — audit batch 3

Stacked on PR139 (`fm/fm-tabs-ux-discuss`) at the exact reviewed recovery head
`26a7baeece4ce2fec58d0f18322a891e034269c4`. This batch addresses finding 2 and
the related plan filter/card presentation findings from the 22 October frontend
audit at `d94082c28a677da17b514f4019928b3f99fc8d04` (S02, S17–S23, S30).

Graph step details, List steps and the plan dialog link to matching task cards and
recorded workers. Matching reuses `workflowNodeOwnsCard`, requiring the explicit
plan, task, project and host association. Converse also requires the recorded
worker id to match the card, with the saved remote server id in its existing
conversation key. Missing, archived, changed-attempt and unavailable-host cases
explain why Converse is unavailable. No title matching or worker creation occurs.

The additive `FleetShell.openTask` handoff uses the public Home screen params,
following batch 2's installation-owned navigation. Its reference contains the
session scope, plan, node, card key and optional existing conversation key.
Home rechecks that reference before selecting List, the plan/host filters and
the task. An unsaved remote host uses All machines so its task stays visible.
Show task closes a covering conversation, expands the real card and
measures it within the native ScrollView; Converse opens the existing drawer.
Done/Later and decision details can reveal a target without rewriting their saved
fold choices. Navigation never submits a workflow or decision action.

Plans search, Graph/List mode, expanded plans, automatic folds, paging, vertical
scroll, graph horizontal scroll and the plan filter stay in a session Map keyed
by selected host, absolute home, mate id and workflow home id. The filter is shared
by Home/Crew/Board and included in both task-view and decision-drawer warnings.
The compact plan chip uses the shared grouped progress, and disappears when
filtered to its plan. The how-to appears on the first populated Plans visit;
running/next facts, budget, posture and the graph legend remain below expanded
steps. Waiting, attention and dependency evidence remain available. Graph layout,
height and removed-node ordering are unchanged; those belong to the separate
graph follow-up task.

The fresh regression failed on the pinned base when reopening Plans cleared its
search (11 existing controls passed). The navigation probe also fails on an
archived copy of that base because graph details have no Show task action.
The focused tests exercise scoped local/remote matching, invalid handoffs,
Home/Plans/Crew/Board round trips at 390 and 1440 points, plan-filter warnings,
scroll/fold/page restoration, existing dialogue recovery, and actual TaskList /
CrewCard expansion and measurement for in-hand, Later, Done and decision rows.
The measurement test uses synthetic native refs; it is not a browser/device test.

Self-review covered the complete delta, scoped navigation and recovery paths,
card/decision reveal, session identity, filter warnings and preserved plan guards.
Compact plan links are siblings of the card toggle, retaining the reverse link
in Converse details. A standalone WorkflowSurface without host identity keeps
its previous read-only RPC set; its optional navigation fleet observer is disabled.
Final affected tests, typecheck and Paseo compiler/Hermes results are recorded in
the PR and ignored local evidence. No server/shared workflow contract changed.

The initial independent Astra review at
`50d9bf00581ef48c81f0ca84aa6beab4f723ec15` identified two accepted navigation
defects. Six component assertions reproduced them: Show task/Converse from a plan
inside Needs you left its decision drawer covering the work at 390 and 1440 points;
a stale worker handoff had no visible recovery on Home Plans at either width.
Ordinary Home Plans navigation and stale recovery on List passed their controls.
The follow-up closes the decision presentation only after a task handoff passes
the existing identity checks, and renders rejection text in Home's shared banner
area rather than only inside List/Board. It leaves rejected identities refused,
records and unsent messages intact, and normal conversation retention unchanged.
The committed regressions check the intended visible target (task or conversation),
pointer/accessibility availability, unchanged decision data and stored drafts and
attachments. Before/after checks and a separate final-head bundle are retained in
`.local/tabs-plans/p2-navigation/`; earlier evidence is preserved. This follow-up
addresses those two findings only, with no new general review or broad local suite.

The initial independent Opus review retained one additional accepted defect (B1):
Home kept passing a Show task reveal after it had already scrolled, reopening the
task and its Done/Later group on later List mounts. List now acknowledges a
successful scroll by request identity; Home consumes only that matching request.
The current group stays open until folded, while subsequent mounts honor saved
folds and card collapse. A second explicit handoff still reveals the task. The
two retained probes became six failing-before regressions covering the actual
List/card and compact First mate / wide Plans, Home files and Deck round trips.
The checks also retain the initial reveal and reject an old acknowledgement for
a newer request. Task/worker validation is unchanged. Separate B1 evidence lives
under `.local/tabs-plans/b1-reveal/`; earlier reports and evidence are retained.

Fresh visual verification is **pending**, deferred by the captain rather than
waived. The original audit screenshots remain baseline evidence only. The copied
actual-component synthetic preview and all before/after check evidence are kept
under ignored `.local/tabs-review/` and `.local/tabs-plans/`. Wide/phone light/dark
capture, including Paseo's real palettes, still gates landing. Native tab focus,
native phones and installed-daemon behavior remain unverified. No browser tool,
Playwright fallback, plugin installation/reload, daemon restart or merge was used.
