# Ship polish art contract

Thirteen original raster sources were generated with the built-in image generation tool, including
reference edits for the seven additional crew identities. [Exact prompts](prompts.json), source PNGs,
[registration](registration.json), [provenance](provenance.json), previews and build scripts stay here.
Only the 23 normalized runtime PNGs named by ship pack **1.4.0** ship in `art/`.

`node docs/ship-deck-art/polish/build.mjs` performs mechanical registration, nearest-neighbour reduction,
fixed-palette quantization and binary alpha normalization. It does not draw or repaint shapes. A connected
component bounds each generated crew cell to exclude fragments spilling from a neighbour. One scale per
identity preserves crouches and raised hands; each pose registers at its soles. The generated idle frame
sets standing height to 32 world pixels, with raised poses up to 36. Sampling uses alpha threshold 180;
transparent RGB is zero. `verify.mjs` checks the contract and writes provenance and 2x2 tile previews.

| Asset | Runtime contract |
| --- | --- |
| Eight crew atlases | 128x160, sixteen 32x40 cells, tight per-pose crops/feet in each lane. Four distinct front walks, four side walks, stand, haul, haul-pull, waiting, two back-facing climbs, lookout and thinking. |
| Ladder | 14x144, transparent; placed at `[215,-38]`. |
| Gull | 96x32, three 32x32 up/glide/down cells, existing flight timing and registration. |
| Foam | Three 256x16 strips; eight-pixel scallops in rows 4–11, existing world placement and timing. Frame zero is also the still fallback. |
| Calm sea | Four 512x128 tiles, twice the former width for less frequent repetition. Six blues from the existing palette; frame zero is the still fallback. |
| Rough sea | Four 512x128 tiles with eight existing blue/grey colours, preserving the existing intensity blend and animation timing. |

Every opaque pixel belongs to the established 64-colour ship palette. Sea subsets reduce texture noise;
no dither, filtering or new runtime colours. The complete ship pack has **488,670 PNG bytes**, within the
engine's 1 MB limit. The six obsolete optional crew sheets are removed from shipped art. The original
deck atlas remains unchanged because it supplies the hull and furniture.

The [crew contact sheet](crew-contact-4x.png) shows all eight identities at 4x nearest scale. The
[calm](water-sea-frame-0-tiled.png) and [rough](storm-sea-frame-0-tiled.png) 2x2 previews check repetition
and joins; their mean boundary colour distances are recorded, not represented as exact edge equality.
Full-scene day/night and ascent/descent previews are in [the polish review](../../deck-enrichment/polish-review.md).
