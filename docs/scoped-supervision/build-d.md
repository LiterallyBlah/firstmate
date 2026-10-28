# Build D: maintenance scopes and timer cutover

This integration reuses S10 and the Build A owned runtime. It stays off unless
`FIRSTMATE_MAINTENANCE=1`. No live activation, provisioning, Attach, timer retirement,
cleanup or deployment is part of this build. Automatic cleanup remains held by G8.

## Checks declared before implementation

Required automatic checks: `npm run typecheck`, `npm test`, and the targeted
`npx vitest run server/maintenance-runtime.test.ts` integration cases. Pass means
zero type errors and zero failing tests. The integration cases must exercise the
production registration/driver seams with isolated homes and native stand-ins.

| Audit acceptance | Required evidence |
| --- | --- |
| A04 | Advisory all-or-none resources retain conflicts; cleanup remains held by G8; retained/link selection regressions remain green. |
| A06 | Duplicate/restart observations and changed incident generations deliver at most once; healthy and unchanged failures wake nobody. |
| A10 | Interrupted/unknown deliveries and host items retain identity and spend, without automatic resend/reapplication. |
| A13 | Shared coordinator/restart and publication recovery retain occurrences, receipts and uncertainty; reads/default-off write nothing. |
| A17 | D5 duplicate/DST/missed-date semantics, complete configured host coverage including offline hosts, fresh timer census, disabled-watch preservation, exact evidence-bound overlapping-timer retirement; Take-the-Initiative is reconciled without creating a fleet reminder. |
| A20 | Job/session/turn budgets and unknown spend hold admission; no refund/reset; unrelated jobs continue. |
| A21 | Strict request/evidence bindings and stale census rejection; nested cleanup links never traverse retained work. |

Existing suites `server/supervision-jobs.test.ts`,
`server/supervision-resources.test.ts`, `server/supervision-timers.test.ts` and
`server/supervision-capabilities.test.ts` remain required regression evidence.

## Rollout boundary

The captain reviews and performs rollout separately. Existing timers remain owned
by their actual owners until exact retirement evidence is accepted. Unknown native
heartbeat ownership remains an explicit U2 hold. G8 remains open until a qualified
no-follow executor, reviewed installed-version reader artifacts, N7 duplicate-cleaner
disposition and advisory receiver acknowledgements all exist.
