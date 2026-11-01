# Supervisor foundation — stage 1

This stage keeps the existing owned runtime, journals, domain identities, cumulative budgets and native receivers. It adds shared native profile fields and configuration/detail controls. Only explicit app controls stage, pause, resume or replace an existing exact owner. Initial plan attachment remains the dedicated Attach action; no helper/CLI, live qualification or new scheduler is introduced. App provenance remains unverified.

The earlier test-only commit `27ffa47` freezes all A1–A12 conditions in `test/fmu-foundation/acceptance.json`, the existing-runtime source pin and runnable baseline commands. Its baseline is the already-direct scoped runtime, where project admission is separate from provisioning. The baseline receipt records 217 passing tests, typecheck and the existing light/dark 1440/390 fixtures. Four new foundation assertions were intentionally red before product changes. Original planning/review inputs were read without modification.

## Implementation boundaries

- New app setup captures concrete provider/model, actual permission mode, explicit reasoning when offered, catalog/policy digests, exact target, finite cumulative limits and immutable generation. Historical setup and records remain readable without inventing metadata. Project setup also checks the selected project's cwd at preview/confirmation; executing sessions and replacements check their intended/native cwd.
- Accepted command receipts are the configuration history. Bindings and effects refer to their applied generation; the existing store validates those references. Worker and supervisor reservations retain individual operation identities. A workspace, create and send remain three separate effects.
- Saving a proposal holds new paid admissions. The current claimed turn retains its old settings and attribution; reserved old effects stay accounted and held. There is no model setter or native protocol shortcut.
- Ordinary pause keeps its active binding and releases only through an exact pause receipt. It cannot clear a transfer, pending change, policy hold or uncertainty.
- Replacement uses the existing hold/reservation/verify/gateway path. It requires the exact stopped/closed predecessor, unchanged reviewed target/catalog/policy, accounted effects and sufficient existing cumulative allocation. The adapter supplies no stop operation; the native session link/identity directs explicit stopping. Existing 1-session caps still refuse a replacement until separately reviewed domain budget authority permits it. The original replacement review is retained even across a hold-before-reservation crash, so a fresh client resumes the same request. Unknown create/opening replies keep identity and spend; no new identity or blind send retry is offered.
- The native detail shows retained effects, workers, decisions, sources and unlanded work. Retirement cannot delete history or workspaces. No cleanup/retirement executor is added.
- The independent inspector profile schema and execution-only catalog refusal are foundation contracts. The existing inspection journal remains the spending authority. Saving/running that new inspector profile, exact watch assignments and typed inspection delivery belong to stage 2. A synthetic read-only catalog is not installed-provider qualification.

## Acceptance mapping

| Contract | Stage 1 evidence / retained boundary |
| --- | --- |
| A1 | Frozen lifecycle contract, concurrent proposals, inert native component tests and app read tests. Existing exact target/host/owner checks retained. Watch assignment races defer to stage 2. |
| A2 | Shared profile tests, initial app generation, save/reload/reference validation, stale review refusal, captured retry, native readback and mid-turn pending tests. |
| A3 | Stopped-predecessor, idle/offline/wrong-owner refusals, cumulative cap, own/unrelated uncertainty, crash-after-hold and lost-opening tests. Native stopping is explicit; no automatic takeover. |
| A4 | Inspector schema and execution-only refusal plus existing isolated-inspector suite. Actual independent profile delivery/adapter qualification is deferred. |
| A5 | Existing rules/effect/command gates plus generation checks and pause-before-worker-reservation regression. No merge/deploy/remote/discard authority is added. |
| A6–A8 | Frozen in full; typed watch waits, overlap, route handoff and associated new assertions are deferred to stage 2. Existing source/continuation/migration regressions remain applicable. |
| A9 | Existing production busy-General/two-chain, stalled-owner and one-per-turn chat queue regressions. These are preserved capabilities, not newly measured relief. |
| A10 | Same-input direct-runtime trace: identical necessary work with/without 100 stored status projections. Count distinct effects and total model turns; billing and live latency remain unknown. No watch-suppression claim. |
| A11 | Shared native components, captured target/stale/lost-reply tests; 1440/390 light/dark screenshots and automatic pinned Attach comparisons. Home/plan ownership-assignment integration is stage 2/3. This is browser/native-component qualification, not a device or installed-app test. |
| A12 | Existing replay/capacity/recovery/migration/journal-isolation suites plus immutable generation-reference checks. No truncation, reset, migration, installation or activation occurs. |

