# Durable feature policy (smooth rollout, slice 3)

This preparatory slice adds a server-owned per-home policy contract and storage.
Runtime enforcement and public enablement belong to slice 4; in-app controls belong
to slice 5. Display preferences do not authorize server work.

## Acceptance checks recorded before implementation

- [ ] Missing settings, fresh/upgrade, home aliases and home changes cannot enable
  another home's capabilities. Reads create no file/journal/coordinator. Concurrent
  saves refuse the stale revision.
- [ ] Existing env-only partial combinations round-trip without broadening;
  explicit persisted off beats a legacy on. A lost settings response resumes the
  same request. Damaged records do not silently re-enable features or erase history.
- [ ] Display preferences never authorize server work. Settings do not change
  current scope/session identity, cumulative budget, project authority or strong
  qualification.
- [ ] This preparatory PR exposes no new public enablement until the runtime
  enforcement in PR 4 exists.

The captain accepted D1-D8 as recommended on 2026-10-29. For this slice that means
explicit opt-in for fresh and upgraded homes, preservation of partial pilot state,
separate capability choices, reviewed capacity, and no claim that switching off
undoes prior effects. Only the captain may attach a supervisor; policy grants no
new Attach, session, source authority, budget or strong capability.
