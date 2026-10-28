# S12 rollout runbook: conservative qualification and legacy drain

S12 is a qualification run, not a rollout. This runbook records the source, owner and timer census, the
acceptance evidence manifest, and the admission-freeze and forward-recovery procedure. Its verdict and the
installation readiness assessment are in the S12 report (`data/fm-ss-s12/report.md` in the FirstMate home).

It is judged against **D6 option 2, the conservative rollout amendment**. U1–U3 are not delivered upstream and
are not assumed. Broader rollout may cover only drained cooperative scopes, with no strong-isolation or
automatic-failover claim. Any milestone that needs U1–U3 is recorded as **gated on U1–U3**, not as failed.
`data/fm-ss-d6/decision.md` still holds the placeholder text, which recommends option 1. The option 2 choice
comes from FirstMate's dispatch, and it should be written into the decision record before any activation.

Census baseline: `ac07bd04` (the S11 merge), plus S12. The F1–F3 follow-up on `fm/fm-sa-gating`
updates sections 1.2 and 6 below. It adds no activation wiring (see *Wiring*).

## Verdict in one line

**Broader rollout and legacy drain are held.** Every new scoped capability is unwired or off in production, so
no scope can exist yet, let alone be drained. Even for drained scopes, four conditions block a General-relief
claim: reviewed activation wiring, General-owned native callbacks and heartbeats, an unmeasured captain-admission
metric, and an unagreed observation window. F1–F3 have code and fixture coverage below; this is not live drain
qualification. *Gates holding expansion* below lists each remaining gate with its reason.

## 1. Census

### 1.1 What is wired in production

Traced through the runtime (value) import graph of `index.server.ts`:

| Module | Runtime status at this head |
|---|---|
| `supervision-store` | Imported through `supervision-status-reader`, `workflow-service`. **Read-only**: every write calls `writable()` and throws `UNSUPPORTED` without `{ writable: true }` (`supervision-store.ts:301`). Production never passes it. No journal exists in the live plugin data |
| `supervision-status-reader` | Built at `index.server.ts:111`. Serves the read-only scope RPCs, the combined Needs-you read, the crew-seen skip and the S08 refusal guards |
| `supervision-gate` (S07) | **Live in every legacy delivery path listed in 1.2**. Unarmed, it reads sidecars and writes nothing. `arm()`/`publishSidecar()` are called only from `supervision-migrate`, which is unreachable |
| `supervision-routing` | `legacyRoute` runs on every legacy workflow mutation. It returns immediately while supervision is uninitialised (`supervision-routing.ts:22`) |
| `supervision-sources` (S08) | Only the pure guards `isScopedSourceWorker` and `refuseScopedRemoteMutation`. The ingress hook is not registered |
| `scope-rpc` | `registerScopeRpcs(..., uiEnabled: false, executionEnabled: false)` (`index.server.ts:157-160`). Answers and discussion throw or refuse |
| `supervision-jobs`, `-resources`, `-projects`, `-commands`, `-inbox`, `-observation` | Imported transitively, never constructed or called in production |
| `supervision-migrate`, `supervisor-sessions` (attach), `supervision-capabilities`, `supervision-capability-evidence`, `supervision-receivers`, `supervision-cooperative`, `supervision-metrics`, `supervision-lifecycle`, `supervision-events`, `supervision-memory`, `scope-discussion` | **Unreachable** at runtime (tests only). They still ship, since `files` includes all of `server/` |

Flags: `FIRSTMATE_STRONG_CAPABILITIES` is read only by unreachable code. `FIRSTMATE_PR_OBSERVATIONS` (off) changes
only the seeded `pr-watch` script, and nothing ingests its spool. `FIRSTMATE_NEEDS_YOU` (on),
`FIRSTMATE_RECEIPT_JOURNAL` and `FIRSTMATE_ATTENTION_OBSERVE` (both off by default) are pre-S06 and unchanged.

### 1.2 Sources: every plugin delivery to General or a worker

Gate column: **full** means verdict, a durable claim and a settled result (`claim`/`claimHeld` → `settle`).
**Enqueue** means a verdict under the gate lock at insertion. **None** means no S07 gate call at all.
Every direct send releases the gate lock before its native call, and settles before marking delivery sent.
Unknown native outcomes remain uncertain holds in the migrator inventory. No new gate is armed by default.

