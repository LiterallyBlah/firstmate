# S04 preparation: supervisor lifecycle, effect gateway and goal continuation

This delivery is the **independent, synthetic-provider portion of S04**. Like S01/S03 it is
**unwired and disabled**: no RPC, request consumer loop, timer, hook, watch, live receiver adapter,
installation, send or native resource creation. Every class refuses with `UNSUPPORTED` unless a
fixture constructs it with `enabled: true`. The live workflow service passes no partition guard,
so legacy behaviour is byte-for-byte unchanged. Full S04 integration remains gated on S02 landing.

Base: `origin/main` `9ed5dd84193075674d598b3ee8624ae4eda8af0d` (S01 + S03 + plan ownership landed).
The independent review of `e99ca022` (R1–R9) is corrected in a later commit; see *Review corrections*.
S02 (`origin/fm/fm-ss-s02`, `9234f208`) was read for its interface only; nothing depends on it.

## What exists

| Module | Responsibility |
| --- | --- |
| `shared/supervision-effects.ts` | Closed local operation vocabulary (`workspace.open`, `agent.create`, `agent.send`, `agent.interrupt`, `agent.archive`), receiver capability contract, receiver seam types. Release operations have no adapter. |
| `server/supervision-effects.ts` | `SupervisionGateway`: S03 start + task pointer + attempt + workspace/create/send reservations in **one** transaction; `dispatch` (commit `dispatching` before the boundary); `reconcile` (exact identity only); `verifyWorker`; guarded interrupt/archive proposals. |
| `server/supervisor-sessions.ts` | `SupervisorSessions`: reserve (prepared binding, selected unprompted identity) → workspace → create → verify → active → opening; explicit captain hold; manual replacement after observed quiescence; counted supervisor turns. |
| `shared/supervision-continuation.ts`, `server/supervision-continuation.ts` | Unfinished-goal obligation: derived disposition, semantic input version, owner-recorded assessment, goal/project status, restart liveness scan. |
| `server/scope-requests.ts`, `templates/tools/scope.mjs` | Legacy/scoped partition (`legacyRoute`, `scopeRoute`) and the guest scope helper transport + consumer (not seeded, not started). |
| `server/supervision-store.ts`, `shared/supervision.ts` | One additive row kind, `continuation`, with owner and reopen invariants. |
| `server/supervision-commands.ts` | `planCommandWith`: the existing checked preparation, extended inside the same transaction. |
| `server/workflow-service.ts` | Optional `route` parameter for `processWorkflowRequests`; unused by the live service. |

## Invariants and how they are enforced

- **One effect per logical start.** Logical keys derive from `(task#ordinal or epoch, operation,
  causation, objective revision)`, never a request ID; the store's unique `effectKeys` index refuses
  a second reservation. Effect, attempt and agent IDs are derived from that key, so a replay reuses
  them. An exact replay returns the original receipt; different bytes under the same ID conflict.
- **Reserved/unprompted → verified → active → send.** `agent.create` waits for its workspace
  receipt; the create request carries no prompt and no parent. `verifyWorker`/`verify` require the
  exact selected identity, workspace and directory, labels, provider/mode/thinking, idle with no
  pending permission and **no `paseo.parent-agent-id`** (independent ancestry, no General callback).
  Only then is the attempt `active` or the binding `active`; sends refuse before that.
- **Uncertainty retains budget and resources.** `dispatching` is published before the receiver call.
  A non-definite failure is `uncertain`; a crash leaves `dispatching` (reported uncertain). Dispatch
  refuses anything not `reserved`. Reconcile uses only exact lookups (reserved agent ID; workspace
  intent key if the receiver declares it); a negative answer never proves non-creation. Sends and
  interrupts have no receipt lookup (U1) and stay uncertain. A late original is bound to its intent.
  A definite pre-admission rejection fails and cancels that launch's never-dispatched siblings.
  Attempt spend is reserved at start and never decreases; supervisor spend counts every reserved
  supervisor create/send effect (cancelled included) against separate caps, so nothing refunds it.
