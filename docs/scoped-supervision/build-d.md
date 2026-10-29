# Build D: maintenance scopes and timer cutover

This integration reuses S10 and the Build A owned runtime. It stays off unless
`FIRSTMATE_MAINTENANCE=1`. No live activation, provisioning, Attach, timer retirement,
cleanup or deployment is part of this build. Automatic cleanup remains held by G8.

## Checks declared before implementation

Required automatic checks: `npm run typecheck`, `npm test`, and the targeted
`npx vitest run server/maintenance-runtime.test.ts` integration cases. Pass means
zero type errors and zero failing tests. The integration cases must exercise the
production registration/driver seams with isolated homes and native stand-ins.

| Audit acceptance | Required evidence |
| --- | --- |
| A04 | Advisory all-or-none resources retain conflicts; cleanup remains held by G8; retained/link selection regressions remain green. |
| A06 | Duplicate/restart observations and changed incident generations deliver at most once; healthy and unchanged failures wake nobody. |
| A10 | Interrupted/unknown deliveries and host items retain identity and spend, without automatic resend/reapplication. |
| A13 | Shared coordinator/restart and publication recovery retain occurrences, receipts and uncertainty; reads/default-off write nothing. |
| A17 | D5 duplicate/DST/missed-date semantics, complete configured host coverage including offline hosts, fresh timer census, disabled-watch preservation, exact evidence-bound overlapping-timer retirement; Take-the-Initiative is reconciled without creating a fleet reminder. |
| A20 | Job/session/turn budgets and unknown spend hold admission; no refund/reset; unrelated jobs continue. |
| A21 | Strict request/evidence bindings and stale census rejection; nested cleanup links never traverse retained work. |

Existing suites `server/supervision-jobs.test.ts`,
`server/supervision-resources.test.ts`, `server/supervision-timers.test.ts` and
`server/supervision-capabilities.test.ts` remain required regression evidence.

## Rollout boundary

The captain reviews and performs rollout separately. Existing timers remain owned
by their actual owners until exact retirement evidence is accepted. Unknown native
heartbeat ownership remains an explicit U2 hold. G8 remains open until a qualified
no-follow executor, reviewed installed-version reader artifacts, N7 duplicate-cleaner
disposition and advisory receiver acknowledgements all exist.

## Delivered integration

`server/maintenance-runtime.ts` shares Build A's `SupervisionRuntime` and coordinator.
`index.server.ts` registers `firstmate.maintenance.read`, `.summary`, `.timers`,
`.admin`, `.admit-ui` and `.answer-ui`. `FIRSTMATE_MAINTENANCE=1`, sampled at startup, enables administration,
request processing and the observe driver on `startWorkflowService`'s existing clock.
It adds no interval. Reads acquire no coordinator and create no session/approval.
The opt-in helper is `tools/maintenance.mjs`; its guide is `data/maintenance.md`.

The strict command surface admits observe job definitions, explicit state changes,
verified existing timer/probe outcomes, uncertain-item reconciliation, advisory
resource reserve/promote/renew/expire/release and exact-owner incident acknowledgement.
S10 still owns daily IANA/DST/catch-up identities, complete configured host sets,
write-ahead host items, all-or-none FIFO resources, matching terminal release evidence
and job wake spend. An edit cannot drop an approved host because it is offline.
The maintenance summary follows Build A's capacity bands after an explicit storage
upgrade; it does not falsely report the old sequence-160 pilot ceiling as exhaustion.

