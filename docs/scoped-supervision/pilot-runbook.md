# S06: two-plan pilot qualification

S06 exercises the **new-plan cooperative path with synthetic receivers**. Qualification receipts
are pinned by the S06 verification manifest and exact-head CI artifacts. The initial A08 timeout
and its bounded product-code diagnosis are documented in [S06-diagnosis.md](S06-diagnosis.md).

The implementation installs nothing,
starts no paid sessions, changes no routing or watches, and grants no live authority. General
reads shared status on demand; routine plan evidence goes directly to its registered owner.
There is no result-summary cascade through a project session. “Project Mate” remains provisional.

The integration base is `c14df7039a48bdeca893db0616e96e3eafa1e2e6` (S05, PR #152), containing
accepted S02/S03/S04 interfaces. FirstMate supplied acceptance of R02–R05 and their re-reviews.
Independent R06 and R06O inspect the delivered source and receipts before any live proposal.
A completed review with unresolved blockers does not clear that gate.

## Reproduce the synthetic evidence

Use an isolated checkout, Node 24 and lockfile dependencies. The test setup replaces `PASEO_HOME`
with a temporary directory and disables receipt/attention/Needs-you observers before imports.
There is no real daemon, provider, remote host, repository release or external resource in these tests.

```powershell
npm ci
npm run typecheck
$env:FIRSTMATE_PILOT_SOURCE_HEAD = (git rev-parse HEAD).Trim()
$env:FIRSTMATE_PILOT_EVIDENCE = '1'
npx vitest run test/scoped-supervision-pilot.test.ts --maxWorkers=2 --reporter=default --reporter=json --outputFile=.local/s06/pilot-tests.json
npm test -- --maxWorkers=2 --reporter=default --reporter=json --outputFile=.local/s06/all-tests.json
```

If the shell has a broken npm shim, invoke the checked Node 24 executable and its adjacent
`node_modules/npm/bin/npm-cli.js` explicitly. Do not change global runtime configuration.
On Windows CI the existing `--testTimeout=20000` default applies; explicitly bounded qualification
tests retain their own timeout. `.github/workflows/check.yml` runs the full suite on Linux/Windows.

Opt-in export writes `.local/s06/scoped-metrics.json`, `legacy-metrics.json` and
`qualification-receipts.json`. The first two contain the strict metadata dataset and its derived
report; the third records bounded case/effect/offer/watermark identities and outcomes. Exact tested source, fixture digest, Node/OS,
relative stage timestamps, event/scope IDs, denominators, missing values and counts are retained.
No prompt, report body, private path, free-text error, token estimate or price estimate is captured.
Keep test JSON/logs and SHA-256 hashes with the source head for independent reproduction.
Published evidence is immutable historical evidence for that head, not a claim about an installed bundle.

## What the fixtures exercise

| Assertion / test | Actual checked path and observable result |
| --- | --- |
| A08, A09: two chains | Two independent plan owners in one project use existing `task@1` builders and `scout@1` reviews. General's simulated running turn stays open for 600,000 virtual ms. Both owners commit, receive, acknowledge and handle their own events, then record inspected outcomes. Four distinct workers; two watermarks reach two. |
| A02, A01: simultaneous results | A builder plus B's two reviewers complete concurrently. Ingress duplicate/reordered observations retain provenance and one primary consequence. Adapter reconstruction reads the journal. Current-head independent review evidence is checked by S03 before one next-step reservation; old-head evidence refuses. An unrelated scope advances. Replaying the accepted request returns the same receipt; another owner/new request cannot duplicate it. This uses owner-attested evidence, not a nonexistent S08 PR adapter. |
| A05: changed instructions / rollback | A narrow source-bound rule change publishes an admission hold. A queued create refuses; an already admitted workspace and cumulative spend remain. The other plan records its result. Disabling the lifecycle changes no queue, effect or journal bytes. |
| A06: ingress publication | Inject after event link, publication sync and publication link. Before publication, neither cursor nor event is exposed and no offer runs; explicit publication recovery plus identical request replay recovers the same record. After publication the original receipt replays. Boot records source gaps; stored status exposes them. |
| A06: owner delivery | Crash after atomic page/turn reservation, lose an admitted send reply, and reconstruct after acknowledgement before handling. Recovery dispatches only the original reserved effect; an uncertain send is never repeated. Ack alone leaves watermark zero. Only the bound owner's explicit per-event disposition advances it. |
| A06, A20: workspace/create/send | Synthetic receiver admits then loses/hides each reply. Original attempt/effect/receiver IDs and resource reservations survive. Negative lookup does not authorize another creation. Worker/session turns remain spent; exact-receipt reconciliation is separate. |
| A07.scoped | Answer during a held manual transfer, discard the first device's response, then submit from a second device. One revision/subject-bound answer and logical outbox survive. Replacement refuses until the exact old synthetic identity is stopped; prepared/verified epoch two receives it. Old epoch handling refuses; the new owner's committed handling result closes the same outbox. Changed subject refuses. |
| A17.preserve, qualified watch subset | Start the actual legacy WatchRunner timer in a temporary home. Preserve the required disabled identities `board-review`, `workspace-review`, `metis-pentest`, `launch-metrics.mjs` and their retained schedules (`*/15 * * * *`, `5 */12 * * *`, `*/10 * * * *`, `*/15 * * * *`). Across scoped enable/disable/reconstruction, assert exact config/definition bytes and timer identity. Tick each retained schedule: zero disabled executions. An enabled control runs the same four definitions. R06's actual-identity reenabling mutation now fails. |
| A17.preserve, unqualified native subset | The native storage timer's 03:15 local schedule, its full retained host set including offline Light, and the unknown-owner existing native heartbeat cannot be exercised through a supplied native inventory/maintenance adapter. They are explicit live-admission holds. No inert coverage JSON or count of unrelated owner/worker creations is evidence of native coverage or no replacement. A17 as a whole is partial, not passed. |
| A19 | Strict metadata validation rejects prompt fields, duplicate event denominators, out-of-order timestamps, synthetic billed usage and live virtual clocks. Reports retain missing/censored observations. |
| A20 | A spent one-run worker allowance refuses an additional task definition. A known exhausted supervisor cap refuses another turn. A lost owner-send response retains its reserved turn and prevents another prompt. Prepared inert payload blobs may remain; no command/effect or spend commits. S06 does not invent an automatic budget-decision/portfolio-cap adapter. |

The existing `server/supervision-crash.test.ts` additionally kills child processes at journal
sync/link/publication boundaries and races actual writers. S06's in-process injected interruptions
and adapter reconstruction are not substitutes for those process/filesystem tests. Neither proves
disk-loss durability or authenticated filesystem IPC.

The original S06 correction replaced quadratic retained-ownership digest comparisons inside each
full journal scan with a scan-local digest set. The revision adds a validated in-memory projection,
request index and a small durable checkpoint. It deliberately changes historical corruption detection
timing under the separately accepted checkpoint-prefix contract below. Journal publication remains
tip/event/publication with the existing fsync/exclusive-link boundaries; checkpointing follows it.
Size accounting also tolerates an inert `.tmp` disappearing between enumeration and stat;
deterministic controls still hold on a disappearing durable event. See the diagnosis for scope.

The checked synthetic route has a complete receiver-send census: zero routine payloads to General
and zero to project sessions. Metrics format 2 uses `duplicateObservations` only for additional
ingress observations deduplicated locally (four in the synthetic trace). `accidentalCallbacks`
always means native callbacks actually delivered to General for the trial, including duplicate
payloads; it is zero in the synthetic trace. `generalTurns` counts trial-attributable General model
turns, excluding the pre-existing busy turn. A native callback may join that busy turn without creating
a new turn: the callback alone still invalidates zero traffic. `zeroRoutineOnCheckedRoute` requires
complete checked-route coverage and zero General/project routine payloads, native General callbacks
and trial General turns. Partial coverage never passes. Legacy board Steer, Interrupt, End, Relaunch
and the pending-steer relay now refuse scoped labels before any effect or forwarding to General.
This does not suppress an upstream native notification. Count, reconcile and investigate any such
delivery even if its ingress observation is deduplicated. Existing legacy fleet traffic is excluded.
The preserved format-1 artifacts belong to the initial head: their `accidentalCallbacks: 4`
was mislabeled duplicate ingress. They are superseded for census qualification by format 2 and
must never be interpreted as four suppressed or delivered native General callbacks.

## Checkpoint bounds, audits and recovery

Ordinary reads verify canonical checkpoint metadata, home identity, the complete checkpoint anchor
(event, expected tip, publication, hashes and any blobs referenced by that event), and the current
coordinator record. The checkpoint binds sequence, transaction hash, projection hash, anchor identity
and a cumulative digest extending over every validated event/tip/publication hash in its prefix.
An in-memory snapshot serves that validated projection and accepted-request index. A second reader
can validate at most 32 new transactions against its cached prefix; it does not replay the old prefix.
Evidence blobs are content-addressed and append-only, and nearly every writer operation adds one, so
a changed blobs directory stays on the warm path when every cached blob keeps its file identity and
every new blob hashes to its own name; tail transactions still recheck the blobs they reference.
A removed, replaced or misnamed blob, a changed coordinator file list, a journal change without a
checkpoint, or a larger tail requires full historical validation. Coordinator records are compared
by durable name (and hash-checked on every read), because Windows can report a directory's earlier
write time late. A write that lands during a warm read retries the warm read (at most three times)
rather than discarding the cache. Retained ownership capsules are hashed once each, not once per
comparison per transaction, so a launch's tail costs its own transitions, not history. Cold startup always
validates all history before trusting a snapshot, even when the durable checkpoint looks current.
The production inbox, combined Needs-you, scope and crew-seen status paths share one read-only
store per configured home for the server lifetime. A home switch starts a separate cold validation;
ordinary polling of the same home stays warm, including across launches and other writer operations.
Concurrent reads in one publication epoch share one validation. The display routes (inbox,
Needs-you, scope) may, after 750 ms of reads overlapped by back-to-back commits, serve their own
result if it validated against a published checkpoint: an earlier committed head, never a
staging-window hold. Crew-seen, receipt and request lookups always wait for the newest head.
**Builder's judgement call, for review:** without this settle budget, a display poll that overlaps a
launch waits for the writer's whole run (about 2.3 s at 176 plan-heavy transactions on the reference
machine), which misses the 2-second read stop rule. The trade is a display that can lag the newest
commit by the overlapping writes, never one that shows an unpublished or held projection. The 5-second Needs-you poll does not construct a new
store or wake a model. Before admitting a live trial, complete and record that home's cold startup
audit, then measure its warm status route under the intended client polling load.

