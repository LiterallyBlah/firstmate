# Installed office review

The final pack is `art/settings/office/setting.json` and 26 PNGs, **168,155 image bytes**. Every PNG is
byte-identical to the commissioned delivery under `docs/settings/office/art/`, its manifest digest and
`verification.json`. No engine code or art pixels changed in the installation PR. The original art
contract/draft remain historical commissioning records; the installed manifest is authoritative.

The manifest uses the reviewed `walk-in@1`, `phase-tint@1` and `phase-frames@1` behaviours, alongside
stable posts, pose fidgets and finite choreography. Three props have explicit full-image crops. A static
`lift-open` depth piece reuses the door strip's first frame between temporary departure effects.

## Live checks

The existing compiled-plugin harness (`docs/deck-settings/render.mjs`) serves the real pack RPCs and
selects office through the global setting. These commands reproduce the static and overlay views after
`node docs/ship-deck-canvas/compile.mjs`:

```sh
node docs/deck-settings/render.mjs '?setting=office'
node docs/deck-settings/render.mjs '?setting=office&overlay=1'
```

`CHECK_SELECTION=1` additionally exercised missing-pack fallback and return to office, with one canvas
mount and no page errors. The [plain render](../../deck-settings/render-office.png) and
[authoring overlay](../../deck-settings/overlay-office.png) show the installed setting and 25 zone posts.

An additional local Playwright driver used that same compiled host and server, observing the Pixi graph
and render count without changing scene drawing. Edge ran at 1440 x 900, scale 2, UTC. Its recorded
[results and graph snapshots](runtime/results.json) accompany the following checks:

| Check | Evidence |
| --- | --- |
| Props, open lift and desk baselines; typing alternates the two registered seated frames | [Full day](runtime/full-day.png) |
| Local clock changes from hour 10 to 11; night chooses hour 2 and tints stage/actor bodies | [Full night](runtime/full-night.png) |
| Keyboard focus retains body tint, and Escape returns to the stage | [Focused colleague](runtime/focus-night.png) |
| New worker walks from x=404 to x=392 at y=112, then reaches the printer waiting zone | [Walk-in](runtime/walk-in.png) |
| Completion samples all three door frames, shows the confetti and removes the departed actor | [Closed lift](runtime/lift-closed.png), [confetti](runtime/completion-confetti.png) |
| 41 colleagues: 12 working, 3 ready/waiting, 2 blocked and 24 idle; calm still mode holds clock frame zero and identical pixels across two seconds | [Still crowd at night](runtime/still-crowd-night.png) |
| SwiftShader selects lite mode, follows the local hour and stays within its 12 fps budget | [Lite afternoon](runtime/lite-afternoon.png) |

The hidden-document check stopped all renders for two simulated seconds and resumed after visibility
returned. Browser checks reported no page errors or deck warnings. The pack linter separately checks
all-pairs paths, floor/crowd geometry, palettes, crop/fit bounds, exact references and capability declarations.

This review proves office composition without setting-specific engine branches. It does not replace the
ship's 81-shot pixel-identical gate, full suite, typecheck or Hermes compilation; their final results are
recorded in [the migration log](../../deck-settings/README.md).
