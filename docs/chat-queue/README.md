# Queued chat messages

Home's FirstMate composer and the project/plan mate conversations opened from
the conversation switcher share a daemon-owned queue. **Queue messages while busy**
defaults on in FirstMate settings. Send saves a busy mate's message; a queued item's
Send now action is an explicit immediate send through the same checked transport as before. With a
steer-capable provider it joins the current turn; it does not force-cancel it. Turning
the setting off makes new sends immediate. Previously queued messages still leave
one at a time.

The queue lives in `plugin-data/firstmate/chat-queues/<home hash>.json`. Targets,
words and attachments survive client reloads and tab switches. Admission retains
request IDs, payload hashes and terminal receipts. The file is replaced atomically
after flushing its temporary file. The one daemon writer serializes admission
before asynchronous checks, so concurrent messages keep admission order. It saves
a claim before entering the existing send service and never repeats a claim after
an error, reload or duplicate request. A failed or unconfirmed send remains visible
with its original words and can be removed; it is never automatically retried.
Queue previews and send receipts omit attachment bytes. Only Edit reads them
back into the composer. Unchanged reads reuse validated file identity in memory.
The client retains an unresolved admission's original request ID and checks that
same request after a lost response. A proven discussion refusal keeps the draft
editable; uncertain delivery becomes held and never becomes a fresh send.

Fresh native status decides when to release one oldest queued message per agent.
An active native turn, a running/initializing status or a pending permission keeps
messages queued. A saved in-flight claim blocks competing release attempts.
Lifecycle callbacks trigger reconciliation, and a daemon sweep checks once a
second after the host API reconnects. Missing, duplicate or reordered callbacks
cannot strand messages or bypass a busy native turn. The engine does not require
a started callback from a delivery. Old saved turn barriers are discarded; durable
message IDs and receipts remain. Send now remains available to deliberately proceed.

Registration sweeps abandoned claims to held before a client reconnects. The
daemon also sweeps claims older than 60 seconds, and bounds its transport wait by
the same timeout. A held message retains its words and offers Remove, with no
automatic retry or Edit that could repeat an uncertain send. A late transport
response cannot restore a row after recovery or removal. Client reloads reuse the
same daemon instance and do not disturb a live claim; plugin/daemon restarts take
over its saved metadata. Recovery creates no agent or provisioning path.

Edit removes an item from automatic delivery and returns its words and attachments
to the composer; resending appends it at the end. This matches the native
[Paseo composer action](https://github.com/getpaseo/paseo/blob/22488d4502cd0c8a4ee4619af991762f071b60a7/packages/app/src/composer/actions.ts#L274).
An editing copy remains saved until it is resent or removed, so a lost Edit
response can be recovered by pressing Edit again after reload.

Main chat still calls `askMate` with its captured mate ID and ordinary transcript
message. Scoped chat still enters `ScopeRuntime` and the checked discussion
outbox, preserving the entire original route, reply and project context. The
receiver checks availability again immediately before its native send. A changed
owner, home, profile, source or budget holds delivery; it never reroutes to General.
Changed scoped ownership leaves the original queue visible in that conversation.
Read-only maintenance/remote conversations and the reviewed first-send flow are
unchanged. No Attach path is added.
Suggestions, Bearings and Ahoy retain their existing immediate send behavior;
queueing applies to the two chat composers.

Both chats keep the queue immediately above the input, so queued rows grow upward
and the message box stays in place as messages enter or leave the queue. There is
no composer-level Send now control. Rows follow Paseo's queued-message treatment:
bordered surface cards, two-line 14px previews, muted status labels and circular
actions. Pencil edits, the accent up arrow sends now, and X removes. Accessible
action names remain Edit, Send now and Remove; compact layouts keep 44px targets.

The queue permits 100 waiting messages and a 128 MiB saved file. Completed receipts
retain IDs and hashes without attachment bodies. Receipts and completed turn tokens
accumulate up to that file cap; automatic pruning is deferred to preserve deduplication.
Filesystem loss or external edits
are outside the single daemon writer guarantee; damaged state refuses mutation.

| Acceptance | Evidence |
| --- | --- |
| Three messages leave one per completed turn | `server/chat-queue.test.ts`; the browser harness checks both composers |
| Reload retains queue and edit recovery | Engine reconstruction test; real browser reload in both conversations |
| Edit returns text, Remove works | Browser input assertions and durable edit/remove tests |
| Duplicate release/admission cannot send twice | Concurrent duplicate admission, repeated completion and reload tests |
| Missing/reordered hooks and Send now into an existing turn | Review probes A/B/E; native-status polling and active-turn RPC tests; unmasked browser harness |
| Interrupted delivery becomes removable without retry | Review probe C; stale-claim, late-response and startup-before-RPC tests |
| Default on; off sends immediately | `client/settings-screen.test.ts`, queue and checked RPC tests |
| Existing routing and outboxes | `server/chat-queue-rpc.test.ts`, existing scope runtime and composer tests |
| Both themes, desktop and phone, before and after | `node docs/chat-queue/render.mjs`: 16 before/after PNGs and 8 interrupted-delivery recovery PNGs plus results in ignored `.local/chat-queue/ui/` |
| Plain status copy, no Updating/as-of labels | Browser text and overflow assertions; visual inspection |
| Queue before composer, stable input, item-only Send now | Browser DOM/bounds assertions across both chats, themes and widths; item-action RPC regression test |

`node docs/chat-queue/reference.mjs /path/to/paseo` renders Paseo's actual
`QueuedMessageRow` and queue styles read-only beside FirstMate's shared component.
The fixture uses the same host palette, records the inspected upstream revision,
and writes both-theme comparisons to ignored `.local/chat-queue/ui/screenshots/`.
It is source-based visual evidence, not a live agent session. No upstream component
is copied into the shipped plugin.
Selected before/after and side-by-side captures are in [the layout review](review/README.md).

Run `npm run typecheck` and `npm test -- --maxWorkers=2` for the full checks. On
Windows this task also uses the repository's hosted 60-second test timeout. The
known Windows launch-tool, crash-dispatch timing and plan-help process-identity
flakes are recorded separately when observed. Hosted checks upload the queue
screenshots and results alongside the existing UI evidence.
