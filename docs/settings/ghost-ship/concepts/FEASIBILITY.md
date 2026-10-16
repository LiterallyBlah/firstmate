# Ghost ship — capability review

Review base: `b1458b4f99a00a366ba008e8bdccab7b4aca7ac1`, 2026-10-16. This is a source review and production plan,
not a claim that a pack has passed runtime gates. Stage 1 changes only this documentation and concept images.

Primary contracts: [authoring guide](../../../deck-settings/authoring.md),
[format and capability catalogue](../../../../shared/deck-setting.ts),
[crew motion](../../../../client/deck-crew.ts), [cast](../../../../client/deck-cast.ts),
[renderer](../../../../client/deck-pixi.ts), [environment](../../../../client/deck-environment.ts).
The installed reference manifests are [Ship](../../../../art/settings/ship/setting.json),
[Sakura coast](../../../../art/settings/japanese-ship/setting.json) and
[Sky pirates](../../../../art/settings/sky-airship/setting.json).

## Result and dependencies

Most of the specification is expressible with the existing catalogue, including `phase-strip@1`, `stage-rock@1`,
lookout transit, finite kraken choreography and a genuinely split-surface suggestion creature. It is **not accurate
to report zero missing engine behavior** for the literal approved specification:

1. **Night-dependent crew transparency is absent.** `Cast` has static look/image/lane definitions, poses, roles,
   fidgets and breath. `stage.tintByPhase` accepts only RGB multipliers. `crewFigures` emits `alpha: 1` for present
   actors; `deck-pixi.ts` sets body alpha to the stale multiplier times figure alpha. Neither reads day phase for
   opacity. PNG alpha can make a ghost permanently translucent, and tint can alter its colour, but neither makes
   it *more see-through at night*. `phase-frames`/`phase-strip` select ambience, not interactive crew bodies.
   A small generic versioned crew phase-opacity capability, with normal/focused/sleeping/transit bodies covered,
   would need a separate engine PR before the pack. No callback, duplicate ambient crew, or fake stale state is an
   acceptable workaround. Alternatively, changing the literal requirement to constant translucency needs the first
   mate's explicit disposition; that relaxation is not assumed here.
2. **The all-pane weather fix is a known external dependency.** The spec explicitly says it is in flight. This
   revision's tile bands start at a fixed `fromRow`, and tile layout tracks left/right/bottom rather than visible
   top. An arbitrary very negative row is neither a viewport contract nor a good memory workaround. Consume the
   separately reviewed weather-fill work before proving gates 8–9. No changes to that worker's branch belong here.

Two narrower implementation interpretations avoid unnecessary engine work:

- `rise@1` accepts `at` and `ms`, not effect tracks. Use a persistent animated green mist swirl at the hatch while
  crew rise through it. The spec does not require mist to exist only during arrivals. If an arrival-triggered puff
  is required later, rise effects would be another generic engine extension; `walk-in` is not a rising substitute.
- `zone-appearance@1` is a fixed representation and suppresses fidgets/breath. To meet **fidgets in every state**,
  use actual sleeping cast poses inside authored below-deck apertures, with interior feet, reserved posts and
  foreground rim pieces. Do not copy the old packs' static sleeping-window substitution and call it animated.

## Specification mapping

