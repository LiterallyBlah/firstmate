# Attention observation

This implements orchestration plan §5.2: measure attention latency before designing another view
or changing delivery. There is no attention model, digest, new watch, dispatch mechanism or recall
collection. The single opt-in setting is the daemon environment variable
`FIRSTMATE_ATTENTION_OBSERVE=1` (also accepts `true`, `on`, `yes`). Off, it registers no additional
hooks or timer and performs no observation reads or writes. Enabling/disabling takes effect when
the plugin next starts; this change does not enable it in an installed plugin.

The append-only log is `<configured home>/data/metrics/attention.jsonl`, separate from launch
metrics. The first `start` timestamp begins a 14-day campaign; restarts keep that deadline. Nothing
truncates, rotates or deletes the log. A later campaign requires explicitly preserving the old log
elsewhere before enabling another one. Each plugin start, mate identity change and recording gap
breaks continuity. No observations are backfilled across reloads.

## Sources and reuse

| Observation | Evidence and limits |
| --- | --- |
| Local permission request/resolution | Existing lifecycle hooks; exact local hook-receipt timestamps and opaque request/worker identities. The hooks do not expose provider event timestamps or the actor who resolved a permission. |
| Local worker finish/error/cancellation | The existing receipt observer's turn-ended hook. Labels are checked through a deferred refresh, including predecessor-owned and manually prompted crew; inspectors and unrelated sessions are excluded. A failed lookup creates a recording gap. |
| Lead start/end/outcome | Lifecycle hooks and turn IDs. The nearest preceding **recorded attention event** is retained for cancellation as an association only. This is not necessarily the event that reached or interrupted the provider. |
| Remote permissions/status | The existing remote service's completed catalog polls, including followed sessions. No new remote poll or log read is launched. Status and permission IDs are diffed, with local sample-start/completion bounds, measured clock skew (nullable) and elapsed poll interval. Baselines, unavailable hosts, unavailable/missing workers and incomplete permission lists do not imply resolution. Intermediate changes between polls can be missed. |
| Actionable states | The existing `loadFleet` compiler and its cards, sampled on board reads and once per minute with the UI closed. The timer borrows the first SDK handle received through a hook or fleet RPC, as the watch service does; before that there is no fleet sampling. No watch/delivery cadence changes. |
| Lead action timing | Reuses the receipt observer's action catalogue and the decision collector's explicit-success/target/turn-binding approach. A bounded 200-entry SDK tail page binds hook calls to the ended turn; hook timelines alone contain history. No page, cursor gap/reset, missing turn, failed call, ambiguous target, or missing turn start means unknown timing. The page is discarded, not retained as another corpus. |
| Remote action timing | The report reads the helper's existing sibling `data/remote-action-receipts/` files. A unique started/succeeded pair for steer, archive or stop must match the current lead actor, host and target. It adds no live collection. Unknown identities, dispatch, permission answers without a target, failed/uncertain results and missing pairs stay unpaired or explicitly excluded. |

The decision collector examined for this work is the existing
`fm-decision-rescope/turnend-corpus/extension-v2` collector, alongside the earlier
`fm-decision-gate2/collector-v3`. Their decision labels, reconstructions, transcript projection,
qualification rules and schedules are unchanged. This observer does not start or rerun them.
Existing receipts remain the source for send/queue evidence and the collector remains the source
for semantic dispositions such as shell-based landing. The observer keeps only the additional
timing metadata required here; it does not copy prompts, reports, tool arguments/results, permission
descriptions, task titles, host connections or credentials. Agent, task, call, request and lead
identities are hashed consistently so the records can be joined without arbitrary text.

## Fleet categories

- `ready`: the compiled Ready column, meaning ready for verification or landing, not proof of either.
- `dependencies-met`: a single explicit `blocked-by` task ID resolves uniquely in the same project
  and host to a Done card. Prose, compound dependencies, duplicates and missing rolled-off Done
  items remain unknown; no new dependency parser or model is introduced.