- **Capability-qualified reserved IDs.** Receivers declare a strict v1 capability record. Without
  `selectedAgentIds` nothing is written and no fresh-ID or prompted fallback exists (A18-C01/C02).
  A receiver claiming send receipts or conditional archive is refused rather than downgraded (A18-C05).
- **No old-epoch authority.** New effects need the current binding epoch (store); the dispatch claim
  rechecks the owner epoch inside the writer boundary; S03 commands, proposals and continuation records refuse old epochs.
  Hold is explicit (captain); replacement needs the exact old supervisor archived/closed — idle is not
  stopped, and no lease, heartbeat gap or timeout grants takeover. Uncertain effects keep their epoch.
- **No scope authority in the global role.** `role.mjs` is unchanged. A supervisor is labelled
  `plan-supervisor`, verified never to be the configured global mate, and uses `scope.mjs`, which
  refuses when `role.mjs` says `first-mate`. The consumer refuses the global mate's identity.
- **Partition.** `legacyRoute` refuses legacy writes to plans the scoped store owns or retains
  (including retained capsules when the store is held). `scopeRoute` refuses plans the legacy store
  owns, has quarantined or cannot currently read. Scoped starts always use the gateway.
- **Stops and holds.** S03's stop cancels reserved effects; the dispatch claim also refuses new work
  under a `plan.start`/`model.use` hold, as do supervisor activation and turns. Interrupt and archive
  remain the safe-stop path. Dispatched/uncertain effects keep their reservations. Unrelated scopes continue.
- **Archive.** A proposal needs the current owner, a recorded terminal node outcome (idle is not
  finished), a complete persisted inventory and zero live descendants; dispatch rechecks it. Without
  U3 this is check-then-archive, not race-free, and the receipt does not claim otherwise.

## Unfinished-goal continuation

`deriveContinuation` computes, from durable plan/attempt/effect/hold/decision rows only:
`ready-action`, `needs-planning`, `waiting`, `blocked`, `paused`, `captain-decision` or `completed`.
All nodes terminal, failed nodes or an empty agenda are **needs-planning**, never success; completion
requires an owner/captain record with evidence while work is quiescent and nothing is ready, applies
only while its outcome fingerprint matches, and is retained as history when superseded. Explicit pause comes from the checked stop/held plan; idleness never pauses.
A routine continuation stays with the owner; only a captain-authority decision escalates (reusing
`decisionOwner` and plan ownership). Spent budget blocks only an otherwise ready run.

The semantic input version excludes plan hash, sequence, acknowledgements, the assessment row and
supervisor offer delivery, so none can retrigger a pass. `due` is true only for
`ready-action`/`needs-planning` without a current, validated, unexpired assessment. An identical retry
at the same generation is refused. Planning and ready work are cleared only by committing them;
neither can be recorded. `goalStatus` gives goal and project rows (owner, next action/wait, live workers/effects,
evidence time) without writing. `livenessScan` reads exact workers after restart/lost callbacks; it
never creates, prompts, rearms or retargets.

## Shared schema agreement (explicit synthetic S04 format)

- **Binding.** `workspaceIntent` (optional) names the reserved workspace request; `workspaceId` is only
  ever the verified Paseo workspace ID and is `null` solely while a reserved binding is unverified
  (schema refinement: null needs an intent and cannot be `active`). The store allows exactly one
  same-epoch change, `null` → value together with `prepared` → `active`, and requires the value to
  equal the succeeded receipt of that binding's own `workspace.open` intent. Intent, agent, host and
  profile stay immutable within an epoch. Bindings without an intent (S01/S03 fixtures) are unchanged.
- **Effect.** `payloadDigest` (optional) is the immutable content-addressed bytes a send delivers
  (brief, opening, offer text). `evidenceVector` keeps only S03 `policy-evidence` refs, so final
  admission can recheck it with S03 semantics. `policyVector` of a worker effect is the de-duplicated
  union of the start and model-use policy read sets. `dependencyBindings` (optional) retains the exact
  prerequisite outcomes admitted by S03 at reservation (plan, node, outcome, satisfying attempt).
