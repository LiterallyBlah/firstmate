# Slice 4: runtime feature policy acceptance

This PR implements only “PR 4 — apply policy while running, with fresh effect guards” from the 29 October 2026 smooth-rollout report. Captain decisions D1–D8 are accepted as recommended. The following acceptance checklist was recorded before implementation.

- [ ] Enable/disable and re-enable from two clients without plugin reload, daemon/app restart or environment edits. One clock/coordinator remains; settings reads and enablement alone wake no model.
- [ ] Disable between reservation and dispatch: undispatched work refuses at the fresh guard. A send already in flight settles exactly once, keeps spend and never retries. Reload during disable/reconcile preserves all identities and receipts.
- [ ] Project help can enable without plan execution or maintenance. Maintenance disable does not stop independent General chat. Capability dependencies are explicit and fail closed; strong qualification is unchanged.
- [ ] Existing project/source/profile/cap checks, cutover gate, exact answer outbox and scope ownership checks still run. No shared General conversation lock is added around per-project work.

Boundaries: retain one runtime/coordinator per home, one workflow clock and existing admission queues. Refuse new work when disabled; preserve settlement, resources, history, uncertainty and the committed single writer. No new setup UI, Attach path, migration/snapshot configuration, cleanup executor or strong qualification. Missing policy stays off except exact home-bound legacy compatibility. Display preferences never authorize work.

Verification evidence will be mapped here and in the PR before completion.

## Acceptance evidence

The implementation and current verification are mapped in [PR #171](https://github.com/LiterallyBlah/firstmate/pull/171). The checklist above preserves the pre-implementation record.

| Report acceptance | Regression evidence |
| --- | --- |
| Two clients hot-apply independent policy without restart, new writer or model | `server/feature-policy-runtime.test.ts`: registered read/set clients, stale CAS/exact retry, home-bound legacy compatibility, independent project/maintenance settings; one owned store and one agent through resume. Production retains the existing workflow clock. |
| Disable at the dispatch boundary; settle in-flight work and retain spend/identity on reload | Preflight-disable, policy revision, successful/lost in-flight replies, immutable origin stamp, project and maintenance partial-provisioning resume, and live capacity-reduction cases in the same suite. Read/receipt reconciliation remains enabled; uncertain sends are never retried. |
| Independent project help and General; explicit dependencies and unchanged strong gates | Project-only and maintenance-only creation/resume, ordinary General message with help off, explicit `scopeExecution`/`scopeUi` refusal; existing capability/receiver suites remain required. |
| Existing source/profile/cap/outbox/ownership/cutover checks and independent project queues | Existing project, plan, scope, maintenance, activation and effect tests; new cross-service origin guard. No per-project native call joins General's conversation queue. |

The neutral pause line is the only presentation addition. [Before/after evidence](pr4-evidence/results.json) covers light/dark at 1440×1000 and 390×844, with the old components pinned to `cb464d1`. `node docs/smooth-rollout/render-policy.mjs` reproduces eight captures under ignored `.local/pr4/screenshots/`; only deliberately selected review images are kept here. The fixture uses real components and synthetic host records, and exercises no live home or model. It checks no page exception/overflow, zero mutation RPCs and disabled creation while paused. This does not claim native-device validation or the later setup UI.

Feature policy, saved-work inventory and retained-owner projections expose the pause. Inventory remains explicitly incomplete for legacy deliveries/native reconciliation; a known scoped count never claims complete fleet coverage. Strong qualification, independent migration snapshots/retention, exact app Attach conventions and automatic-cleanup refusal remain separate guards. No public settings screen or new setup/provisioning transport is introduced by this slice.
