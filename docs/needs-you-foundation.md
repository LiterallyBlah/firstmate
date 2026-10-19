# Needs-you server foundation

This foundation implements the reconciled 19 October attention model. The shared
indicator and decision drawer are documented in [needs-you/README.md](needs-you/README.md).
Native attention and the opt-in timing observer remain independent. There is no
phone transport.

Observation defaults on with the indicator slice; `FIRSTMATE_NEEDS_YOU=0` in the
plugin server's environment disables it. Tests explicitly disable the production
timer and use isolated services. With observation off, the
fleet field reports `disabled`, counts are unknown (`null`), and no decision
ledger is created. Disablement preserves an existing ledger. Re-enabling it
reconciles current records without re-baselining existing decisions.
The decision service reads the configured home strictly: missing or malformed
configuration reports unavailable/stale state instead of selecting the board's
fallback default home.

## Source rule and observation quality

An In flight or Queued item with a nonempty hold and no blocker is open,
regardless of kind, worker, worker permissions, runtime state, reports or
suggestions. A hold with `blocked-by`, or a captain-kind item without a hold,
is parked. Done is excluded. Conditional prose is not interpreted. The proposed
`attention` metadata from one earlier design is not an additional exclusion in
the reconciled rule. Native mate requests remain on their existing direct path;
they are not synthesized into backlog gates here.

The board keeps its existing lenient parser. The detector requires all three
recognized sections and unique host/project/task identities. Missing, unknown or
repeated sections, duplicate identities, comments/NUL and read failures reject
the entire observation. Malformed rows/metadata, contradictory completion markers,
embedded carriage returns and unknown/ambiguous hosts instead quarantine that row.
Other rows still reconcile after stable reads. Diagnostics in `freshness.problems`
identify physical line numbers and task ids; no source is repaired automatically.

Quarantined rows retain existing gates exactly, with actions disabled for those
gates. If an identity cannot be fully read, matching by task id conservatively
protects all its scopes; an unreadable id protects all missing gates. A suspected
hold contributes one read-only attention entry unless an actionable retained gate
already represents it. These rows persist in the ledger, including across restart
or file failure. Removing a quarantined hold, or losing its hold text in another
unreadable edit, cannot clear it. A readable task must supply the outcome.
Snapshots can therefore be fresh with problems: the freshness applies to readable
rows, while `quarantined` identifies the excluded rows. Local aliases include
`local`, the local server id and its saved host label (when unambiguous).

Stable observations require two reads at least two seconds apart. File stat
changes during a read are rejected. Files larger than 2 MiB are not observed.
Even a syntactically valid empty or near-empty document cannot resolve missing
open tasks: the entire last good decision snapshot is retained until those tasks
are represented again. A still-present task can resolve its gate by removing
the hold, moving to Done, or adding a blocker. Removal alone is never an answer.
This favors an inspectable stale request over silently losing a decision.

The service starts with the plugin, uses a five-second fallback timer and a
two-second debounced directory watch (surviving atomic file replacements), and
accepts the exact source read used for fleet cards. It needs neither an SDK
handle nor a mounted view. Source reads have process-local sequence numbers so
a delayed fleet assembly cannot roll back newer observations. The timer catches
missed watch events; confirmation can take a second poll. Stop drains queued
work and closes timers/watchers. No agent is woken.

## Durable identity and lifecycle

Each canonical home has one ledger at
`$PASEO_HOME/plugin-data/firstmate/needs-you/<canonical-path-sha256>/ledger.json`.
Real paths (including junctions and Windows case normalization) select the
namespace; a persisted random home ID scopes opaque request/event IDs. A new
home gets a separate namespace. Mate/provider/worker replacement is absent
from identity. Known remote aliases resolve through the existing host resolver;
an unavailable remote worker does not remove its locally recorded hold.

Configured path aliases are recorded atomically in the same ledger. On restart
with a missing home, recovery searches those durable aliases rather than hashing
an unresolved path. This preserves identity through Windows short-name paths and
junctions even when `realpath` can no longer resolve the home. Recovery never
creates a namespace or resolves a gate. Ambiguous reused aliases or unreadable
recovery metadata leave counts unknown; a readable match remains stale.

Within a home, source identity is host/project/task, matching the scope of item
tags. A request ID additionally contains its generation. Monotonic record
revisions bind acknowledgements and answer submissions. Whitespace, case and
trailing question punctuation are cosmetic. Title, tags, section and worker
changes do not revise the question. A wording edit increments the record
revision but retains acknowledgement/snooze. A different URL/report target,
changed optional `gate` token, confirmed resolution followed by reopening, or
an edited ask after an answer creates a new generation. The optional gate token
is read only by the strict observer; no authored record or template is migrated.
One source task has at most one active generation.