Routine traffic is automatic and plan- or fleet-related. Conversation is the captain talking to General.
Lifecycle covers General's own launch, compaction and handover.

| # | Path (entry) | Store | Class | S07 gate | Drain status |
|---|---|---|---|---|---|
| S1 | Note flush `flushMateNotes` (`mate.ts:426-442`; 15 s timer, turn-end hook, fleet load, plan act) | `config.mateNotes` | Routine | **Full** | Drainable per scope (S07 L1–L5) |
| S2 | Plan notes `queuePlanNotes` (`workflow-service.ts:47`, 1 s timer) | `config.mateNotes` | Routine | **Enqueue** + cutover pre-skip | Drainable per scope |
| S3 | Local steer relay burst (`crew.ts:203` → `mate.ts:356`) | `mateNotes[].burst` | Routine | **Enqueue** | Drainable; scoped workers refused by S08 |
| S4 | Burst extend (`mate.ts`, `extendBurstNote`) | `burst.holdUntil` | Routine | **Enqueue**: verdict and refusal receipt under lock | F3 closed; refused extensions leave the captured payload unchanged |
| S5 | Watch batch (`watches.ts`, `record` / `enqueuePrompt` / `flushOnce`) | `watches.json` queue | Routine | **Full at send; enqueue verdict and refusal receipt under lock** | F3 closed; frozen-plan output is refused before insertion; existing queued opaque output retains S07 dispositions |
| S6 | Watch-runtime fault note (`watch-service.ts:183-191`) | `config.mateNotes` | Routine | **Enqueue** | Drainable |
| S7 | Inspection result to General (`watch-inspections.ts`, `deliver`; 15 s `tickPrompts`) | `watch-inspections/inspection-runs.json` | Routine, only for watches routed to an isolated session | **Full** (`inspection` claim, exact payload hash and saved opaque text) | F1 closed; plan mentions stay pending during freeze and after commit, with a refusal receipt. Pending runs are not transferred; reconcile explicitly |
| S8 | Inspector prompts (`watch-inspections.ts`, `start` / `reconcile`) | same | Fleet inspection lifecycle, to the inspector agent | **None** | Out of per-plan drain scope: parentless read-only inspectors have no crew identity, plan ownership or finish subscription. General retains fleet inspection; S7 gates its results |
| S9 | Decision answer (`decision-answer.ts:116-137`) | Needs-you ledger | Captain-initiated, plan-scoped | **Full** (`claimHeld`) | Drainable (L4) |
| S10 | Item discussion (`item-threads.ts`, `sendThread`) | `data/item-threads/` | Captain-initiated | **Full**, in the captured recipient's `beforeSend`, with reservation under the same gate lock | F2 closed; refused drafts are not reserved, recorded messages replay without a second send |
| S11 | Relaunch request to General (`crew.ts`, `relaunchCrew`) | none | Captain-initiated | **Full**, after `askMate` captures General | F2 closed; claim retains worker identity and exact relaunch payload |
| S12 | Captain chat, Bearings, Ahoy, update request (`askMate`, `mate.ts:287-301`) | none | Conversation | None | Out of drain scope: General stays conversation-first |
| S13 | Opening, compact, handover (`mate.ts:176, 251`; `migration.ts:252`) | config | Lifecycle | None | Out of drain scope |
| S14 | Local steer, interrupt, end (`crew.ts`, board action functions) | in-memory steers | Captain → worker | **Full** (`crew-action`) | F2 closed; S08 refusals retained. Existing safety exception retained: an unreadable sidecar with no worker identities cannot block local Interrupt/End; known frozen/scoped workers remain refused |
| S15 | Remote steer, interrupt, end (`remote-crew.ts`, `mutate`) | none | Captain → remote worker | **Full** (`crew-action`, remote worker key), after S08 guard | F1 closed; request outside lock, accepted/uncertain result before return; no native retry added |

General-originated actions are not plugin deliveries, but they reach workers too (R12O N4):