Maintenance owner support extends the existing `SupervisorSessions` and cooperative
SDK receiver, with `maintenance-mate` labels and independent workspace verification.
Home/Plans has an explicit Create maintenance owner confirmation naming the owner,
model, permission mode and total turn cap (opening, incidents and answer notifications).
The app admits the scope and retains the exact input in an immutable command before
reserving its workspace, parentless unprompted session and opening. Shared General
headroom admission precedes reservation. Native effects use the existing gateway;
exact workspace/profile/label verification precedes the opening. An interrupted app
can resume the saved request after reload. Uncertain creation is reconciled only by
the reserved identity; uncertain workspace/opening sends stay held. Neither failure
nor retry changes identity, resets spend or creates a replacement. App provenance is
`plugin-ui-unverified`: captain-only by convention, never authenticated identity.
There is no Attach caller, helper/CLI admission, background provisioning or worker path.

Incident delivery requires the admitted owner's exact opening to have succeeded.
Each changed pending incident generation
gets one deterministic reserved send, a bounded template and cumulative session/turn
accounting. The final gateway claim rechecks job, incident, budget, scope, owner and
stop state. A failed/uncertain send retains its original identity and spend. Repeated
clock ticks or process restarts never resend it. Delivery is not acknowledgement;
an obsolete generation's still-reserved, never-claimed notification can be withdrawn
under the same publication boundary, retaining its full counted spend. Claimed or
uncertain notifications can never use that path. This prevents a busy owner from
being permanently blocked behind an obsolete unsent generation.
Only the exact delivered owner/epoch can acknowledge a confirmed send. A confirmed
but unacknowledged delivery no longer starves later host incidents; every unknown or
unfinished native send still blocks new turns through S04. Owner queues
and bounded native waits isolate a stalled owner from independent maintenance scopes.
General reads `.summary` directly; no routine summary cascade or captain count is added.

The fresh census reads actual script bytes, managed routing/configuration and native
schedule targets, preserving fingerprints for same-schedule content/coverage changes.
Both cron and interval agent-targeted reminders are inventoried. Retirement is a
recorded disposition after the actual known owner has disabled the exact linked timer;
the census fingerprint and disabled state are rechecked before commit. Missing,
unknown-owner or enabled timers remain held. All overlapping timers must be reconciled
before any future replacement executor can qualify G8/N7. Managed Take-the-Initiative
is retained and cannot be retired by this path; no native fleet reminder is created.

Automatic cleanup is always labelled held in this build: no executor is installed,
and the existing `executorApproval` reports the missing no-follow deletion, installed
version reader evidence, N7 and advisory receiver acknowledgements. Nested-link deletion
cannot occur through this integration. Any corrective plan must use Build B's checked
plan runtime and applicable seven-rule gates; incident delivery has no dispatch shortcut.
U1–U3 strong claims stay unsupported.

## Genuine captain choices and checked answers (review F2)

Routine observe incidents remain maintenance-owner notifications and create no captain
count. The exact verified owner may explicitly `escalate` an open incident for a genuine
authority/budget choice with question, numbered options, recommendation and evidence.
Real S10 budget holds, or a spent captain-approved owner turn cap with a waiting incident,
introduce one durable budget choice without waking General or spending a model turn.
The maintenance board shows those choices and their checked evidence. Job/incident
version changes disable an old subject; routine summaries are never decisions.

The app answer binds the displayed home, decision, revision, subject, option and exact
evidence. It commits the immutable answer and a logical-owner outbox together in the
shared journal. Duplicate submission bytes replay; changed bytes conflict. The answer
changes no job/cap/authority. A counted notification uses the original captain-approved
owner limits, current verified owner and existing claim-before-send gateway, with no
General/backlog fallback. The outbox survives job stop, session reload and uncertainty.
Unknown delivery never resends or refunds; successful delivery alone never marks it
handled. Only the exact successfully notified owner/epoch can record `answer-handled`
with checked result evidence. Exhausted owner caps keep the answer pending; no turn is
borrowed to deliver it. Answers and handling use unverified same-user/app conventions,
not authenticated IPC. Plan commands explicitly refuse maintenance decisions.