## Reproduce qualification

Use Node 24 and the locked dependencies. `npm ci` and `npm ci --prefix docs/board-list` install only development dependencies. The Windows machine's npm PowerShell shim had an incorrect relative path; invoking its installed `npm-cli.js` directly worked without changing machine configuration.

```powershell
npm run typecheck
npm test -- --maxWorkers=2 --testTimeout=60000 --reporter=default --reporter=json --outputFile=.local/fmu-foundation/full-tests.json
node docs/fmu-foundation/render.mjs
node docs/fmu-foundation/check-bundle.mjs
```

For the full suite, mirror `.github/workflows/check.yml`: enable `FIRSTMATE_RECEIPT_JOURNAL=1`, `FIRSTMATE_CI_DIAGNOSTICS=.local/ci-diagnostics`, `FIRSTMATE_PILOT_EVIDENCE=1` and pin `FIRSTMATE_PILOT_SOURCE_HEAD` to the checked source. Test setup confines all journal activity to temporary synthetic homes. The evidence flag runs no live pilot. Run every existing check/deck-review render and regression command as listed in that workflow, including the `PR175_CAPTURE=1` wiring test. The new foundation renderer is also part of CI.

Set `PASEO_COMPILER` to the inspected installed compiler path for the local bundle command. This command compiles both bundles through Paseo, parses the entire client AST to require zero class declarations/expressions, and runs Hermes. It installs or reloads nothing. The older `docs/shell-phase1/check-bundle.mjs` fails on the three maintenance object keys named `class` on both the pinned baseline and this stage; its failure and the baseline/current Hermes comparison are retained under `.local/fmu-foundation/`. The new check tests actual class syntax while preserving the native requirement.

All screenshots, comparisons, command logs, failures and runtime evidence stay in ignored `.local/fmu-foundation/` (existing harnesses retain their own ignored output directories). `report.md` there is the final head-bound builder receipt. No committed screenshot is a claim about a live workload. Required GitHub results must be checked on the final PR head before reporting green. FirstMate owns the separate independent Astra checkpoint and exact-head acceptance; stage 2 remains held until that acceptance and reviewed landing.

## Foundation checkpoint corrections

The original `f2b6aa55be77d97a4d8679c4b23fda8bd280c283` report, red runs, CI attempts and 32 captures remain historical evidence. The independent checkpoint requested F1?F4 corrections; it did not accept that head.

Replacement now carries the reviewed subject through the predecessor hold, final owned reservation and each not-yet-admitted opening effect. Stale work remains under its original request, identities and spent caps; settled/uncertain effects keep their existing reconciliation behavior. Catalog capture binds the deterministic next supervisor workspace, with exact directory validation before agent creation. Initial plan, project and maintenance profile capture uses that same intended context.

An exact pending proposal can be withdrawn through the app using its control ID, configuration digest and current displayed target. A subsequent review creates another immutable generation. Withdrawal releases only that proposal (including its own unreserved transfer hold), never an ordinary pause or other operation hold. Resume still releases only its exact ordinary pause.

Reserved predecessor work blocks replacement. The app exposes the saved payload preview and a separate exact ID/version-bound **Withdraw undelivered input** action for never-dispatched owner sends. Its cancellation receipt retains the input blob, identity, cause and spent turn and records non-delivery. It never resends that input to another owner. Worker reservations require their existing checked stop/release disposition; claimed or uncertain effects cannot use this action.

`server/supervisor-corrections.test.ts` derives the reviewer's R1?R5 reproductions and adds restart, post-reservation decision races, concurrent/stale proposal withdrawal, worker separation and cwd-dependent positive/refusal cases. Original reviewer probes remain untouched. The renderer adds stale-proposal and undelivered-input states, producing 40 captures in both themes at 1440/390 plus the four retained Attach comparisons. Set `FMU_EVIDENCE_DIR` to retain correction captures/native receipts separately from the original evidence. This remains source/synthetic qualification; stage 2 requires independent exact-head acceptance and reviewed landing.