| # | Path | Class | S07 gate | Drain status |
|---|---|---|---|---|
| S16 | Remote helper pump (`remotes.ts:427`, 1 s): runs the first mate's `tools/remote.mjs` requests (send, run, archive …) against remote hosts | General → remote worker | **None**, and no S08 guard | Out of automatic per-plan delivery drain: explicit General-authored tool commands, not queue notifications or board actions. Charter-only exclusion of scoped workers remains cooperative; no enforced exclusion or fleet-wide relief claim |
| S17 | General's native Paseo MCP calls (`send_agent_prompt`, `archive_agent`, `create_agent` …) | General → local worker | **None**: the daemon executes them, so no plugin path exists | Out of plugin delivery drain: explicit General-authored native operations with no plugin admission point. Charter-only exclusion remains cooperative; enforced exclusion needs U1 |

The gate is skipped entirely when `config.home` and `config.mateAgentId` are both empty (`watch-service.ts:133`).
That case has no first mate, so no recipient.

### 1.3 Owners

| Owner | Held by | Transfer available? |
|---|---|---|
| Legacy plugin queues (`mateNotes`, watch queue, decision ledger) | `config.mateAgentId` (General) | Yes, per plan, through S07 dispositions; the importer is unwired (the cutover executor is gated) |
| Native finish/permission callbacks (`notifyOnFinish`) | The agent that created or last prompted each worker, which is General for legacy crew | **No (U2).** The only path is drain or hold with the original owner, and the charter never re-prompts to rearm. `worker-callback` is an S07 hold kind |
| Native heartbeat (`create_heartbeat`, charter section 7, about every 30 minutes while work is under way) | General | **No (U2).** There is no heartbeat inventory or ownership API. Archiving General completes its heartbeat |
| Native schedules | The captain's; the charter only reads them | Not plugin-owned |
| Scoped plan owners | None can exist: `SupervisorSessions.attach` (captain-only) and `prepare` have no production caller | Gated (activation) |

Live read-only observation at census time: 0 entries in `config.mateNotes`, 0 entries in the watch queue
(`watches.json`), and no `supervision/` journal. One legacy plan store exists, with 86 entries under one home
digest. Read once; this is not an observation window.

### 1.4 Timers and hooks

| Timer / hook | Period | Can wake General? | Switch |
|---|---|---|---|
| Workflow request service + `queuePlanNotes` (`workflow-service.ts:97`) | 1 s | Indirectly (queues S2) | None |
| Script-watch runner (`watches.ts:233-271`) | Each minute | Yes (S5) | Per-watch `disabledWatches` |
| Turn-end flush retries (`watches.ts:420-431`) | 1, 5, 15 s after a General turn | Yes (S5) | None |
| `tickPrompts` (`watch-service.ts:175`) | 15 s | Yes (S6, **S7**) | Managed watch `enabled` |
| Note flush timer (`watch-service.ts:198`) | 15 s | Yes (S1) | None |
| Remote pump/poll (`remotes.ts:441-444`) | 1 s pump, 60 s poll | No (remote CLI only) | No hosts, no work |
| Needs-you ledger (`needs-you-service.ts:163-167`, plus a backlog `fs.watch`) | 5 s | No | `FIRSTMATE_NEEDS_YOU=0` |
| Attention sampler (`attention.ts:192-199`) | 60 s | No | Off unless `FIRSTMATE_ATTENTION_OBSERVE` |
| Hooks: steer relay (`crew.ts:203`), crew-seen (skips scoped workers), receipt observers, watch-service turn hooks | Per turn | Steer relay → S3 | Receipt journal flag |
| Unregistered: `supervision-events`, `supervision-lifecycle`, `registerScopedBoardIngress` | — | — | — |

Watches in the live home at census time (`watches/`, `config.disabledWatches`). `pr-watch` (`*/5`) and
`remote-watch` (`* * * * *`) are the enabled built-ins. Four are disabled: `board-review`, `launch-metrics.mjs`,
`metis-pentest` and `workspace-review`. The live `pr-watch` is an **untouched** copy of the installed version's
built-in (fingerprint `2bfa5831c4d1f364`). Installing this head therefore rewrites it to main's version
(`9d23562fb85a7be2`): same schedule, same default output, with the opt-in typed spool added. `remote-watch` is
unchanged. S10's `timerInventory` is not exposed by any RPC.

## 2. Acceptance evidence manifest (A01–A22)