This cooperative pilot stops **new effects at 192 transactions**, reserving 64 records for known work
and reconciliation, with an absolute **256-transaction** ceiling and **8 MiB of projection plus retained
ownership** (the earlier 100 MiB physical journal alarm also remains). At 256, all new journal writes
hold; plan the admitted workload and stop well before exhausting reconciliation headroom. No bound
truncates, evicts or resets history or spend. Warm reads perform constant journal metadata/
anchor work plus response serialization bounded by that state ceiling. New launches perform only
their new transitions, with no historical reducer replay. Tests cover 11 versus 176 transactions,
a launch after 176, new-effect refusal at 192 with admitted outcome recording still allowed,
32-item tail overflow, and the 256-transaction hard boundary. Warm reads do not hold the writer lock:
they wait for an active in-process publication, and retry when a writer overlaps their check so no
transient staging result is served. The 176-transaction status-poll regression pauses a warm reader
at its anchor, commits before releasing it and then observes the new head. Explicit full audits and
index repair serialize with writers. Full audits, cold startup and recovery remain O(history), bounded by the admitted pilot history; this is not a
claim of constant cost for arbitrary future fleets. Do not raise these pilot bounds to clear a hold.

**Changed detection timing:** an in-place edit to an old, non-anchor entry or old evidence can remain
undetected by a warm read until the next full audit. Old entry deletion or directory changes may force
an audit sooner. Anchor tampering is checked on every read. Full validation runs automatically on
each store instance's startup and all recovery operations. The explicit read-only audit command is
`scope.mjs read --file <input.json>`, with `{ "scopeId": "<bound UUID>", "epoch": 1, "page": "audit" }`.
It reuses the existing disabled/unseeded scope transport and returns freshness/sequence/hash/problems,
without receiver effects. It adds no production attachment. Internal operators/tests can also invoke
`SupervisionStore.audit()` directly. Audit before/after each admitted trial and after an integrity
incident; a new instance independently performs that same full startup validation.

