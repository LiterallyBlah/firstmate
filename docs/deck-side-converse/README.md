# Deck conversation evidence

The `!onDeck` docking exclusion and conditional replacement of `deckScene` were the cause.
Converse and Steer now open the same panel beside Deck at 680 points or wider. At narrower
widths, including Home's phone Deck, an absolute overlay leaves the canvas mounted at its
existing dimensions. The covered scene is inert. Escape, close and Deck return to the same
canvas and focused sailor. The scene keeps animating beside a docked conversation.

The deck's document keyboard listener yields while Converse is open. It also ignores handled
events: otherwise the Escape that closes the drawer can reach the listener just reattached
by that close and dismiss the sailor's focus too.

Worker replies use the existing chat Markdown, code copy, message copy, local image reader
and image viewer. Earlier history uses `useAgentTimeline.loadOlder` with the shared prepend
scroll anchor. Worker image paths resolve from its cwd inside its registered workspace,
with host/workspace validation and the existing server containment and size limits. A missing
worker identity cannot reinterpret an image relative to the first mate's home.

The composer shares MateChat's extracted `GrowingChatInput`, including its wrap measurement,
shrink behavior and 160-point cap. Delivery still uses the existing local/remote steer RPCs;
the first mate's burst relay and recipients are unchanged. The shared permission card and
Conversation/Activity modes remain. Remote conversations remain text logs.

**Open in its own tab** calls the existing native `navigation.openAgent` action. A second
FirstMate conversation tab would duplicate native chat capabilities. The tooltip explains that
messages sent in the native tab are not relayed by the drawer. The Deck panel stays open.

## Screenshots

All shots use the real React Native Web views and Pixi engine with synthetic host APIs.
These are fixture checks, not an installed desktop or native-device test. No plugin was
installed or reloaded, and no art pack was edited. Before uses commit `b1458b4`.

| Scenario | Light | Dark |
| --- | --- | --- |
| Before: Converse replaces Deck, 1440 px | [before](before-wide-light-conversation.png) | [before](before-wide-dark-conversation.png) |
| After: Converse beside Deck, 1440 px | [after](after-wide-light-conversation.png) | [after](after-wide-dark-conversation.png) |
| Narrow overlay, 650 px | [overlay](after-narrow-light-conversation.png) | [overlay](after-narrow-dark-conversation.png) |
| Narrow return to retained focus | [back](after-narrow-light-back.png) | [back](after-narrow-dark-back.png) |
| Home phone overlay, 390 px | [overlay](after-phone-light-conversation.png) | [overlay](after-phone-dark-conversation.png) |
| Home phone return | [back](after-phone-light-back.png) | [back](after-phone-dark-back.png) |
| Relaunch stays in the focus card | [relaunch](after-wide-light-relaunch.png) | [relaunch](after-wide-dark-relaunch.png) |
| End confirmation stays in the focus card | [end](after-wide-light-end.png) | [end](after-wide-dark-end.png) |

## Verification

`node docs/deck-side-converse/render.mjs` covers ten scenarios: wide Deck, narrow Deck, phone
Home Deck, List and Board in both themes. It asserts canvas identity through open/close,
Escape, back, Steer, Interrupt, Relaunch and confirmed End; retained sailor focus and drafts;
resize between dock and overlay; live animation beside the panel; growing/shrinking input;
earlier history, copy controls, inline image routing, permissions, Conversation/Activity,
native agent navigation, remote logs/steers and no page errors or horizontal overflow.
Results are in [after-results.json](after-results.json). `render.mjs before` captures the base.

`mate-regression.mjs before` and `mate-regression.mjs after` measure MateChat at 360, 500, 800
and 1100 px with empty, multiline, capped and cleared drafts. The two measurement JSON files
are identical. The old `docs/chat-toolbar/render.mjs` assertion that the empty input is one
line at 360 px is stale: the base's long placeholder also wraps to 60 points there. That
existing first-mate behavior is preserved. Converse starts at 40 points in the tested widths.

Typecheck passes. The full suite passes with `npm.cmd test -- --maxWorkers=2 --testTimeout=30000`:
101 files, 1181 tests passed, 3 skipped. The initial unrestricted run hit short timeouts under
concurrent machine load; the bounded run covered the whole suite. A subsequent run alongside
the pixel gate passed 1180 tests but hit the existing PR-watch 400 ms budget assertion
(`server/pr-watch.test.ts:241`, empty saved batch instead of four URLs). That loaded-machine
run is retained in [tests.log](tests.log); no unrelated watch code or test threshold was changed.
Paseo 0.11's production compiler and Hermes parse pass; no Pixi or class syntax enters the
client bundle. See [compile-results.json](compile-results.json).