Status words: **H** means the hard invariant is passed on the checked plugin path, by the named tests and the
accepted narrow review. **E unq.** means E is explicitly unqualified, gated on U1–U3 (`supervision-capabilities`
refuses every strong capability on 0.11.0, 0.12.0 and 0.13.0). **T unmeasured** means there is no
representative baseline. **Live: none** means no live scope can exist at this head, so there is no
production-path evidence.

| ID | Class | Primary evidence (tests; review) | Status under D6 option 2 |
|---|---|---|---|
| A01 | H; E | `supervision-effects`, `supervision-s04-closure`, `supervisor-sessions`, `test/scoped-supervision-pilot` tests; R01, R03, R04 | H. E unq. (`authenticated-caller` refused); file actor stated as unauthenticated |
| A02 | H | Pilot two-plan chain test; R06, R06O | H (synthetic). Live: none |
| A03 | H; E | `supervision-effects` (stale/red evidence), S08 head/check observations; R08 | H. E unq. (`receiver-fence`) |
| A04 | H; E | `supervision-resources`, `supervision-jobs`, `supervision-cooperative` (suspect holds); R10, R11 | H. E unq.; advisory locks never presented as enforced |
| A05 | H; E | `supervision-cooperative`, `supervision-effects`, pilot, S09 project-stop holds; R09 | H. E unq. |
| A06 | H; source completeness | S02 events/inbox, S08 sources (dedupe, gaps); R02, R08 | H on the journal path. Native callback replay is **gated on U2**: documented drain/hold, not transfer |
| A07.scoped | H | S03, S05, S06 answer identity/routing; R03, R05, R06 | H (synthetic). Live: none |
| A07.legacy | H | `supervision-migrate` L1–L5 on actual `queuePlanNotes`/`flushMateNotes`/decision adapters (L1 now asserts its exact binding reason); R07, R11 | H on the adapters. **Current-owner receipt** comes from a synthetic receiver: a live bound owner cannot be attached at this head. Live disposition: none |
| A08 | H; T | Pilot ten-minute General turn; R06 | H (synthetic, virtual clock). T unmeasured |
| A09 | H | S02 status pages, S05 UI (`S05-verification.json`), S09 `portfolio()` with zero `transact` calls; production reader is non-writable | H. "No resource on view": the production reader cannot write (store `writable()`) |
| A10 | H; E | `supervision-effects`, `supervisor-sessions`, `supervision-cooperative` (unresolved/uncertain hold); R04, R11 | H. E unq.; no automatic takeover is claimed (typed `false`) |
| A11 | H; E | S03 policy, S09 memory/grants (`supervision-projects`); R03, R09 | H. E unq. (spoof resistance) |
| A12 | H | `supervision-migrate` A12 history replay; S01 | H |
| A13.store | H | S01 barriers and `supervision-crash`; S07 abort/forward recovery; R01, R07 | H. See section 4 for the rollback-binary rule |
| A13.legacy | H | S07 L1–L5 plus F1–F3 path tests in section 6 (claim-before-send, freeze races, refusal receipts, uncertain holds) | Fixture coverage now includes S7, S10/S11/S14 and S15. No live scope or drain qualification |
| A14 | H; E | `archive-inventory`, `supervisor-sessions`, `supervision-cooperative`; R04, R11 | H (refusal). E unq.: conditional archive is gated on U3 |
| A15 | H | S03, S09 intent/sponsor/conflict tests; R09 | H |
| A16 | H | S05 UI checks (`S05-verification.json`); R05 rereview | H; the UI is disabled in production |
| A17.preserve | H | `supervision-timers`, pilot A17; S08 keeps `pr-watch` output unchanged; R06, R08 | H in fixtures. **Installing this head rewrites the untouched live `pr-watch`** (an approved built-in update, same schedule); the four disabled watches are retained |
| A17.occurrence | H | `supervision-jobs` (D5 option 1 dates, zones, DST, missed days, per-host resume); R10 | H in fixtures; no executor and no live scheduler |
| A18 | H; E | `supervision-capabilities` (refusal, exact versions, frozen evidence, no caller-supplied table); R11 | H. E unq. |
| A19 | T | S06 metrics, recomputed byte-equal by `summarizePilotMetrics` (`s06-b3r2-evidence`): legacy queue age p50 299 s / p95 599 s with ack and handled missing 4/4; scoped commit 0 ms, offer 10 ms, ack 20 ms | **T unmeasured.** Both runs are synthetic with a virtual clock. **Captain admission and first reply have denominator 0.** There is no live baseline |
| A20 | H | `supervisor-sessions`, `supervision-jobs`, pilot budgets; R04, R10 | H |
| A21 | H | `supervision-sources` (forged scope text stays in triage), `supervision-inbox` (forged watermark), `remotes` (redaction), watch quoting; R02, R08 | H |
| A22 | H | `supervision-crash` (SIGKILL boundaries), S01 A22 table; R01 | H; claims limited to process/filesystem durability |