| Spec item | Existing capability and production implementation | Status |
| --- | --- | --- |
| Level broadside rotten galleon, green seams, tattered translucent sails, frayed flag | `stage`, alpha PNGs, layered parts and pieces; cycles for moving cloth, flag and seam-light. | Supported |
| Working at rigging/capstan | `zones`, `cast`, `pose-fidgets`; crank/haul settled keys, stable post assignment. | Supported |
| Waiting at raised stern wheel | Reachable stair polygon, helm posts, waiting poses and fidgets. Wheel/rail pieces sorted by row. | Supported |
| Blocked beside bow figurehead | Bow zone and posts safely inboard, spectral mermaid art and blocked-state fidgets. | Supported |
| Idle in below-deck hammocks/coffins through portholes | Non-spill interior floor with access corridor, twenty-four independent sleeping cast poses and aperture rim pieces. Actual cast preserves fidgets and identity. | Supported; must prove crowd geometry |
| 6–8 distinct ghost/skeleton/lantern-eyed looks | Eight static `cast.looks`, identity-hashed as in Ship; alpha PNGs, common registered pose anchors. Distinct hats, silhouettes and costumes. | Supported |
| More see-through at night | No cast phase alpha or phase sprite mapping exists. | Engine gap above |
| Lookout climb, lantern, ladder behind sail | `post-transit`, climb poses, mast-front depth, later cloth/rim occlusion; lantern row behind actor. Cloth opening preserves a visible clickable climber. | Supported |
| Rise through hatch in green mist | `rise` plus a stage-attached looping mist `cycle`. | Supported with persistent swirl |
| Horizontal plank walk, drop and splash | `choreography`, named marks, visible walk-cycle segment on plank, then world effects; mist/splash keys. | Supported |
| Large skeletal kraken wraps, swallows, sinks with ripple in 1.5–2.5 s | Finite effect keys and named mouth anchors; actor reveal/gone keys, with waterline occlusion painted into the registered effect frames. Target 2,000 ms from emergence to submerged rest, after approach walk. | Supported |
| Anglerfish in water, lure and suggestion bubbles | `attention-carrier` + `carrier-surface`, `bubbleHeight`, swim frames, loiter and water clock. Surface row crosses body; marker remains above. Opposite side from departure. | Supported |
| Five haunted landmarks in about twenty minutes | `phase-strip`, fixed voyage clock, repeat width / 1,200 seconds as drift speed. Graveyard, skull rock, chapel, broken masts and lighthouse in the same strip. | Supported |
| Night windows and scenery-bound light/life | Six coast phase sets; shallow beam phase strip with identical repeat width, drift speed and clock. Windows baked into each coast phase. Scenery life belongs in synchronized frames, or transient cycles. | Supported |
| Six tinted day phases; real moody daytime with pale sun | `day-cycle`, `backdrop-cycle`, `phase-tint`; explicit dawn/morning/midday/afternoon/dusk/night art. | Supported |
| Large moon with crossing clouds, full stars, night fog and green glow | Moon/stars in day-aware sky/overlays, cloud drifters over moon, phase-strip mist with night frames, green light glyphs and alpha art. | Supported |
| Calm low mist, gentle swell, wisps, bats | Slow parallax strips, bob/rock, sparse cycles; night-only bats via a small phase-strip animation with transparent non-night frames. `flyby.nightBelow` is a night cutoff, so cannot implement night-only bats by itself. | Supported by composition |
| Busy fog, rising wind, faster sails, stronger green glow | `atmosphere` channels/clocks, intensity variants and cycle opacity/duty; no new busyness semantics. | Supported |
| Storm rain, heavy fog, rough sea and green lightning | Tiled rain/fog, dark overlays, storm wave variants; one `flash` emitter, maximum two frames/3,500 ms, opacity ≤0.6, minimum four dark seconds; lite/still hide flashes. | Supported; weather-fill dependency |
| Peak ghost whale and spectral ship, plus kraken | Separate intensity-gated `cycle`/`strip` elements for whale breach and fog-ship passage. Authored clear-water/transparent rest frames and generous gaps. A distant peak kraken/tendril cycle can occupy a separate region from the departure eater. | Supported |
| All sizes, all motion modes, clickability and preview | Existing fit, motion policies, interaction geometry and manifest preview. Pack geometry, art and verification determine success. | Must pass Stage 2 gates |

## Section 7 preliminary motion audit

Comparison is against the installed Ship manifest at the review base. These are intended implementations;
the finished audit must replace this plan with frame/clip evidence. Structural art may be locally static while
participating in the shared ship bob/rock. No moving creature should be delivered as a frozen action pose.

| Element | Planned motion | Ship comparison / rest policy |
| --- | --- | --- |
| Hull, stairs, rails, porthole rims, mermaid | Whole-stage bob + rock; local structure static | Same rigid-motion approach; structural stability is intentional. Still holds level. |
| Two tattered sails | Registered rest/billow cycles, wind clock and stronger storm variants | Ship main/fore/jib cycles; each cloth must visibly change shape. |
| Rigging | Sway or registered cycle with mast anchors maintained | Add explicit rigging motion instead of leaving fixed ropes. |
| Jolly Roger | Multi-frame flutter cycle | Ship flag cycle; proper resting first frame. |
| Lanterns and nest light | Out-of-phase `flicker` glyph/glow | Ship lights; rows always behind adjacent crew. |
| Green hull seam glow | Small registered alpha cycle, intensity-dependent strength | Additional stage cycle, hull base remains fixed. |
| Hatch swirl | Persistent stage mist cycle | Additional cycle accompanying Ship-style rise. |
| Water | Multiple wave-band frame sets/drift speeds, foam, wake and storm variants | Expand Ship tile/foam/wake into distinct depth bands; calm still art. |
| Fog/mist | Several strips and sky drifters at different speeds, day palettes | Extends Ship cloud layers; phase-aware night thickness. |
| Will-o-wisps | Sparse cyclic paths, nonidentical offsets across width | Additional ambient cycles; hide when motion is reduced. |
| Floating candles | Small bob/frame cycles with authored wave split | Additional water life; stable floating first frame is valid rest. |
| Bats | Night phase-strip frame loop with intervals of empty frames | Night-only substitute for Ship's daytime flyby; lite/still hide. |
| Ravens on yards | Head-turn/wing-settle stage cycles | Comparable to Ship yard-gull/cat; first frame is perched rest. |
| Ghost jellyfish | Pulsing swimming frames beneath water tint | Additional under-surface life; hide or quiet submerged rest in lite/still. |
| Ghost whale | Full emerge/breach/dive/splash/clear-water loop, peak opacity | Comparable to Ship weather creatures; start/end hidden, lite/still hide. |
| Spectral ship | Slow passage frames/strip with a long transparent gap, peak opacity | Ship merchant-passage vocabulary; disappears into fog, lite/still hide. |
| Kraken | Finite departure poses plus optional separate distant peak cycle | Replaces Ship shark; finite eater ends empty water. Ambient cycle hides in lite/still. |
| Anglerfish | Swim/lure frames, loiter, shared-clock ripple | Existing carrier surface; first pose half-submerged in lite/still. |
| Crew | Walk cycles, crank/haul, helm/bow fidgets, sleeping fidgets/breath, reversible climb | Existing cast and transit. Eight looks. Night alpha still needs engine support. |
| Haunted coast | Constant twenty-minute drift; matching phase lights | Existing voyage phase-strip. Buildings remain rigid relative to island. |
| Lighthouse beam | Shallow synchronized animated phase-strip | Existing Ship beam pattern; transparent daytime sets. |
| Sky gradient, sun/moon, stars | Static celestial layout, changing day blend; clouds cross moon | Static background is intentional; sky coverage verified per aspect. |
| Optional ghost drifting through rail | Omit physical off-deck movement; any spectral wisp is decorative | Spec says “might”; preserving clickable inboard feet takes precedence. |

