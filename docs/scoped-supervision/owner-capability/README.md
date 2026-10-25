# Unqualified Windows owner capability fixture

This is test-only preparation and retained failed qualification. **No reusable owner is qualified.**
It has no product import, integration or runtime-support switch. Vitest, PowerShell and Chromium
remain unsupported. The reviewed observer/witness is unchanged.

The local capability assignment allowed one normal and one blocked Node root-plus-descendant case.
The normal attempt at source base `fb077f20` failed with `Unexpected live owned set` before any
fixture entry was retained. It correctly refused reuse. The blocked attempt did not run because
the normal prerequisite failed. Do not rerun either target without a new explicit diagnostic budget.
Exact source, initial compiler failure, successful no-target preflights, native/outer receipts and
limits are in `.local/owner-capability/handoff.md` and its sealed manifest.

The candidate uses inbox PowerShell 5.1 `Add-Type` for documented `kernel32` P/Invoke. It creates
an unnamed kill-on-close job without breakaway, configures `PROC_THREAD_ATTRIBUTE_JOB_LIST`, and
creates the fixed root with `STARTUPINFOEX` and `CREATE_SUSPENDED`. It checks membership using the
actual process handle before resuming. The normal/blocked fixtures are fixed local Node scripts;
their only descendant is the fixed child script, and they make no network/product calls.

The intended success gate requires retained handles/creation identities for both members, a
complete live member set, an independent parent timer, zero final active members and signaled
process handles, followed by owner disposal and helper close. A direct process exit, successful
termination request, missing notification or closed job handle alone cannot satisfy that gate.

`admission.controls.mjs` is a tiny in-memory control suite; it launches no owner or target.
`run.mjs` is an explicit one-shot capability command, with persistent per-case directories and
exact-source preflight/normal prerequisites. It is not a generic diagnostic runner or authorization
mechanism. The normal failure lacks the observed failing member list, target stderr and process
exit state; those must be prepared and independently reviewed before any separately authorized
target retry. Parent timer/supervisor observations are not hard-real-time or kernel-liveness proof.

The C1/C3 follow-up is **static preparation only**. `run.mjs`, `invoke.ps1` and the native entry
points carry an explicit review hold with no override. Native changes have not been compiled,
preflighted or executed. Tiny controls exercise only `capture.mjs`/admission with in-memory
facts and retained JSON; they do not execute or qualify the C# implementation.

Future capture retains the last complete and exact offending membership, validated partial/query
failures, available handle identity/wait/exit observations and separate acquisition/disposal states.
Recording overflow/errors cannot throw through cleanup. Termination and up to eight terminal
snapshots precede disposal on both paths; unbound descendants remain unknown. Original errors
remain separate. Missing closure emits explicit false/unknown/reasons.

Prepared root streams use anonymous pipes, noninherited parent reads/job handle, an exact inherited
standard-handle list, `STARTF_USESTDHANDLES` and `bInheritHandles=true` before creation. Readers retain
at most 65,536 bytes per stream, continue draining/counting loss, and report EOF/read/close state.
They do not close under pending `ReadFile`. Child stdout/stderr use separate Node pipes and bounded
capture. A blocked root may never report child drain; that absence refuses reuse and cannot be
filled from root output. This limitation is not a qualified external descendant stream owner.

Future capture cannot resolve the previous unnamed, disposed job's missing terminal evidence.
**All fresh targets remain held until prior C2 uncertainty is explicitly resolved, the preparation
is independently accepted and a fresh bounded assignment is recorded.** A new budget alone is
insufficient. No root lookup, guessed PID, process-name cleanup or inferred descendant identity
can replace that missing evidence.
