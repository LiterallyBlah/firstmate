# Sky airship — concept decision

Stage 1 only, awaiting the captain's pick. One coherent design: a level wooden broadside beneath a
patched cream balloon, sage/coral patches, restrained brass, short side sails and a sky-whale companion.
Generated with the built-in ImageGen tool on 2026-10-16. Exact prompts and input references are in
[prompts.json](prompts.json); each entry names its corresponding image.

| Image | What to review |
| --- | --- |
| [01-day.png](01-day.png) | Overall silhouette, balloon lookout, crank engine, stern wheel, hatch, hammock windows, floating islands and cloud sea. |
| [02-night.png](02-night.png) | Same ship under moonlight, stars, amber lanterns and firebox glow. |
| [03-storm-departure.png](03-storm-departure.png) | Lightning, rain, strained sails, distant sky serpent, and the plank departure into a whale's mouth through a cloud puff. |
| [04-suggestion-whale.png](04-suggestion-whale.png) | Enlarged companion detail: cloud bank overlaps the lower body; mist crosses the surface; speech marker remains clear. |

These are 1536×1024 generated concept illustrations, composed for a 480×320 logical stage, not registered
sprites or exact nearest-neighbour exports. The first three share a camera; the fourth is a magnified
detail. They establish the look, not animation, final palette limits, geometry or runtime behaviour.
Stage 2 must simplify/commission the art at native scale (roughly 32-pixel crew, 40–42 pixels with badge),
keep the carrier around 56–64 logical pixels wide, and reserve room for badges and crowd overflow.
The large whale in the storm shot is the separate departure effect; hiding the suggestion carrier there
is a concept composition choice, not a proposed engine rule. Bow station and departure queue must be
separate reachable locations in the final layout; the sketches use the left plank to demonstrate scale.

## Capability check

Read against [authoring.md](../../../deck-settings/authoring.md),
[the executable contract](../../../../shared/deck-setting.ts), and both installed manifests at
`47e305d6357bb9f7400862d9ea6418137a85178b`. Ship provides full motion/weather/departure reference;
Sakura coast provides the 480×320 broadside art and carrier-surface reference (its current manifest
does not itself contain Ship's full departure/weather set).

**No new engine behaviour is expected.** Every requested slot has a data/art implementation:

| Parity slot | Existing capability / authoring approach |
| --- | --- |
| Cranking amidships; wheel on raised stern; blocked at bow/figurehead | `floor@1`, `zones@1`, `cast@1`, `pose-fidgets@1`; reachable deck, stair and bowsprit geometry, crank poses. |
| Sleeping in hammocks inside round windows | `zone-appearance@1`; fixed sleeping-window handles above hull-front piece, preserving worker identity. |
| Rope climb to balloon-top lookout | `post-transit@1`; reversible authored route, climb poses and piece-relative depth; overflow remains on deck. |
| Climb up through hatch | `rise@1`; cast artwork and hatch rim provide the climbing impression. |
| Plank → cloud puff → whale swallow | `choreography@1`; finite jump/reveal/gone segments, named cloud-impact and swallow events, aligned whale/puff effect frames. |
| Small whale half-sunk in clouds | `attention-carrier@1` + `carrier-surface@1`; faint cloud-tinted lower rows, pale mist-coloured surface arcs, scalloped mist painted into carrier frames. Carrier draws above foreground, so foreground clouds alone cannot mask it. |
| Scrolling cloud sea, vapour trail, mist wisps | `tile@1`, `strip@1`, `cycle@1`, `drifters@1`; authored cloud art in back/front bands and shared clocks. |
| Billowing sails, breathing balloon, air rocking | `cycle@1` frame swaps for sails and balloon contour; `sway@1` for rig/parts and `bob@1` for whole stage. Breathing is drawn frames, not runtime mesh deformation. |
| Lanterns and firebox | `flicker@1`; separate light styles/glyphs and warm glow inks. |
| Pink-gold dawn, blue midday, amber dusk, moonlit night/stars | `day-cycle@1`, `backdrop-cycle@1`, `phase-tint@1`, `overlay@1`; moon in night backdrop, stars in night overlay. |
| Calm birds and distant airship | `flyby@1`; separate sprite sequences and paths. |
| Busy wind, racing clouds and strained sails | `atmosphere@1`, `variants@1`; intensity tables drive clocks, frame duty and cloud/sail variants. |
| Storm thunderheads, rain and lightning | `overlay@1`, `drifters@1`, `tile@1`/`cycle@1`, `variants@1`, `flash@1`; authored rain frames, existing single-emitter flash caps retained. |
| Peak-storm sky serpent | `cycle@1` + `variants@1`/intensity opacity, like Ship's serpent slot; looping coiling frames, not procedural creature motion. |
| Crew looks/fidgets, focus, replies and scene picker | `cast@1`/`pose-fidgets@1` plus existing engine interactions and pack discovery; no custom callbacks. |

Visual inspection: the three full scenes retain a horizontal hull and consistent balloon patches;
night preserves readable warm lights; the storm separates the falling sailor and whale mouth from the
hull; the companion detail has no air gap beneath its body. These static concepts do not prove motion
parity. The storm illustration is a single illustrative flash, not a proposed flash intensity or rate.

After the captain chooses the look: commission native-scale layers, poses and effects, check every
motion slot, carrier cloud overlap, full/lite/still and interaction behaviour; then pack lint, Ship gate,
Hermes, full checks and CI through the Sakura-coast review process. No pack, runtime code, installation,
reload or PR is part of this stage.
