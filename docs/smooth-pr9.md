# Optional plan help (smooth rollout, slice 9)

## Acceptance checks recorded before implementation

- [x] An updating legacy plan keeps its current owner/history until an explicit reviewed handover completes. Selecting or viewing Plan help neither migrates nor attaches.
- [x] The complete supported setup can be performed without environment edits or restart, including snapshot/retention configuration. Invalid backup location/retention remains held with an understandable in-app correction.
- [x] Prepare/resume/barrier/commit/abort and answer holds retain existing rules, byte-for-byte history and immutable audits. No second writer, budget reset, new supervisor identity or unverified claim of authenticated captain identity is introduced.
- [x] A lost create/opening response resumes the same attachment; active verified opening is required before labeling the helper ready. Unsupported strong capabilities remain refused.

## Boundaries

Only slice 9: contextual plan-help review, in-app independent snapshot/retention configuration, and the existing checked S07 handover and dedicated captain Attach review. Viewing creates nothing. No automatic handover, attachment, new attachment transport, budget increase, stronger capability claim, project setup, routine-check setup or introduction. The captain accepted D1–D8 on 2026-10-29; rollout remains opt-in. RPC provenance remains unverified.

## Verification

| Acceptance | Evidence |
| --- | --- |
| Viewing leaves ownership/history intact | `client/plan-help.test.ts` checks read/review/cancel have no mutation. `server/supervision-activation.test.ts` verifies guided preview leaves the journal sequence unchanged, handover causes no receiver calls, and the original event bytes remain identical. |
| Complete app path; hot backup setup; actionable invalid settings | `server/migration-settings.test.ts` checks inert reads, persistence/reload, home binding, exact-request replay, two-client CAS, bad paths/retention, a junction alias and corruption. The production-component browser walkthrough saves backup settings, supplies reviewed evidence and confirms prepare/check/barrier/commit, then opens the existing Attach review. Invalid settings retain the draft and offer a fresh correction review. No environment change or restart is used. |
| Existing S07 safety | Existing migration, recovery, gate and answer-hold tests remain unchanged apart from listing the three added app RPCs. New guided tests hold changed backup/source and incomplete decision inventory before freeze. A simulated interruption between freeze and prepared receipt retains the exact preparation and a named app recovery entry; a new runtime resumes the same scope/migration, with no attachment or receiver effects. |
| Exact attachment recovery and truthful readiness | Existing Attach component and production recovery tests retain original profile/opening/request identity after lost create/opening replies. New readiness tests require an active binding, successful opening and a readable snapshot. Only `SupervisionActivationBoard` still calls `AttachConfirmation`; the new review calls no Attach transport. Existing strong-capability tests remain the refusal gate. |

The supported guided handover requires one unambiguous admitted project, its current checked permission sources and a fresh decision inventory. Missing qualification is explained and held; it is never manufactured by an evidence checkbox. Multi-project/host ambiguity stays with specialist review. Existing project setup is a separate slice. Plan help never creates a project or imports permission authority. Reviewed delivery-inventory, rollback-build and policy-import references stay explicit, under Handover evidence; the existing S07 inventory and barrier independently recheck real deliveries.

Backup settings use strict immutable home-bound revisions, exclusive publication, CAS and exact request/body replay. Legacy backup environment configuration is retained only for its original home until an explicit app save. Saved settings apply on the next capture/verification without restart. Every production handover requires a verified independent backup, including a partially enabled pilot. Changing a folder or retention during a saved handover holds continuation until its original verified evidence is restored; no snapshot is moved, deleted or silently accepted under a different policy. Retention remains operator-managed; there is no automatic deletion or restore.

The existing S07 importer, single-writer gate, answer-hold authorization, audits, scope/session budget and strong qualification are unchanged. Frozen-plan navigation metadata is read-only and never enters Needs-you, Coming up, work cards or counts. App action provenance stays unverified. No live daemon/home was changed. Automated browser checks establish the app path, browser keyboard focus and layout, not a human usability observation or native screen-reader validation; those remain slice 10 release checks.

Focused typecheck, regression, browser and full-suite results are recorded in the PR. The known intermittent Windows `server/launch-tool.test.ts` flake did not occur in the first full local run (246 files, 3,424 passed, four skipped). A final full run follows the recovery/navigation tests added during self-review. Hosted Linux/Windows and visual checks are the merge gate.

## Visual evidence and copy

| Theme / width | Before → after | Review, blocked setup, handover, Attach and 200% text |
| --- | --- | --- |
| Light desktop | [Comparison](smooth-pr9/evidence/light-desktop-comparison.png) | [Reviews](smooth-pr9/evidence/light-desktop-reviews.png) |
| Dark desktop | [Comparison](smooth-pr9/evidence/dark-desktop-comparison.png) | [Reviews](smooth-pr9/evidence/dark-desktop-reviews.png) |
| Light phone | [Comparison](smooth-pr9/evidence/light-phone-comparison.png) | [Reviews](smooth-pr9/evidence/light-phone-reviews.png) |
| Dark phone | [Comparison](smooth-pr9/evidence/dark-phone-comparison.png) | [Reviews](smooth-pr9/evidence/dark-phone-reviews.png) |

Baseline `9c3485e8` is read through `git show`, without changing the checkout. Eight original Plans screenshots are beside the comparison sheets. `node docs/smooth-pr9/render.mjs` produces 44 component captures/assertion cases using a synthetic host, validates no writes on view/cancel, checks the entire reviewed handover, verifies no Attach calls, and checks 44px targets, phone wrapping, 200% text and focus return. `node docs/smooth-pr9/contact-sheets.mjs` produces the committed review sheets. Bundles, per-case text/RPC logs and captures stay under ignored `.local/smooth-pr9/ui/` and are uploaded by CI.

Ordinary copy uses Plan help, plan helper, backup and handover. Identity, scope/version, migration controls and audits remain behind Attachment details or Advanced work details. The creation review names the actual selected model and permission mode; its warning explains that Paseo cannot verify who pressed Attach. Only a verified successful opening is called ready. No capacity, plan-budget or cleanup promise is added.

Single biggest slowdown: preserving an accessible exact-request recovery path while S07 temporarily removes a frozen plan from the ordinary Plans projection.
