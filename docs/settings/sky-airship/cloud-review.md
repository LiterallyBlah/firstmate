# Cloud revision for PR #86

The captain approved the ship and characters but asked for more depth and less
repetition in the clouds, with a consistent storm sea. This revision changes
cloud art and ambience data only. [Preservation audit](cloud-preservation.json)
compares the approved `9ced243` pack with this revision.

Three new built-in image-generation outputs are saved under `sources/`:

- `cloud-banks.png`: far, mid and near panoramic banks, increasing billow size,
  creamy lit tops and layered lavender-blue undersides.
- `cloud-banks-storm.png`: a registered storm lighting edit of the same atlas,
  with slate/charcoal shadows and dim steel-blue tops throughout.
- `cloud-shapes.png`: puff, long broken bank, tower, feather, curl and anvil.

[Exact prompts and references](cloud-prompts.json). Nearest-neighbour native
registration retains 12/16/20 colours in the sea banks. Upper sky sprites use the
engine's three palette slots, so they change continuously with the existing day
cycle: dawn pink, dusk gold and moonlit blue. The sea's neutral ivory/blue daytime
palette is retained at night; it has weather variants, rather than a separate
night palette. Ship lighting and the approved night backdrop are unchanged.

| Layer | Size | Top row | Base drift | Slot / purpose |
| --- | --- | --- | --- | --- |
| Far bank | 1920 × 210 | 177 | 0.65 px/s | Behind ship; small, soft forms, continuous cloud foundation |
| Mid bank | 1664 × 148 | 215 | 1.8 px/s | Behind ship; larger rolling cloud forms |
| Near bank | 1408 × 160 | 286 | 3.8 px/s | Foreground; broad bright crests, larger shaded billows |
| Mist | 160 × 18, four frames | 301 | 3 px/s | Wafts across the whale's cloud line |

The far atlas's opaque textured foot is extended below the camera using mirrored
source rows; it fills valleys in the closer banks without revealing the old
backdrop sea. There is no repeated vertical tile. Three long, differently sized
strips drift independently on the wind clock, so their silhouettes do not repeat
as a single short band. Taller cumulus sprites rise from the horizon behind them.
High wisps occupy their own slower field instead of sharing the large cloud lanes.
Each panorama has a reflected continuation, doubling its period and making both
the continuation and wrap joins pixel-continuous. `audit-clouds.mjs` verifies
those edges, identical day/storm alpha and each bank's lower storm luminance.

All banks and mist use the same intensity curve, starting their crossfade at 0.35
and fully storm-dark at 0.95. Storm art inherits the exact day alpha silhouette;
the few registration-edge pixels missing in the generated edit receive slate
ink. At peak, the pale versions have zero opacity. Existing upper thunderheads,
lightning, rain and serpent are preserved. The departure's transient impact puff
and whale assets remain unchanged, as requested.

The suggestion whale keeps its original target, split row, mist ripple and
swimming frames. Its surface is at stage row 308; the foreground crests and the
mist strip surround that line. Its click target stays clear of the plank at the
other end of the ship. Neither crew geometry nor the 24-sleeper fix changed.

Updated real renderer evidence: [day](review/day-canvas.png), [night](review/night.png),
[storm](review/storm-lightning.png), [scene motion](review/scene-alive.gif),
[storm motion](review/storm-alive.gif), [whale surface](review/suggestion-whale.gif),
[departure](review/whale-departure.gif), and [crowd clicks](crowd-focus.json).
The [motion audit](motion-review.md) states which textures are static and which
positions, frames and palettes move. No engine or capability additions.
