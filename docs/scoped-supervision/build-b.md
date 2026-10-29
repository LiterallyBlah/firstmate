# Build B: operating plan supervisors

Implementation contract, recorded before coding. This build extends #164's owned
runtime and #163's existing app Attach convention. Everything new requires
`FIRSTMATE_PLAN_SUPERVISORS=1`; installation and views activate nothing. No live
rollout, U1–U3, remote mutation, release executor, takeover or second Attach path.

## Automatic acceptance checks

Run `npm run typecheck` and the complete `npm test -- --maxWorkers=2` suite
(Windows uses `--testTimeout=20000`). Run affected production-composition, receiver,
seven-rule, source, workflow, migration and lifecycle tests while iterating.
Run the existing S05/native-client checks for changed contracts and UI renders for
changed operator surfaces. Review the complete diff, then require all PR checks
green before marking ready. Test homes/providers/repositories are isolated; no
real agent or live activation is part of this build's verification.

| Audit acceptance | Required automatic evidence |
| --- | --- |
| A01, A10, A18 | Production receiver reserves exact independent identity/worktree; claim before native calls; duplicate/restart/lost replies retain uncertainty and spend; no native-parent or strong-capability claim. |
| A02, A03, A05, A08 | Two production-composed chains advance with General busy; stale review/head, stopped scope, changed policy/rules and budget refuse while unrelated scope progresses. |
| A04, A06, A07 | Existing reservation and mailbox/outbox invariants; duplicate/reordered events and restart have one consequence; logical-owner answers retain exact subject/epoch and uncertainty. |
| A09, A11, A15 | Ordinary Plans/fleet expose authoritative scoped plans; checked owner/backend action routing; rules/policy/context provenance and project membership; reads create nothing. |
| A12, A13, A14, A22 | Migration preserves original bytes, attempts, delegation and budgets; snapshot digest/restore boundary; operator inspect/resume/abort; no unknown-callback transfer, history reset or capacity reset. |
| A20, A21 | Durable continuing-turn caps; unknown effects reserve spend; confined capped digest-verified evidence; source gaps and unsupported remote/release operations remain explicit. |
| Rules 1–7, rows 71–78 | Each rule refuses dispatch and successful completion when missing/failed/stale; changed subject/head during admission refuses; factual failures remain recordable; remediation, recurring blocker handling, isolated-scope progress and accepted historical replay. |

The full matrix is the audit's Build B acceptance: A01–A15, A18, A20–A22.
Live latency, native bypass confinement, callback transfer and the separately
authorized two-plan/24–48 hour rollout trial remain explicit qualification limits.

## Implementation and verification

Pending. The PR remains a draft until implementation and its acceptance checks pass.
