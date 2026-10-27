# S06 bounded A08 diagnosis

This is the initial `f94c338c` diagnosis. R06/R06O subsequently required the checkpoint index
described in [pilot-runbook.md](pilot-runbook.md#checkpoint-bounds-audits-and-recovery). Warm
reads now trust a validated prefix, with full audits on startup/recovery and explicit audit.
Statements below about checking all historical bytes on every read describe the initial delivery.

The A08 timeout was a product scan-cost defect, not a virtual-clock wait, owner/General deadlock
or slow fsync. `SupervisionStore.scan` deduplicated retained ownership with a nested `some` that
recomputed both capsule digests for every candidate comparison. Every gateway/mailbox read scans
the journal, amplifying the quadratic comparison loop as history grows.

The authorized diagnostic ran the actual A08 fixture under a **30-second outer process limit**,
with a 25-second CPU profile. Prototype wrappers timed store scans/reads/commits, reducer replay,
gateway operations and mailbox operations. Existing written/synced boundaries measured fsync
intervals. Timing used `performance.now`; the fixture's virtual Date could not stall this limit.
The runner killed only its own subprocess tree. No model, daemon or live resource was involved.

At the pre-fix 24.018-second observation: 132 scans had replayed 3,417 transactions. Reducer replay
took 909 ms in aggregate, referenced-blob checks 293 ms, journal tip/event/publication fsync
intervals 137 ms, and all recorded fsync intervals about 160 ms. Scan durations overlap between
owners and must not be summed as wall time. In the CPU profile, scan stacks accounted for
15.844 seconds; the retained-ownership comparator accounted for 10.884 seconds within those
stacks. The same bounded post-fix trace reached sequence 65 by 29.003 seconds; its CPU profile
no longer contained that comparator. These diagnostic samples locate the cost, not provider
latency or throughput targets.

The fix computes each checked ownership capsule's digest once and deduplicates with a set local
to that scan. It preserves capsule order and content. Every read still rereads and validates every
anchor's canonical bytes, schema, checksum and identity; transaction chains, publication markers,
projection checks, evidence blobs, coordinator checks and write/fsync boundaries are unchanged.
There is no persistent cache, skipped validation, journal migration or new storage format.

The regression in `server/supervision-store.test.ts` cold-reads twelve different ownership
capsules and counts ownership digests rather than asserting a noisy time threshold. The old
comparison loop performs **312** hashes and fails; the fixed loop performs **48** (four per
transaction, including both retained anchors and the existing projection/tip comparison).
Every historical capsule remains present. After a successful read, corrupting a publication
still makes that same reader held, proving that the optimization did not hide subsequent damage.

The full suite also exposed a transient missing-brief projection and fixture config leakage.
The legacy baseline now clears its synthetic General identity in `finally`, so a later fixture
can select another home without bypassing the existing home-move refusal.

A separate deterministic regression reproduced a scan race: the reader enumerates an inert
publication/blob `.tmp`, then the publisher unlinks it before the reader's size check. Previously
that `ENOENT` held the scan before any plans were projected. Both temporary-file regressions fail
on the original size accounting. The correction treats **only an already-validated `.tmp` name's
`ENOENT`** as zero staging bytes. A disappeared durable event still holds, as do other IO errors;
no authority record, checksum or publication check is skipped, and no request is retried. This is
a demonstrated source of transient empty projections; the earlier brief failure did not retain
its underlying scan error, so its attribution to that race remains an inference.

Reproduce with `npx vitest run server/supervision-store.test.ts -t "hashes retained capsules linearly"`.
For a red control, restore only the old `result.ownership.some(saved => digest(saved) ===
digest(anchor.ownership))` comparison; restore the delivered fix before any other verification.
The original 60-second and 180-second failures and diagnostic source/logs remain in ignored
`.local/s06/`. Neither timeout was raised again. Final qualification receipts are identified in
the S06 verification manifest and exact-head CI artifacts; the earlier partial exports are not
acceptance evidence.
