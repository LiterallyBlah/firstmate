# Generated pixel clouds

Five ready-to-integrate transparent cloud sprites. [manifest.json](manifest.json) defines sizes, palette, tint maps and drift; [provenance.json](provenance.json) retains all five exact generation prompts and source hashes.

| Asset | Canvas | Verdict | Review |
| --- | --- | --- | --- |
| `wisp.png` | 44 × 12 | usable | Tiny two-lobed wisp; thin trailing end is intentionally only one logical pixel high. |
| `puff.png` | 36 × 14 | usable | Small rising puff; three lobes simplify at this scale but retain a distinct silhouette. |
| `cumulus.png` | 62 × 21 | usable | Medium central dome; broad tonal clusters read at native size. |
| `long-bank.png` | 92 × 25 | usable | Broad low bank; stepped underside and uneven lobes are usable for slow background drift. |
| `twin-bank.png` | 80 × 24 | usable | Twin bank with deep saddle; elongated flat base is visible at enlarged review scale, acceptable as a small background sprite. |

Use one texture pixel per deck logical pixel with nearest-neighbour sampling, matching the 426 × 161 hull, 32 px crew and 20–23 px gull. The visible clouds range from roughly 32 to 88 pixels wide. Each canvas includes two transparent pixels on every side. Alpha is binary; transparent RGB is zero. The checkerboard is present only in the review sheet.

The three colours are **exactly** the existing environment palette's `#A8B9BD` shadow, `#BECAC6` body and `#D9D4BE` highlight. This is the deck's muted grey/cream interpretation of neutral daytime clouds; no new white or grey colours were introduced.

## Tint and drift

Prefer the manifest's three-slot palette replacements: neutral midday, slightly warmer afternoon, warm dawn, muted dusk and dim blue night. The six-stage preview uses those exact mappings. No separately tinted runtime PNG is needed. Blend those slots with the existing `skyBlend` result, including its 90-minute transition windows. Ordinary multiplicative sprite tint also works for simpler dimming, but does not reproduce the supplied colour mappings exactly.

Place clouds above sky/stars and behind the gull. Suggested sky-source rows are 20–110; keep their bottom edges above row 150. Apply the sky's transform and pixel scale. Drift at 0.3–0.55 logical pixels/second, rounding position to whole logical pixels; independent seeds and heights avoid a procession of evenly spaced clouds. Freeze motion in still/lite modes.

These are isolated sprites, not strips to join edge-to-edge. Wrap only once the entire cloud leaves the viewport, using the offscreen padding and period formula in the manifest. Each PNG's opposite edges are fully transparent, so there is no opaque seam. Do not clip a sprite at a viewport edge and teleport its visible portion.

## Generation, cleanup and verification

Generated using the built-in `image_gen__imagegen` tool in **5 calls**, below the 10–15-call ceiling. The generator does not name its backend model. Original outputs remain on the generation host at the location recorded in provenance.

Mechanical cleanup cropped the generated silhouettes, block-median sampled them to logical size, removed soft alpha/fringe, mapped colours to the exact three-colour subset, and removed isolated interior shade specks. Nothing was hand-painted and no cloud shape was procedurally drawn. The complete numeric recipe, crop coordinates and source hashes are in provenance.

[verification.json](verification.json) records each PNG's size, SHA-256, colours, alpha values, transparent pixel count, zero transparent RGB and two-pixel padding. [review/contact-3x.png](review/contact-3x.png) shows the sprites enlarged; [review/six-stages.png](review/six-stages.png) shows native-scale composites against all six shipped skies.

All five are **usable** as small drifting background clouds. The banks retain some angular generated contours and the twin bank has a long flat base when enlarged; a human pixel artist could refine those, but no cleanup is required before this intended use. Their silhouettes do not deform: motion is whole-sprite drift.

The six-stage image is an asset review composite, not a runtime integration test. It retains the original preview's gull at dusk/night, whereas live code hides the gull then. This branch changes only this asset directory; client wiring, installation and reload are outside this delivery.
