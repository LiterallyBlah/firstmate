# Supervisor first-release integration qualification

This is Stage 3 source and synthetic readiness over the accepted Stage 1/2 implementation. The runtime, one executing plan per physical owner, optional project judgment, dedicated app Attach, cumulative budgets, uncertain-effect reconciliation and all authority/capability gates remain their existing mechanisms. No live rollout is implied.

Stage 1's frozen contract and baseline remain byte-identical to `27ffa47`. Stage 2 correction head `ce98f3b5b612af744bb7f81467cb821698b8bcdf` was independently accepted and landed in `b9793eba4cd915c60e238aad9fdf599903b33fd7`. This branch starts there. The input audit verifies the accepted document, original reports, all 49 correction-review artifacts, all 269 correction-builder artifacts and 13 committed source pins. It does not execute predecessor scripts or modify those worktrees.

## Remaining gaps and bounded changes

The accepted ownership/configuration/routing mechanisms already deliver A1–A8. Remaining work was production native-to-effect evidence, complete reservation-cost accounting, queue-boundary timing, legacy/new snapshot compatibility and integrated readiness qualification. This stage adds no execution system, source timer or provider adapter.

- The captain queue retains optional enqueue, claimed-transport and transport-response times plus the admission busy cause. Exact replay/reload preserve these observations. Historical rows stay without invented timestamps. Failed/uncertain sends retain null acceptance; native model start stays unknown. Queue ordering, one-per-completed-turn, explicit-now and uncertainty behavior are unchanged.
- Receiver status reads run outside the shared queue file transaction. Submission keeps arrival order per physical recipient; an exact replay still precedes current receiver checks. The existing background poll keeps at most one pending observation per recipient and claims only its original oldest item after a fresh local recheck. A stalled scoped receiver cannot hold General's admission or another recipient's next completed-turn release. Late reads cannot revive removed/edited/delivered inputs. This reuses the same queue and timer.
- The pure cost projection reads existing owner effects, worker attempts (including imported spending) and the original inspector ledger. It does not count worker create/send effects again, refund failures, or count inspector notification recipients as extra inspections. It reports unknown totals for missing owner history/General coverage, and unknown tokens, context and billing. There is no new authoritative spending store or model-based reporting.
- Migration snapshot `/1` retains exact configuration, watch generations, watch queue and inspection ledger bytes, with an explicit inventory. Journal configuration generations and route sidecars remain in their existing journal/legacy inventory. Source changes during capture hold it. Existing `/1` readers already verify these ordinary file entries; old snapshots remain readable. These copies are evidence, not an atomic native census or restore authority. No migration/restore executor is added.
- The integrated browser exposed a completed prepare review still visible after route preparation/commit/pause. The shared native review now hides that completed form. Three causal red/green assertions preserve stale-review refusal and the existing exact lifecycle controls.

## A1–A12 evidence map

| Contract | Required evidence on the final head |
| --- | --- |
| A1 | Native component/real-handler fixture, concurrent assignment/replay in `test/fmu-assignments`, original activation/profile/host/one-owner tests; browsing creates no native effect. |
| A2 | `supervisor-controls`, `supervisor-corrections`, `supervisor-sessions`, profile-contract and effect tests; immutable explicit high, final readback and pending attribution retained. |
| A3 | Existing replacement/lifecycle/activation crash tests and foundation contracts, including stopped predecessor, lost opening, exact retry, caps and refusal of uncertainty. |
| A4 | Existing observer and inspection suites; missing qualified adapter refuses before creation. Synthetic independent read-only fixture is source-contract evidence only. Installed provider confinement remains **unqualified**. |
| A5 | Actual schema-checked app assignment through owned ingress/gateway; existing source/profile/policy/rules, headroom and authority tests. No assignment grants release/remote/merge authority. |
| A6 | Real script runner -> PlanRuntime test: 100 identical healthy reports add zero owner/General/inspector turns before a changed failure reaches its exact owner. Stage 2 clock, A–B–A, due/expiry/policy and recovery controls rerun unchanged. |
| A7 | Source/continuation/inbox/decision suites plus prior F1/F2/F5 adverse controls: stale evidence, coverage gaps, failed dependencies, unhandled results, unknown effects and source failures retain obligations. |
| A8 | Existing S07 and assignment prepare/drain/commit/send crash tests, actual handler F3/F4 replay/crash repairs and snapshot retention. Precommit abort preserves exact old entries; accepted/committed work uses forward reconciliation. |
| A9 | Two production-composed build/review chains finish while General's lifecycle lock stays held. Prior actual stalled-owner and production-tick isolation controls rerun. New native -> RPC -> watch runner -> PlanRuntime -> receiver path adds no General cascade. Causal queue regressions and the actual registered General-submit handler prove admission and completed-turn release while another native receiver lookup stalls. Existing one-per-turn, replay, late-read removal and uncertain-send suites remain required. |
| A10 | `test/fmu-integration/chains.test.ts` replays the same necessary-work schedule through the existing direct runtime with/without 400 stored status projections. Both reserve 4 worker sessions/turns and 2 owner sessions/4 owner turns: **6 sessions, 8 turns**, zero added status turns. Inspector and General counts on this cohort are zero; other layers are explicitly included. Queue metrics retain measured/censored denominators and unknown model start. |
| A11 | Actual native-web entrypoints use schema-checked registered app handlers at 1440/390, light/dark, including keyboard entry and prepare/commit. Existing frozen Attach comparisons, both-theme/width state and Home/watch/plan equality harnesses rerun. Browser/native-component evidence is not an installed-device test. |
| A12 | Full replay/capacity/recovery/migration/journal-isolation/receipt/legacy tests; old snapshot reader, original inspection spend, historical queue rows, additive timing and uncertainty remain compatible. Required typecheck/native compiler/Hermes/full CI gates are mandatory. |

