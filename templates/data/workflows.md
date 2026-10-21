# Plans and the agenda

Every work request has a plan. Read open plans before drafting another: a follow-up revises the same
plan. Questions, Bearings, steers, answers and maintaining a plan do not need plans.

`node tools/workflow.mjs plans` lists open plans; `plans --all` includes completed and declined history.
`plan <id>` reads one. A plan finishes when every node has a recorded terminal outcome; one agenda
item reports that completion without dropping any evidence. Ship done stays in flight until landed
or explicitly closed without landing as an evidence-only experiment (see `close` below);
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
this with `request: {text, at, posture: sail|review, quote}`. Otherwise posture is read at draft/revise
from the plan-posture entry in one fenced block in `data/captain.md`:

```standing-orders
plan-posture: review
```

`review` reviews every plan, `sail` releases plans within their budgets, and `default` uses D2.
Absent/unreadable blocks fall back to D2; malformed, duplicate or unknown plan-posture values
require review. Other entries are ignored here; merge and routing orders remain in slice 6.
The resolved source is recorded in the event and shown in the plan. An implicit launch held by an
order creates only its pending plan, without creation instructions; approve it, start that same node,
then use the returned bound launch request. No block is installed into existing captain records.
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

An evidence-only experiment may have been started as a ship run even though its branch is only a
record of the trial. After inspecting its report and confirming there is no deliverable to merge or
deploy, use `close --plan <id> --node <id> --attempt <uuid> --expected <current plan hash>
--evidence <why this verified trial has nothing to land>`. This appends a close-without-landing
receipt to a verified `done` ship attempt. It preserves the original outcome, report, attempt,
worker/workspace and budget; it does not invent a merge, archive a worker, or permit another run.
Running, stale, invalidated or individually held work cannot be closed. Replan any pending landing-dependent
work first. A closed trial satisfies `done` evidence dependencies, never `landed` dependencies.
It leaves open Plans and Bearings and stays in finished history, labelled **Closed without landing**.

Bearings sends only a compact overview: one line per open plan, plus due and upcoming decisions.
The captain sees the short request and a collapsed Plan overview disclosure; the mate receives the
overview and reads full plans with `plan <id>` when needed. Browsing or requesting Bearings records no outcome.

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
healthy plans and legacy decisions remain readable. A retry of the original mutation automatically
repairs a crash between a new expected anchor and its event, under the mutation lock: only one final
unpublished anchor may be dropped, the entire surviving prefix must validate, and no launch record
may name an attempt unknown to it. A durable recovery receipt remains in history. If the event exists
but its publication marker was interrupted, retry completes that marker and reuses the committed
attempt. Reads never repair files. Old anchors without publication metadata cannot be rolled back.

Publication markers under `.published/` are written after the event and before any result is exposed.
They detect losing the newest event and its anchor together. These local files are not a trusted
external backup: coordinated loss of the log and its tips/publication metadata can still hide a
truncated history, especially in older logs. Restore a known backup and reconcile worker/launch
identities after such loss; never treat it as permission to restart work.

Only names matching the plan-id format are considered plans. Other root entries, including
`desktop.ini` and `Thumbs.db`, are reported as ignored warnings in the agenda and do not hold work.
A quarantined plan holds only conflicting task/host scopes. Publication records retain checked
ownership capsules (scopes, attempts, worker/workspace identities and budget), even if the first
event becomes unreadable. Older logs use their verified prefix. If all ownership metadata was lost,
only the known plan/task id can be held, across hosts; restore a known backup to recover other lost
identities. Unrelated launches and verified outcome records remain available.
Dependency references use bare node ids: a quarantined prerequisite cannot borrow evidence from a
same-named task on another host. Its dependents stay held for replanning with an unambiguous id.

To retire an unreadable plan, inspect `node tools/workflow.mjs plan <id>` first. Its `quarantined`
record gives the file fingerprint, problem, retained scopes and attempts. After inspecting any
workers and launch records, run `node tools/workflow.mjs retire --plan <id> --expected <fingerprint>
--evidence <inspection> --request-id <uuid>`. Both transport and daemon require the current first mate.
Changed files require another inspection. Retirement appends a receipt under `.retired/`, with the
evidence, author and retained inventory; it preserves all log, anchor and publication files. It
closes the quarantine escalation, not the worker. The plan id and its task/host reservations stay
retired permanently: retirement never refunds budget, resets attempts or permits a fresh duplicate.
Restore backups for investigation, or plan genuinely new work with a new task identity.

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


## Plans on the board

Larger plans have a chip and a Plans filter. The dialog shows the runs, models, dependencies, worker
and turn bounds, decision options and revision history. Approve authorizes work only. Approve with
edits can change an unstarted run's model/thinking, saved host or dependencies, or remove it. Removing
a prerequisite holds its dependents until the captain approves revised dependencies. Started runs
stay pinned. Ask for changes records the captain's text and wakes the first mate to draft a revision;
Hold stops new starts while preserving running work; Decline applies only before anything started.

Now contains due decisions and plans awaiting approval. Coming up lists future choices with their
dependencies, what needs them and the recommendation. Coming up contributes nothing to the badge.
Decisions may be answered early. Every action carries the current plan revision and subject hash;
a stale or second-device answer is refused. Viewing, closing or filtering is never approval.
The Deck still contains real workers only. Multi-step rounds and merge gates arrive in later slices.

A captain answer in chat may be recorded by the current first mate with `plan action --file …`:
`{op: captain, plan, revision, subjectHash, action: approve|changes|hold|decline|answer, text}`.
Quote the captain's actual words in text; answer also needs node and option. Read the subject hash
from `plan <id>` or the board/read RPC, never invent it or treat a model's interpretation as the captain's answer.
Bearings reads plans for Captain's Call, Underway and Charted Next, including Coming up, without
changing any business records.
Chat-recorded actions show the first mate as their author, distinct from a captain button press.
A stale action says the plan changed since it was opened. Historical actions are not reauthorized
against a new projection during replay; their raw committed hashes and chain are still checked.
Damaged plans show separate problems without hiding unrelated fleet cards or captain decisions.
Their unknown actions make the displayed count a lower bound. Finished implicit plans leave the
agenda, board projection and Bearings; Recently Landed covers at most ten explicit results in seven days.
