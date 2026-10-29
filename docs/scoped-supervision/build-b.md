# Build B: operating plan supervisors

Implementation contract, recorded before coding. This build extends #164's owned
runtime and #163's existing app Attach convention. Everything new requires
`FIRSTMATE_PLAN_SUPERVISORS=1`; installation and views activate nothing. No live
rollout, U1–U3, remote mutation, release executor, takeover or second Attach path.

## Automatic acceptance checks

Run `npm run typecheck` and the complete `npm test -- --maxWorkers=2` suite
(Windows uses `--testTimeout=20000`). Run affected production-composition, receiver,
seven-rule, source, workflow, migration and lifecycle tests while iterating.
Run the existing S05/native-client checks for changed contracts and UI renders for
changed operator surfaces. Review the complete diff, then require all PR checks
green before marking ready. Test homes/providers/repositories are isolated; no
real agent or live activation is part of this build's verification.

| Audit acceptance | Required automatic evidence |
| --- | --- |
| A01, A10, A18 | Production receiver reserves exact independent identity/worktree; claim before native calls; duplicate/restart/lost replies retain uncertainty and spend; no native-parent or strong-capability claim. |
| A02, A03, A05, A08 | Two production-composed chains advance with General busy; stale review/head, stopped scope, changed policy/rules and budget refuse while unrelated scope progresses. |
| A04, A06, A07 | Existing reservation and mailbox/outbox invariants; duplicate/reordered events and restart have one consequence; logical-owner answers retain exact subject/epoch and uncertainty. |
| A09, A11, A15 | Ordinary Plans/fleet expose authoritative scoped plans; checked owner/backend action routing; rules/policy/context provenance and project membership; reads create nothing. |
| A12, A13, A14, A22 | Migration preserves original bytes, attempts, delegation and budgets; snapshot digest/restore boundary; operator inspect/resume/abort; no unknown-callback transfer, history reset or capacity reset. |
| A20, A21 | Durable continuing-turn caps; unknown effects reserve spend; confined capped digest-verified evidence; source gaps and unsupported remote/release operations remain explicit. |
| Rules 1–7, rows 71–78 | Each rule refuses dispatch and successful completion when missing/failed/stale; changed subject/head during admission refuses; factual failures remain recordable; remediation, recurring blocker handling, isolated-scope progress and accepted historical replay. |

The full matrix is the audit's Build B acceptance: A01–A15, A18, A20–A22.
Live latency, native bypass confinement, callback transfer and the separately
authorized two-plan/24–48 hour rollout trial remain explicit qualification limits.

## Implementation and verification

The production entry point is `index.server.ts` → `PlanRuntime`, using Build A's
single owned runtime. Root hooks are installed at startup and lazily compose the
existing S02/S04/S08 handlers before processing the first callback. The existing
workflow clock consumes `scope.mjs`, dispatches reserved worker effects and runs
bounded restart/initiative reconciliation independently of General's lock.
No second timer, Attach, provisioning path or summary relay is added.

`SupervisionWorkerReceiver` creates caller-selected isolated git worktrees and
unprompted independent workers, checks repository/branch/worktree identity and
supports positive exact workspace/agent lookup. A missing lookup never proves
non-admission. Sends and interrupts retain unknown outcomes; archive, release,
remote mutations and strong capabilities remain refused.

The additive `firstmate.plan-rules/1` record binds an effective plan revision and
actual policy sources. Head/attempt-bound verification, failure and violation
receipts use the existing journal/blobs. Actual check/capture artifacts and
distinct verifier provenance are mandatory. Applicability is explicit. Final
dispatch rechecks rule digest/subject, grants, dependencies, allocation, PR head
and budget; successful completion rechecks current evidence and known bound-PR
head/gaps. Factual failed reports remain recordable and terminal history remains
immutable. Missing report evidence can be repaired without another worker.

Delegated repair can add stricter checks or a corrective run in the same already
authorized local project. Task registration is atomic with the checked revision;
it cannot borrow identity, expand project scope, raise caps or weaken an existing
criterion/baseline/applicability. Explicit replacement preserves task/workspace
and cumulative spend; release needs definite non-creation; retirement retains
identities/history and refuses unsettled effects or retained dependents.

Counted continuing-turn limits include opening and uncertain reservations. A
true exhausted plan-supervisor cap introduces one checked domain budget question
and logical-owner outbox. Its presentation uses C's contract; its exact answer
context stays separate. Answering does not revise rules, increase budget or
reserve a paid effect. Routine rule failures produce refusal/remediation receipts,
not captain approvals. Long-run exhaustion also retains a checked-stop request;
native cancellation is never inferred.

Project judgment inputs cover relevant conflict/memory changes only. An exact
committed judgment handles the logical outbox; a changed source needs an explicit
evidenced disposition. The store recognizes this narrowly checked project-owned
outbox without inventing a plan backend. Ordinary plan completion creates no
project-to-General summary cascade.

PR observations are bound to exact attempts, ingested from the opt-in spool and
reread before worker admission. Newly bound facts have one actionable route;
the final legacy-delivery guard retains opaque pre-cutover notes for inspection.
The existing remote poll supplies observations only. Board submissions retain
their existing message IDs/correlation and uncertainty.

