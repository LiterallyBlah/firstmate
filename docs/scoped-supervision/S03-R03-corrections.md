# S03: R03 correction evidence

This additive correction retains the original S03 delivery at
`d99e0b41bb7117fe9bb2ba869664f08530f194ab`, its two commits, [scope and activation
boundaries](S03.md), and [original validation receipt](s03-validation.json). The independent R03
report and exact probe/control inputs are fingerprinted in the [correction receipt](s03-r03-validation.json).
The independent report remains unchanged; this document requests a separate re-review rather than
claiming independent acceptance.

## Corrections

| Finding | Checked behavior | Regression and positive control |
| --- | --- | --- |
| R03-01: borrowed node approval | New approvals bind the selected node, complete parsed command, pinned brief hash and exact dependency binding digest, alongside the existing plan/subject/head/policy/model/evidence vectors. Launch approvals also recheck the actual confined brief. | A trial approval refuses a build start with identical plan/profile. A changed brief refuses the old approval and cannot receive a new approval using its stale hash. The exact target and a newly reviewed brief both start successfully. |
| R03-02: unrelated result consumed an answer | Only an explicit `ack handled` command can record causal links to pending same-scope/same-plan outboxes. Its committed result retains each exact outbox, decision and causation ID plus the owner epoch. `acknowledge` requires that link, current ownership and a later committed result. | Unrelated `told`, `told` naming the answer, unrelated `handled`, and `handled` naming another outbox all refuse without changing the answer outbox. Exact linked handling succeeds. A link from the previous epoch refuses even if the agent ID stays the same; fresh handling succeeds. |
| R03-03: dormant readiness mismatch | Scoped Needs you uses the same logical UI-answer ownership states as admission: active, held or transferring plan scopes in scoped mode. Dormant ownership contributes no ready action. | A dormant decision is waiting, counts zero and rejects the answer without writes. Held/transferring scopes remain ready and accept a logical UI answer even while the binding is suspect. |
| R03-04: incomplete dependency inventory | Structural plan validation receives the complete checked retained plan inventory. Per-node readiness still requires exactly that node's direct prerequisites and their checked bindings; unrelated bindings remain invalid. | An independent trial starts while another step names an external prerequisite. An extra binding refuses. The dependent build stays held until external work is done; missing/stale bindings refuse and its exact current binding succeeds. |

These changes reuse the existing store, reducer and dependency checks. They add no execution,
transport, notification or policy-import adapter. Bookkeeping acknowledgements still produce no
notification, and a transport receipt remains insufficient evidence of handling.

## Retained history

The new approval target and result handling metadata are optional **without replay defaults** on
retained rows. This preserves the original journal shape and hashes. An old approval remains valid
history but cannot authorize a new operation without the new target binding. An old accepted command
returns its original receipt before today's admission checks; it is never reauthorized during replay.
Only new explicit linked handling can consume a pending outbox.

Controls read a temporary journal containing pre-target approval and pre-handling accepted-result
rows, compare their exact projections and replay receipts, and confirm that reads/replay write
nothing. Another control replays an accepted start after an actual owner transfer, deny-policy
change, raw source drift and disabled command writes, preserving its single spent attempt.

## Verification and boundaries

The eight counterexample cases first failed against the delivered implementation. The final test
file has 39 cases, including the existing S03 scenarios and the added positive/preservation controls.
The correction receipt retains counts, failure summaries, report/log digests, exact commands and
Git-normalized source/test hashes. In particular, it preserves the initial counterexample failures
and the intermediate compatibility-fixture request-ID conflict; the fixture received a distinct
historical-start request ID, with no relaxed product guard.

All probes use temporary homes and supported in-process store/service APIs. Existing process-crash
fixtures remain isolated. No provider/model call, credential access, live resource, install/reload,
activation, routing, watch change, migration, merge or new terminology is included. The seam stays
unwired and disabled. Same-user provenance and filesystem cooperation retain the limitations in
the original S03 document; this correction adds no authentication or fencing guarantee.