## Section 8 acceptance ledger

All rows are **pending production verification**, not passed by these concept images. No hard gate is waived.

| # | Gate | Concrete Stage 2 proof |
| --- | --- | --- |
| 1 | Level broadside | Inspect final hull and wide/square/tall views; horizontal deck and keel, no diagonal camera. |
| 2 | Animated sail, clouds, rigging and life | Real captured frames/clips at distinct times and the final motion audit. |
| 3 | Creatures in medium | Anglerfish split-row render; kraken waterline crossing in each emergence/sink key. |
| 4 | Real plank and large 1.5–2.5 s eater | Visible full walk, measured 2,000 ms eater timeline, mouth-alignment and disappearance clip. |
| 5 | Ladder behind sails | Depth crop in rest and mid-climb; inspect torn opening and flat mast alignment. |
| 6 | Lights behind crew | Adjacent workers at every lamp, day/night and focus views; no lantern drawn over body. |
| 7 | Crew inside rail | Twenty-four in each state, overlay and before/after bow crops; overflow stays inboard. |
| 8 | Fill every pane shape | Wide, square and tall-narrow captures for six phases plus storm; no seams or blank bands. |
| 9 | Pane-wide weather | Same aspect matrix at storm; depend on reviewed weather-fill fix and inspect very top edge. |
| 10 | Scenery-bound life scrolls | Two distant voyage times with tracked coast/beam landmarks; no fixed life over moving scenery. |
| 11 | Spread life; safe lite/still | Full-width distribution and lite/still/reduced-motion captures; breach creatures hidden/submerged. |
| 12 | Clean animation ends | End-to-start crops for whale, kraken and every life cycle; empty-water rest where appropriate. |
| 13 | Full star field | Night captures across aspect sizes, stars present throughout visible sky. |
| 14 | Water depth | Visible parallax wave bands, foam and underwater layer; motion clip demonstrates different speeds. |
| 15 | Smooth sky | Inspect dithered phase gradients and transition captures for hard horizontal bands. |
| 16 | Storm meets sketch | Compare final peak render/clip directly with `03-storm-peak.png`, including both large set pieces. |
| 17 | 6–8 looks | Eight authored looks/pose atlases and rendered mixed-cast evidence. |
| 18 | Every crewmate clickable at 24 | Existing interaction harness, all four states including each sleeper; logged unique hits and focus. |
| 19 | Preview and name | `preview.png`, manifest display name `Ghost ship`, picker render and lint inventory. |
| 20 | Approved-sketch quality | Side-by-side final day/night/storm and detail renders against this selected set. |

## Build and verification boundary

Reserve floor, eight-look actor scale/feet, twenty-four sleeper slots, ladder opening, light depth, and left
plank/kraken versus right anglerfish bounds before final sprite commissioning. A provisional 640-pixel-wide stage
matches the current Ship scale; final dimensions are chosen from the crowd proof, not forced to the concept raster.
Use explicit crops for props. Budget indexed PNG atlases and six small skies before committing production art;
the final pack is data/art only, includes the picker thumbnail, and contains only manifest-referenced PNGs.

After first-mate selection and engine dependency resolution, use the established tools:

- `npm.cmd run lint:deck-packs`
- `node docs/ship-deck-canvas/compile.mjs` (bundle and Hermes)
- `node docs/deck-settings/render.mjs '?setting=ghost-ship'` and `'?setting=ghost-ship&overlay=1'`
- Existing setting review/interaction harness patterns in `docs/settings/japanese-ship/` and `docs/settings/sky-airship/`
  for the full aspect/phase/motion matrix and 24-crew checks. Capture frames/clips; no custom Pixi-internals observer.
- `node docs/deck-settings/gate.mjs` against the unchanged frozen Ship fixture: 81/81, no baseline replacement.
- `npm.cmd run typecheck`, `npm.cmd test`, review the PR and confirm CI green.

Required PR evidence remains day/dusk/night/storm/tall-narrow renders, alive/departure/peak/night-transparency
clips (including scrolling night lighthouse), completed motion audit and all twenty hard-gate pass records.
None of those Stage 2 checks has been run or claimed for this Stage 1 documentation-only commit.