Ordinary Plans/fleet now merge authoritative scoped progress/history and route
captain actions to that backend. Exact accepted app replay precedes mutable
reauthorization. Stored rule refusals remain labelled historical receipts.
Migration inspection/review/resume/reconcile/barrier/commit/abort extends the
existing UI/RPC. No operator view, filter, form edit or review sends a command.
Lost replies retain the exact reviewed input; a home change cannot retarget it.

## Acceptance evidence

| Audit IDs | Automatic evidence retained in the PR checks |
| --- | --- |
| A01, A10, A18 | `supervision-worker-receiver`, `supervision-effects`, `supervisor-sessions`, `plan-recovery`: selected identities, real isolated git repository/worktree verification, claim-before-call, lost replies, positive lookup, no absence inference, no duplicate send or refunded spend. S00/S11 capability/refusal suites remain unchanged. |
| A02, A03, A05, A08 | `plan-runtime`: two build/review chains through the production request consumer while General's lifecycle lock is held; one worker per attempt across replay/restart; changed PR head refuses dispatch/completion; one project stop holds only its own start. Existing source/policy/pilot suites retain independent review-set and admission-race coverage. |
| A04, A06, A07 | Existing resource, inbox, source, scoped command/answer and pilot crash suites; `pr-watch` adds singular scoped delivery/spool-before-baseline/missing-route refusal. `plan-runtime` adds the first post-restart callback before any view/tick and one subscription/consequence. |
| A09, A11, A15 | `plan-runtime`: default-off zero resources, ordinary Plans action routing/replay, authoritative history, granted all-project allocations and constrained corrective tasks. `project-judgments`: exact owner outboxes, no routine summary cascade and changed-source disposition. Existing S03/S09 tests retain source authority, alias/intake and cross-project refusal coverage. |
| A12, A13, A14, A22 | `plan-recovery`, `migration-snapshot`, existing migration/activation/store/capacity suites: bytes/prefix/snapshot digests, interrupted captures, independent destination/retention, original callback drain holds, retained identities/delegation/spend, no automatic restore/takeover or journal reset. |
| A20, A21 | `plan-rules`, `supervisor-sessions`, `plan-runtime`: counted caps/uncertainty, exactly one genuine budget exception and checked answer with no new effect, actual confined artifacts, source/subject/head staleness and narrowly scoped refusals. Existing native-client/host-import/Hermes and untrusted-source tests remain full-suite gates. |
| Rules 1–7 | `plan-rules`: strict pre-dispatch declarations; rule/digest change at final dispatch; each missing completion gate; actual artifact and verifier checks; reproduced/fixed regression obligations; approved captures, numerical threshold, counted runtime/spend checkpoints, isolated matching heavy-suite baseline and fresh result; repeated blocker disposition; report repair, immutable failure history and accepted historical replay. |
| Operator UI | `migration-operations` and existing activation client tests: zero writes on view/review, double press, exact lost-reply retry, captured home. `node docs/scoped-supervision/build-b-ui/render.mjs`: both themes, 1440px desktop/390px phone, inspection/review screenshots, zero actions/overflow/browser errors. Impeccable detector returned no findings. |

## Switches and integration seams

Everything new stays off unless `FIRSTMATE_PLAN_SUPERVISORS=1`. Existing project
provisioning and app migration/Attach retain their own switches. New migration
and new attachment require a verified independent snapshot under explicitly
configured `FIRSTMATE_MIGRATION_BACKUP_ROOT` and `FIRSTMATE_MIGRATION_RETENTION`.
An older committed cutover without that proof remains held for deliberate
reconciliation. No restore/deletion service ships; restored external effects
still require reconciliation and spend is never reset.

`shared/plan-supervisor-limits.ts` supplies C's landed `ScopeRuntimeOptions.planLimits`
seam with the effective revision's durable cap. Discussion, initiative and opening
turns share cumulative reservations, including cancellation and uncertainty.
General retains its independent transport. Cap refusal emits one checked budget
question; neither an answer nor a presentation record grants additional spend.

Rebased on C's merged `254b9fe5` (#165), using its real
`shared/scoped-captain-decision.ts` contract. Plan and project exceptions retain
exact checked context and logical-owner outboxes separately from presentation.
Relevant project inputs stay owner work unless the exact bound project owner
records a current, evidenced captain exception with a reason, numbered choices
and recommendation. Its answer requires source-bound `decision.answer` policy,
fresh project/source identity and explicit app/chat provenance. The narrow
project policy target cannot grant worker/model operations. Answers wake only
that project owner; routine completion creates no summary cascade. Changed
sources hold the question and preserve the draft; replay cannot duplicate it.
`scope-runtime` and `project-judgments` tests cover the real shared composition,
answer outboxes, wrong owners, changed sources, historical reread and counted
cap refusal. Maintenance captain exceptions remain Build D's responsibility.

Verification uses Node 24, isolated temporary homes, synthetic providers and
real temporary git worktrees. It makes no live activation, install, provider or
rollout claim. U1–U3, full-access confinement, live callback transfer, measured
latency/cost and the captain's later bounded live trial remain unqualified.
