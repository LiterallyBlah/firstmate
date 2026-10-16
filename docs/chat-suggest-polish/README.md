# Chat composer and shark suggestions

Real FirstMate React views rendered through react-native-web in headless Edge. Host APIs and suggestion persistence are fixtures; no plugin was installed or reloaded and no live home was changed. `render.mjs` uses the existing shell fixture and exercises the real fleet dismissal callback, cache update and deck components. Converse uses separate reply components and is unchanged.

The empty composer now measures its actual placeholder with the same hidden Text used for draft sizing. The toolbar and bottom-aligned attach/send controls retain their layout. Typed content still shrinks, grows to 160 px and scrolls beyond that.

Each shark suggestion has a sibling dismiss button with the accessible name **Dismiss suggestion**. It uses the strip's shared pending gate and the existing removal RPC. Send remains the main bubble action; dismissal does not mark a suggestion answered or send a prompt.

## Browser evidence

All captures are light and dark, at 844 px viewport height (shark: 900 px).

| Layout                                    | Before                                                                   | After                                                                  | Empty input height before → after     |
| ----------------------------------------- | ------------------------------------------------------------------------ | ---------------------------------------------------------------------- | ------------------------------------- |
| 360 px desktop side panel in 1440 px Home | [dark](before-side-panel-dark.png), [light](before-side-panel-light.png) | [dark](after-side-panel-dark.png), [light](after-side-panel-light.png) | 40 → 80 px (three-line keyboard hint) |
| 320 px narrow Chat                        | [dark](before-narrow-dark.png), [light](before-narrow-light.png)         | [dark](after-narrow-dark.png), [light](after-narrow-light.png)         | 40 → 60 px                            |
| 390 px phone Chat                         | [dark](before-phone-dark.png), [light](before-phone-light.png)           | [dark](after-phone-dark.png), [light](after-phone-light.png)           | 40 → 40 px                            |
| 1000 px wide Chat                         | [dark](before-wide-dark.png), [light](before-wide-light.png)             | [dark](after-wide-dark.png), [light](after-wide-light.png)             | 40 → 40 px                            |

Shark list with dismiss controls, then the first suggestion removed: [dark before](shark-dark-before.png), [dark after](shark-dark-after.png), [light before](shark-light-before.png), [light after](shark-light-after.png). These are both captures of the new UI, before and after the removal action.

Browser assertions cover full empty-placeholder visibility, long draft scrolling, shrinking and clearing, pending send/dismiss disabling, returned-list removal, failure preservation with toast, zero mate sends, last-item empty state, and Escape closing. Screenshots were visually inspected. These are browser fixture checks, not native phone/device tests.

## Reproduce

Install root dependencies and `docs/board-list` harness dependencies with `npm.cmd ci`. Run:

```powershell
$env:BEFORE='1'
node docs/chat-suggest-polish/render.mjs
Remove-Item Env:BEFORE
node docs/chat-suggest-polish/render.mjs
npm.cmd run typecheck
npm.cmd test -- --maxWorkers=2
node docs/ship-deck-canvas/compile.mjs
node docs/deck-settings/gate.mjs
```

The before run substitutes only `client/chat.tsx` from the pinned baseline into the fixture; all other UI and stubs stay the same. The after run imports this checkout's source. The scene gate compares the complete plugin bundles and scene packs to main.

Validation so far: `npm.cmd run typecheck` passes; the full suite with two workers passes all 97 files (1,155 tests passed, 3 skipped). The first unconstrained suite run, concurrent with compilation and rendering, hit three server timing failures (`pr-watch`, `update-source`, `watch-service-routing`); the full bounded-concurrency rerun passed. No server code or tests were changed. Both main and branch client bundles parse under Hermes; the current committed bundle was separately verified byte-identical to the one compiled for the gate. See `compile-results.json` and `test-results.txt`.

The full scene gate passed: **81/81 shots pixel-identical to main**, with no page errors, masks or intentional-change exemptions. This includes still scenes, noon/storm/night animation, crew transitions, focus and the software renderer. See `gate-results.json`. The compiled input records show the pre-edit HEAD because compilation ran before the implementation commit; the emitted client bundle was then rebuilt from commit `36b9743` and compared byte-for-byte with the gated bundle successfully.