A missing/stale checkpoint or any anchor/digest mismatch triggers full validation and a hold. An
invalid checkpoint exposes no accepted plan projection, even if the journal validates. Explicit
`recoverIndex()` rebuilds only derived metadata after a full valid scan; `recoverPublication()` also
audits the whole journal and refreshes the index after completing an exact pending publication.
Both repair only when the existing checkpoint is a consistent **ancestor** of the validated journal:
its sequence is not past the journal head, and its transaction hash, projection hash, cumulative
prefix digest and anchor equal the values recomputed at its sequence. A crash between publication
and checkpoint replacement only ever leaves it behind. A checkpoint ahead of the journal (for
example, a deleted published transaction) or on a divergent prefix is reported as an integrity
incident and refused: it may be the last witness of lost history and needs deliberate
reconciliation, never a rebuild. **Deliberate reconciliation is owned by the main first mate
(FirstMate), who stops admissions, preserves a copy of the whole supervision directory, reports the
incident with its exact sequences and hashes, and asks the captain how to proceed.** No repair tool
exists or is to be improvised; restoring a backup follows the external-effect reconciliation rule. Checkpoints are replaced atomically and never deleted, so a missing
or unreadable one is likewise refused over a nonempty journal; only an empty journal (initialization
interrupted before its first index) is rebuilt. **Builder's judgement call, for review:** refusing a
missing checkpoint means a lost index has no automatic repair. The alternative, rebuilding it, would
accept a journal truncated together with its checkpoint, which is the case this rule exists to catch.
The qualified local operator attachment must stop admissions, inspect the held status's home ID,
sequence, hash and problems, then invoke `SupervisionLifecycle.recoverIndex({ homeId, sequence, hash })`
with those exact observed values. That method performs a full audit, accepts only a checkpoint-only
hold on an unchanged journal head, calls `SupervisionStore.recoverIndex()` and audits the result.
It has no public RPC or request-file route in this disabled delivery; the future operator attachment
and its authority need separate review. A stale observation or damaged journal refuses repair.
After a successful receipt, reread the original request/effect IDs and reconcile known work before
admissions resume; recovery never authorizes a resend.
These recovery paths do not repair missing/corrupt authority, discard history or retry an external effect;
the ancestor rule above is what keeps an index rebuild from overwriting the record of lost history. A crash
after journal publication but before checkpoint replacement holds until index recovery, then the
original request receipt replays. Checkpoint writes use synced staging plus atomic replacement; a
missing result is not proof an effect failed. These are process-crash/cooperative guarantees, not
authenticated immutable storage or disk-loss protection.

