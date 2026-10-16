# Ship polish

Ship pack **1.4.0** completes the enrichment pass with generated scalloped foam, three gull wing poses,
wider varied calm/rough sea tiles, eight expressive crew identities, day-phase darkening and a working
lookout who climbs into the crow's nest. [Art contract, sources and provenance](../ship-deck-art/polish/README.md)
record every generated asset and its mechanical normalization outside shipped `art/`.

Intentional visual changes are limited to those assets and behaviours: four-frame front/side walks,
alternating rope-haul poses, attentive waiting/thinking poses, two alternating back-facing climb poses,
and the shaded-eyes lookout. The first working post moves from `[194,106]` to the ladder base `[222,98]`,
then follows `[222,-35]` to `[218,-35]`. The other six working posts keep their locations. The ladder is
new; the existing basket's front rim now occludes the lookout's legs. The mast split moves above the
basket so the occupied basket stays rigid and only the tip sways. A worker descends before moving to
another state, including the unchanged clickable below-deck rest target.

The existing `phase-tint@1` colours the hull, crew and stage art at dawn (`#CBC1CE`), dusk (`#B8A1B8`)
and night (`#687594`). Noon keeps the original colours. Engine badges remain legible and untinted.
The sea, foam and gull keep their former placement, clocks, intensity response and motion policies;
the sea repeat is now 512 pixels wide. The reply shark, weather creatures/lightning, UI, camera geometry,
portal paths and timings retain their existing contracts. Portal actors use the new cast art.

The new closed capability **`post-transit@1`** is generic pure data: path points, speed, moving/settled
pose ids, foreground piece and optional image dependencies. It has no setting-id branch, script, callback
or timer. Only a post's primary holder ascends; overflow stays on floor. Route progress reverses continuously
on reassignment and carries elapsed time across the floor boundary. First mount/reduced motion snap to the
station; removal in reduced motion fades where the actor was drawn. Missing ladder/mast art leaves a normal
floor post. Missing mandatory crew art fails the pack mount cleanly, while optional looks fall back as before.

The generic tests use an unrelated pack id and verify strict validation, clickable coordinates, first mount,
reduced motion, mid-route reversal, descent before walking, overflow, removal and full/lite time partitioning.
The historical plank trajectory golden remains unchanged, using its original cast timing fixture.

The [compiled-browser check](check-polish.mjs) uses seven workers so the other six stations stay occupied.
It checks click-to-worker from the nest by day and night, full-motion descent to a clickable porthole,
walking and climbing back to the free nest, then removal with no ghost target. The
[results](polish-interactions.json) and [day](polish-day.png), [night](polish-night.png),
[walking](polish-walking.png), [ascending](polish-ascending.png) and [descending](polish-descending.png)
captures document the real compiled client and packaged art. Reproduce after compiling with
`CHECK_POLISH=1 node docs/deck-settings/render.mjs`.

The prior slices' compiled-browser checks also pass: all 24 below-deck targets focus distinct workers,
state changes/removal clean up targets, and the shark body/bubble/keyboard controls open the correct
local or remote Converse view. Multiple requests, reordered cards, unreachable workers, removal and
office isolation still pass. Fresh [crowd](polish-below-deck-crowd.png) and
[reply-signal](polish-reply-shark.png) captures are retained without replacing their historical evidence.

Final validation and the exact 81-shot comparison are recorded below after both independent captures.