No frozen assertion is renamed or waived. Stage 2 F1–F5 remain regression requirements: shared-subject exact-one recovery/quiet renewal; no contradictory clock replay; accepted prepare replay before new-target validation; latest-action-only transport repair with visible holds; source-local failure isolation with affected admissions held until recovery and global corruption still globally held.

## Reproduce

Use Node 24 and locked dependencies (`npm ci`, `npm ci --prefix docs/board-list`). All tests use the repository's isolated `PASEO_HOME`; no native daemon/provider is used. Logs, failures, PNGs, reports and manifests stay in ignored `.local/fmu-integration/` and the existing render output directories.

```text
node docs/fmu-integration/audit-inputs.mjs
node node_modules/typescript/bin/tsc --noEmit
node node_modules/vitest/vitest.mjs run --maxWorkers=2 --testTimeout=60000 --reporter=default --reporter=json --outputFile=.local/fmu-integration/full-tests.json
node docs/fmu-integration/run-gates.mjs
node docs/fmu-assignments/check-native.mjs
```

For full tests enable `FIRSTMATE_RECEIPT_JOURNAL=1`, `FIRSTMATE_CI_DIAGNOSTICS=.local/ci-diagnostics`, `FIRSTMATE_PILOT_EVIDENCE=1` and pin `FIRSTMATE_PILOT_SOURCE_HEAD` to the exact head. This evidence flag runs synthetic fixtures only. For native source compilation set `PASEO_COMPILER` to the inspected installed compiler and `FMU_ASSIGNMENTS_NATIVE_OUT=.local/fmu-integration/native`; this installs/loads nothing. `run-gates.mjs` executes the CI's Node render/regression commands with exact argument vectors, including production browser captures. The historical baseline `de4dac1be70736cf0a0f417244f9ab895ed5354d` must exist for the delayed UI harness, as required by CI.

The new production-handler browser gate runs after browser dependencies are ready with `FMU_INTEGRATION_CAPTURE=1` and `test/fmu-integration/native-path.test.ts`; it invokes real registered handlers only in temporary fixture homes. Its absent-capture normal mode uses the same native component through React's test renderer and identical handlers/effect assertions. Native headers/modal and the provider receiver are synthetic host seams. Required CI must independently pass at the published PR head; local results do not imply GitHub success.

## Bounded rollout and rollback packet

This packet authorizes no operational action. FirstMate owns the final same-stage independent Astra HIGH checkpoint and any subsequent source/readiness disposition under existing authority.

1. Separately authorized installation must attest the reviewed source, loaded compiler/runtime/dependencies, effective policy and compatible rollback reader. A registered source path is not proof of a loaded bundle. Preserve unlanded work and prior rollback source.
2. Refresh the original absolute home/host namespace, exact plan/watch definitions, owner/profile/catalog generations, cumulative caps, queue/claim/callback census and source coverage. Views initialize nothing. Optional projects retain allocation/policy without a required project model.
3. For each future migration, retain the exact inventory/dispositions and independent verified snapshot. S07 prepare/freeze/import/barrier/commit stays authoritative. Only the captain's dedicated app action attaches; the transport still has unverified app provenance, not authenticated captain identity.
4. Before commit, abort uses the original retained request and restores only exact archived entries under the existing protocol. After accepted source binding or committed S07 cutover, hold new admission and reconcile forward with a compatible reader/writer. Never re-enable the old General writer, truncate journals, resend uncertain input, clear a claim or reset/refund cumulative spending.
5. Watch routes retain the existing timer identity and enabled choice. Prepare inventories old deliveries, only exact approved drains proceed, and uncertainty prevents commit. Unassign pauses future input with no General fallback. Broad initiative remains until every residual duty has an explicit owner/disposition. No additional timer ships.
6. A later local pilot requires a separate reviewed grant over two new disposable local fixture scopes, each at most 2 worker attempts/turns and 1 owner session/8 owner turns including opening: at most 20 total model turns. Stop at two verified outcomes or the first unresolved authority/uncertainty/budget failure. Replacement is another counted session, never a free retry. Actual read-only inspectors are excluded unless independently qualified and budgeted.
7. Measure actual captain enqueue-to-accept/model-start distributions, source detection delay, sample counts, owner/worker/inspector/General usage, context, tokens and billing before expansion. No sample is zero wait. Synthetic 6-session/8-turn parity and zero unchanged-input turns establish no live latency or fleet-wide saving.

Remaining operational risks: loaded-version attestation, complete callback/queue/initiative census, valid current grants/caps, exact native stop for replacements, and compatible post-cutover forward reconciliation. The first release still excludes actual unqualified read-only providers, physical pooling, persistent grouped observers, remote/release offload (including Ariadne), automatic cleanup and strong takeover. Full-access is cooperative execution and cannot be described as read-only confinement. No installation, activation, live Attach/adoption, migration, provider/model trial, remote operation or release occurs during this qualification.