**Admission preflight (R06O):**
- **No pre-checkpoint store.** Confirm the target home has no supervision store created before checkpoints existed (S01–S05, the f94c338 era). For each `<plugin-data>/firstmate/supervision/*/`, refuse only if `transactions/` is non-empty and there is no `checkpoint.json` beside it. A freshly initialized store has `checkpoint.json` beside an empty `transactions/`, and that is valid. Production has never initialized one, so the expected result is "absent".
- **Exactly one installed build.** Run `paseo plugin ls --json` and confirm the one daemon lists exactly one FirstMate plugin, at the reviewed build. An older build, or one without the S07 cutover gate (an S08-only build, for example), does not read the gate or its sidecars and must not be installed alongside it.

Before a live trial, qualify at most two local chains under these history/state limits. Record every
warm read and checked launch duration. The proposed admission stop limits are **2 seconds for any
warm read on a display/status route** (Inbox, Needs-you and scope status, which may settle after
750 ms) and **10 seconds for any launch**; stop new admissions on a miss and retain the trace.
Newest-head reads (crew-seen, the inbox replay and request lookups, writer-side reads) deliberately
wait out overlapping commits. Record them separately and bound them by the 10-second launch rule, not
the 2-second display rule (R06O N12).
Filesystem/provider stalls can exceed them: these are measured stop rules, not hard real-time
completion guarantees. The source-bound synthetic timing samples live in `index-bound-evidence.json`;
they do not qualify a live adapter or establish provider latency. A longer workload needs a separate
reviewed history/budget policy, not silent checkpoint or quota growth.

