# Queued chat messages

Home's FirstMate composer and the project/plan mate conversations opened from
the conversation switcher share a daemon-owned queue. **Queue messages while busy**
defaults on in FirstMate settings. Send saves a busy mate's message; Send now is
an explicit immediate send through the same checked transport as before. Turning
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
editable; uncertain delivery keeps its claim and never becomes a fresh send.

Completed turn IDs and the outstanding message's turn are saved as well. One
qualified completed turn claims at most one oldest queued message for that agent.
A second idle submission waits behind the first message even if the app still
shows the agent as idle. Failed, canceled or unidentified callbacks do not release
another message. Send now remains available to deliberately proceed. Restoring a
client creates no timer, agent, attachment or provisioning path.

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

The queue permits 100 waiting messages and a 128 MiB saved file. Completed receipts
retain IDs and hashes without attachment bodies. Filesystem loss or external edits
are outside the single daemon writer guarantee; damaged state refuses mutation.

| Acceptance | Evidence |
| --- | --- |
| Three messages leave one per completed turn | `server/chat-queue.test.ts`; the browser harness checks both composers |
| Reload retains queue and edit recovery | Engine reconstruction test; real browser reload in both conversations |
| Edit returns text, Remove works | Browser input assertions and durable edit/remove tests |
| Duplicate release/admission cannot send twice | Concurrent duplicate admission, repeated completion and reload tests |
| Default on; off sends immediately | `client/settings-screen.test.ts`, queue and checked RPC tests |
| Existing routing and outboxes | `server/chat-queue-rpc.test.ts`, existing scope runtime and composer tests |
| Both themes, desktop and phone, before and after | `node docs/chat-queue/render.mjs`: 16 PNGs plus results in ignored `.local/chat-queue/ui/` |
| Plain status copy, no Updating/as-of labels | Browser text and overflow assertions; visual inspection |

Run `npm run typecheck` and `npm test -- --maxWorkers=2` for the full checks. On
Windows this task also uses the repository's hosted 60-second test timeout. The
known Windows launch-tool, crash-dispatch timing and plan-help process-identity
flakes are recorded separately when observed. Hosted checks upload the queue
screenshots and results alongside the existing UI evidence.