Full suite at the S12 head (Windows 11, Node v23.7.0): 199 files, 2960 passed, 3 skipped. One
`launch-tool.test.ts` case failed on the first run and passed 90/90 on an isolated rerun, a known Windows
timing flake. `npx tsc --noEmit` exits 0. CI on both operating systems is the authoritative run.

## 3. Gates holding expansion

| Gate | Reason | Clears when |
|---|---|---|
| G1. Activation is unwired | No production path initialises a writable store, runs the S07 migrator, attaches a supervisor or constructs `SupervisionCommands` | A separately reviewed wiring change plus captain activation |
| G2. Legacy source coverage (F1–F3) | Implemented with per-path positive/refusal fixtures in section 6; unarmed adapters remain supervision-write-free. S8, S12/S13 and S16/S17 have explicit drain exclusions in the census | Review this follow-up before activation; re-run census and live qualification on the eventual wired build |
| G3. Native owners (U2) | General owns legacy crew callbacks and the heartbeat, and nothing can transfer them | **Gated on U2.** Under option 2, only scopes whose legacy workers have all finished (drained) qualify. General keeps its heartbeat while any legacy work runs |
| G4. Fleet-wide zero routine traffic | Requires G2, G3, and every legacy plan either drained or held by an accounted owner | Census re-run shows zero ungated routine paths and zero General-owned live callbacks |
| G5. Metrics | Captain admission was never measured (denominator 0). Queue latency is synthetic only | A live observation window records `captain[]` and samples with a monotonic clock |
| G6. Decisions | D6 option 2 is not yet recorded in its decision file; the exact install/route expansion and the observation window (the plan proposes 24–48 hours with a controlled reconnect) are not chosen | The captain records them |
| G7. Reviews | R12 and R12O have not run | Both accept, with no blocking findings |
| G8. Executor | `executorApproval` stays unapproved: `live-readers` is partial, there is no no-follow executor, and N7/receiver acknowledgements are missing | Not needed for drain; needed before any maintenance executor |

## 4. Admission freeze, forward recovery and rollback

These procedures apply once activation exists. **Nothing here is authorised by this document.**

**Admission freeze (new scopes).**

1. Stop creating scopes: no `prepare` or `attach`, and no S07 `prepare` on a new plan.
2. Existing scopes keep their owners. Pending S07 cutovers either `abort`, which releases the plan back to the
   legacy writer and restores archived entries exactly, or complete their committed sidecars. Never leave a plan
   half-frozen without an owner.
3. Reconcile admitted effects: `uncertain` and `accepted` effects stay reserved and are never resent. Spend and
   reservations are retained.

**Forward recovery.**

- Repair forward at a higher epoch: `hold`, then archive only after a complete persisted inventory, then
  `prepareReplacement`, then `verify`, then the new epoch's opening.
- Readiness counts an epoch only after its own opening has succeeded (R11 B2/R3-N2). Never restore a stale owner
  or epoch.
- A damaged journal holds admissions. Restore from a backup rather than resetting it.

**Rollback binary rule (new finding F4).**

- The S07 sidecar refusal exists only in builds that contain S07. The currently installed `9ed5dd84` predates
  S06–S11. It would write a plan that a committed cutover owns (a dual writer). It also reads no supervision
  state, so it has none of the scoped-worker refusals: board controls, steer relay, item discussion and remote
  guards (R12-5).
- **Trigger:** any of the following exists:
  - an initialised supervision journal (`plugin-data/firstmate/supervision/`);
  - any worker carrying a `firstmate.scope` label;
  - any `.scoped/` sidecar or `armed.json` in the live plan store.
