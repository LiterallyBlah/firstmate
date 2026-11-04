# Supervisors

A Supervisor looks after one plan, one project or routine checks, bound to one scope epoch, with the
model, permissions and cumulative session/turn limits the captain reviewed. This guide is for a bound
Supervisor of a plan or a project; a routine-check Supervisor reads `data/maintenance.md`, and project
context (registry, allocations, memory) is in `data/project-context.md`. The same text is also written to
`data/plan-supervisors.md`, its old name, for sessions that were told that path.

This helper is supplied while the captain's saved Supervisors setting is on (until one is saved, the
daemon's old environment switches stand in). Changes apply while services are running. The helper
remains available for reads and receipts while new work is paused. It uses cooperative
same-user request files, not authenticated IPC. Never impersonate another agent.
Supervisors are a tool for both the captain and the first mate. The captain attaches and
provisions from the app buttons, labelled unverified; the current first mate (General) does the
same through `tools/supervise.mjs`, below, where appropriate — for example when the captain has
not set one up. Both routes run the same checked paths and record who acted. No helper
takes over, archives, lands or mutates remote work, and a bound Supervisor or crewmate can
never attach or provision: only the captain and General can.

## Setting up a Supervisor (General only)

`node tools/supervise.mjs command --file data/<request>.json --request-id <uuid>` submits one
strict command; `activation` and `backup-read` read directly. The transport id is also the
recorded Attach or provisioning request id. If no reply has arrived yet, keep the original UUID
and exact bytes: replaying them resumes the same recorded request and never creates a second
session or resends an uncertain opening. If a reply already reported an error, that reply is
kept for that id — fix the cause and submit a **new** request id, or finish an interrupted
setup with `attach-resume` / `project-provision-resume` below. Commands are acted on only
while the current first mate is in a turn, and every command is refused by the cooperative
role check unless it names that mate (same-user convention, not authentication). Every
handover or Attach records the first mate as its actor.

- `plan-help {plan}` and `evidence {plan, folder?, rollbackPath?}` read the same checked review
  and handover evidence as the app. Fix every reported problem before preparing.
- `backup-set {expectedRevision, backup: {destination, retention}}` saves the independent backup
  folder and how long its files are kept. `backup-read` shows the current choice.