- `hold`: a backlog hold is present.
- `queued`: the compiled Queued column plus Queued backlog items currently held/blocked, including
  work awaiting unblocking.
- `followed`: a remote worker marked followed by the catalog.
- `permission` and `failure`: pending permission count and the compiled Failed column.

These categories overlap. Entries/exits are recorded on changes, not on every identical sample.
State identity uses host plus worker, or host/project/task for work without a worker, rather than
the board's positional backlog key. A changed identity is a new observation. Fleet errors or
unavailable remote cards break observation rather than manufacturing exits. An exit is a sampled
state change, never an attribution to the lead.

## Report

With Node 24+, run from this checkout:

```sh
npm run report:attention -- /absolute/path/to/home/data/metrics/attention.jsonl
```

Use `npm.cmd` on Windows. The command prints JSON and writes nothing. Its `byCategory` table orders
measured action upper-bound p95 values, with source counts, paired/unpaired action counts and
baseline counts. Empty populations have null statistics. Inspect these together: a category with
many unmatched events has a coverage gap, not evidence of fast handling. `incidents`, `permissions`,
`leadTurns`, `unpaired`, `gaps` and invalid line numbers provide the supporting records.

Three quantities are deliberately separate:

1. Permission request-to-resolution duration: exact between local hook receipts. Remote pairs use
   interval bounds; an appearance in the initial catalog is left-censored and its true duration is
   null. A disappearance does not identify who resolved it.
2. Time to the next lead turn: association only. It neither proves notification delivery nor proves
   that the lead addressed the item. Native `<paseo-system>` delivery is not exposed to the plugin.
3. Time to an explicitly successful, targeted lead tool action: a range bounded by that turn's
   start/end. The turn must start after the incident was observed. Overlapping turns remain
   unpaired. A matching tool proves action on the subject, not resolution of that state. Explicit
   crew creation can match queued task identity; shell, verbal, file-only and remote-helper actions
   without paired receipts remain unpaired here and require the existing collector evidence for
   interpretation. Paired remote helper receipts instead bound the action between intent and
   success on the local clock. Actions after an observed state exit/resolution are not paired to
   that interval. The `remoteReceipts` section reports unavailable, invalid, failed, uncertain and
   unpaired evidence. Receipt import is refused when the attention log has malformed lines or
   clock regressions, and receipts outside the observed log window are excluded.

First-seen states are left-censored: their observed residence is useful, but actual age is unknown.
They never enter total action-latency distributions as zero. Resolution-only events, restart gaps,
malformed/partial lines, regressing local clocks and missing starts cannot be silently paired.
Remote clock skew is contextual uncertainty; calculations use local observation intervals instead
of subtracting remote `updatedAt`. Skew measurement error itself is unknown.

## Isolation and verification

Hooks and catalog callbacks only queue bounded work; they do not await recording or alter a send.
The queue has a 256-job cap, drops an overloaded backlog with an explicit gap, and logs failures
without including error payloads. Reads, projection and appends run afterward. Disk/SDK failure
costs observations, not delivery. Teardown unregisters the timer/hooks; already queued work can
finish, but shutdown may lose the tail. Restart boundaries preserve that uncertainty. Like any
in-process observer this uses finite CPU/I/O; it adds no synchronous wait to message delivery.

Tests cover each event, all fleet categories, local/remote pairing, censored and unpaired records,
historical-hook call rejection, the default-off path, delivery while storage is blocked, recording
failure/overflow, append-only storage, the persisted campaign deadline, headless sampling and a
fixture report. Test setup always clears the opt-in flag and isolates `PASEO_HOME`.
Run `npm.cmd run typecheck` and `npm.cmd test -- --testTimeout=30000 --maxWorkers=2` on Windows
under host load. These are fixture tests, not a claim that observation has been enabled on a live
daemon or that a real 14-day latency study has already completed.
