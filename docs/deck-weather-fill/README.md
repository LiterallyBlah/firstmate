# Weather fills the visible Deck

The tile renderer repeated from each band's `fromRow` downward and cached only the left, right and bottom bounds. All three shipped scenes place rain in a single band at row zero. A tall pane exposes negative deck rows, leaving a dry band above that origin. A resize exposing only more sky also failed to invalidate the tile layout.

Single-band tiles starting at or above stage row zero now extend to the visible top, snapped to their original tile grid. The frame, drift, variant opacity and pixel density are unchanged. Waterline and horizon bands retain their original start rows. The missing-image flat fallback uses the same coverage rule.

Intensity-driven overlays already followed the backdrop's expansion at the top and sides. They could still end before the visible bottom. Eight edge/corner crops now extend their outermost pixels into uncovered space, without scaling or moving the original image or its horizon. Night overlays (moons and stars), flashes, drifters and positioned cycles retain their existing placement. No pack manifest or art changed, and no opt-in is required.

Reproduce with the established compiled-client/RPC renderer:

```powershell
node docs/ship-deck-canvas/compile.mjs
$env:RENDER_TREE='main'
node docs/deck-weather-fill/render.mjs
Remove-Item Env:RENDER_TREE
node docs/deck-weather-fill/render.mjs
node docs/deck-settings/gate.mjs
```

The review reuses `docs/deck-settings/render.mjs` and public canvas attributes, with no Pixi instrumentation. Both engines receive the same current installed packs. Before is the compiled `b1458b4` engine; the separate 81-shot gate uses its hash-verified frozen ship fixture. The browser viewports are 1600×700, 1000×1000 and 650×1500, with actual canvas bounds recorded in the JSON files. Full and lite runs use a busy fleet at storm intensity; reduced motion uses the same fleet with calm weather.

| Scene | Wide | Square | Tall/narrow |
| --- | --- | --- | --- |
| Sky pirates | [Before](before/sky-airship-wide-full.png) · [After](after/sky-airship-wide-full.png) | [Before](before/sky-airship-square-full.png) · [After](after/sky-airship-square-full.png) | [Before](before/sky-airship-tall-narrow-full.png) · [After](after/sky-airship-tall-narrow-full.png) |
| Sakura coast | [Before](before/japanese-ship-wide-full.png) · [After](after/japanese-ship-wide-full.png) | [Before](before/japanese-ship-square-full.png) · [After](after/japanese-ship-square-full.png) | [Before](before/japanese-ship-tall-narrow-full.png) · [After](after/japanese-ship-tall-narrow-full.png) |
| Pirate voyage | [Before](before/ship-wide-full.png) · [After](after/ship-wide-full.png) | [Before](before/ship-square-full.png) · [After](after/ship-square-full.png) | [Before](before/ship-tall-narrow-full.png) · [After](after/ship-tall-narrow-full.png) |

Generic synthetic-pack tests cover all viewport edges, top-only growth, resize back, nonzero grid origins, identical base/variant alignment through frame changes and drift, waterline preservation, fixed cycle placement, overlay seams and original placement, night art, lite/still policy and missing-image fallback.

`compare.mjs` uses the existing pack-linter PNG decoder to record changed pixel bounds. Aspect captures advance the clock while asynchronous mounting completes, so moving art can land on adjacent initial frames between runs; these captures demonstrate coverage, while the frozen-fixture gate provides the strict pixel-identity check. The Sky pirates full-motion pairs differ only in their formerly dry top region.

The [frozen ship gate](gate-results.json) passes **81/81 pixel-identical**, with no expected-difference exemptions and no page errors. Both complete client bundles [parse under RN 0.81 Hermes](compile-results.json), with no Pixi bundled and no class syntax. Pack lint passes 69/69 checks.

All **54 captures** (before/after × three scenes × three aspects × full/lite/still) complete without page errors. [Full](after/full.json) and [lite](after/lite.json) report storm intensity 1.00; [reduced motion](after/still.json) reports still weather and no flashes. Every lite capture also has no flash. All nine reduced-motion before/after pairs are pixel-identical in [the PNG comparison](pixel-comparison.json). Lite rain keeps its frozen first frame, and full-motion rain fills the previously dry upper area without a seam.