- **Target, after the trigger:** roll back only to a build that contains S07 **and parses every journal row kind
  present**. In practice that is the build that wrote them, or a later one. `c01b272` (S07) cannot parse the
  S09/S10 kinds (`project` … `maintenance-incident`). A journal holding them would read `held`, and crew-seen
  would stop clearing attention for every crewmate. Never roll back to `9ed5dd84`.
- A build that has armed this follow-up also needs readers for delivery claim sources `crew-action` and
  `inspection`, including inspection text retained for later inventory. A pre-follow-up migrator cannot read
  those claims. Keep the writing build or a compatible later one for reconciliation.
- Before the trigger, rollback to `9ed5dd84` stays safe, because this head writes no new legacy-store construct.

**Plugin rollback (installation only, nothing armed).** Reinstall the retained previous directory source with
the same remove/install lifecycle used for the 2026-10-26 install. Plugin data persists across remove/install.

**Observation (proposed, not agreed).** At least 24–48 hours of representative traffic, including one controlled
remote reconnect and the actual maintenance cadence. Record a `firstmate.supervision-pilot-metrics/2` dataset
with `mode: live` and `clock: monotonic`, with captain samples. Compare against the legacy route. Report
denominators and exclusions. Unknown cost stays unknown.

## 5. Installing this head over the live `9ed5dd84`: what visibly changes

The install is inert: nothing scoped activates. The exact install and rollback steps are in the S12 report. A
captain would see:

1. **A charter Compare notice.** The live `data/charter.md` is edited, and the plugin charter gains one
   paragraph on `firstmate.scope` workers. The install writes `data/charter.new.md` and shows Compare/Done.
   `AGENTS.md` is unchanged until the captain merges.
2. **`watches/pr-watch` is rewritten**, because it is an untouched built-in (fingerprint `2bfa5831…` →
   `9d23562f…`). The schedule and default output are the same; it adds only the opt-in typed spool.
3. **Plan notes in the chat fold more widely (R12-6).**
   - Every generated plan-action note (`firstmate-plan-<uuid>`) folds to one line, with a ` · <plan id>`
     suffix, for example "Plan approved · scheduler".
   - Transfer and resume notes now fold as well ("Plan owner transferred", "Plan resumed").
   - An action the client does not recognise folds as **"Plan updated"** instead of showing in full.
4. **The steer relay, board steer, interrupt, end, relaunch and item discussion refuse workers labelled
   `firstmate.scope`.** None exist live. A worker archived, or whose re-check fails, between its turn ending and
   the relay is still relayed to the first mate as before (R12-3).
5. **The plugin is absent for about 20 s during remove and install.** The `plugin-settings/firstmate/` folder
   (`display.json` and `task-layout.json`, including Detailed columns) must be backed up and restored. In-memory
   board steers still awaiting an answer are lost on any reload.
6. **Trivial, irrelevant to the live home today (R12-6):**
   - Files view saves under `data/scoped/` outside `proposals/` are refused. The folder does not exist.
   - Agents labelled `plan-supervisor` are not offered for adoption.

## 6. Findings

- **F1 (implemented in the gating follow-up).** Inspection results and remote steer/interrupt/end now claim
  their captured recipients under the gate, send outside its lock, and settle. Inspection claims retain opaque
  report text so a later inventory can identify plan mentions. Reports mentioning a frozen or committed plan
  stay pending with a visible delivery error and refusal receipt; they are not rerouted or transferred.
  S08's remote guard and followed-session End refusal remain in front of delivery.
- **F6 (fixed in S12, R12O N1).** S07 had wrapped the watch runner's recording of a finished run, including
  `routeNote`, in the cutover gate lock. Once a script watch is routed to an isolated session, this formed a lock
  cycle: gate → inspection lock → lifecycle lock → gate. That deadlocks the plugin until restart. Routing now
  happens before and outside the gate, and only the queue insert and persist stay gated
  (`watch-lock-order.test.ts`, driven through a real `WatchRunner` tick; it hangs before the fix).
