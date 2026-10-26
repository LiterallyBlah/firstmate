# S02 bounded unknown-owner triage qualification

**No code defect is established by this investigation. No product, original test,
assertion, timeout or CI policy is changed.** The retained Windows failure does
not identify the stalled operation. Two bounded local experiments validate phase
attribution and preserve the original semantics; they do not retrospectively
diagnose or waive that failed qualification.

The frozen input is `5f236856dea1844c23c871d0a7af850fb506133e`, following the
independent R02 render **ACCEPT**. That acceptance and its disclosed product
startup-gesture limitation remain unchanged. This work is the separate
`fm-supervision-architecture/fm-ss-s02-triage` attempt
`956fcddf-e282-43cd-b93e-d7953f7c877a`.

## Historical evidence

[Push run 40147581692](https://github.com/LiterallyBlah/firstmate/actions/runs/40147581692),
Windows job `121032128589`, records **2,549 passes, one failure and four skips**.
`server/supervision-events.test.ts:101` exceeded its existing **5,000 ms** test
limit; the assertion result duration is **5,033.1591 ms**. The recorded exception
is a test timeout, without a phase, native-call stack or operation-completion
marker. The job failed before executing the render harness. Its Ubuntu sibling
is cancelled even though saved test/render result artifacts contain passing
results. That cancelled job is not reported as green.

The complete [raw failed-job log](s02-triage-evidence/historical-ci-failure.log),
[source-bound CI inventory](s02-triage-evidence/historical-ci-inventory.json) and
[same-source controls](s02-triage-evidence/historical-ci-controls.json) are retained.
The later Windows PR case passed in 407.3737 ms, and the two Ubuntu cases passed
in 200.7006 / 182.1418 ms. Those are observations of the same source, not evidence
of a contention, filesystem, scheduler or flakiness cause. Green PR run
`40147584594` does not replace the failed push.

## Exact path and instrumentation

The original case creates and seeds a fresh journal; admits a previously unknown
worker observation through hook and catalog sources; requires `UNKNOWN_OWNER`
before registry recovery; commits an exact new worker/attempt association;
resolves the retained primary; and prepares a single offer. Its five original
expectations require exact owner/attempt assignment, superseded duplicate
provenance, one pending consequence, zero remaining triage and one prepared offer.

The probe generator extracts the callback literally from the frozen Git source.
The [source receipt](s02-triage-evidence/probe-source.json) binds the whole original
test file and exact callback. Callback SHA-256 is
`c20c1cff852619e52197e6c9df656fa6154c3bad7c85aeb2a413c6b29732e71c`.
The [executed adapter](s02-triage-evidence/executed-probe.test.ts.txt) contains that
unchanged callback and all five unchanged expectation lines.

Only this explicitly selected diagnostic file runs. Its config reuses the real
`test/setup.ts`, fresh temporary `PASEO_HOME`, and unchanged default 5,000 ms limit.
One worker bounds the isolated experiment; this does not reproduce the full CI
two-worker environment. No provider, daemon or live resource is accessed. The
existing fixture's explicit process-identity stand-in remains in use.

[The tracer](s02-triage-evidence/trace.mjs) observes the actual store/event/inbox
methods and delegates filesystem calls to their original Node implementations.
File handles retain native receivers and actual write/sync/close behavior. It
records nested method and filesystem spans, bounded relative fixture paths and
errors, without journal payloads. It caps a run at 8,000 spans. Internal method
wrapping is a diagnostic adapter, not a new runtime extension contract. Vitest's
actual timeout signal captures a deadline snapshot; its finish hook drains the
case before the existing temporary-home cleanup.

## Two bounded experiments

| Experiment | Result |
| --- | --- |
| Exact callback, actual filesystem delegation, no injected gate | One pass; 283.8505 ms case span / 284.265 ms final snapshot; all five original expectations pass |
| Same callback/config/tracer; hold only the second resolution's event-sync boundary | Expected exit 1 with the unchanged 5,000 ms timeout; deadline snapshot at 5,012.8136 ms identifies the injected boundary |

The [native trace](s02-triage-evidence/native-trace.json) contains 800 spans and no
unfinished work. It observed 16 journal scans, six committed transactions, two
admissions, two resolution calls and one offer preparation. Scans account for
203.7815 ms of inclusive time in this observation; the slowest observed native
filesystem span is about 2.33 ms. [Grouped timings](s02-triage-evidence/native-summary.json)
are nested and must not be added together. One locally passing trace supplies no
statistical performance bound, CI reproduction or reason to call a timeout safe.

The smallest counterfactual changes only `S02_TRIAGE_MODE` from `native` to
`hold-resolution-sync`. The synthetic gate is **before** the actual native sync
invocation, at transaction five's event publication during `events.resolve#2`.
It is not an observed operating-system sync stall. The real Vitest deadline
records this pending chain:

```
exact-source-case
  events.resolve#2
    store.transact#5
      store.commit#5
        store.publish(event)
          fs.sync  [controlled gate before native invocation]
```

The [deadline receipt](s02-triage-evidence/held-deadline.json) retains the pending
chain; the [finished receipt](s02-triage-evidence/held-finished.json) has no pending
spans after abort and native handle cleanup. The
[raw negative result](s02-triage-evidence/held-tests.json) and
[log](s02-triage-evidence/held.log) remain failures. No later assertions are
invented as executed or passed. The
[native result](s02-triage-evidence/native-tests.json) and
[log](s02-triage-evidence/native.log) provide the positive semantic control.

This shows that the observer can distinguish a concrete stalled boundary from
an aggregate timeout. It does **not** show that the historical failure stalled
there. No local full suite, repeated unchanged test loop or manual CI retry was
used to search for a passing result. A generator bootstrap/config-loading error
occurred before the first test and is [retained](s02-triage-evidence/probe-setup-failure.log);
the corrected generator uses literal source boundaries instead of the unavailable
legacy TypeScript compiler API. Fresh typecheck passed.

## Concrete qualification recommendation

Keep the original 5,000 ms limit, source semantics and assertions. The remaining
gate needs operation attribution in the actual Windows qualification environment,
not another unobserved retry of `40147581692`.

1. Prepare a separately reviewed **test-only diagnostic change** around this one
   original case, resetting its observer state at case entry. Reuse the proven
   deadline/finish snapshots and original Node delegations. Keep synthetic gates
   confined to the explicit local negative control; the qualifying mode must be
   `native` and must not alter journal data or publication ordering.
2. Retain the real Windows Node/runner identity and existing two-worker suite
   budget. Capture active operation, ancestor chain, completed spans, exact
   source/body hashes and test outcome at timeout; upload those receipts even
   when the case fails or its sibling job is cancelled. This is a concrete new
   source/observability qualification, not an unchanged CI rerun.
3. If that run times out, use its recorded native/read/validation/publication
   boundary to choose the smallest targeted counterfactual. Correct only a
   demonstrated defect, with the five original triage assertions plus a negative
   and positive control. Do not broaden this into journal redesign, a blanket
   timeout increase or an unsupported environmental explanation. Stop after the
   same obstacle twice rather than loop qualification.

The committed diagnostic is reproducible from the repository root with existing
dependencies and the frozen Git object available:

```
node docs/scoped-supervision/s02-triage-evidence/prepare-probe.mjs
```

Then set `S02_TRIAGE_MODE=native` (positive) or `hold-resolution-sync` (expected
timeout), and run:

```
node node_modules/vitest/vitest.mjs run --config .local/s02-triage/vitest.config.mjs
```

This explicitly selected local probe is not installed into the default suite or
CI workflow. The [executed generator](s02-triage-evidence/executed-generator.mjs)
and [portable generator](s02-triage-evidence/prepare-probe.mjs) differ only by
output-directory creation and copying the identical tracer beside the generated
test. Generated source hashes were checked equal without another test run.

## Delivery and preservation

[The source-bound qualification receipt](s02-triage-qualification.json) binds the
accepted input, review, unchanged source inventory, all prior handoff artifacts,
new source and raw positive/negative receipts. New files are documentation and
diagnostic evidence only. No original runtime, fixture, assertion, timeout,
configuration or lockfile changes. The previously accepted render correction and
disclosed startup-gesture limitation remain intact.

Any automatic CI caused by publishing this evidence is recorded separately at
the exact delivery head. A later pass cannot identify the historical stalled
operation or erase its failure receipt. This report completes the bounded
diagnosis; it does not waive the outstanding qualification or authorize landing,
installation, reload, activation, routing/watch changes or a broader UX correction.
