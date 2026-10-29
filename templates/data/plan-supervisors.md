# Operating a scoped plan

This helper is served only with `FIRSTMATE_PLAN_SUPERVISORS=1`. It uses cooperative
same-user request files, not authenticated IPC. Never impersonate another agent.
Attach remains the captain's app button, labelled unverified. No helper attaches,
provisions, takes over, archives, lands or mutates remote work.

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
a true scope, authority or budget exception as one captain-authority decision
through the existing checked plan; its presentation uses
`firstmate.scoped-captain-decision/1` alongside the exact checked answer context
and logical-owner outbox. A decision answer alone grants no new budget or effect.

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

For an exceptional project judgment that needs the captain's authority, `project-result`
may include `captain: {title, question, reason, options: [{id, label}, ...], recommendation}`.
Keep ordinary conflicts and memory review delegated. The exception requires the current
input and an actual evidence digest; it creates one numbered shared-inbox question,
never a grant. Read its `decision.answer` outbox and record the resulting evidenced
judgment with `project-result`. A changed source needs `disposition: "source-changed"`.
General must separately import reviewed `decision.answer` policy for exactly the admitted
project scope and its logical `project-<projectId>` target; that target permits no worker
or model operations. A captain answer does not change allocation, policy or work authority.