Build C integration: D imports the real `shared/scoped-captain-decision.ts` from
merged PR 165 (`254b9fe5`), format `firstmate.scoped-captain-decision/1`. The read RPC
emits `captainDecisions` for C presentation, alongside D's separate durable `decisions`
(checked maintenance origin) and `outbox`; presentation never authorizes a legacy send.
Maintenance contexts use job/incident IDs in retained decision identity fields, not a
workflow/backend grant. Other plan decisions/outboxes retain their original validation.
The plan-only Needs-you adapter excludes maintenance rows/outboxes instead of inventing
plan origins or offering the plan answer transport. Maintenance choices/counts remain
in the Maintenance owners board with D's exact checked answer transport.

Review F1/F2 checks were recorded in the PR before follow-up implementation. Production
entry tests now construct the owner through the registered app RPC from a fresh home;
the ordinary integration fixture also uses this path. Tests cover lost create/opening
replies and fresh-runtime resume, receiver mismatch, default-off, duplicate/conflicting
submissions, stale evidence/options/job versions, authority origin checks, one automatic
budget choice, original-cap exhaustion, checked outbox handling and uncertain restart.
App tests cover explicit confirmation, exact retry/resume and failed-refresh holds.

## Read-only timer re-inventory, 29 October 2026

The calling Light host listed zero native schedules and no registered destinations.
That limited listing is not proof of complete heartbeat or remote ownership (U2).
The actual plugin configuration retained four disabled scripts: `board-review`,
`launch-metrics.mjs`, `metis-pentest`, `workspace-review`. Actual managed timers were:

| Timer | Schedule | Observed state | Build D disposition |
| --- | --- | --- | --- |
| storage-daily-cleanup | 03:15 daily | enabled, three named storage hosts including Light | retain schedule, full coverage and existing access/host holds; observe before cutover |
| daily-concluded-worktree-cleanup | 04:00 daily | enabled | retain until exact known-owner retirement; automatic replacement held by G8 |
| Take-the-Initiative | every 30 minutes | enabled, current session | retain managed owner; do not recreate native fleet reminder |
| Ariadne-Browser-Recovery | hourly | disabled | preserve disabled state |

The existing remote-status file reported three reachable hosts at its observed timestamp;
it did not cover the full storage set and cannot narrow approved job coverage. Nothing
in this census changed a timer, scope, host, permission, installation or live session.

## Executable acceptance mapping

| IDs | Fresh integration evidence, plus retained S10/S11 regressions |
| --- | --- |
| A04, A10 | `server/maintenance-runtime.test.ts`: production advisory resource commands retain conflicts/suspect leases, reject premature terminal release, and promote only after matching success. Existing resource, cleanup-selector/alias and executor-condition suites remain required. |
| A06, A17 | Integration cases cover zero healthy/unchanged wakes, one turn per changed incident generation, obsolete never-sent withdrawal without refund, D5 catch-up with skipped dates, all configured hosts and managed initiative retention. Existing S10 duplicate/DST/missed-day cases remain unchanged. |
| A10, A20 | Lost send/restart retains original identity, spend and uncertainty with no resend/false ack; unknown budget holds notifications; a stalled owner does not block another owner. |
| A13 | Production registration/default-off reads create no writer/timer/session; request queue records actual host results. Upgraded storage fixture crosses 256 without resetting sequence/spend or falsely exhausting summaries. Existing publication recovery and interrupted-item suites remain required. |
| A17, A21 | Fresh disabled known-owner retirement only; stale fingerprints and changed replay bytes refuse. Same-schedule script bytes/native targets affect the census. Offline hosts cannot disappear from coverage. |
| A20, A21 | A stop committed during a paused native lookup refuses the late send while retaining its counted turn. Exact successful-delivery owner/epoch is required for ack. Admission and captain answers have app-only RPCs; helper cleanup/provision/Attach/worker commands are absent. Genuine choices retain checked answers and logical-owner outbox; original caps and uncertain holds remain enforced. |

Validation results are recorded in the PR after the full suite, typecheck and self-review.
