# Slice 4: runtime feature policy acceptance

This PR implements only “PR 4 — apply policy while running, with fresh effect guards” from the 29 October 2026 smooth-rollout report. Captain decisions D1–D8 are accepted as recommended. The following acceptance checklist was recorded before implementation.

- [ ] Enable/disable and re-enable from two clients without plugin reload, daemon/app restart or environment edits. One clock/coordinator remains; settings reads and enablement alone wake no model.
- [ ] Disable between reservation and dispatch: undispatched work refuses at the fresh guard. A send already in flight settles exactly once, keeps spend and never retries. Reload during disable/reconcile preserves all identities and receipts.
- [ ] Project help can enable without plan execution or maintenance. Maintenance disable does not stop independent General chat. Capability dependencies are explicit and fail closed; strong qualification is unchanged.
- [ ] Existing project/source/profile/cap checks, cutover gate, exact answer outbox and scope ownership checks still run. No shared General conversation lock is added around per-project work.

Boundaries: retain one runtime/coordinator per home, one workflow clock and existing admission queues. Refuse new work when disabled; preserve settlement, resources, history, uncertainty and the committed single writer. No new setup UI, Attach path, migration/snapshot configuration, cleanup executor or strong qualification. Missing policy stays off except exact home-bound legacy compatibility. Display preferences never authorize work.

Verification evidence will be mapped here and in the PR before completion.
