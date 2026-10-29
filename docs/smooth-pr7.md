# Reviewed project batch setup

Slice 7 extends the existing individual project setup. It keeps the captain's
explicit selection, original General conversation and all existing safety checks.

## Acceptance checks recorded before implementation

- One project and all 2 eligible projects both work; all 6 valid projects remain
  selectable when only 3 fit, with a truthful capacity step. Existing/invalid
  projects are counted separately. No implicit capacity or plan-budget increase.
- Duplicate confirm, two clients, request/body mismatch, app reload and daemon
  restart reconcile the exact batch and child inputs. A completed child is never
  recreated because another child's reply was lost.
- Mixed success, changed source, offline host, exhausted admission capacity and
  uncertain opening show separate outcomes. Read-only Check saved setup does not
  retry unknown sends. Explicit cancellation affects only undispatched work and
  preserves identity/spend.
- After success, Home still shows the original General transcript; opening a new
  mate is explicit. Routine incidents and batch progress never inflate
  captain-decision totals.

## Boundaries

At most 64 canonical projects; explicit Select all eligible, no initial selection.
Aggregate capacity includes General's retained headroom. A shortfall retains all
selection and requires a separate reviewed capacity change or fewer projects.
Reuse valid reviewed profiles; no unapproved numeric preset. Each independent
native effect keeps its existing queues, source/profile/cap/policy guards and
authoritative receipts. Results are individual, without transactional rollback.
No Attach, plan cap changes, background retry, cleanup, budget refund or rollout
default changes. App provenance remains unverified. Refreshes stay silent.
