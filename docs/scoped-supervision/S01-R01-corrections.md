# S01: bounded R01 ownership corrections

R01-1 and R01-2 are corrected in the builder's source for renewed independent narrow review.
This report is implementation evidence, not independent acceptance or authority to land/activate.
PR #144 remains the delivery. Its immutable delivery head and the normalized source/test digests in
[the correction receipt](s01-r01-validation.json) identify the exact reviewed correction candidate.

## Inputs and preservation

The correction base is `7139feb970e7dc4bc822793394fcf82c24fc61c0`, the exact R01-reviewed head.
The existing `fm/fm-ss-s01` worktree was continued without reset or rebase. The original S01 receipt,
R01 report, retained counterexamples and corrected S00 artifacts remain preserved.

| Input | SHA-256 |
| --- | --- |
| R01 `report.md` | `8b53ec7bda06b1028ed0c833ad654bc3b06b1b82696ea67411c3a4c71872b536` |
| Accepted corrected S00 manifest | `343444b790d0f8ad17b6458f804b65f564f083b6825536ef72d4f04034a7b135` |
| Accepted corrected S00 report | `d8b3ead73fde15bca210db3944ca00cb0687471e957298342c8e969ff6045a80` |

`test/fixtures/supervision-r01/counterexamples.json` derives the exact mutation batches from the
retained duplicate-worker, foreign-attempt and distinct-host journals. It records ten original
input-file hashes. Only `Scope.homeId` is rebound to a fresh temporary test home; the retained IDs,
worker/host values, relationships, epochs and other payload fields remain the probe inputs. The
reviewer's files and fixtures are never reused as writable test stores.

## R01-1: one current task owner per worker

The completed next projection now indexes each assigned worker of a task's `currentAttempt` by
`(host.trim().toLowerCase(), opaqueAgentId)`, matching existing host normalization. A second task
claiming that identity refuses with `CONFLICT` before any publication. Workspace differences do not
make one host/agent a different worker. The check covers insertion, later assignment, both mutation
orders, and multiple assignments within one transaction. It also covers different tasks in the
same scope. Task state alone does not silently release the current ownership claim.

Historical attempts are retained rather than added as competing current owners. Same-task
promotion may advance the current pointer while preserving prior attempts, worker identities,
spend, effect rows and reservations. The same agent ID on distinct hosts remains independent.
No implicit ownership transfer, resource release or future migration exception is introduced.

## R01-2: all attempt-bound effects have the task's scope

Every effect with an `attemptId` now resolves effect → attempt → task and requires
`effect.scopeId === task.ownerScopeId`. This applies to non-launch effects as well as launch effects,
regardless of whether a worker has been assigned. Missing references or a foreign owner refuse with
`CONFLICT`. Same-scope non-launch effects can still name a current or retained historical attempt.

These are final-projection checks in the existing pre-publication validation seam, also reused by
replay. They grant no caller/command/approval authority. Separately checked transfer/migration
protocols remain future work; no historical data or ownership is silently rewritten to bypass a
refusal.

## Verification

- Before the runtime fix, the 15 new regressions produced **12 expected refusal failures and three
  passing controls** against the reviewed source. The retained contradictions were reproduced.
- After the fix, **15/15** regressions pass. Each refusal compares the entire store's file bytes and
  the full projection before/after, then reopens through a fresh read-only store. Companion scope
  edits, effect reservations, tips, events, publication markers and temporary files remain absent
  or unchanged on refusal.
- **243/243** affected S01 tests pass across six files, including existing historical parity,
  coordinator, crash/publication and strict corrected-contract cases. Typecheck passes under
  Node `v24.18.0`.
- The full repository suite passes: **2,450 tests passed, three skipped, 166 files**, run alone with
  `--maxWorkers=2`. The initial overlapping full/affected run had one unchanged legacy
  `workflow-close-review` case exceed its existing 5,000 ms limit. That file then passed **10/10**
  in isolation (the timed-out case took 336 ms); no test/timeout change was made. Both the initial
  failure and successful controls are retained in the correction receipt.
- The correction receipt records full-suite results and raw test-report hashes. The existing
  Windows/Ubuntu CI jobs retain full-suite JSON alongside their render evidence; PR #144 links
  the successful run for the exact delivery head before handoff.

Only `server/supervision-store.ts` changes runtime behavior. New code is limited to the two index
relationships. The remaining changes are retained-input fixtures, regression tests and review
evidence. Feature wiring remains off. No schema, executor, dispatch, caller authentication, receiver
fencing, charter, live history, routing, installation, reload, provider call, delegation or merge is
added or performed. Renewed independent R01 review remains required before landing.