## Baseline protocol and performance limits

The executable comparison isolates delivery: four synthetic completion observations, two scope IDs,
the same virtual arrival times and a General turn busy for ten minutes. The baseline invokes actual
`queueMateNote` / `flushMateNotes` adapters against a synthetic Paseo handle. Its four notes wait until
General is idle. The scoped sample drives the journal, owner mailbox, counted sends and owner results.
It is a routing/control experiment, not a provider timing benchmark or a complete legacy worker-chain
execution. Legacy lacks a typed ack/handled receipt here; those stages are null, never fabricated.

`server/supervision-metrics.ts` reports nearest-rank p50/p95/min/max for observe-to-commit/offer/ack/
handled, commit-to-offer queue age, and captain submit-to-admission/first-reply. Every distribution
reports denominator, measured and missing counts. No samples means no percentile. Source polls,
General turns and reserved worker/supervisor sessions/turns are separate; uncertainty retains spend. Provider tokens and
billing remain null without receiver/provider evidence. Virtual stage delays are prescribed fixture
inputs; they do not demonstrate millisecond performance or savings. Captain samples are empty in the
synthetic proof, so captain latency is explicitly unmeasured.

A later approved measurement must fix comparable workload, runtime/model/profile, head, load,
source coverage and observation window before starting. Capture monotonic timestamps at the actual
boundaries, offered/message/ack/result IDs, accepted/uncertain receipts and all model wakes. Measure
General conversational occupancy and captain admission/first reply separately from plan queue latency.
Use the same sample/exclusion rules in both routes; retain failed, held and censored samples in the
denominators. Report sample size and distributions per route/scope, not only averages. Investigate a
target miss without weakening any hard invariant. Any provider latency/cost target needs an agreed
baseline and actual samples; this delivery declares no provider performance target passed.

## Live admission: all gates must have concrete receipts

This is activation material for a subsequent approval, not an executable enable switch. Current
production wiring remains off. S04's receiver contract is qualified only as a synthetic fixture;
S05 injects no writable store, command service, discussion execution or gateway. A real adapter,
server-owned profile/cap source and reviewed attachment must first be delivered and independently
qualified against actual supported runtime APIs. A version number, invented flag or edited request
file is insufficient. Do not enable one component to bypass a missing integration gate.

1. Pin source/installed bundle, runtime and qualified receiver capability receipts, exact home/project/
   host aliases, new scope/task IDs, explicit isolated workspaces, source coverage and current journal
   anchors. Resolve narrow findings and both wide reviews. Identify one coordinator; no timestamp takeover.
2. Attach the existing D1 dispatch-authority receipt and D2 bounded cooperative acceptance. D2 permits
   new isolated local plans only, with no automatic takeover, production release, shared cleanup or remote
   mutation. State that full-access peers can bypass the plugin; epochs guard its gateway only.
3. Record D3's lazy arrangement: logical scopes at draft, persistent context when dormant, mailbox-driven
   turns and no model wake for unchanged state. Separately approve a concrete trial budget: proposed ceiling
   seven new sessions (one optional project, two owners, two builders, two independent reviewers), eighteen
   turns (project two, owners twelve total, workers four). No retry/fixer allowance. Dormant unused project
   capacity is not spent or borrowed. Each sample plan has one reviewer for routing proof; ordinary product
   release review policy is unchanged. A full two-reviewer B stress case is synthetic only under this ceiling.
