# Unpublished diagnostic adapter wiring

Source base: `d3b099587759d132761edd10ea8ca377fd608b2a`. Attempt: `7fee0e91-e32c-4d6b-8b9c-96c31ce8ef9d`, `fm-supervision-architecture/fm-ss-observer-wiring`.

This is test-only wiring for independent review. Nothing is added to product, default tests, render entrypoints or CI. All existing source, accepted loss correction, original callbacks/assertions/timeouts and retained evidence are unchanged. No real failing qualification runs here. A successful synthetic control is not admission of a real runtime or historical-cause evidence.

## Correlation and final status

`createCase` binds a parent slot, frozen source head, source/body/observer hashes, actual PID/thread/Node version plus worker-instance UUID, session IDs and owned home. It emits entry at the callback boundary, heartbeat, original fulfilled/rejected outcome, observer status, resource lifecycle and final post-disposal status. `run` returns the original value/promise/error. Finalization never waits for unsettled work and never equates a complete capture with drained work.

The external channel is a separate per-slot append-only framed file, not the trace sink or Vitest's IPC. Each channel is capped at 256 frames of 16 KiB. Parent reading preserves partial JSON/UTF-8, rejects malformed correlation/sequence/final status, bounds retained events/problems and keeps missing capture inadmissible. Child monotonic observation and parent monotonic receipt times are separate fields; no clock conversion or nominal kernel-stall time is inferred. Local file identity/UUID/PID checks qualify typed fixture sources; they are not authentication, independent trust or fencing.

The detailed sink remains the accepted bounded session recorder. Its returned failure status, restoration conflicts and pending/loss counters are forwarded after disposal through the independent channel. If that channel also fails, parent missing/gap/final checks block admission. A failed final send is visible in the returned in-memory status; it cannot report itself through a broken channel. Channels and synchronous recording can still perturb or block the observer thread. The parent witness has its own process clock but is not a hard-real-time/kernel liveness guarantee.

`captureAdmissible`, original `outcome`, `workDrained`, direct child closure, known resource closure, runtime support and `safeForReuse` are distinct. A rejected original callback can have a valid observation without passing its test. A direct closed process with pending work/missing final/failed capture remains inadmissible. Receipts are detached values; late events cannot rewrite them. This staging always retains fixtures, even after a positive synthetic run.

## Ownership support

| Path | Current support |
| --- | --- |
| Fixed synthetic Node child with this source and no runtime descendants | Direct child handle and independent close/deadline/kill evidence exercised. Never a general process-tree claim. |
| Real Vitest forks | **Unsupported.** Public cancellation/close APIs do not establish independent closure of every worker/descendant after forced termination here. No private `_fork` access. |
| Existing PowerShell identity exec | Actual existing promise/child can be registered once and its lifecycle observed. **Descendant ownership/closure unsupported.** |
| Chromium | Page/context close and browser disconnection can be observed. **Process-tree closure after a stuck protocol unsupported.** Capture deadline is not cancellation. |

`requireRuntime` blocks the three real paths before creating their resources. Selected case entry, dedicated setup/config and startup bootstrap also guard them. No environment switch, permissions change, installed service or speculative process-tree kill bypasses this refusal. Support would need a separately reviewed source change and actual supported ownership evidence; direct child close or browser disconnection is insufficient.

