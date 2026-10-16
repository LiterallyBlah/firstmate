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

The carrier's pack anchor is `[100,274]`, in the foreground sea below the forward hull. This is near the
reviewed `[100,304]` alternative, moved up 30 logical pixels so the complete target plus loiter stays
inside the existing fit at wide aspect ratios. The hull, island, camera, layout and image data are unchanged.

Sakura opts into `carrier-surface@1`: row 29 cuts across the body, preserving the dorsal fin and upper
back. The lower 15 rows are deep blue at 22% opacity, with a thin pixel ripple crossing the waterline.
The ripple, swim frames and loiter share the existing `water` clock and freeze together in lite/reduced
motion. The marker and suggestions stay above water. The original sprite supports this split cleanly;
no generated or edited art is needed. Ship's deck has no surface setting and keeps its drawing and motion.

Waterline close-ups: [day](review/waterline-day-close.png), [night](review/waterline-night-close.png).
Moving frames: [one](review/waterline-moving-0.png), [two](review/waterline-moving-5.png),
[three](review/waterline-moving-10.png). [Runtime motion assertions](review/waterline-full-checks.json)
verify crop registration, attachment, swim/ripple changes and reduced-motion freezing.

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

- Full suite: 93 files, 1,103 passed, 3 skipped (`npm.cmd test -- --maxWorkers=2`).
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
  crew shots; the Ship's deck pack positions, motion and image data remain identical. Focus uses the same camera.
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
$env:WATERLINE_REVIEW='1'
node docs/deck-settings/render.mjs '?setting=japanese-ship'
Remove-Item Env:WATERLINE_REVIEW
$env:SAVE='1'
node docs/deck-settings/gate.mjs
```

“Before” uses the compiler's pinned main bundle and that commit's original pack manifest, with the
unchanged images. The exact gate hashes cover full screenshots; no masked regions or tolerances.
Day/night captures remount at the requested hour and assert the canvas sky phase before capture.
