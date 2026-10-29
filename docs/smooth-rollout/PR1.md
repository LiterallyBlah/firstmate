# Keep the chat; make the first frame trustworthy

Slice 1 of the 29 October 2026 smooth-rollout review. Home and Chat retain the
existing General transcript. Only an explicit contextual request opens a scoped
discussion. This changes no feature defaults, execution authority or Attach path.

These acceptance checks were recorded before implementation:

- Existing transcript messages, older-page access, attachments, tool disclosures,
  draft and reading position survive off → on, late scope reads, reload,
  opening/returning from a named discussion and retained old scope-UI selection.
- Fresh homes show ordinary FirstMate setup, not an unknown recipient plus two
  composers. Explicit unavailable/cross-home scoped routes keep their own
  draft/target and never fall back to a General send.
- General uses the existing checked sender; scoped sends/answers use their
  original transports. Navigating and toggling presentation creates no agent,
  writer or message.
- Hold initial decision/fleet reads for 1, 8 and 30 seconds: neutral loading, no
  `!`, no invented zero, usable navigation and available transcript. Reject a
  read: show a real retryable failure. Corrupt/quarantined inputs retain their
  warning/hold.
- Complete fresh empty results may say zero. Partial and old results keep
  lower-bound/as-of semantics. Test all count surfaces, phone keyboard/composer
  behavior, focus return and screen-reader announcement order.

## Scope

Preserve the native transcript, checked senders, exact scoped targets, uncertain
outcomes, quarantine warnings and lower-bound counts. Pending query state works
without the later bounded-read service. No setup wizard, settings policy,
administrative section redesign, enablement or server runtime change belongs here.

## Evidence

Implementation checks and before/after captures will be mapped here and in the PR.
Browser fixtures do not establish native device or screen-reader behavior.
