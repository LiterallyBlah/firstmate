# Plans and the agenda

Every work request has a plan. Read open plans before drafting another: a follow-up revises the same
plan. Questions, Bearings, steers, answers and maintaining a plan do not need plans.

`node tools/workflow.mjs plans` lists open plans; `plans --all` includes completed and declined history.
`plan <id>` reads one. A plan finishes when every node has a recorded terminal outcome; one agenda
item reports that completion without dropping any evidence. Ship done stays in flight until landed;
finished implicit plans leave the agenda entirely. `agenda` lists what needs
handling, in priority order; it changes no business records. `--json` is accepted on every command.

Draft strict JSON with `plan draft --file data/plans/<id>/draft.json`. The format is
`firstmate.plan/1`: `id`, `title`, `request: {text, at}`, `budget: {agents, turns}`, `nodes`.
Each run has `kind: run`, `id`, `title`, `summary`, `workflow: task@1|scout@1`, `launch`, `after`.
`launch` is the launch helper's request with a complete `brief: {file: data/<id>/brief.md}`.
Each dependency is `{node, reason, on}`. Reasons: builds-on, needs-evidence, decision, shared-state.
`on` is done, landed or answered. A decision dependency uses reason decision and on answered.
Decision nodes have `kind: decision`, `id`, `title`, `summary`, `after`, `options: [{id,label,consequence}]`,
`recommendation` (option id or null), and `rationale`. At least one run must need each decision.
References can cross plans. Cycles, duplicate task identities and unknown fields are refused.

Two or more runs or any decision wait for review; one run sails. The captain's own words can override
this with `request: {text, at, posture: sail|review, quote}`. Standing-order parsing comes later.
For approval recorded from chat in this slice, use `plan approve --plan <id> --expected <hash>
--quote <captain's words>`. This records the first mate as its author; approval grants no merge authority.
Each one-step run costs at most one worker and one initial worker turn. Reviews/relaunches require a
recorded revision and additional budget; a revision never erases used runs or their evidence.

`plan revise --file data/plans/<id>/revision-2.json --expected <current plan hash> --reason <why>`
submits a whole new definition. Started runs and answered decisions stay pinned. Changed assumptions
need a replacement decision and a revised dependency, never a silent reuse of old evidence.

`start --plan <id> --node <id>` commits the start intent and prints a launch request. Save that request
under the task and pass it to `launch.mjs prepare --file …`. It prints exact local MCP calls; only the
first mate makes them. `launch.mjs` also creates an implicit one-run plan automatically for a new small
request. No extra drafting call or approval message is needed, and its backlog line stays as before.

`record --plan <id> --node <id> --attempt <uuid> --state running|done|landed|failed|cancelled|unresolved
--evidence <verified evidence> [--agent <id> --workspace <id>]` accounts for the effect. Running needs
both identities. Check the actual report or PR and head/checks before recording completion; a worker's
status line is never proof. Ship done means its deliverable is verified; landed requires the existing
merge/local landing checks. Cleanup remains the charter's separate decision. These slices do not run
PR/CI checks for the first mate: the agenda marks running/starting work as unobserved until handled.

`record --plan <id> --told <agenda-id,...>` records a message already delivered to the captain;
`--handled <agenda-id,...>` acknowledges other items after their cause was handled. Never acknowledge
a start as a substitute for starting or a missing brief as a substitute for supplying it.
Agenda order: escalations, captain answers/edits, replans, ready runs, things to tell, books out of step.
Keep the heartbeat as a backstop. An empty agenda is a quiet turn.

Every effect checks the current role. `--request-id <uuid>` reuses the same transport operation on a
lost reply; different content under that id is refused. On timeout inspect the saved request and plan.
Never retry a create by preparing another launch. A broken hash chain fails closed. The daemon alone
writes `plugin-data/firstmate/workflow-plans/<home digest>/`; `data/plans/<id>/plan.md` is a readable projection.
Home identity is the absolute path (case folded on Windows). Moving a home starts a separate namespace;
switching back recovers its history. Old unscoped logs are never silently imported: reconcile them
explicitly before reuse. Missing expected-tip files also require explicit reconciliation; no shorter
history is treated as a fresh budget. A bad plan is quarantined and listed as an escalation while
healthy plans and legacy decisions remain readable.

`release --plan <id> --node <id> --attempt <uuid> --evidence <inspection>` releases only a starting
intent with no accounted worker and no issued launch record (a dry-run record is harmless). Restarting
uses that same attempt and budget. Lost prepare replies replay the same transport id. Once a launch
record exists, inspect it; do not release or repeat creation.

`invalidate --plan <id> --node <id> --attempt <uuid> --evidence <changed assumption>` appends a
correction without deleting the original outcome or refunding its budget. Dependencies stop using
that result. Revise the plan and obtain renewed evidence/review before reusing the work.
After checking new evidence against the changed assumption, `validate --plan <id> --node <id>
--attempt <uuid> --expected <hash> --evidence <renewed verification>` restores that result's
applicability. The original result, invalidation and renewal all remain in the event history.

`replace --plan <id> --node <id> --attempt <uuid> --expected <hash> --kind relaunch|promote
--agents <cumulative cap> --turns <cumulative cap> --evidence <inspection and authority>` records a
deliberate manual replacement or scout promotion. First inspect and stop/archive a wedged worker;
promotion requires its verified scout report and the captain's authority. Preserve the workspace.
The transition retains prior attempts, advances the revision and reserves additional cumulative budget.
Increases over 1.5 times the approved worst case require approval. Start the new intent, make the
same-workspace calls from charter §7/§8 manually, then record the actual identities against its new
attempt. The launch helper deliberately remains limited to new worktree creation.

`node data/backlog-lint.js` uses the daemon's exact strict backlog observer through `workflow.mjs lint`.
It accepts opaque legacy blocker prose; only recognized ID lists acquire dependency semantics.
An unavailable daemon is a lint failure, never a clean result. No separate parser replica can drift.