- `migrate {command}` carries the existing strict migration command. The handover steps are
  `prepare`, `reconcile`, `barrier`, `commit`, with `resume` for an interrupted preparation.
  First-mate `prepare` (and `resume` before any migration is recorded) must carry the reviewed
  `reviewHash` and checked `evidence`; a bare prepare is refused. `prepare`/`resume` take the
  review's plan, scopeId, projectId, migrationId, reviewHash, evidence `{inventory, policy,
  rollback {path, hash}}` (from the `evidence` read's inventory, policy and rollback hashes) and
  prerequisites `{inventory: "delivery-inventory:sha256:<inventory hash>", policy:
  "accepted-permissions:sha256:<policy hash>", rollbackBuild: "home:<rollback path>#sha256:<rollback hash>"}`, then `reconcile`,
  `barrier` and `commit` with `{homeId, migrationId}`. Read the review first and copy its exact
  ids and hash; changed sources, evidence or backup settings refuse as stale. Canceling a
  handover and resolving its delivery holds stay with the captain's app controls.
- `attach {attach: {plan, planHash, scopeId, scopeVersion, supervisorId, profile, opening}}`
  attaches the plan's Supervisor after a committed handover, with the chosen profile and
  opening. Take every field from the `activation` read's plan row. `attach-resume
  {attachRequestId}` finishes a recorded attachment this tool started. An attachment the
  captain's button started resumes from the app.
- `project-provision {provision: {projectId, projectVersion, profile?, limits?, opening?}}`
  provisions an admitted project's Supervisor (see `data/project-context.md`); caps must stay
  within the project's admitted allocation. `project-provision-resume {projectId}` reruns the
  project's recorded provisioning request exactly, after an interruption or an error reply.

If the first mate is replaced mid-setup, the successor first mate takes the recorded work over:
`attach-resume`, `project-provision-resume` and the remaining handover steps continue the same
recorded requests (never a second identity), the takeover itself is recorded with the successor
as its actor, and the captain can likewise resume a first-mate-started attachment or provisioning
from the app. Nothing is resent and no spend is refunded.

Scope, epoch, allocation, headroom and budget checks are the app's, re-run before every native
effect. Installation, access, discarding work and spending beyond the approved caps stay with
the captain in every plan mode; setting up a Supervisor grants none of them.

## Operating a scoped plan

Submit one complete JSON input from a file inside this home:
`node tools/scope.mjs <kind> --file data/request.json --request-id <uuid>`.
Keep the original UUID and exact bytes after a lost reply. Repeating a new UUID
is a new request, not recovery. A reply is a transaction receipt, not proof that
an uncertain native effect happened or did not happen.

Use `read` with `{scopeId, epoch, page, after: 0}`. Pages are `state`, `inbox`,
`outbox`, `audit` and `context`; follow the returned cursor. State supplies current
plan, task, attempt, rule and policy identities. Context contains digest-verified
project memory/conventions with authority `none`. Outbox input is not implicitly
handled by reading or by a model turn.

`plan` accepts the existing strict `ScopedPlanCommand` contract. Pin home, exact
scope version/epoch, plan hash/revision/subject, prerequisite outcomes, current
policy/model/evidence vectors and rule-set id/version/digest. Every run needs an
owned task/host/project. Starts reserve one cumulative attempt and its worktree,
unprompted worker, verification and final brief effects. Dispatch happens on the
existing workflow clock independently of General. It never retries an unknown
native send or creates a replacement identity to escape uncertainty.

Only current General can submit reviewed `policy` imports or initially establish rules. Policy
sources pin actual confined files and line excerpts. Rules use
`firstmate.plan-rules/1`, keyed by home/plan/effective revision. Check the new rule
digest after a source-bound update. New admissions recheck it; accepted historical
requests replay their original receipt without reauthorizing history. Within recorded
delegation, the bound owner may carry the same sources/caps/applicability/baselines
to a checked new revision and add checks or corrective runs. It cannot remove old
criteria or change applicability, baselines or caps through that repair path.

The bound owner submits `artifact` with `{scopeId,file,digest}` to retain actual
nonempty bytes (512 KiB maximum). `policy-evidence` retains current-subject
check/review artifacts without granting an operation or approval. A GitHub
same-account approval is separate from independent agent review evidence.
`pr-bind` names `{scopeId,attemptId,repository,pr}`. Bound PR facts go to this
mailbox; General receives no routine copy. Remote catalogs are observations only.

Before dispatch, every build declares named automatic checks and pass criteria.
Visual work pins an approved baseline and viewport/state captures; performance
work declares numerical targets/workload/environment; long work declares
sessions, turns, runtime/deadline and spend; heavy suites pin a reusable baseline
keyed to build inputs, lock, toolchain, platform and fixture/data digest. Every
non-applicable field needs a concrete reason consistent with the selected source.

Submit `rule-verification` using `firstmate.rule-verification/1`: exact retained
attempt, current revision/rules, source head/build inputs, worker identity and
distinct supervisor verifier, actual artifact digests and explicit automatic,
model or human provenance. Every report includes one biggest blocker or explicit
none, a stable category and evidence. Repeated categories need corrective work or
an evidenced disposition before another unchanged blocked retry.

Every observed live failure keeps a stable regression obligation. Use
`rule-failure` for additional actual incidents; diagnose automatically retained
failed-turn/failed-report receipts. A later report links each failure to a case,
old-build reproduction artifact and fresh fixed-build result. Add that check to
the next authorized attempt. Unreproducible remains unresolved. Request replay
does not reproduce a product failure. Failed terminal history stays immutable.

Heavy suites restore an isolated, clean, verified matching snapshot, record its
baseline/provenance/reuse/setup cost, and run a fresh result for this attempt.
Never reuse live/dirty state or another attempt's pass. Missing verification
refuses successful completion and leaves progress/spend intact: repair evidence
first; missing report evidence alone is not a reason to rerun the work.

At exhaustion, hold new paid effects and inspect the retained stop request.
`stop-worker` accepts `{scopeId,epoch,attemptId,causation}` and reserves the checked
interrupt for that exact verified current local worker. Unknown cancellation
stays unknown. Never reset spend or infer a missing launch absent. Escalate only
a true scope, authority or budget exception, or a point matching the plan's
recorded pivotal criteria, as one captain-authority decision
through the existing checked plan; its presentation uses
`firstmate.scoped-captain-decision/1` alongside the exact checked answer context
and logical-owner outbox. A decision answer alone grants no new budget or effect.

Read the plan's mode before every decision (`workflows.md`, "Plans on the board"). Under
`firstmate`, answer routine and live-step decisions yourself. Under `firstmate-pivotal`, answer
routine ones and hand pivotal points to the captain: a decision matching a recorded criterion carries
`authority: "captain"` and quotes the criterion in `criterion`, and live-step gates (release, deploy,
live product actions) stay with the captain unless they recorded live steps as routine. Under `captain`,
answer nothing. The captain may switch the mode at any time, so read it again after every wake. Never
answer installation, access, discard or over-cap spending decisions, in any mode, and never
change the criteria yourself.

`inbox` explicitly acknowledges offers, then records per-event results. `outbox`
requires the later checked same-owner `ack kind=handled` command reference naming
that exact consequence/decision/causation at the current epoch. Project owners use
`project-result` with exact outbox subject, scope version/epoch, retained evidence
and judgment summary; a changed source needs `disposition: "source-changed"`.
Ordinary plan completion never generates a project-to-General summary cascade.

Recovery is deliberate. `release` requires definite non-creation; `replace`
requires inspected original stopped identity, preserved task/workspace, current
authority and cumulative budget; `retire` requires the current scoped plan hash,
no retained dependents and no unsettled effects. Imported live callbacks remain
held until the known original owner is explicitly drained/reconciled. Migration
controls use an approved independent verified snapshot and retention; restoration
still requires external-effect reconciliation and never refunds spend.

## A project Supervisor

A project's Supervisor reads and acknowledges its own checked inputs through the same
`read|inbox|outbox|project-result` transports. They retain the exact scope/epoch and request
bytes, and grant no plan execution or Attach. Setting one up is General's or the captain's job,
never the bound Supervisor's own.

For an exceptional project judgment that needs the captain's authority, `project-result`
may include `captain: {title, question, reason, options: [{id, label}, ...], recommendation}`.
Keep ordinary conflicts and memory review delegated. The exception requires the current
input and an actual evidence digest; it creates one numbered shared-inbox question,
never a grant. Read its `decision.answer` outbox and record the resulting evidenced
judgment with `project-result`. A changed source needs `disposition: "source-changed"`.
General must separately import reviewed `decision.answer` policy for exactly the admitted
project scope and its logical `project-<projectId>` target; that target permits no worker
or model operations. A captain answer does not change allocation, policy or work authority.
