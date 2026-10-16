# Scene switcher on every Deck surface

Home's Deck now has the same `DeckSceneSwitcher` as the workspace Deck panel. Both save the existing global `deckSetting` document. Home uses the compact picker for a narrow pane or compact layout; the panel uses it below 900px. The picker is hidden while Home shows a worker conversation in place of the scene.

Surface audit: `registerFleetViews` registers FirstMate Home as the plugin screen and the standalone workspace destinations. `FleetSurface` is the only production caller of `SelectedDeckView`; the latter is the only production caller of `ShipDeckView`. Board, Crew, Chat and the contextual "FirstMate here" panels do not draw a Deck.

## Screenshots

Real registered views, scene engine and installed pack RPCs, rendered in Edge through react-native-web. Host APIs, settings persistence, navigation and modal chrome are fixtures; these are not installed desktop or native-device screenshots. No plugin install or reload was performed.

| Surface | Light | Dark | Picker light | Picker dark |
| --- | --- | --- | --- | --- |
| FirstMate Home, right pane (1440px) | [Scene](home-light.png) | [Scene](home-dark.png) | [Picker](home-light-picker.png) | [Picker](home-dark-picker.png) |
| FirstMate Home, compact Deck tab (390px) | [Scene](compact-light.png) | [Scene](compact-dark.png) | [Picker](compact-light-picker.png) | [Picker](compact-dark-picker.png) |
| Workspace Deck panel (1440px) | [Scene](panel-light.png) | [Scene](panel-dark.png) | [Picker](panel-light-picker.png) | [Picker](panel-dark-picker.png) |
| Narrow workspace Deck panel (800px) | [Scene](narrow-panel-light.png) | [Scene](narrow-panel-dark.png) | [Picker](narrow-panel-light-picker.png) | [Picker](narrow-panel-dark-picker.png) |

## Validation

- `npm.cmd run typecheck`: passed.
- `npm.cmd test`: 93 files, 1,101 passed, 3 skipped.
- `npm.cmd run lint:deck-packs`: 51 passed.
- `npm.cmd pack --dry-run --json`: passed; docs and fixture assets excluded from the package.
- `node docs/ship-deck-canvas/compile.mjs`: both client bundles parse under React Native 0.81.5 Hermes, no class syntax or bundled Pixi; client growth 488 bytes. [Compiler results](compile-results.json).
- `node docs/deck-scene-switcher-everywhere/render.mjs`: eight layout/theme cases passed. Each checks one switcher, Ship to Sakura through the picker, saved scene on navigation to the Deck panel, switching back, reload persistence, external global-setting updates, control bounds and no page/toast errors.

To reproduce screenshots, install root dependencies and `docs/board-list` dependencies with `npm.cmd ci`, then run the render command above. The harness reuses the registered shell fixture and global settings fixture; it serves actual packs from this checkout.
`compile-results.json` records the working tree based on `edda14e`, before the change was committed.

Full gate: `node docs/deck-settings/gate.mjs` passed all 81 shots pixel-identical to main, without toolbar masking or expected-change exemptions. [Gate results](gate-results.json).
