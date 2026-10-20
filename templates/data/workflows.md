# Plans and the agenda

Every work request has a plan. Read open plans before drafting another: a follow-up revises the same
plan. Questions, Bearings, steers, answers and maintaining a plan do not need plans.

`node tools/workflow.mjs plans` lists open plans; `plans --all` includes completed and declined history.
`plan <id>` reads one. A plan finishes when every node has a recorded terminal outcome; one agenda
item reports that completion without dropping any evidence. `agenda` lists what needs
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
writes `plugin-data/firstmate/workflow-plans/`; `data/plans/<id>/plan.md` is a readable projection.
