# Slice 8: contextual discussion and plain shared decisions

## Scope

Implement only PR 8 of the captain-approved smooth-rollout report (29 October 2026). D5 keeps Home on the original FirstMate transcript and opens an explicit named conversation with Back to FirstMate. Preserve captured targets, owner epochs, per-recipient drafts, first-send checks and checked outboxes. Maintenance and unqualified remote conversations remain read-only. No new Attach, provisioning, policy enablement, migration or authority path.

## Acceptance checks (recorded before implementation)

- [ ] Switching recipient, returning from a decision, restoring a scoped draft after reload, and a failed scope read preserve the captured send target. General and owner drafts/history remain separate and recoverable.
- [ ] Optional @recipient/#context syntax shows its actual resolved recipient before sending. Ambiguous/unsupported addresses refuse and retain the draft.
- [ ] Filters show human project/plan names, make no mutation/model turn, retain the global total and unknown quarantines. Coming up/setup never enter counts; missing sources retain lower-bound/unknown semantics.
- [ ] Backlog/plan, scoped plan and maintenance answers use their existing origin-specific services and current revision/subject/evidence. Changed subjects refuse; lost replies remain disabled and reconcile the original answer before navigation.
- [ ] New discussion creation gets a concise review before the first effect. Loading an empty thread creates nothing. Maintenance/remote routes remain read-only with useful conversation/original-host navigation.
- [ ] Both themes at 1440×1000 and 390×844: before/after evidence, plain copy, 44px controls, keyboard/focus and wrapping checks. Exact diagnostic/provenance information remains in Details.

## Validation and evidence

Pending implementation. The component harness will use synthetic host/RPC data only and write generated artifacts under ignored `.local/smooth-pr8/`.