- Prepared-before-verified binding, constructor-supplied supervisor caps and retained previous-epoch
  reservations remain the bounded seams accepted in principle by the review; caps still need a
  durable policy source and one budget decision.

## Review corrections (R1–R9)

- **R1 final admission.** `dispatch` publishes its `dispatching` claim through `transactCommand`, so
  the checks and the claim share the writer boundary and a committed hold/stop/policy/backend change
  wins. Checked: owner scope/binding/epoch/state, backend, plan status, node attempt and liveness,
  current dependency satisfaction, stop/policy holds, the pinned policy read set (rules, deny/expiry,
  model constraints, on-disk source re-hash), evidence rows and approval expiry. Sends re-observe the
  exact target (identity, workspace, idle, no pending permission) before the claim; interrupt and
  archive re-observe their exact target, archive rechecks its inventory and terminal outcome. Interrupt
  and archive stay admissible under stop (safe-stop). The U1 receiver race after the check remains.
- **R2 replay first.** Starts, supervisor prepare/replacement and turns replay an accepted request
  from the immutable command receipt before any brief, capability, epoch or receiver preflight.
- **R3 spend.** Supervisor sessions/turns count every reservation, including cancelled ones; stop
  and policy holds refuse new supervisor activation and turns.
- **R4 offers.** Supervisor activation and turn effects are excluded from the goal generation and
  reported as `offers`; settling an offer cannot create a new planning pass.
- **R5 identity.** Replacement accepts closure only for the exact old identity and pins the observed
  binding through its commit; archive reconciliation and the liveness scan ignore misbound answers.
- **R6** as in the schema agreement above.
- **R7.** The store refuses a workflow running identity that differs from the verified attempt
  worker, and refuses one recorded before verification for a gateway-reserved attempt.
- **R8.** Completion binds an outcome fingerprint (graph, node outcomes including invalidation,
  external prerequisites). If it changes, the completion stops applying and the goal is due again;
  a checked `validate` that restores the same outcome restores it. Superseded completions are kept
  verbatim (store-enforced append-only history). Completion is refused while ready work or an open
  decision remains.
- **R9.** Only `waiting`, `blocked`, `paused` (captain), `captain-decision` and evidenced `completed`
  can be recorded. Waits must name a current fact (live attempt/effect, held hold, open captain
  decision, unmet external dependency) or be a bounded capacity/prerequisite wait with `until` at most
  seven days ahead; expiry makes the same generation due again with a new wake key. Ready work is
  quiet only behind a capacity, hold or prerequisite wait.
- The unguarded legacy path no longer awaits an absent route guard.

## Format compatibility (unactivated synthetic format, replaced not migrated)

These formats were never activated, installed or written outside fixtures. Each correction **replaces**
the synthetic S04 format; nothing migrates or rewrites saved evidence, and no mixed-version
reader/writer compatibility is claimed.

- Older S00/S01/S03-shaped bindings (real workspace ID, no intent) and effects without the new optional
  fields still parse. Readers older than the S04 corrections cannot read `workspaceIntent`, a null
  `workspaceId`, `payloadDigest` or `dependencyBindings` (strict schemas refuse unknown fields).
- `e99ca022` continuation rows do **not** parse: they lack `superseded` and `completion.outcomeHash`,
  and their recorded `needs-planning`/`ready-action` dispositions are no longer storable.
- `0a6fc23b` worker effects lack `dependencyBindings`; final dispatch refuses such an effect when its node
  has prerequisites (`HELD`, replan), and keeps its reservation and spend.
- Retained review evidence stays under its original source identity; a store written by an older head
  must be read by that head. Before any persistence integration, version this boundary explicitly.

## Correction-review closure (C1–C3, after `0a6fc23b`)

