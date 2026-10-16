# Home Deck caption and scene picker

Home now passes its scene picker into the deck caption row. The picker stays right-aligned beside the scene name and rendering status, wrapping onto the next line when needed. The separate 40px strip is removed. The standalone Deck header still owns its existing picker and receives no caption action.

At 1440px and 1100px viewport widths, the canvas begins 31px higher: the old 40px picker row plus 19px caption becomes a single 28px caption/control row. Narrower panes wrap to a 55px caption/control area and still reclaim 4px. The control remains 28px high, including the compact form in the 587px Home pane at viewport width 1100.

## Before / after

Real registered views, react-native-web, scene engine and pack RPCs in headless Edge. Host APIs, settings persistence and modal chrome are fixtures, not an installed desktop/device test. Captures show the first 300px of Home at a 1000px viewport height. No install or reload was performed.

| Viewport | Dark before | Dark after | Light before | Light after |
| --- | --- | --- | --- | --- |
| 1440 | [Before](before-1440-dark.png) | [After](after-1440-dark.png) | [Before](before-1440-light.png) | [After](after-1440-light.png) |
| 1100 | [Before](before-1100-dark.png) | [After](after-1100-dark.png) | [Before](before-1100-light.png) | [After](after-1100-light.png) |
| 800 | [Before](before-800-dark.png) | [After](after-800-dark.png) | [Before](before-800-light.png) | [After](after-800-light.png) |
| 638 | [Before](before-638-dark.png) | [After](after-638-dark.png) | [Before](before-638-light.png) | [After](after-638-light.png) |
| 390 | [Before](before-390-dark.png) | [After](after-390-dark.png) | [Before](before-390-light.png) | [After](after-390-light.png) |

## Reproduction and checks

Install root and `docs/board-list` dependencies with `npm.cmd ci`. Run `node docs/deck-home-blankspace/reproduce.mjs` for after screenshots and layout assertions; set `BEFORE=1` for before screenshots using the two original production files from commit `d4b4c1d`. The harness also checks scene selection at every width/theme. [Before measurements](before-measurements.json), [after measurements](after-measurements.json).

- `npm.cmd run typecheck`: passed.
- `npm.cmd test -- --maxWorkers=2`: 93 files passed; 1,103 tests passed, three skipped. The initial default-concurrency run hit a 5s timeout in the unrelated Git-source fixture; the full rerun passed.
- `node docs/deck-scene-switcher-everywhere/render.mjs`: all eight surface/theme cases passed, covering picker selection, shared saved setting, reload, external update, bounds and errors.
- `node docs/ship-deck-canvas/compile.mjs`: both bundles parsed under React Native 0.81.5 Hermes; no class syntax or bundled Pixi. [Compiler evidence](compile-results.json).
- `node docs/deck-settings/gate.mjs`: all 81 shots pixel-identical to compiled main `3082862`, without toolbar masking or expected-change exemptions. [Gate evidence](gate-results.json).
