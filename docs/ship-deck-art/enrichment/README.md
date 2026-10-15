# Ship enrichment art — weather

Original raster artwork generated with three built-in `image_gen__imagegen` calls on 2026-10-15.
The tool does not disclose its backend model. Exact prompts are in [prompts.json](prompts.json).
Sources remain in [source/](source/), outside the shipped package. No external artwork was used.

| Asset | Runtime frames | Registration | Motion |
| --- | --- | --- | --- |
| Serpent | 4 × 64×56, plus 4 dark silhouettes | `[32,52]` at `[32,166]` | 1000 ms per frame on `swell` |
| Kraken tentacles | 4 × 48×56, plus 4 dark silhouettes | `[24,52]` at `[400,166]` | 1200 ms per frame on `swell` |
| Distant lightning | 2 × 32×48 | `[16,4]` under the existing drifting clouds | Existing 80/120 ms event |

[build-weather.mjs](build-weather.mjs) extracts the generated poses at one fixed scale per animation,
registers their bases, block-median samples them, thresholds alpha to 0/255, and maps colours to the
listed palette. It does not draw creature or lightning shapes. Silhouettes reuse those exact generated
pixels in navy. [weather-provenance.json](weather-provenance.json) records source hashes, crops,
scales, anchors and palette. Shipped frame hashes are in the ship manifest.

The serpent starts looming at intensity 0.55, its surfaced colour begins at 0.65, and reaches 85%
opacity at 0.85. Tentacles begin at 0.72, colour begins at 0.82, and reach 85% at 1. Both use
`cycle@1` with `variants@1`, behind the engine's interaction layers, in the sea at either end of the hull.
They fade out along the same curves when work quiets. Lite holds their first pose; reduced motion hides
them completely. Lightning keeps the existing one-emitter schedule and timing, with a more legible fork
and peak opacity 0.54 (below the engine's 0.6 cap). No whole-screen flash or sound is added.

All existing hull, crew, sky, sea, foam, wake and camera pixels remain the same outside these additions.
This is a four-pose creature animation, not continuous deformation. Source pose proportions vary slightly;
fixed-scale registration preserves the waterline without stretching each pose independently.

Rebuild from the repository root:

```powershell
npm.cmd install --prefix docs/board-list --no-save --package-lock=false pngjs@7.0.0
node docs/ship-deck-art/enrichment/build-weather.mjs
```

The two old lightning PNGs were replaced by the registered enrichment frames and removed from the
shipped pack. Their generation sources and historical manifest remain in `docs/ship-deck-art/storm/`.
AI-generated assets are distributed with the repository's MIT license; no human authorship is claimed.
