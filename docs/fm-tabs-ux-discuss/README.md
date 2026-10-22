# Decision discussion handoff — audit finding 1

The 22 October tabs audit at `d94082c28a677da17b514f4019928b3f99fc8d04`
identified Home's Discuss first callback closing the selected decision and opening
`firstmate-chat` with an empty composer (audit S07–S10). The fresh component
regression failed on that callback before implementation: expected no tab navigation,
received `openView("chat", "home")`; the other 32 drawer tests passed.

Home now unfolds its own chat and retains the decision. Compact Home shows First
mate with a return-to-decision action; returning and then closing the drawer restores
the previous compact destination. Chat handles discussion locally, docking its drawer
at 1,100 points and above. Transcript, composer and drawer content are capped at 760
points. Views without chat open Home through the public screen-params API.

The discussion carries home, request, record revision and mate identity. Preparing an
empty per-mate draft happens once per discussion, without changing existing words or
attachments. Nothing is sent. Preparing and returning check the current snapshot;
changed, absent, settled, stale or wrong-mate references cannot prepare or resume an
answer. The stale reference can be dismissed. Uncertain-delivery chat inspection
continues to work without preparing another answer. Open Board for unreadable holds
selects and reveals Home's Board instead of creating another Board workspace tab.

Self-review covered the complete diff: only client navigation/state/presentation,
focused regression tests, the render assertion for the new Board destination and
this evidence note. The contextual panel adapters ignore
their return-focus argument when invoking the extended Home navigation callback.
There are no new server mutations, native-tab APIs, sidebar policy changes or sends.

Verification:

- Affected tests: decision drawer/discussion, actual Home state with child chat stubbed,
  actual MateChat/GrowingChatInput with synthetic dependencies, workspace registrations,
  Needs-you state and shell. Widths 390, 900, 1,099, 1,100 and 1,440 are driven by
  component layout events. These are state and callback tests, not browser layout proof.
- `npm.cmd run typecheck`.
- `node docs/shell-phase1/check-bundle.mjs`: Paseo compiler 0.11.0 and RN Hermes parsing.
- No local full suite: the captain's 12 October standing rule specifies affected
  tests, typecheck and repository CI for this UI batch. CI configuration is unchanged.

The first CI push run caught a frame/content mistake in this change: the drawer's
outer cover had been capped at 760 points. The existing geometry assertion expected
the whole 900-point pane. The cap now applies to scroll content while the outer cover
keeps its full pane width. That geometry assertion and all check limits are unchanged; the
original failure is retained in `.local/tabs-discuss/ci-push-failure.log`.

The old Open Board render assertion expected the standalone Board heading. It now
requires Home's header, the selected Board tab, the visible task board and a closed
decision drawer. All subsequent repair/answer assertions and timeouts are retained.
The Board handoff also records the compact tab before the first width measurement:
a fresh narrowed Home must show Board even if its previous session showed chat.
That case was reproduced with the real Home component before the fix.
One Windows CI run timed out at 5,000 ms in the unchanged server workflow-board
"missing interior" case (2,114 other tests passed). The exact same test bytes and its
server/shared dependencies are unchanged from the base; the isolated case passes on
both an archived base and the current head. Logs and matched SHA-256 evidence remain
in `.local/tabs-discuss/`. No timeout or server code was changed.

Fresh visual verification is **pending**, deferred by the captain until later rather
than waived. Paseo `browser_new_tab` returned structured
`browser_no_host` / `No browser automation host is connected.` twice, and again on the
single fresh attempt authorized after desktop connection was confirmed. No tab was
created. No Playwright fallback was used. The unchanged audit screenshots are baseline
evidence only; they do not verify this implementation. Wide/phone light/dark checks,
including the real Paseo palettes, still need capture. Native tab creation/focus,
native phones and installed-daemon behavior remain unverified.

Ignored local evidence is preserved under `.local/tabs-discuss/` (before failure,
affected checks, typecheck, bundle and exact capture failure). The audit worktree's
original `.local/tabs-review/` and its screenshots are untouched. Its copied preview
in this worktree bundles the current real components with synthetic host APIs:
`node .local/tabs-review/serve.mjs 48843`. It makes no daemon calls or real sends.
No plugin was installed/reloaded and Paseo was not restarted.
