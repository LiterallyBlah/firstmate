# Sky pirates: floating-island voyage

Stacked on #101 at `9d4093d56773cf89475a386d99993b73b33f2f73`; base branch `fm/sky-crew-edge` is untouched. This change is pack data, PNGs and offline authoring/review evidence only.

## Composition and travel

The old static island paintings have been removed from all four sky plates. The sky is now an island-free coverage background; the existing layered cloud ocean remains the coverage below. Floating islands belong exclusively to world-anchored `phase-strip@1` layers, never backdrop placement or viewport-edge coordinates. There is no stationary island silhouette competing with a moving copy.

| Depth | Landmarks | Period | Speed | Lap |
| --- | --- | --- | --- | --- |
| Far | Small empty islets and distant ruins | 1,024 px | 0.853333 px/s | 20 minutes |
| Middle | Tower city, cloud lighthouse, ruins | 1,536 px | 1.28 px/s | 20 minutes |
| Near | Waterfall island, dock with two moored airships, rocky islets | 2,048 px | 1.706667 px/s | 20 minutes |

The constant `voyage` clock stays at one at every busyness level. A lap is 20 minutes of active scene time; hidden/reduced-motion behavior follows the existing engine clock. All three layers travel right, consistent with the airship sailing left. Large transparent intervals separate landmarks and join each loop seamlessly. The near waterfall's glints descend through four frames on a separate shallow-content strip with exactly the near layer's width, top, span, drift and clock. Buildings, moored airships, ropes, windows and beacon lights are in the island pixels and travel together.

Each depth has explicit dawn/day/dusk/night phase sets. Windows and the lighthouse lantern are bright only in the night set; dawn and dusk use palette transfers without lit pixels. Night transitions use the engine's existing eased phase blend. A generated star field covers the entire open night sky.

The fit's top moves from -14 to -90 to leave visible sky above the balloon, including in a narrow pane. No crew station, overflow, floor, cast, portal, part or light moves. The existing cloud sea strips gain a wide fixed world span so this headroom cannot expose their old horizontal endpoints. Six cloud PNGs are losslessly palette-encoded to keep the expanded pack below the 1,000,000-byte budget; `audit.mjs` compares every decoded pixel with #101.

## Evidence

| Phase | Wide, 1440 x 900 | Tall/narrow, 700 x 1600 |
| --- | --- | --- |
| Day | [Render](renders/wide-day.png) | [Render](renders/tall-day.png) |
| Dusk | [Render](renders/wide-dusk.png) | [Render](renders/tall-dusk.png) |
| Night | [Render](renders/wide-night.png) | [Render](renders/tall-night.png) |
| Peak storm | [Render](renders/wide-storm.png) | [Render](renders/tall-storm.png) |

[Real-time wide voyage](motion/wide-voyage.gif) and [real-time tall voyage](motion/tall-voyage.gif) each show 24 seconds at the actual authored speed. [Ten-minute day](motion/ten-minute-day.png) and [ten-minute night](motion/ten-minute-night.png) show the dock and ruins after advancing the real production animation clock, without changing positions or speed. [Lite wide](motion/wide-lite.gif) and [lite tall](motion/tall-lite.gif) exercise software rendering. Static day/dusk/night captures exercise reduced motion. [Crowd evidence and overlays](after/) retain the exact centre target from #101.

**Engine provenance:** the stack predates main's already merged weather-coverage fix #98. Phase/coverage and motion captures use the existing `RENDER_TREE=main` option: this branch's pack served to main's compiled engine at `88b8e1b`. This verifies the shipping integration, including rain above stage row zero in tall panes. It does not transplant engine source into the PR or hide a pack workaround. The 24-crew check, local full suite and frozen-Ship gate run the branch normally; the gate also compares main's engine. #101 remains unchanged. These are synthetic host fixtures, not installed-plugin/device claims.

## Motion audit and applicable ghost-ship gates

| Area | Motion / gate evidence |
| --- | --- |
| Islands and attached objects | Three parallax speeds, fixed world span; exact 1,200-second laps and transparent gutters audited. No viewport positioning or clamping. |
| Waterfalls | Downward glints; exactly registered with their island in every phase. |
| Windows and beacon | Static on their building, night-only colour; the whole building moves. No independently pinned light. |
| Sky, stars and moon | Static atmospheric coverage is intentional; no land or scenery-bound life remains in it. Full-width star field, dithered sky. |
| Cloud sea | Existing layered wave shapes and parallax preserved; pixels unchanged, world span extended. It fills below every pane shape independently of islands. |
| Balloon, sails, rigging, flag, hull, smoke, lamps | Existing #101 cycles, sway, bob and rock retained. Level broadside and light/crew depth remain unchanged. |
| Whales and serpent | Existing surface split, breach, left-facing carrier and storm-only travelling serpent unchanged. The independent flyers and serpent remain in world coordinates. Existing lite/still hiding policies retained. |
| Crew, plank, lookout | Floor, posts, overflow, casts and portals unchanged; exact 24-crew centre selection rerun in all states at both pane shapes. #101's departure/climb review remains applicable. |
| Picker and presentation | Existing Sky pirates name retained; preview refreshed from the reviewed day composition. |

This covers section 8's applicable gates 1-19. Gate 20 is the visual match to the generated atlas and reviewed scene, shown above; no separate ghost-ship sketch is claimed. Scenery may leave the pane naturally, but never follows its edges. Still mode holds a coherent landscape at its initial offset; it does not freeze a creature mid-action.

## Reproduction

`build.mjs` registers the generated sources, creates phase sets and downward waterfall glints, updates hashes and emits `layout.json`. `indexed.mjs` encodes existing palette pixels losslessly. `audit.mjs` checks the protected #101 data/pixels, lap speeds, phase lights and wrap gutters. Generation prompts and source provenance are in [PROMPTS.md](PROMPTS.md). `world-check.mjs` checks the production strip functions at 0, 24, 600, 1199.9, 1200 and 1224 seconds, including wrap and full/lite/still policies. Lite resize smoke checks completed the wide-square-wide and tall-square-tall round trips in 909 ms and 877 ms including screenshots and simulated frames; these are smoke checks, not device performance benchmarks.

```powershell
node docs/settings/sky-airship/voyage/build.mjs
node docs/settings/sky-airship/voyage/audit.mjs
node docs/ship-deck-canvas/compile.mjs
$env:RENDER_TREE='main'
node docs/settings/sky-airship/voyage/render.mjs
node docs/settings/sky-airship/voyage/motion-render.mjs
node docs/settings/sky-airship/voyage/later-render.mjs
node docs/settings/sky-airship/voyage/lite-render.mjs
Remove-Item Env:RENDER_TREE
node docs/settings/sky-airship/voyage/crowd-render.mjs
node docs/deck-settings/gate.mjs
npm.cmd run lint:deck-packs -- --maxWorkers=1
npm.cmd run typecheck
npm.cmd test -- --maxWorkers=1
```

The render wrappers reuse the repo's compiled-plugin host, public canvas diagnostics and authoring overlay. No Pixi-internals observers, plugin installation or reload are used.

## Validation result

Pack lint: 69 passed. Full suite: 1,180 passed and three skipped. Typecheck and both plugin Hermes parses pass. The frozen-Ship gate is 81/81 pixel-identical to main. All 192 exact crowd-centre clicks plus six normal-bow clicks pass. Wide/tall phase, full, lite, still, ten-minute-route and resize captures report zero browser errors. See `verification.json`, `ship-gate.json`, `compile-results.json`, `checks.json` and the per-render results. CI runs again on the final evidence commit.