4. D4 accepts the exact source-bound policy import/ambiguity report, allowed models/modes/thinking options,
   stop rules and equal-priority FIFO; preserve valid specific grants. No policy import is authorized by this
   document. Unresolved operation constraints hold. Project/plan budget attribution and a global admission
   cap must be demonstrated: current fixture per-scope limits do not by themselves enforce 7/18 globally.
   Exhaustion must produce one durable scoped decision or an explicitly accounted manual hold; do not claim
   an absent automatic decision adapter passed. Unknown send reserves worst-case turn cost.
5. Obtain **separate exact-version installation approval and exact live-trial/routing approval**, with
   authorized recipient scopes, new isolated resources, trial window, stop owner and observation/cost caps.
   Implementation authorization, D1–D3 answers and plan approval are insufficient. Keep legacy subscriptions,
   unknown heartbeats and existing timer coverage with their original accounted owners. No live callback
   retargeting, archive, migration, release or shared effect is admitted.
   A17's native storage schedule/full coverage and unknown-heartbeat no-replacement subset remains
   unqualified: require its supported inventory/configuration evidence before claiming preservation
   or admitting any maintenance change. Never create a replacement while ownership is unknown.
6. Before any paid call, verify every cap, source, dependency/review/head, ownership/epoch and target at the
   gateway. Prepare unprompted selected-ID sessions; verify binding/independence before opening. Reserve all
   work/effects before external calls. If any required capability is unsupported, leave the trial held and
   name the missing contract. Strong isolation/fencing/raw-tool containment remains unqualified.

The supplied dispatch records D1 answered, D2 cooperative, and D3 lazy sessions (26 October 2026).
D4 acceptance, concrete paid trial budget, installed-version approval, live routing and native adapter
qualification are **not supplied by S06**. The runbook cannot clear them. S07/S10/S11/U1–U3 are not added
as cooperative-pilot prerequisites. They retain their existing later contracts and strong-mode boundaries.

## Conduct, stop and forward rollback

For an admitted trial, register two new builder/reviewer chains in one project and capture the frozen
definitions/brief hashes and policy vectors. Record General's uninterrupted busy interval for at least
ten minutes. Send no routine completion to General or project. Let each owner inspect report/PR/head
evidence and commit its own next step. Count every receiver send, native callback and model wake,
including retries and failures. Read status and Needs you directly without sending a model summary.
Project wakes require relevant discussion, judgment or a recorded conflict; routine result recording
alone does not qualify. A direct native prompt remains externally initiated and cannot mint authority.

Stop on any hard invariant failure, stale/ambiguous ownership, unexpected General payload, unknown
effect, unaccounted spend, coverage gap requiring judgment, cap exhaustion or missing review. Freeze
new admissions first; record a scoped incident/decision and exact affected operations. Let known,
isolated admitted work drain when safe. Retain uncertainty, attempts, resource reservations, pending
offers, answers, outboxes, checkpoints, evidence blobs and journal anchors. No automatic resend,
fresh-ID fallback, budget refund, archive-based cancellation or unknown-owner replacement.

Rehearse rollback synthetically before live admission: publish a narrow hold while a create is queued
and another workspace is already admitted; prove refusal and retained spend, allow unrelated known
work to finish, then disable the lifecycle and compare preserved state. For an uncertain send, retain
the original effect/page and reconcile its exact receipt before any further turn. Hiding controls or
disabling the route does not undo admitted work. Resume only through a checked current epoch and an
explicit disposition; never restore an old writable snapshot/binary or reactivate an old owner by TTL.

A17.preserve changes nothing about existing daily zone/DST/catch-up or per-host resume semantics.
A07.legacy/A13.legacy real queue migration belongs to S07. A17.occurrence belongs to S10 under D5.
No remote source adapter, native ownership-transfer contract, strong receiver exclusion or release
race guarantee is qualified here. S12 remains readiness evidence for its own broader milestone.
