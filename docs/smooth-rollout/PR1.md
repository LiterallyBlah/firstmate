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

See [all before/after captures](evidence.md) and the [reproduction instructions](README.md).

| Acceptance | Evidence |
| --- | --- |
| Existing chat survives enablement, late reads, old selection, named discussion/return and reload | `chat-discussion.test.ts`, `chat-return.test.ts`; browser long-history interactions at both widths retain the draft, attached file, older page, expanded tools, scroll offset and composer focus. Remount checks retain the cached history and discard a changed epoch. |
| Ordinary fresh setup; unavailable/cross-home routes remain scoped | Fresh and UI-only captures; `chat-discussion.test.ts` refusal/remount checks, `fleet-discussion.test.ts` incomplete-address and repeated-handoff checks; S05's restored-scope browser refusal/refresh case. |
| Original checked transports and no navigation effects | No server/shared/template changes; browser interaction call logs refuse mutations and assert no ask/discuss/answer/attach/create/launch calls. Existing S05 checked scoped send/answer and uncertain/rejected-answer browser checks still pass. |
| Neutral 1/8/30-second reads, available chat, genuine failure/retry and retained warnings | `read-progress.test.ts`, pending recovery component check, startup/delayed/failure/decision-pending captures. At 30 seconds Try again uses `cancelRefetch: false`; browser assertion proves one in-flight fleet request. Quarantine/answer safety remains covered by the existing drawer and raised-card tests. |
| Fresh zero, partial lower bounds, old timestamps and all count surfaces | `needs-you-state.test.ts`, header/sidebar tests, List/Board/Drawer read-state matrix, raised-card refresh/failure check, Deck label/bubble/view tests. Plan-only lower bounds remain visible when legacy observation is off. |
| Phone composer, focus and announcement sequence | Browser return-focus/reading-position checks at 390px; compact composer overlap/newline component check; timer test verifies one polite live region with neutral → delayed → real-failure transitions. |

The visual matrix contains 96 screenshots (12 cases × before/after × two themes ×
two widths), with no page exceptions or horizontal overflow, plus two long-history
interaction checks. The original S05 and Build C browser suites also pass in all
four theme/width combinations. Impeccable's mechanical check returned no findings.

Validation: typecheck; full local suite with hosted Windows settings (`--maxWorkers=2
--testTimeout=20000`): 233 files, 3,318 passed / 3 skipped; later complete client run:
92 files, 1,120 passed, followed by focused checks for the final count changes.
Hosted CI reruns the full suite and browser harness against the submitted head.
The initial unrestricted-worker/default-five-second run timed out in unchanged
file-heavy tests; using the existing hosted Windows budget resolved those failures.
No test timeout or assertion was weakened. The existing Deck browser assertions
now require the exact recorded timestamp: Attention Deck passes 9 render cases;
Needs-you passes 40 header cases, 14 layouts, 6 task views and 4 raised-decision
cases. Their previous expectation of an undated stale legend contradicted this
slice's freshness contract.

The return cache has the existing draft lifetime: the running app, including bundle
reevaluation and view remounts. It is keyed by host/home/agent and bounded to 16
General conversations. Source history still comes from the native timeline.
Physical iOS/Android keyboard and spoken screen-reader behavior were not tested
on a device here; the evidence covers browser layout/focus, native overlap wiring,
and live-region structure/order. No live home or installed plugin was modified.
