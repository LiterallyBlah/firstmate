# Chat composer toolbar

The shared `MateChat` now keeps Bearings and Ahoy on the left, with context usage and a session-actions
overflow on the right. Labels appear when the measured toolbar is at least 400 px wide; narrow desktop
splits and phone layouts use the same rule. Full conversation, Compact and Restart live in the host
Modal pattern already used by Home's More control. Restart retains its confirmation and running/busy
guards. The host handles dismissal; cancelling Restart returns focus to the overflow trigger.

The input starts at one line and grows to 160 px, then scrolls. An inaccessible text mirror uses the
same font, line height and padding, so it shrinks after deletion or sending without textarea-height
feedback. Attach and the primary Send button sit beside each other at the bottom right of the input
frame. The shared draft, attachments, send gate and keyboard handler are unchanged.

## Screenshots

Before captures use the composer from `47e305d`; after captures use this branch. The real Chat panel,
React Native Web components and composer are rendered with synthetic host APIs. These are fixture
checks, not an installed desktop or native-device test. No plugin was installed or reloaded.

| Width | Dark before | Dark after | Light before | Light after |
| --- | --- | --- | --- | --- |
| 360 | [Before](before-360-dark.png) | [After](after-360-dark.png) | [Before](before-360-light.png) | [After](after-360-light.png) |
| 500 | [Before](before-500-dark.png) | [After](after-500-dark.png) | [Before](before-500-light.png) | [After](after-500-light.png) |
| 800 | [Before](before-800-dark.png) | [After](after-800-dark.png) | [Before](before-800-light.png) | [After](after-800-light.png) |
| 1100 | [Before](before-1100-dark.png) | [After](after-1100-dark.png) | [Before](before-1100-light.png) | [After](after-1100-light.png) |

[Overflow, dark](overflow-dark.png) · [Overflow, light](overflow-light.png) · [Home chat](home-after-dark.png)

## Verification

- `npm.cmd run typecheck`
- `npm.cmd test -- --maxWorkers=4`: 97 files passed; 1,140 tests passed, 3 skipped.
- `node docs/chat-toolbar/render.mjs before` and `node docs/chat-toolbar/render.mjs after`:
  eight captures each; one-row alignment and containment, growth/shrinkage and 160 px cap, full-chat
  navigation, Restart confirmation/cancellation and focus return, desktop Enter/Shift+Enter and
  compact Enter/Send. Additional checks resize a noncompact desktop host through 240/360/500/800 px,
  exercise running-session guards, and inspect the shared Home chat.
- `node docs/shell-phase1/check-bundle.mjs`: Paseo 0.11 compiler; client 706,213 bytes, server 354,567
  bytes; zero class tokens; RN 0.81.5 Hermes parses the complete client with default flags.
- `node docs/ship-deck-canvas/compile.mjs` then `node docs/deck-settings/gate.mjs`:
  [81 shots pixel-identical to main](deck-gate-results.json), no masks, exceptions or page errors.
  The gate compiled the toolbar changes before their first commit (so its revision field names the
  base); the only subsequent production edit explicitly matches the input/mirror font. The final
  bundle was separately compiled and parsed under Hermes as recorded above.
- Self-review: no new dependencies, transcript/native-chat/deck changes, or draft/send-state changes.
  Existing action descriptions and disabled conditions remain on the relocated buttons.

The render harness uses the existing `docs/board-list` dev tools (`npm.cmd ci --prefix docs/board-list`).
It does not claim to verify a native phone keyboard or the host's native bottom sheet.

The initial push's Windows CI hit the existing 5-second timeout in `server/update-source.test.ts:202`,
followed by `EBUSY` during fixture cleanup; Linux passed. No unrelated test or timeout was changed.
