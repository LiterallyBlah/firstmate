# S04 preparation: supervisor lifecycle, effect gateway and goal continuation

This delivery is the **independent, synthetic-provider portion of S04**. Like S01/S03 it is
**unwired and disabled**: no RPC, request consumer loop, timer, hook, watch, live receiver adapter,
installation, send or native resource creation. Every class refuses with `UNSUPPORTED` unless a
fixture constructs it with `enabled: true`. The live workflow service passes no partition guard,
so legacy behaviour is byte-for-byte unchanged. Full S04 integration remains gated on S02 landing.

Base: `origin/main` `9ed5dd84193075674d598b3ee8624ae4eda8af0d` (S01 + S03 + plan ownership landed).
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
  Attempt spend is reserved at start and never decreases; supervisor spend is derived from durable
  effects (non-cancelled create/send) against separate caps, so failures do not refund it.
- **Capability-qualified reserved IDs.** Receivers declare a strict v1 capability record. Without
  `selectedAgentIds` nothing is written and no fresh-ID or prompted fallback exists (A18-C01/C02).
  A receiver claiming send receipts or conditional archive is refused rather than downgraded (A18-C05).
- **No old-epoch authority.** New effects need the current binding epoch (store); dispatch fences
  the binding/attempt versions; S03 commands, proposals and continuation records refuse old epochs.
  Hold is explicit (captain); replacement needs the old supervisor archived/closed — idle is not
  stopped, and no lease, heartbeat gap or timeout grants takeover. Uncertain effects keep their epoch.
- **No scope authority in the global role.** `role.mjs` is unchanged. A supervisor is labelled
  `plan-supervisor`, verified never to be the configured global mate, and uses `scope.mjs`, which
  refuses when `role.mjs` says `first-mate`. The consumer refuses the global mate's identity.
- **Partition.** `legacyRoute` refuses legacy writes to plans the scoped store owns or retains
  (including retained capsules when the store is held). `scopeRoute` refuses plans the legacy store
  owns, has quarantined or cannot currently read. Scoped starts always use the gateway.
- **Stops and holds.** S03's stop cancels reserved effects; dispatch also refuses under a
  `plan.start` hold. Dispatched/uncertain effects keep their reservations. Unrelated scopes continue.
- **Archive.** A proposal needs the current owner, a recorded terminal node outcome (idle is not
  finished), a complete persisted inventory and zero live descendants; dispatch rechecks it. Without
  U3 this is check-then-archive, not race-free, and the receipt does not claim otherwise.

## Unfinished-goal continuation

`deriveContinuation` computes, from durable plan/attempt/effect/hold/decision rows only:
`ready-action`, `needs-planning`, `waiting`, `blocked`, `paused`, `captain-decision` or `completed`.
All nodes terminal, failed nodes or an empty agenda are **needs-planning**, never success; completion
requires an owner/captain record with evidence while work is quiescent, and cannot later be erased
for the same objective. Explicit pause comes from the checked stop/held plan; idleness never pauses.
A routine continuation stays with the owner; only a captain-authority decision escalates (reusing
`decisionOwner` and plan ownership). Spent budget blocks only an otherwise ready run.

The semantic input version excludes plan hash, sequence, acknowledgements and the assessment row,
so recording an assessment or a bookkeeping ack cannot retrigger itself. `due` is true only for
`ready-action`/`needs-planning` without a current-generation assessment. An identical retry at the
same generation is refused. Ready work is cleared only by committing it; "ready-action" cannot be
recorded. `goalStatus` gives goal and project rows (owner, next action/wait, live workers/effects,
evidence time) without writing. `livenessScan` reads exact workers after restart/lost callbacks; it
never creates, prompts, rearms or retargets.

## Contract notes for review

1. **Binding before effects.** The plan text says "commit binding after verify". S01's store requires
   a binding at the effect's epoch for every new effect. This slice commits a `prepared` binding
   (reserved identity) before the activation effects and makes it `active` after verification; scope
   state is `transferring` meanwhile, which S03 already refuses for commands.
2. **`binding.workspaceId`** is `workspace-intent:<key>` because the workspace ID is unknown until its
   own effect succeeds and the store forbids same-epoch identity changes. The actual workspace is the
   effect receipt, checked at verification. A schema field for both is an S01/S02 integration choice.
3. **Payloads** (brief, opening, offer text) are immutable store blobs referenced from the send
   effect's `evidenceVector` as `payload-blob`; the supervisor profile blob's ID is the binding's
   `profileDigest`. No new effect field was added.
4. **Supervisor caps** are constructor inputs in fixtures; their durable policy source is unassigned.
5. **Re-epoching reserved effects.** Reserved, never-dispatched worker effects from a previous epoch
   are left visible and refused, not cancelled or moved; the new owner's handling needs a decision.

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
`server/supervision-continuation.test.ts`, `server/scope-requests.test.ts`, with
`test/synthetic-receiver.ts` (deterministic fault injection: lost reply, hidden/late creation,
capacity/definite rejection, tampered settings/ancestry, incomplete inventory, slow reply) and
`test/supervision-s04-fixture.ts`. They cover A01-C02/C04/C05, A03-C04, A05, A08, A10, A14, A18-C01/
C02/C03/C05, A20, P05/P06 and the initiative report's intermediate-success/zero-worker, two-ready,
missing plan vs captain decision, lost callback, capacity, stale transfer, unchanged retry, pause,
self-trigger and status controls. Synthetic fixtures are not live qualification.
