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

Local validation: **90 test files, 1,088 tests passed, three pre-existing skips**, typecheck and all
**51 pack-lint checks**. No test was disabled or timeout extended. Existing geometry tests now distinguish
the historical floor/cast fixture from the intentionally changed ship pack; the generic transit tests
and real browser checks exercise the new behaviour directly.

Paseo's compiler builds both bundles; Hermes parses the client with no `class`, bundled Pixi or embedded
PNGs. Client growth against main `dfecf41` is **3,971 bytes**. The packaged art total is **790,718 bytes**
across both settings and their manifests; source art, documentation and tests are excluded by `npm pack
--dry-run`. Ship PNGs alone total 488,670 bytes. [Windows and Ubuntu CI for runtime `01d7276`](https://github.com/LiterallyBlah/firstmate/actions/runs/38829865336)
passes. The authoring overlay also draws access paths and labels their endpoints.

The first complete capture compares runtime **`01d7276`** with merged main **`dfecf41`**. All **81** frames
have matching canvas metadata, zero flakes and zero browser errors. Every frame contains an intended
water/art change. Main, branch and red-difference frames were inspected in full scenes and all 21 indexed
comparison sheets before recording exact main/branch PNG hashes in
[`expected-changes.json`](../deck-settings/expected-changes.json).

| Frames | Reviewed intentional differences |
| --- | --- |
| 8 still views | Crew art and lookout station, ladder, sea/foam; phase tint at dawn, dusk and night. All-idle retains its hull targets, lost-feed retains stale presentation. |
| 8 moving noon | Generated crew/fidget/gull frames, wider sea and scalloped foam, rigid basket and moving mast tip. |
| 29 storm views | The same art under unchanged weather intensity, creatures and four lightning captures. |
| 2 moving night | Stage and bodies darkened; engine state graphics stay untinted. |
| 27 crew transitions | New actor art during state changes, walking, hatch arrival and departure; normal floor and portal paths/timelines retained. |
| 4 focus views | The same selected worker now occupies the nest, so the existing camera follows it upward; new lookout art, then return to the full scene. Focus card remains identical. |
| 3 lite views | New art under the existing lite timing and calm policies. |

The [additional pixel check](check-polish-pixels.mjs) verifies the PNG pairs against the gate's hashes,
then reports **zero changed pixels outside the canvas** in every shot. It also verifies the 61 untouched
image hashes, stage size/fit/backdrop/props/motion/lights/palette, and the unchanged manifest sections
for floor, portals, effects, ambience, atmosphere, day cycle, attention carrier and copy.
[Per-shot results](polish-pixels.json) are evidence, not an acceptance mask: the gate compares every
pixel by exact hashes, without tolerance, masks, rerender forgiveness or skipped scenarios.
The [authoring overlay](polish-overlay.png) shows the ladder route and its reachable floor base.

The second independent full capture passes **81/81**, reproducing every main/branch PNG hash pair from
the first capture. All canvas metadata still matches, with zero flakes and browser errors. The extra
pixel/preservation check passes again. [Final gate results](../deck-settings/gate-results.json) and
[compiler results](../deck-settings/compile-results.json) are committed. Reproduce with
`SAVE=1 RERENDER=0 node docs/deck-settings/gate.mjs` after compiling, then
`node docs/deck-enrichment/check-polish-pixels.mjs` for the preservation evidence and comparison sheets.

Self-review of code, schema, pack, generated art, missing-art behaviour and every screenshot difference is
complete. The final evidence commit changes documentation/harnesses and captures only; runtime and pack
inputs remain at `01d7276`. The slice is published as a READY PR after the final commit's Windows and
Ubuntu CI checks pass. This is the fourth and final deck-enrichment slice.
