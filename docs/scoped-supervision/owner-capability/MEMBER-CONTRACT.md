# Prepared member-normal contract

This is a distinct test-only normal contract, `required-workload-and-owned-set/1`,
native capture **4** / diagnostic **3**, with separate `firstmate.member-normal/1`,
`firstmate.member-normal-final/1` and `firstmate.member-normal-capture/1` envelopes.
The legacy exact-two contract and root-only gate remain unchanged. This packet
qualifies source and offline admission only; it authorizes no execution.

The workload is the original, unchanged `root.mjs` and `child.mjs`. The root and
expected child must both match their committed case, nonce, PID, parent,
instance, Node/main-thread identity and original results. The native entry reads
the three committed entry files with a 4 KiB bound, preserves their raw bytes,
and binds the child PID jointly recorded by root and child to an already held
live lifetime. The consumer independently checks those same bytes and binding
references. An arbitrary second member cannot fill the child role. Local
files, source pins and dispatch checks are behavioral guards, not authenticated
IPC or hostile-peer containment.

All actual job members, regardless of image, use the reviewed first-attempt
immutable held-lifetime machinery. The new partial unit reuses that machinery
from `WindowsRootGate.cs`; it does not invoke or relabel the root-gate entry.
Root and every additional member retain PID, creation time, initial image,
membership, handle/reference, required wait/exit results and actual disposal.
Terminal image observation is explicitly unattempted and refers to the held
initial binding. Every retained query failure remains a refusal, including a
failure followed by success with an inconsistent zero error counter.

Snapshot and cumulative membership must reconcile to all held lifetimes. The
required workload roles and the complete owned set have separate cardinalities.
An unobserved cumulative member, failed acquisition/query, replacement, loss,
overflow, pending final member or incomplete disposal refuses admission and
closure. There is no image allowlist and no launch-flag change.

Physical closure requires complete, empty terminal job accounting, signaled
held lifetimes, complete capture and actual resource disposal. Normal support
additionally requires correlated workload entries, release order, original
successful root/child results, complete output and no deadline or forced stop.
A missing workload result can refuse normal support while complete physical
closure remains independently established. `actualRuntimeQualified` and
`anotherCaseAuthorized` always remain false. A source/offline pass is not a
normal execution result or permission to reuse this case.

All caps are retained: detailed file 2 MiB, final frame 32 KiB, each stream
64 KiB, each committed entry/marker 4 KiB; eight members/eight terminal samples,
64 events/eight errors; native deadline 5 s, closure bound 8 s, outer deadline
15 s plus 3 s grace. Recording errors never replace the original fixture error
or interrupt independent cleanup. The compiled library remains unloaded.

The proposed future command, from this retained worktree, is exactly:

```powershell
& 'C:\Program Files\nodejs\node.exe' 'C:\Users\micha\.paseo\worktrees\23z5sbxl\fm-ss-s02\docs\scoped-supervision\owner-capability\member-normal-controller.mjs'
```

It accepts no arguments or alternate case. Independent source acceptance and
a separate named execution dispatch must precede any invocation. The inactive
`member-normal.dispatch.template.json` is review material only. The controller
requires its exact bytes at `.local/owner-member-normal/member-normal-1.dispatch.json`
before any directory/reservation/helper creation; that path and the case
directory remain absent during preparation. The helper repeats source and
identity checks before its exclusive native reservation and entry invocation.
All nine runtime pins, the three-source NUL-delimited native hash, controller
hash and image hashes are frozen in the command packet. Any mismatch,
non-absence, failed/lost/uncertain evidence or first result stops the case.
There is no retry/reset/second workload or guessed cleanup authority.

Historical C2, normal-1 and normal-2 failures and unknown closures remain
unchanged. The consumed root-gate case confirms only its own captured refusal
and closure. No result here supplies a missing historical identity or closure.