| State              | Action count | Meaning                                                       |
| ------------------ | ------------ | ------------------------------------------------------------- |
| New                | Included     | New actionable generation or an expired snooze                |
| Seen               | Included     | Quiet; explicit acknowledgement records time and revision     |
| Snoozed            | Excluded     | Absolute epoch-millisecond wake time; retained across restart |
| Answer sent        | Excluded     | Accepted send recorded; source reconciliation remains pending |
| Delivery uncertain | Excluded     | Unknown outcome; no automatic retry or implied acceptance     |
| Resolved           | Excluded     | Answered, completed, deferred, or superseded, with timestamp  |

The first valid observation is a silent baseline. Its holds use the quiet Seen
state with `baseline: true`, **null `seenAt` and `seenRevision`**, and no
actionable events. This is not a claim of human acknowledgement. Explicit Seen
does not clear the action count. Snooze expiry requires a fresh still-open source
and produces one New transition. Unsnooze restores quietness if previously seen
or baselined. Pending answers remain pending indefinitely until source evidence
changes or an uncertain send receives a definitive outcome; no timer resends.

State and outbox are in the same atomic, serialized write: unique staging file,
file sync, then rename. Acknowledgements return only after commit. As with the
repo's other stores, the lock orders this plugin process; the host owns one
contributing server process per installation. Multiple in-process callers share
the per-ledger lock. Directory creation marks an allocated namespace: a missing
or corrupt ledger there is an error, not first enablement. A crash during initial
creation can therefore require restoring the ledger rather than silently
baselining again. Existing last-good memory remains visible as stale on read or
write failure; after restart with no readable state, counts are unknown. Staging
files left by a process crash are ignored. Resolved generations and transition
history are retained without automatic pruning in this foundation.

## Payload and RPC contract

`fleet.needsYou` and `firstmate.needs-you.read` return the same server snapshot:
`homeId`, `version`, `actionCount`, `newCount`, `snoozedCount`,
`pendingAnswerCount`, `freshness`, requests (including resolved history), parked
sources, and `delivery: "off"`. The fleet field is optional for compatibility
with earlier servers. Counts are `null` until a good baseline exists. Freshness
is `disabled | unknown | stale | fresh`, with `asOf`, `checkedAt` and diagnostics.
The version identifies durable ledger state; freshness may change without a
ledger write. Clients must consider both home ID and version, and must not hide
freshness merely because the version is unchanged.

All mutation RPCs require `{homeId, id, revision}` and re-read the configured home,
source and ledger before committing. Stale sources, wrong homes, resolved gates
and outdated revisions are refused. Reads, navigation and native attention clears
never acknowledge these gates.

| RPC suffix under `firstmate.needs-you` | Additional input                                               |
| -------------------------------------- | -------------------------------------------------------------- |
| `read`                                 | No target; input `{}`                                          |
| `seen`                                 | None                                                           |
| `snooze`                               | `until`: absolute future epoch milliseconds                    |
| `unsnooze`                             | None                                                           |
| `record-answer`                        | `submissionId`, `outcome`: `uncertain`, `accepted` or `failed` |

`record-answer` records an explicit submission/outcome; it **does not send any
message or perform an approval**. The later authorized send path can reserve an
`uncertain` submission durably before attempting its send, then settle that same
ID as accepted or definitively failed. Direct recording of an already known
outcome is also supported. Identical retries are idempotent; an ID cannot be
reused for another gate/revision, definitive outcomes cannot be changed, and a
second answer is refused while one is pending. Definitive failure restores the
previous state. Answer bodies are not stored by this foundation.

A revision binds the recorded question, not a verified PR head or report digest.
Changes behind the same URL/path are not detected. No revision-bound one-click
artifact approval is offered by this slice.

## Disabled outbox seam

Every non-baseline transition commits with a stable home/sequence event ID and
request ID, generation, revision, kind and timestamp. Events contain no question,
title, project, URL, answer text or credentials. A read-only cursor helper is
separate from acknowledgement. Candidate selection defaults off and also
requires fresh data; it suppresses seen, snoozed, pending, resolved and superseded
requests and returns only the latest candidate for a current New request.
There is no registered transport, network sender, delivery attempt or external
acceptance claim. Later delivery must add its own durable cursor/attempt owner,
policy and revalidation. Quiet hours, batching, phone routes and transport retries
are intentionally outside this foundation.

## Verification

`server/needs-you-detect.test.ts` covers the designs' source tables, six-open/
three-parked synthetic scenario, malformed records, duplicates, aliases and
section moves. Ledger tests cover state transitions, generations, stale revisions,
quiet baseline, absolute snooze times across London DST, idempotency, pending
answers and outbox suppression. Service tests use isolated temporary homes for
restart, missing/corrupt stores, failed and uncertain commits, concurrent callers,
background polling, delayed fleet reads, home changes, RPC schemas and fleet
integration. No installed-plugin or native-device validation is claimed.
