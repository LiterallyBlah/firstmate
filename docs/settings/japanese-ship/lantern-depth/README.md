# Sakura lantern depth

The three chochin sorted at row 245, ahead of sailors whose feet were farther
back on the deck. Only their depth rows change: 223, 223, 228. The first two
precede the open deck's minimum row 224. The stern lamp sorts just above the
shelter's row 228 (lights have the existing fractional tie break) and behind
the sailors standing in front of it at row 229 or greater. Keeping that lamp
above the shelter avoids hiding its approved position in the roof/wall art.
The hull-front starts at y=247, below the lamps; its foreground depth is unchanged.

Positions, glyphs, glow, flicker, seeds, motion policies and day/night settings
are unchanged. The generator records the same depth values. Ship and Sky pirates
are untouched, as are all engine files and PNG assets.

## Review evidence

Real compiled-client Edge captures, using the existing fixture host and public
DOM metadata, against main `96d5914`. No Pixi observer or renderer patch is used.
Every pair uses the same cards, time, viewport and reduced-motion setting.

| Lamp / overlapping crew | Day before | Day after | Night before | Night after |
| --- | --- | --- | --- | --- |
| Bow / blocked | [crop](before/day-blocked-chochin-0.png) | [crop](after/day-blocked-chochin-0.png) | [crop](before/night-blocked-chochin-0.png) | [crop](after/night-blocked-chochin-0.png) |
| Middle / working | [crop](before/day-working-chochin-1.png) | [crop](after/day-working-chochin-1.png) | [crop](before/night-working-chochin-1.png) | [crop](after/night-working-chochin-1.png) |
| Stern / waiting | [crop](before/day-ready-chochin-2.png) | [crop](after/day-ready-chochin-2.png) | [crop](before/night-ready-chochin-2.png) | [crop](after/night-ready-chochin-2.png) |

Full scene: [day before](before/day-ready.png), [day after](after/day-ready.png),
[night before](before/night-ready.png), [night after](after/night-ready.png).
The other states have full scene captures alongside these files.

`posts/` on each side repeats the captures with all authored open-deck posts
occupied: three bow, seven rigging (including lookout), three stern. Its idle
scenario is an empty deck, visibly retaining all three lanterns at day and night.
Those empty-deck frames are pixel-identical before and after, as are the 24-sleeper
frames. [Pixel audit](audit.json) records every full-frame difference and its bounds;
the only changed regions are lantern/sailor overlaps. The audit also asserts the
entire manifest equals main except for the three intended row values.

[Pointer results](after/checks.json): 192 successful actual clicks, covering 24
workers in each of blocked, working, waiting and idle states, at day and night.
Each opens its own named details panel. Positions are resolved with the existing
pure crew geometry, and clicks go through the real rendered canvas.

Validation: pack lint 66/66; typecheck; full suite 1,155 passed and 3 skipped
across 97 files. Paseo compiler and React Native 0.81.5 Hermes pass for both main
and branch, with zero bundle growth. [Ship gate](../../../deck-settings/gate-results.json):
81/81 pixel-identical to main, including still, full-motion and software-renderer
scenarios, with no exceptions. Ubuntu and Windows CI passed. This is browser fixture evidence, not an
installed plugin or physical-device session.

## Reproduce (PowerShell)

```powershell
node docs/ship-deck-canvas/compile.mjs
$env:SAKURA_LANTERNS='before'; $env:SHARK_REVIEW='before'
node docs/deck-settings/render.mjs '?setting=japanese-ship'
$env:SAKURA_LANTERNS='after'; Remove-Item Env:SHARK_REVIEW
node docs/deck-settings/render.mjs '?setting=japanese-ship'
# Repeat both passes with SAKURA_LANTERN_POSTS=1 for authored posts / empty deck.
node docs/settings/japanese-ship/lantern-depth/audit.mjs
npm.cmd run lint:deck-packs
npm.cmd run typecheck
npm.cmd test -- --maxWorkers=1
node docs/deck-settings/gate.mjs
```

No plugin installation, reload or merge was performed.
