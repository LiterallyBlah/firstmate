# Sea, sky and storm follow-up

**Checkpoint: final verification incomplete.** Two full-render attempts failed with Windows
`UNKNOWN` / errno `-4094` opening existing evidence files for writing: `review/departure-contact.png`
and `review/floor-overlay.png`. Work stopped under the brief's repeated-obstacle rule.
Pack lint, typecheck, the 1,180-test suite, lite/still checks and Hermes passed; the final
full-motion capture and post-merge 81-shot gate are not complete. Evidence files and validation
reports below include earlier captures and must be refreshed before a ready PR is opened.

This follows the approved remaster merged in PR #95 (`b1458b4`, reviewed head `7e4c185`).
It changes the three atmosphere items from the first-mate review. It does not rebuild the
ship or change the route, crew, floor, hatch, climb, plank, shark, lights or stage rocking.

The day sea now starts turquoise at the horizon and deepens to azure in the foreground.
Generated whitecaps and sun sparkle sit over six independently blended water palettes;
dusk turns muted violet-blue and night stays deep blue. Small distant waves move at 4 px/s,
while the larger near waves retain the original 10 px/s water clock. The stern wake uses
its original silhouettes and timing with brighter foam.

Six generated sky gradients replace the old broad colour steps. Offline registration
averages the source's rows, then uses fine ordered dithering instead of median-cut bins.
The extended sky plates also carry the distance-water colour. A separate foreground
backdrop has a transparent 512-row upper region anchored at the hull waterline, so the
existing horizon-fit calculation expands it for tall panes. An independent opaque tiled
floor covers the visible ocean beneath these plates. Neither sky nor sea fill depends on
the travelling coastline strip. Stars and moon retain their visible pixels and positions;
only transparent padding changes to match the larger backdrop canvas.

At peak activity the generated thunderhead ceiling becomes opaque, the sea crossfades
to dark breaking waves, bow spray grows, and rain reaches 85% opacity. Four readable
purple kraken poses replace the small inherited tentacles. The serpent, frigate, lightning
and their existing timing/placement remain unchanged. Still and lite policies are retained.

Exact new prompts are in [polish-prompts.json](polish-prompts.json); original outputs are
`sources/polish-{sky,water,kraken}.png`. [polish-art.mjs](polish-art.mjs) registers the plates
through the existing offline build, with no runtime drawing or new engine capabilities.
The pack uses 149 PNGs, **956,652 bytes** of the 1,000,000-byte cap.

## Review evidence

| Item | Before PR #95 merge | Follow-up |
| --- | --- | --- |
| Day, wide | [before](https://github.com/LiterallyBlah/firstmate/blob/7e4c18590fc837148a63aa49a001afd19ddf5f97/docs/settings/ship-voyage/review/day-canvas.png) | [after](review/day-canvas.png) |
| Day, tall | [before](https://github.com/LiterallyBlah/firstmate/blob/7e4c18590fc837148a63aa49a001afd19ddf5f97/docs/settings/ship-voyage/review/day-tall-narrow.png) | [after](review/day-tall-narrow.png) |
| Peak storm | [before](https://github.com/LiterallyBlah/firstmate/blob/7e4c18590fc837148a63aa49a001afd19ddf5f97/docs/settings/ship-voyage/review/storm-wide.png) | [after](review/storm-wide.png), [tall](review/storm-tall-narrow.png), [motion](review/frigate-chase.gif) |

The [evidence index](README.md) links all six phases at both sizes, refreshed motion clips,
the overlay, 24-crew checks, full/lite/still reports and the element-by-element parity audit.
[Preservation checks](polish-preservation.json) compare approved geometry, behavior and art
against the merged remaster. [Validation](validation.json) records the final verification.

The original 81-shot engine gate still uses the byte-frozen test fixture on both engines.
Its post-merge rerun is [polish-gate.json](polish-gate.json). The original baseline migration
evidence remains untouched; no screenshot hashes are updated against remastered screenshots.