Public API/source references inspected: [Vitest Node lifecycle](https://github.com/vitest-dev/vitest/blob/v5.0.3/docs/guide/advanced/tests.md), [cancellation](https://github.com/vitest-dev/vitest/blob/v5.0.3/docs/api/advanced/vitest.md), [per-file setup](https://github.com/vitest-dev/vitest/blob/v5.0.3/docs/config/setupfiles.md), [worker limit](https://github.com/vitest-dev/vitest/blob/v5.0.3/docs/config/maxworkers.md), [Rolldown JavaScript API](https://github.com/rolldown/rolldown/blob/main/docs/guide/getting-started.md). Installed Vitest 5.0.3 declarations confirm the public worker APIs and optional test-path state; they do not supply missing descendant guarantees.

## Executable selected seams

`prepareSelected` reads frozen original blobs, verifies the current callback files, and writes a fresh private preparation directory. No old preparation directory is overwritten.

Frozen Git source hashes use LF canonical text; raw checkout byte pins remain separate and exact. Original-module transforms compare canonical text to allow declared CRLF checkout conversion, then preserve the input bytes outside the explicit seam. Other content changes still refuse the transform. No existing file is rewritten to change its line endings.

- Mailbox: exactly two generated files contain byte-identical original triage/inbox callback bodies. The dedicated config includes only these files, the existing two-worker envelope, isolation and unchanged default 5,000 ms. A selected per-file setup binds its own temporary root, then imports the **real** `test/setup.ts`. A hash-checked transform at that module's original ID changes only its cleanup hook to retain the home; original isolated home creation and observation-off flags remain. This intentional cleanup guard prevents deletion racing unfinished work; it never deletes automatically. The callback shell sends the actual entry/result protocol and finalizes after disposal without waiting for a nonsettling callback.
- Identity: the child-only Rolldown plugin accepts only the exact original process and child module IDs/hashes. It shares one capsule-keyed bridge, wraps the existing promisified exec once, registers that actual `.child`, and wraps the original main entry. Original PID/start parser, refusal, stderr/result, 5,000 ms/4,096-byte subprocess settings and crash handshake/assertions remain untouched. A generated build script compiles the original child only when deliberately invoked; no build artifact is executed here. The plugin itself was exercised on a tiny synthetic source through the installed Rolldown API. It is not installed into the ordinary crash test. A deliberate SIGKILL can leave final capture missing; that remains explicit missing evidence and never substitutes for the original crash guard.
- Startup: a generated selected harness retains the original bootstrap/pageAt and invokes only the original startup helper through `startupCore`. The guard precedes bootstrap resource creation. Fresh delayed/settled capsules, sessions, homes, pages and contexts retain trace/status before original close, observe page/context closure, preserve the 1,500 ms held press, default 10,000 ms and original assertions. Result capture follows the original iteration, including its finally; a failed context close or incomplete previous observation blocks creating another case. Browser disconnection remains connection-only evidence. The original helper is imported unchanged, not rewritten. Native browser closure and the full runtime remain unsupported; only fake-page/DOM wiring controls ran.

Generated code is syntax-checked and source-bound, not claimed to be typechecked or qualified runtime integration. Original source acceptance and four unresolved historical failures retain their prior limits.

## Minimal runnable proposal, after independent review

From this worktree, using the installed Node executable:

```powershell
node docs/scoped-supervision/observer-wiring/cli.mjs support
node docs/scoped-supervision/observer-wiring/cli.mjs prepare
node docs/scoped-supervision/observer-wiring/cli.mjs preflight vitest-forks
node docs/scoped-supervision/observer-wiring/cli.mjs preflight powershell-exec
node docs/scoped-supervision/observer-wiring/cli.mjs preflight chromium
```

`prepare` emits a selected Vitest config/setup, two original callback files/capsules, child-only identity build/capsule, and startup-only entry/two capsules. It runs no original callback, subprocess probe or browser. All three preflights currently exit **2 / UNSUPPORTED_OWNERSHIP**, retaining a concrete receipt and fixture. There is deliberately no real-run CLI command. Do not run the generated diagnostic entries as qualification or edit the gate to force a run.

The next real diagnostic is blocked on independently accepted ownership/closure support and a separately dispatched budget. Once that prerequisite is satisfied, the prepared material provides the exact two-file/5,000 ms/two-worker mailbox selection, existing child transform and original startup-only harness. Preserve the original four failures and use any new captured phase to select a smallest counterfactual; no timeout inflation, second identity probe, broad suite or unchanged CI retry follows from this delivery.

Synthetic verification only: `node --test --test-reporter=tap docs/scoped-supervision/observer-wiring/wiring.controls.mjs`. Exact run/source/environment receipts and preservation seal are in `.local/observer-wiring/handoff.md`. No installation, reload, activation, push or CI is part of this staging.
