# Idle recovery CPU

The 2026-11-07 live profile on installed `dfc12c24` captured 45 seconds and 29,910
samples. Weighted time was 91.8% in `scanFull`, 87.9% in its `apply`, 35.1% in
`validateIndexes`, and 30.4% in `validateInbox`; idle was 0.6%. These inclusive
percentages overlap. The raw profile and stack summary remain in this task's
local evidence folder; no live records were copied into the reproduction.

`startWorkflowService` runs a guarded scoped lane every second. `PlanRuntime.tick`
runs lifecycle recovery at startup and every 60 seconds after the preceding pass
finishes. `SupervisionLifecycle.recover` called `store.audit()` unconditionally:
`audit -> checkedFullScan -> scanFull`. This bypassed PR217's warm fingerprint
path altogether. Restart wakes audited again per scope, and effect reconciliation
audited again per effect.

The recovery sweep also changed the supposedly idle journal: `boot` rewrote the
same hook gaps; catalog sweeps journaled identical observations and fetched every
stopped worker's timeline again. Failed/closed workers could repeatedly reopen
provider helpers. Board report failures were cached for only one `updatedAt`, so
timestamp churn bypassed even their fixed 30-second cooldown.
`wake` also rewrote a binding's observation timestamp every minute even when
the owner remained closed, invalidating an otherwise unchanged fingerprint.

## Policy

- A heartbeat uses PR217's fingerprint only after a clean full audit. A changed,
  missing or unreadable fingerprint, a held journal, or one hour since the last
  clean audit forces a full audit. Restart and explicit audits remain full.
- Each recovery pass shares one audit across concurrent scope wakes and effect
  reconciliation. A receiver lookup for live workers or a recovery send forces
  that audit before proceeding, even if the idle fingerprint gate initially
  skipped it. The pass lease expires when its callback returns, including errors;
  detached observations cannot keep borrowing it.
- The stat fingerprint intentionally does not cover old prefix bytes. An in-place
  historical edit invisible to it is caught by the hourly/explicit full audit;
  an actual recovery action still forces a full audit first. Tests pin this limit.
- Boot gaps are recorded once per ingress instance and registered worker. Repeated
  identical missing-agent gaps and unchanged catalog observations do not append
  records. Changed status, permissions or attention still enter the normal path.
  Binding observations persist state transitions; timestamp-only refreshes do not
  change the journal. Stored observations still age to unknown after 60 seconds
  under the existing projection rule. A quiet owner with no owed work is not
  looked up merely to refresh display metadata.
- Catalog timeline requests coalesce while pending, cache unchanged successful
  observations, and retry negative results after 30, 60, 120, 240, then 300 seconds.
  Board reports use the same bounded retry intervals across timestamp changes.
  A closed worker gets at most one timeline attempt until observed reopened.
  Retained reports and source gaps stay explicitly uncertain; no failure proves
  absence, completion, or permission to resend. Valid partial timeline pages
  remain eligible for the next sweep.

## Temporary-home measurement

`reproduce.test.ts` seeds 100 scope transactions and two registered stand-in
workers, then runs the same recovery audit/boot/catalog path for 30 seconds.
The minute lane is deliberately accelerated to one beat per second on both
revisions. Initialization and two warm-up beats are excluded. Native timeline
responses are synthetic; there is no daemon, provider or live-home access.

| Measured revision | Wall seconds | Process CPU seconds | Average cores | Beats | Full scans | Timeline calls | Journal appends |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Main `dfc12c24` | 30.150 | 10.578 | 0.351 | 23 | 23 | 23 | 92 |
| Fix | 30.190 | 0.359 | 0.012 | 30 | 0 | 0 | 0 |

This is a 96.6% reduction in measured process CPU in the bounded reproduction,
with more beats completed. It is not an after-install production measurement;
the production journal is much larger and the installed plugin was not changed.
Raw counters are in `before.json` and `after.json`.

To reproduce from this worktree in PowerShell (the test setup creates and removes
its own temporary home):

```powershell
$env:FIRSTMATE_IDLE_CPU_EVIDENCE = Join-Path (Get-Location) '.local/idle-cpu.json'
node node_modules/vitest/vitest.mjs run docs/idle-cpu/reproduce.test.ts --maxWorkers=1
```

Without that environment variable the measurement is skipped, including in CI.
The fixture's optional-method fallback also runs unchanged on the main revision.

## Verification and operational limit

Nine new regression cases failed on main, including timestamp churn making 11
native report reads instead of one and repeated catalog sweeps making four reads
instead of one. The targeted store, ingress, lifecycle, continuation, gateway,
plan-runtime, runtime-wrapper and fleet suite passed 186 tests with at most two workers.
After the final timestamp-only observation fix, 83 lifecycle, ingress,
continuation and session-status tests passed; TypeScript also passed.

The live profiling cleanup accidentally scheduled CommonJS `require` in an ESM
process. Its uncaught error terminated the host at 09:06:17Z; the first mate
reloaded it and prohibited further live attachment. The saved profile is usable,
but the overlapping process-CPU sample is invalid and is not used above. All
subsequent measurements use temporary fixtures. No inspector code is shipped.