- **C1 (R1).** Reservations retain S03's validated dependency bindings. Final dispatch re-resolves each
  under the writer boundary: unique owning plan and node still present, the shared S03 route rule
  (`checkDependencyRoute`: active scoped backend, available owner scope), same satisfying attempt, outcome
  still met, not held or invalidated. Refusal keeps the reservation and spend and calls no receiver.
- **C2 (R1).** Before a send claim, the fresh observation must equal the verified reservation (exact
  identity, profile, workspace and directory, labels, no native parent, idle, no pending permission), for
  workers and supervisors. Model policy is then evaluated on that validated observed profile. Detected
  divergence only: later native changes are not fenced (U1).
- **C3 (R9).** One applicability rule is used when recording and on every quiet derivation. A decision
  wait counts only for a captain-authority decision the answer handler would accept now
  (`planDecisionReady`). An external dependency wait counts only while that prerequisite is advancing
  (live attempt or answerable decision); otherwise only a bounded prerequisite wait can account for it.
  A persisted wait whose fact no longer holds never quiets derivation.
- **Final-admission audit (revision/subject/approval).** With real commands: a revision returns the plan
  to review, so queued work is `HELD` until re-approved; the landed reducer pins started nodes (removing
  one is refused, currently with a `TypeError` message from `digest(undefined)` — a pre-existing reducer
  defect outside this slice; no write occurs). Approval rows are immutable and their policy/evidence
  vectors are pinned in the effect; a policy change holds, and after the reviewed release the stale pinned
  vector still refuses (`STALE`). Approval expiry cannot be produced through the real approve path
  (`expiresAt` is always null) and remains source-checked only.

## Remaining S02 integration seams

- Ingress/assignment: S02 events for worker finish/permission/error must resolve to the attempts and
  effects created here (`firstmate.scope`/`firstmate.attempt` labels, attempt IDs), and S02 handled
  results reference effect IDs (`InboxResult.kind: "result"`).
- Offers: an S02 informational offer must go through `SupervisorSessions.reserveTurn` + `dispatch`
  so a supervisor turn is counted; `DerivedContinuation.wakeKey` is the stable consequence key.
  One in-flight offer per scope and checkpoint acknowledgement after replacement are S02's.
- Trigger wiring: S02 hooks/catalog/timeline facts, turn ends, restart and the existing heartbeat
  call `continuationAgenda`; persisted `livenessScan` facts become S02 events.
- Status/RPC: `goalStatus` is the S05 projection input; no RPC is registered.
- Live receiver: a `GatewayReceiver` over `PaseoApi` (`workspaces.create`, `agents.create` with
  `agentId`, `agents.ref().send`, archive via `archive-inventory.ts`) needs S00/S11 capability
  qualification; until then it must declare `selectedAgentIds: false` and is not written here.
- Not changed while disabled: `templates/data/charter.md`, `role.mjs`, `launch.mjs`, `workflow.mjs`,
  `mate.ts`, `launch-tool.ts`, `archive-inventory.ts`. Charter text reaches live homes on reload, so
  guidance for an inactive feature would mislead the current mate.

## Tests

`server/supervision-effects.test.ts`, `server/supervisor-sessions.test.ts`,
`server/supervision-continuation.test.ts`, `server/scope-requests.test.ts`,
`server/supervision-s04-review.test.ts` (every review counterexample and positive control),
`server/supervision-s04-closure.test.ts` (C1–C3 and the final-admission audit), with
`test/synthetic-receiver.ts` (deterministic fault injection: lost reply, hidden/late creation,
capacity/definite rejection, tampered settings/ancestry, incomplete inventory, slow reply) and
`test/supervision-s04-fixture.ts`. They cover A01-C02/C04/C05, A03-C04, A05, A08, A10, A14, A18-C01/
C02/C03/C05, A20, P05/P06 and the initiative report's intermediate-success/zero-worker, two-ready,
missing plan vs captain decision, lost callback, capacity, stale transfer, unchanged retry, pause,
self-trigger and status controls. Synthetic fixtures are not live qualification.
