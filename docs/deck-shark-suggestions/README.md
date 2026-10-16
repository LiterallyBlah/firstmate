# Shark suggestions

The shark opens the same suggestions as List/Board, in file order. Each speech bubble shows its label
and full prompt and calls the existing `onReply` → `suggest` → `useMateSender` path. Sending returns to
Home chat. There is no new RPC. The shared send/removal gates disable unavailable choices; answered
entries remain visible and disabled until the file changes, and a failed send restores the entry.
Sailors retain their own markers, linked reply bubbles and click-to-focus.

The shark stays with an empty list or no crew. Its baked-in `...` marker is hidden using the pack's
`bubbleHeight` crop metadata; clicking its body still opens “Nothing to suggest right now.” The list
scrolls inside the canvas and closes on outside click, Escape, its close button or another shark click.
The legend's Suggestions button provides the keyboard route.

## Sakura coast position

Only the carrier's pack anchor moves: `[14,273]` → `[8,164]`, into open water ahead of the bow and clear
of the bow rope. Size, frames, loiter, hull, island, crew layout and motion are unchanged. No PNG changes.
Ship's deck retains its positions and art; its pack adds only marker crop metadata and a version bump.

| View | Before | After | Open bubbles |
| --- | --- | --- | --- |
| Day, 900 | [Before](review/japanese-ship-before-day-900.png) | [After](review/japanese-ship-after-day-900.png) | [Bubbles](review/japanese-ship-after-day-900-bubbles.png) |
| Night, 900 | [Before](review/japanese-ship-before-night-900.png) | [After](review/japanese-ship-after-night-900.png) | [Bubbles](review/japanese-ship-after-night-900-bubbles.png) |
| Day, 640 | [Before](review/japanese-ship-before-day-640.png) | [After](review/japanese-ship-after-day-640.png) | [Bubbles](review/japanese-ship-after-day-640-bubbles.png) |
| Night, 640 | [Before](review/japanese-ship-before-night-640.png) | [After](review/japanese-ship-after-night-640.png) | [Bubbles](review/japanese-ship-after-night-640-bubbles.png) |

## Interaction frames

Sakura coast: [shark and open list](review/japanese-ship-after-01-click-shark.png) →
[pick returns to Home chat](review/japanese-ship-after-02-picked.png) →
[answered on reopening Deck](review/japanese-ship-after-03-answered.png).

Ship's deck: [shark and open list](review/ship-after-01-click-shark.png) →
[pick returns to Home chat](review/ship-after-02-picked.png) →
[answered on reopening Deck](review/ship-after-03-answered.png).

Also captured: [empty list](review/japanese-ship-after-empty.png) and
[scrolling 24 long suggestions](review/japanese-ship-after-long-list.png).
The chat transcript is fixture content; the harness asserts the exact outgoing `firstmate.mate.ask`
payload, rather than pretending a live agent responded.

## Verification

The real compiled plugin, Pixi renderer and pack RPC reader run in headless Edge; only host APIs and
the fleet are fixtures. This is not an installed desktop/device test. No plugin reload or install occurred.

- Full suite: 93 files, 1,101 passed, 3 skipped (`npm.cmd test -- --maxWorkers=2`). The first unrestricted
  run competed with browser captures and hit watch/update timing failures; both pass with two workers.
- Typecheck and pack lint pass. Package dry run includes both packs and excludes docs/tests.
- Paseo 0.11 compiler and Hermes pass; Pixi remains served, not bundled.
- [Sakura coast interaction assertions](review/japanese-ship-checks.json) and
  [Ship's deck interaction assertions](review/ship-checks.json): order, bounds, keyboard, dismissal,
  send payload, pending gate across mounts, failure toast/retry, answered state, scrolling and empty state.
- Screenshot gate results and the 81 exact reviewed pairs are recorded in `../deck-settings/`.
  Every pair was inspected with `review-gate.mjs` (main, branch, red pixel differences). Changes are the
  suggestion footer, restored sailor markers and persistent shark. Where the old footer was shorter
  (one or no worker needing attention), the new persistent control changes the canvas height and its
  existing responsive fit. That accounts for broad pixel differences in busy/idle/stale/storm and later
  crew shots; pack positions, motion and image data remain identical. Focus still uses the same camera.
  All canvas renderer/motion/weather/sky metadata matches main; no page errors.
- [Pack audit](art-audit.json) proves that all 104 images and all remaining manifest fields are unchanged.

Reproduce from this worktree (PowerShell):

```powershell
npm.cmd ci
npm.cmd ci --prefix docs/board-list
npm.cmd run typecheck
npm.cmd test -- --maxWorkers=2
npm.cmd run lint:deck-packs
npm.cmd pack --dry-run
node docs/ship-deck-canvas/compile.mjs
$env:SHARK_REVIEW='before'
node docs/deck-settings/render.mjs '?setting=japanese-ship'
$env:SHARK_REVIEW='after'
node docs/deck-settings/render.mjs '?setting=japanese-ship'
node docs/deck-settings/render.mjs '?setting=ship'
Remove-Item Env:SHARK_REVIEW
$env:SAVE='1'
node docs/deck-settings/gate.mjs
```

“Before” uses the compiler's pinned main bundle and that commit's original pack manifest, with the
unchanged images. The exact gate hashes cover full screenshots; no masked regions or tolerances.
