# Observe maintenance

Available when the captain enables routine checks in the home's saved feature policy. Changes apply while services are running. Existing environment-only pilots keep their exact original-home selection until saved. Turning checks off refuses new work while retaining read/receipt reconciliation and all identities, spend and uncertainty. This is same-user cooperative transport,
not authenticated IPC. It does not provision sessions, Attach, dispatch workers,
create/retire native timers or delete files. Automatic cleanup is held by G8.

`node tools/maintenance.mjs summary` gives General the stored exception/coverage/resource
counts directly, without a model summary cascade. `node tools/maintenance.mjs read` reads stored jobs, full host coverage, occurrences,
incidents, resources, delivery state and G8 conditions. General reads this directly;
healthy outcomes and unchanged failures never need a model summary or captain count.
`node tools/maintenance.mjs timers` takes a fresh actual script/managed/native census.
An empty native schedule list is not proof of complete heartbeat/remote ownership.

`node tools/maintenance.mjs command --file data/<request>.json --request-id <uuid>`
submits one strict command. Retain the request id after a timeout; replaying the same
accepted request never repeats its mutation. The current first mate records job
administration. A registered maintenance work owner may submit `observe`, `ack`,
`escalate` and `answer-handled`. Captain-app admission first creates the maintenance
scope and owner from Home/Plans, with an explicit profile and cumulative turn cap.
Fresh clients resume its saved request. No helper or CLI exposes admission or Attach.

Commands use the `firstmate.maintenance.admin` contract:

- `job`: `input` is the S10 job definition including expectedVersion, existing
  maintenance scopeId, explicit daily IANA schedule, every approved host (offline
  hosts included), selectors, retained paths, legacy timer link, turn budget and
  maxPasses. Only `mode: "observe"` is accepted. New definitions are dormant.
- `state`: jobId, expectedVersion and active/stopped. Activation is a rollout action.
- `observe`: input has occurrenceId, hostId, completed/failed/offline outcome,
  plain detail and resultDigest. Record a verified existing timer/probe result;
  a due date, idle agent or reachable host alone never proves successful cleanup.
- `ack`: incidentId, generation and the exact delivered epoch. Only the bound owner
  can acknowledge a succeeded notification. Delivery alone is not acknowledgement.
- `escalate`: input has incidentId, generation, epoch, kind (`authority` or `budget`),
  question, two to twelve unique options (`id`, `label`), recommendation (option id
  or null), and evidence (`ref`, `digest`). Only the exact verified owner may raise
  a genuine choice on its open incident. Routine failures/offline observations are
  not captain choices. Real budget exhaustion also creates one choice without a wake.
- `answer-handled`: outboxId, epoch and nonempty result evidence. The captain answers
  only in the app, binding the displayed subject/revision/evidence. Its checked outbox
  remains pending until the exact successfully notified owner records handling.
  Unknown sends stay held; successful delivery is not semantic handling. Answers
  change no budget and grant no cleanup, dispatch or other work authority.
- `retired`: jobId, expectedVersion, timerId, inventoryHash and nonempty evidence.
  First use the timer's actual known owner to disable it under existing authority,
  then reread `timers`. This records evidence only when that exact linked timer is
  still observed disabled. Missing/unknown-owner timers stay held. The managed
  Take-the-Initiative owner remains; never recreate the old fleet reminder.
- `reconcile-items`: occurrenceId, hostId, expectedVersion, exact uncertain item
  keys/outcomes and receiver evidence. Nothing is reapplied.
- `resource-release`: reservationId, expectedVersion, terminal kind and evidence.
  The S10 matching-terminal checks still apply; expiry is never release.
- `resource-reserve`: effectId, class, keys, priority and leaseMs reserve only an
  existing effect's named resources. `resource-promote`/`resource-renew` preserve
  fences and FIFO; `resource-expire` marks expired leases suspect, never releases.

A changed incident gets one bounded notification to its admitted maintenance owner.
Unknown send outcomes retain their identity, spend and hold, with no automatic retry.
There is no General fallback. A corrective plan must use the checked plan runtime
and its applicable rule/evidence gates. Routine owner incidents create no captain
decisions. Genuine escalations emit the shared scoped-captain-decision presentation
contract alongside their retained checked answer context/outbox, never a notification
count. Owner turns retain the captain-approved cumulative cap.
