# S02 corrections for independent R02 re-review

This delivery corrects R02-1, R02-2 and R02-3 from the independent review of
`e8e4646604b040693e4a80587653b7bfdeff4057`. It requires a new independent review; it does not
represent acceptance, integration or activation. The original [S02 report](S02.md) and
[validation receipt](s02-validation.json) remain unchanged historical evidence. The current
source, inputs and test evidence are bound by [the correction receipt](s02-r02-validation.json).

## Corrections

**R02-1:** Scope event pages sort by durable mailbox ordinal before filtering or returning the
ordinal cursor. Resolving older triage can leave insertion order `[36, 1, 2, ...]`; it now traverses
`[1, 2, ..., 36]`. Global primary-position paging and source/offer offset paging keep their existing
contracts. The regression traverses all supported page sizes, 1 through 32, over 36 facts, including
the 24 KiB response bound, without missing or repeating a fact.

**R02-2:** Changed content under the same source key is retained as `quarantined`/`malformed`,
including when its typed worker/turn/outcome shares an existing consequence. It links to that
primary, retains its own immutable event/blob provenance, and receives no second mailbox ordinal,
offer or result. Ordinary cross-source duplicates still supersede under the one primary consequence.
An existing handled result and its contiguous watermark remain retained.

Both ingress and gap recording preserve `malformed` while that source has retained malformed
quarantine, including after repeats of either observation, healthy later turns and a boot epoch
change. Public counts and pending age include unresolved secondary evidence; scoped counts follow
the primary's resolved owner when necessary. The existing bounded `problems` field names quarantine
event/consequence IDs, and the source page retains the malformed gap. Unrelated subjects continue.
The event page still pages primary consequences, with no RPC shape or mailbox-order migration.

Malformed quarantine remains held. S02's existing `resolve` handles well-formed unknown-owner
primaries only; it cannot discharge a conflict. No automatic clearing or new reconciliation authority
is added. A future explicit conflict reconciliation would require a separately qualified checked
transition. The current reducer rejects changing a quarantined observation into a superseded
duplicate. This correction does not rewrite previously published dispositions from the old head.

**R02-3:** Immediately after typed refetch, the adapter compares `page.agentId` with the requested
ID before reading the page's epoch, entries or cursors. A mismatch (including an absent ID) records
only a malformed gap against the requested source's checked prior version and returns `null`.
It admits no event/blob evidence, assignment or mailbox fact, and preserves any existing baseline.
A stale mismatch cannot overwrite a concurrently qualified source. A subsequent valid matching
page can establish bounded coverage. This qualifies malformed typed responses; it provides no
authentication, peer containment or installed-daemon defect claim.

## Evidence and verification

The [original independent probe source](../../test/fixtures/supervision-r02/r02-review.test.ts.txt)
is retained byte-for-byte. The runnable [regressions](../../test/supervision-r02.test.ts) adapt only
its output destination to ignored `.local/s02-r02/probes/`, import Node's URL explicitly, and add
boundary assertions. The original four probes first reproduced **three failures and one passing
partial-reoffer control** before product edits. Their [JSON receipt](s02-r02-evidence/red.json)
and [failure log](s02-r02-evidence/red.log) remain committed. The copied harness's initial Node URL
type error is also [preserved](s02-r02-evidence/typecheck-initial-failure.log); importing Node's URL
fixes it. Logs are transcribed from PowerShell UTF-16 to UTF-8 with trailing whitespace removed for readable Git storage; raw bytes
and the full reproduction readbacks remain retained under `.local/s02-r02/` with receipt hashes.

Fresh checks use Node 24.18.0, existing dependencies and isolated temporary homes from `test/setup.ts`.
The correction suite contains 13 checks: the four original probes/control, every supported page
size, assigned/handled-primary conflict persistence, four invalid returned identities, checked
baseline recovery with independent scope progress, and a concurrent-source control. The affected
run passes **137 tests in nine files**. Typecheck and the CJS server bundle/import probe pass; the
latter never invokes the contribution and leaves its scratch home unchanged. The full suite passes
**2,507 tests with three skipped, in 169 files**, with `FIRSTMATE_RECEIPT_JOURNAL=1` at invocation
to exercise the existing temporary-home override.

Self-review covers the complete S02 diff against S01 plus this correction: publication/replay
invariants, consequence/provenance separation, ordering, identity qualification, result/watermark
retention, bounded projections, default-off wiring and the regression controls. No schemas, RPC
shape, workflow reducers, grants, legacy receipt/watch/timer code or installed plugin are changed
by the correction. This remains local observe-only groundwork for A02/A06/A08/A09 and A17.preserve,
with the original deferred runtime/UI/effect/pilot boundaries. No provider/model calls, delegation,
installation/reload, live routing/activation, history migration, merge or deployment occurred.
