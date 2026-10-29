# Scoped supervision activation

Build A adds separately default-off project ownership via `FIRSTMATE_PROJECT_MATES=1`. Home/Plans
show a read-only registry census and legacy/scoped plan associations; only explicit project provisioning
creates an independent persistent session. Admission, memory, cumulative caps and the shared paged runtime
are documented in [Build A's contract and acceptance mapping](docs/scoped-supervision/build-a.md).
This does not add a second plan Attach path or enable ongoing plan execution.

Build B adds separately default-off operation via `FIRSTMATE_PLAN_SUPERVISORS=1`.
The owned runtime consumes scoped requests, offers mailbox/outbox inputs, observes
PR/remote/board facts and dispatches qualified local isolated workers while General
is busy. Source-bound versioned rules gate dispatch and completion, retain actual
artifacts and cumulative caps, and leave routine repairs with the delegated owner.
Ordinary Plans reads the authoritative scoped history. Migration controls inspect,
resume and abort through the existing path; continuation requires an independent
verified snapshot under explicitly configured operator retention. See
[Build B's acceptance mapping](docs/scoped-supervision/build-b.md). No rollout is implied.

Activation is off unless the daemon environment contains exactly
`FIRSTMATE_SCOPED_ACTIVATION=1`. Installing or viewing the plugin does not initialize a journal,
acquire a coordinator, arm the delivery gate, migrate a plan or create a session. The switch enables
explicit controls; it does not perform those operations itself.

## Attach is a convention

The captain chose **captain-only by convention**: a dedicated Attach button in the plugin's client
UI, with a confirmation naming the plan, supervisor identity, model, permission mode and opening.
General's charter forbids invoking attach by any route or briefing a crewmate to do so. No shipped
MCP tool, CLI command, slash command, home helper or background loop exposes attachment.

**Paseo's plugin RPC carries no caller identity.** Handlers receive only the plugin's shared `paseo`
handle. The button is a convention, **not a security boundary**. A direct caller with daemon RPC
access can submit the same request. The server does not authenticate the captain or claim to refuse
General and crew as transport principals. Input cannot supply an actor.

The original library `SupervisorSessions.attach` retains its captain-actor guard. Production uses a
separate `attachFromUnverifiedUi` seam, explicitly enabled by the activation service, with actor kind
`plugin-ui-unverified`, ID `unauthenticated-plugin-call`, and source `client UI (unverified)`.
Authenticated caller identity and captain authorization remain a future transport upgrade. Roles
supplied in input, agent labels and shared home files would not provide that upgrade.

## Atomic audit and lifecycle

Each accepted attachment stores its audit in the existing immutable command receipt, atomically
with its binding, cumulative session/turn spend and three reserved S04 effects. It retains server
time, plan ID, supervisor ID, source `client UI (unverified)` and authorization label
`by convention, not verified`. Disabled, malformed and stale calls do not attach. An exact accepted
retry preserves the original audit without introducing another action. The board shows every audit,
including a later failed or uncertain create/opening, and retains the history when activation is off.

The final transaction checks the displayed plan hash, scope version and deterministic supervisor ID.
Attachment requires an S07-committed active plan scope with no existing binding. S04 claims precede
opening a separate workspace, creating the reserved parentless, unprompted session, verifying its
actual workspace/settings/labels, and sending its reserved opening. The production cap is one
supervisor session and one opening turn per scope. Failure and uncertainty never refund the budget.

Paseo's SDK takes a combined `provider/model` selection for creation but returns separate `provider`
and `model` fields. The production receiver restores that combined identity before the existing exact
profile verification; a different provider, model, mode or thinking option still refuses the opening.

An explicit retry reconciles an uncertain create through the existing gateway's lookup of the reserved
agent ID. A negative lookup never creates another supervisor. Verification of its workspace, labels,
parentlessness and full profile still precedes the opening. The board derives `resumeRequestId` from
the durable audited command and its current binding/effects. Its **Resume attachment** confirmation
uses that request ID through the same UI RPC, including after client/plugin reload; it accepts no new
profile, opening or identity. A partial audit keeps the original confirmation open. Only an active
binding with a successful opening closes it. Unknown workspace/opening delivery stays held; no replay
of an uncertain workspace open or send, new identity, refund or takeover is offered.

The SDK adapter is labeled `cooperative-paseo`, not live-qualified or strongly confined. SDK send
success is transport history, not semantic handling evidence. Unknown outcomes keep their effects
and spend; no automatic replay or takeover is installed. Worker dispatch, conditional archive,
receiver exclusion, failover, takeover and U1–U3 remain unavailable. The strong-capability gate and
its frozen evidence are unchanged.

## Store and cutover ownership

`SupervisionActivation` acquires a writable store/coordinator lazily per absolute home identity on
an explicit mutation, and releases it during plugin cleanup. Views stay read-only. Mutations use
the existing lifecycle lock and store serialization; home is rechecked before opening the writer.
Corruption and unknown coordinator liveness hold writes. A nonempty damaged journal is never reset.

The production migration RPC delegates to S07's `SupervisionMigrator` and `legacyAdapters`, using
the actual watch runner's single queue, config mate notes and fresh Needs-you ledger. It provides
prepare, resume, reconcile, barrier, commit and abort, plus evidence-based resolution of ordinary
holds. Prepare explicitly arms the existing claim gate. Resume takes the original preparation input
to recover a freeze before its journal receipt. History import, sidecars, claim/receipt sequencing,
compare-by-ID/payload removals and exact abort restoration remain S07's implementation. No second
queue or send path is introduced.

Explicit migration resume/abort and attachment retry detect a checkpoint-held restart before
coordinator acquisition. The existing strict `recoverIndex` validates the authoritative published
journal and the old checkpoint's ancestry, rebuilds accepted-request and state projections, then
advances only the derived checkpoint. The observed journal head is rechecked under its repair lock.
An already published transaction is recorded once, even if its checkpoint replacement was interrupted.
Missing, unreadable or divergent checkpoints over nonempty history, missing anchors/events and a
shortened/corrupt journal still refuse; no witness is erased. After coordinator acquisition, resume,
abort and retry call the existing `recoverPublication` for an exact event/tip awaiting its marker.
Reads never repair or publish, and disabled activation never enters either recovery operation.
After a freeze without a prepared receipt, S07 proves the original inventory by its full frozen hash.
Protected watch arrivals append under the same gate, so recovery checks bounded watch prefixes while
retaining every non-watch disposition. A hold flag alone cannot identify a late row: a flush may also
hold an original row. Only the exact original hash admits preparation. Late rows remain in the real
queue, then enter the existing re-inventory as holds. Resume is idempotent, and abort can release the
prepared cutover while preserving those rows; no sidecar deletion or invented disposition is used.

Migration app calls also record unverified provenance. Abort and ordinary hold resolution accept
that provenance. **Answer holds still require the original captain actor and are refused through
this unauthenticated RPC.** No call is relabeled `captain-ui` to clear one.

Build C wires explicit discussion and checked answer execution behind independent default-off
`FIRSTMATE_SCOPE_UI=1` / `FIRSTMATE_SCOPE_EXECUTION=1` startup controls. It reuses S05 captured
targets, drafts, threads and native links; one shared Needs-you snapshot gains scope/ancestry
filters with global totals and retained quarantines. Stored status and compact scoped Bearings
wake no model. General sends do not acquire a scoped writer. The app's answer press records
unverified provenance and uses the existing logical-owner outbox; it cannot approve a plan or
attach a supervisor. Plan sessions use B's durable cap when its explicit switch is enabled; otherwise caps stay 1/1. The shared captain
decision shape adapts real plan decisions; project/maintenance origins require their domain
owners to emit actual captain escalations. See [Build C](docs/scoped-supervision/build-c.md).

Scoped workflow commands, source ingress, inbox offering and worker dispatch require
Build B's separate switch. Discussion execution remains Build C's separate integration.
Attaching a session does not qualify broader rollout or General relief. Follow
[the per-plan procedure and observation gates](docs/scoped-supervision/rollout-runbook.md#7-explicit-activation-and-per-plan-expansion).
