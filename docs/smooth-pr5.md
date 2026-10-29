# In-app help settings (smooth rollout, slice 5)

## Acceptance checks recorded before implementation

- [ ] A non-technical tester reaches the setup entry without a terminal and sees
  applied state immediately. No restart instruction is needed. A first update
  keeps everything off unless previously opted in.
- [ ] Opening/canceling/settings navigation has zero model/session effects.
  Feature-save failure leaves the previous effective state and draft review visible.
- [ ] A partially enabled pilot sees its actual setup; unavailable policy
  dependencies have a named in-app next step. Turning off cannot look like
  deletion or completed rollback.
- [ ] Two-client stale settings, host/home switch and permission/provider
  unavailability refuse safely with readable recovery.

## Scope

Use the existing policy RPCs and runtime enforcement from slices 3–4. Add
Project mates, Plan help and Routine checks to the existing settings screen,
with read-only setup review, explicit enable-only saving, reviewed dependency
changes, retained independent pilot values, turn-off impact and separately
reviewed capacity/headroom changes. Do not add project admission/provisioning,
batch setup, migration/Attach, routine-check creation or the upgrade introduction;
those belong to later slices. Only the captain attaches a supervisor.

The captain accepted D1–D8 on 2026-10-29. D2 requires explicit opt-in for fresh
and upgraded homes and exact legacy environment compatibility until an explicit
save. Saved settings then override environment values, including saved off.

## Validation and visual evidence

Pending implementation. Capture before/after in light and dark at desktop and
phone widths, check the report's copy contract and map each acceptance check to
focused tests and evidence before marking complete.
