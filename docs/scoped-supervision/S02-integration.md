# S02/S03 branch integration and Windows qualification

This normal merge retains accepted S02 head `2ac5979ccbe1a171d2e0ae51b506404328ac5f14`
and fetched main/S03 merge `b02540b9041fc68672f75120c2f5eed685732b3a` as its parents.
It does not land the branch. Independent integration review is required before landing.
The original S02, R02 correction and S03 reports/receipts remain unchanged historical evidence.
The [integration receipt](s02-integration-validation.json) binds current source/tests and preservation.

## Conflict resolution

Only `server/supervision-store.ts` and `shared/supervision.ts` conflicted. Both import sets and
both sets of row kinds are retained. The combined status includes inbox and policy/decision/outbox
projections. S02's replay validation, pending ceiling, ownership checks and source/disposition
invariants remain in S03's extracted commit path; S03's command replay, checked preparation,
policy rows and decision/outbox invariants remain intact.

One composition defect required an explicit fix: `transactCommand` could reach the shared commit
without S02's inbox request-ID check. A [regression](../../server/supervision-integration.test.ts)
first published a mismatched inbox replay marker when it should have refused. Its
[failing receipt](s02-integration-evidence/marker-red.json) is retained. The shared commit now checks
the marker before publication. A positive mixed-journal control retains command replay, explicit
mailbox handling and watermark 1 without reauthorizing accepted work or changing store bytes.

## Retained Windows failures and causal limits

Accepted-head push run 40142118090 failed twice: 7 then 3 assertions. Both failed the first
`tip:written` generation assertion; workflow-close tests timed out, followed by dependent-state or
duplicate-plan errors. The same head's PR run 40142121386 passed. All 13 R02 checks passed in each.
The original reports/logs and hashes remain under `.local/s02-r02/`; they are not replaced.

The crash fixture checked empty stdout and nonzero exit, then assumed the child had claimed a
coordinator and reached the requested kill point. That premise was not observed. The retained
[Windows counterfactuals](s02-integration-evidence/counterfactuals.json) distinguish three cases:

* Removing SystemRoot before Node bootstrap aborts Node crypto initialization, with no coordinator;
  the parent correctly claims generation 1. This disconfirms treating all early exits as OS-probe refusals.
* Removing it after Node bootstrap isolates the actual identity-probe refusal: child exit 2,
  `UNSUPPORTED`, no coordinator, then parent generation 1.
* The healthy control kills at `tip:written`, retains coordinator 1 and lets the parent claim 2.

These reproduce the misleading assertion through different early-exit causes. **The historical CI
child stderr was not reported, so its exact early-exit reason cannot be recovered or attributed to
either counterfactual.** In particular, a 5-second OS-probe timeout is not established as that cause.
The old failures are not labelled harmless or treated as valid recovery qualification.

The child now reports the exact boundary over fixture IPC and waits for the parent's acknowledgement
before SIGKILL. Every publication/backend crash case requires that observation and empty stderr
before evaluating the original recovery assertions. The new negative control rejects a pre-claim
identity refusal as a target crash. Actual OS identity checks and real child-process deaths remain
in the positive cases. No production process probe, generation assertion or timeout was weakened.

The workflow helper's separate defect was reproduced using its exact extracted functions: pause A
after its first draft, reassign its global store to B, then resume. A remains planned while B becomes
done. Capturing the store reverses that result: A finishes and B remains planned. The helper source
fingerprint is [retained](s02-integration-evidence/helper-source.json). Timeout does not cancel an
arbitrary promise, so the original globals let expired cases issue later commands against the next
case. Fixtures now capture their own context, stop issuing commands after their test signal aborts,
and drain in-flight commands before teardown. Delayed and aborted controls use real temporary
workflow stores; B remains untouched in both. All ten original workflow assertions remain.

Both failed CI files overlapped the CLI workflow test at the failed close cases; the passing PR
close cases did not. Retained reports show three simultaneous test files. This supports contention
as a timing contributor, but does not prove the historical child-exit cause. CI now declares the
same **two-worker file budget** used by local qualification, rather than a CPU-derived default.
This is a recorded qualification envelope, not a timeout increase or a claim that arbitrary load
is supported. The 5-second test/probe, 20-second child and 30-second crash limits are unchanged.

## Validation and boundaries

Typecheck and the uninvoked CJS server import pass. The affected run passes **191 tests in 13 files**,
including S02 ingress/inbox/R02 controls, S03's 39 policy/command cases, shared journal ownership,
actual Windows crash qualification, workflow isolation and mixed-entry-point controls. The full suite
passes **2,551 tests with three skipped, in 172 files**, with the receipt-journal environment enabled
at invocation to exercise the existing test-home override. Raw-report digests are in the integration receipt. Tests use isolated temporary homes,
existing dependencies and supported APIs; fixture-only IPC adds no product sender or observer.

Self-review compares both parents, every conflict and the additional qualification diff. All unique
accepted S02 and S03 source/report files are byte-preserved except the explicitly composed store
and shared contract. Old failure receipts remain retained. No reset, rebase, force push, default-branch
merge, install/reload, activation, live routing/watch change, provider call or history migration is
performed. Both features remain disabled. New exact-head CI is separate evidence and cannot erase
the historical failure or establish authentication, receiver fencing or a live pilot guarantee.
