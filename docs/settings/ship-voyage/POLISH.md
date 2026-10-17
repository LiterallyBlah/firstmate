# Pirate voyage polish

Follow-up to the approved remaster merged in PR #95 (`b1458b4`, reviewed head `7e4c185`).
The installed id remains `ship`, the pane switch remains **Deck**, and the display name and
pane heading are now **Pirate voyage**. No installed setting uses that name. A 384×200
thumbnail from the actual daytime canvas restores the picker preview.

The day sea starts turquoise at the horizon and deepens to azure in the foreground.
Generated whitecaps and sun sparkle sit over six independently blended water palettes;
dusk turns muted violet-blue and night stays deep blue. Distant waves move at 4 px/s,
larger near waves at the original 10 px/s. The stern wake retains its silhouettes and
timing with brighter foam. Six continuous colour curves fitted to the generated palettes, with fine dithering, replace the broad colour
steps. Independent sky/depth plates and an opaque sea tile fill tall panes, without
depending on the travelling coastline. Moon and star pixels are unchanged.

Peak activity brings heavy charcoal thunderheads, dark breaking waves, larger bow spray
and 85%-opacity rain. Four readable purple kraken poses accompany the existing serpent,
lightning and chasing navy frigate. Storm effects still ease away as activity falls.

## Marine life: cause and correction

The old dolphin sequence repeated a visible tail pose during its quiet interval; its first
frame was also visible under the `first-frame` lite/still policy. The old whale repeated a
visible back, used the same resting policy, and had a fixed world anchor. These data choices
made both animals appear idle even though their full-motion frame clocks were running.
The engine intentionally pauses hidden panes; the new browser check verifies that it resumes.

The suggestion shark and its real surface split remain byte-for-byte unchanged. Dolphin
leaps now occupy centre-right foreground water, entirely below the hull waterline and clear
of the plank path. Two positions alternate 30 art pixels apart. Each 5.2-second sequence
has four leap/dive poses, a surface splash, and then transparent frames. The first and final
frames are transparent. The whale surfaces and spouts for 2.75 seconds in each 11-second
cycle, then disappears. Its 2048-pixel lane drifts right at the coast's exact 1.7 px/s voyage
speed, initially in the right horizon. It is never permanently anchored to the screen.
Both animals hide in lite, still and reduced motion.

The merchant already travels at 2 px/s on the voyage clock. The navy frigate now also travels
in a 1536-pixel strip, at 1 px/s, so its chase slowly falls astern instead of staying pinned.
It remains restricted to peak activity and hides under reduced motion. Flying gulls and
fish use moving seeded flybys; the yard gull and cat belong to the ship and rock with it.

## Crew and preserved behaviour

All standing posts, their overflow floor polygons and spacing are inset onto the planks.
The bow rope and foremast are obstacles. The hatch endpoint moves three pixels inward and
the departure queue moves inward; the hatch timing, climb, projecting plank, rail/tip/water
marks and splash/shark timeline remain intact. The hold's 24 resting windows are unchanged.
Lanterns remain behind crew and the climb ladder remains behind the sails.

The dressed hull, rig, coastline, night-only windows/lighthouse, stage rocking, original
eight crew looks and suggestion shark are preserved. The change is pack data and registered
art, with no production engine code. Exact prompts are in [polish-prompts.json](polish-prompts.json);
source outputs are `sources/polish-{sky,water,kraken}.png`. The installed payload is
**159 PNGs / 984,461 bytes**, including the preview, below the 1,000,000-byte limit.

## Before and after

| Item | Merged remaster | Follow-up |
| --- | --- | --- |
| Day, wide | [before](https://github.com/LiterallyBlah/firstmate/blob/b1458b4/docs/settings/ship-voyage/review/day-canvas.png) | [after](review/polish-final/day-canvas.png) |
| Day, tall | [before](https://github.com/LiterallyBlah/firstmate/blob/b1458b4/docs/settings/ship-voyage/review/day-tall-narrow.png) | [after](review/polish-final/day-tall-narrow.png) |
| Peak storm | [before](https://github.com/LiterallyBlah/firstmate/blob/b1458b4/docs/settings/ship-voyage/review/storm-wide.png) | [after](review/polish-final/storm-wide.png), [tall](review/polish-final/storm-tall-narrow.png), [motion](review/polish-final/frigate-chase.gif) |
| Bow clearance | [before](review/polish-final/bow-before.png) | [after](review/polish-final/bow-after.png) |
| Picker | Preview was absent | [Pirate voyage and thumbnail](review/polish-final/picker.png) |
| Marine distribution | Left-side fixed whale and tail-out dolphin | [full width](review/polish-final/marine-distribution.png), [four leaps, real time](review/polish-final/dolphin-leaps.gif), [whale passage, 5×](review/polish-final/whale-passage-5x.gif) |

The [evidence index](README.md) links all six phases at both sizes, motion clips, overlay,
24-crew checks and the element-by-element audit. [Preservation checks](polish-preservation.json)
compare unchanged sections and 90 retained images against the merged remaster. Marine checks
record [full/resume](visitors-full.json) and [lite/still](visitors-lite.json) results.
[Validation](validation.json) records lint, tests, Hermes and the gate. The full suite passes
on isolated Windows and Ubuntu CI runners. Local Windows suite attempts hit timeouts and a
PR-watch wall-clock budget assertion while the shared machine was busy; no tests were weakened.
The local pack lint passes with a 30-second timeout.

The original engine gate still uses the byte-frozen fixture on both engines. Its follow-up
run is [polish-gate.json](polish-gate.json). No baseline files or screenshot exceptions are
changed. New evidence is written atomically to `review/polish-final/` to avoid Windows
in-place PNG locks; the original merged review evidence is retained.