- **F7 (fixed in S12, R12O N3).** Plan reads, the agenda, the board snapshot, the scope route and the 1 s
  plan-note tick list `.scoped/` once, instead of reading four sidecar files per plan (about 344 failed reads a
  second on the live store, under the lifecycle lock). The writer's own check is unchanged
  (`workflow-cutover-batch.test.ts`).
- **F2 (implemented in the gating follow-up).** Item discussion reserves the message and claims the captured
  General recipient in one gate section, after lifecycle checks. Relaunch claims in `askMate`'s `beforeSend`.
  Local controls claim the exact native operation and worker. A freeze after the preliminary verdict is
  rechecked at admission. An uncertain acknowledgement remains a durable migrator hold, including after a
  result file has been written; it never authorizes automatic replay. Recorded discussion retries still return
  their original record, including after cutover.
- **F3 (implemented in the gating follow-up).** Script-output and prompt-watch insertions check the verdict
  under the same gate lock as insertion. A refusal writes a deduplicated receipt before throwing, with no queue
  mutation. Existing queued output still uses S07's explicit disposition flow; a foreign late insertion is still
  re-inventoried as a hold. Burst extension records its refusal and leaves the payload unchanged, returning as
  before. Watch routing stays outside the gate, preserving the R12O N1 lock-order fix.
- **F4 (rollback).** The rollback-binary rule above, with its trigger and target widened per R12-5.
- **F5 (record).** `data/fm-ss-d6/decision.md` does not record the option 2 choice.

The F1–F3 follow-up adds no writable production store, migrator/attach wiring, default activation or U1–U3
capability. Native callback/heartbeat ownership, F4 and F5 remain unchanged. The original S12 report records
its historical head; this census supersedes its F1–F3 source status only.

Per-path fixture coverage (test names with `%s` expand to each action named in the row):

| Finding / path | Implementation | Positive test | Refusal test |
|---|---|---|---|
| F1 inspection result | `server/watch-inspections.ts`, `deliver` | `watch-inspections.test.ts`: `F1 inspection result claims before General delivery and settles before marking sent` | `F1 inspection result refuses a %s plan mention and retains pending evidence` (freeze, committed) |
| F1 remote steer / interrupt / end | `server/remote-crew.ts`, `mutate` | `legacy-delivery-gating.test.ts`: `F1 remote %s claims before request and settles` | `F1 remote %s refuses a committed worker before request` |
| F2 item discussion | `server/item-threads.ts`, `sendThread` | `F2 discussion claims its captured recipient before delivery and settles before sent` | `F2 discussion rechecks under the gate after lifecycle checks and refuses before reservation` |
| F2 local steer / interrupt / end / relaunch | `server/crew.ts`, action functions | `F2 local %s claims before native delivery and settles` | `F2 local %s refuses a frozen worker and records it`; `F2 local %s rechecks a freeze after its preliminary verdict` |
| F3 script-output / prompt-watch enqueue | `server/watches.ts`, `enqueue` | `F3 watch %s enqueue admits unrelated output under the gate` | `F3 watch %s enqueue refuses frozen output before queue mutation` |
| F3 burst extension | `server/mate.ts`, `extendBurstNote` | `F3 burst extension admits an unrelated worker` | `F3 burst extension records a refusal without changing the captured payload` |

Additional coverage: direct controls and discussions are supervision-write-free while unarmed; inspection has
its own unarmed check. Lost native acknowledgements stay uncertain without automatic retry. `supervision-migrate.test.ts`
checks both worker and inspection uncertainty holds. `watch-lock-order.test.ts` retains the routed-watch lock
cycle regression; existing scoped-worker tests retain S08 refusals.

Follow-up local qualification (Windows, Node 24.22.1): typecheck passed; full CI-shaped two-worker suite
passed 203 files / 3,011 tests with 3 skips and no failures, with the CI journal/diagnostic/pilot flags.
All five CI render commands passed: `docs/needs-you/render.mjs`, `docs/scoped-supervision/s05-ui/render.mjs`,
`docs/attention-deck/render.mjs`, `docs/fm-ui-polish/render.mjs` and `docs/decision-ux-lists/render.mjs`.
Artifacts remain in ignored `.local/`. Hosted Actions billing is disabled; these are local checks, with no
Ubuntu or live daemon/provider qualification. No install, reload, arm, migrate or attach was performed.
