# Voyage feasibility, before pack construction

> Historical Stage 1 record. The captain subsequently approved these concepts.
> `phase-strip@1` landed in PR #94; the completed Stage 2 implementation and evidence are in [the voyage README](README.md).

Read against `b09b3b08b849c369226bcb3b88f522998dc35c61` on 2026-10-16, after
fetch/rebase onto `origin/main`. This is a source review and art proposal, not a runtime
prototype. No pack or engine was built. The concepts are in [concepts/](concepts/README.md).

## Contract and installed examples

Sources: [authoring contract](../../deck-settings/authoring.md),
[strict schema/capability catalogue](../../../shared/deck-setting.ts), and the complete
[Ship](../../../art/settings/ship/setting.json),
[Sakura](../../../art/settings/japanese-ship/setting.json) and
[Sky pirates](../../../art/settings/sky-airship/setting.json) manifests.
The engine has two ambience slots, `back` and `front`, each ordered numerically;
stage parts, row-depth crew/furniture and portal effects have their own layers.

| Slot/function | Ship's deck | Sakura coast | Sky pirates |
| --- | --- | --- | --- |
| Stage / fit | 426×161; fit −80…171; bob | 480×320; fit 0…320; bob | 488×320; fit −14…334; bob + rock |
| Back atmosphere | sky 0; overcast 1; stars 2; lightning 3; clouds 4; gull 5 | night sky −3; twinkles −2; moon −1; coast 0; overcast 0.5; lightning 2.5; clouds 3; coast foreground 4 | sky 0; thunderheads 1; lightning 2; clouds 3; wisps 3.1; serpent/gulls/airship 4; cumulus towers 4.8 |
| Back water | sea tile 6 from row 96 | ripple tile 5 from 214; turning wake 6; umibozu 6.5; cranes 7 | far strip 5 at 177; mid strip 6 at 215 |
| Stage parts | tall mast, swaying topmast/masthead, access ladder, cycling sail | fixed rig, swaying masthead, ladder extensions, cycling sail | fixed ship, cycling balloon/rig/flag/two sails/propeller/smoke/vapour, swaying pennant |
| Floor/depth | near rail, mast/bollards, plank, nest rim; barrel/crate/rope props; 3 lights | hull front, mast/ladder, stern shelter, plank, lookout perch; chochin lights | hull front, engine front, ladder, stern rail, plank; lanterns/firebox |
| State → zone | working→station, waiting→helm, blocked→bow, idle→rest portholes | working→rigging, waiting→stern, blocked→bow, idle→rest windows | working→engine, waiting→helm, blocked→bow, idle→rest windows |
| Foreground | same sea tile from 151; wake 7; foam strips 8; spray 9; serpent/kraken 10 | same ripple tile from 290; rain/spray 11; petals 12 | sea-floor tile 4.9 from 398; near strip 5 at 286; mist strip 6 at 301; rain 10 |
| Independent carrier | half-submerged suggestion shark, water clock | half-submerged suggestion shark | half-submerged cloud whale |
| Portals / raised post | hatch rise; reversible nest climb; plank + shark/splash; hatch sink also defined | hatch rise; lookout climb; plank + dragon/splash | hatch rise; lookout climb; plank + whale/splash |
| Named image bytes (measured) | 488,670 | 886,395 | 966,489 |

Ship's `sea-still` and `foam-still` occupy their corresponding primary element's slot
as fallbacks, not additional permanent layers. Sakura splits background clouds from
foreground coast using two matching backdrop cycles. Sky's bottom tile continues its
short strips through tall panes. Adopt those separation/coverage lessons without
copying their art. Retain Ship's state meanings and all eight crew looks if budget permits.

## A concrete route using the current engine

1. Commission a transparent **2048×96** low-palette coastline plate. Four 512-pixel
   regions hold cove/skull rock, ruined fort, port and lighthouse, with reef/open-water
   gaps. Use one frame, not hundreds of pre-scrolled images. Terrain is behind the
   hull, with contact foam and dark submerged roots. Its first and last columns must
   form a verified seamless open-water gap. The wide concept is the composition brief,
   not that deliverable.
2. Use one `strip@1` element, `slot: back`, after base ocean and before the ship;
   e.g. order 6 with ocean at 5, `top: horizon−90`, `frames.frameMs: 1000`, one sprite,
   `drift: {pxPerSecond: 1.7, clock: voyage}`. Define atmosphere clock `voyage` on
   channel `voyage-pace`, fixed to 1 in **every** table row and in `delivered`.
   Weather must not speed up the route. The ocean/wake and cloud clocks may still accelerate.
3. `[floor(t×1.7) mod 2048]` advances one pixel about every 0.59 seconds; a region
   center passes every 301 seconds and the complete loop is 1,205 seconds (20m05s).
   Rightward world drift suits this left-facing ship. `foamSegments` samples
   `x−offset`, so the camera encounters texture regions in descending source-x order:
   author the production texture order accordingly. Do not accidentally sail backwards
   or silently reverse the captain's route. Initial visible region is an offline art
   offset, not a runtime route controller.
4. `strip.span` is fixed world coordinates, **not viewport coverage**. For an initial
   640-pixel-wide stage, a generous span such as −4096…4736 covers ordinary pane
   aspect ratios; test extremes and focus. It may repeat landmarks in very wide panes.
   Beyond that span the transparent coast may end over continuous open sea. Sky and
   sea must never depend on the strip for coverage: use `backdrop-cycle` sky with its
   automatic top/side expansion and `tile` ocean bands extending to the visible bottom.
   Blend land roots locally; avoid a solid rectangular bottom to the coast plate.
5. Use `lite: run`, `still: first-frame`. Hidden panes pause the existing simulation;
   reduced motion shows the calm first route position. Mount resets the route clock;
   persisted route progress is **not** currently supported and is not necessary here.
   It is a loop of scenery, not a navigation game or reward system.

Relevant implementation: [strip/crop and tile renderer](../../../client/deck-environment.ts),
[whole-pixel offset / backdrop fit](../../../client/deck-sky.ts),
[integrated atmosphere clocks](../../../client/deck-atmosphere.ts).
A long strip increases cached crop textures: up to roughly two crops per offset per
frame (around 4,096 for one 2,048-pixel frame/span combination, plus variants), not
4,096 image buffers. Later implementation must profile a full lap and repeated
resizes; do not assume the old foam strip's “few hundred objects” estimate still holds.

## Why the other primitives do not replace it

| Primitive | Useful here | Boundary |
| --- | --- | --- |
| `tile@1` | Full-height animated sea; slower far ripples, faster near water; weather variants | Repeats vertically too, so a coastline tile would duplicate islands down the sea. |
| `strip@1` | Ordered panorama and sparse passing-vessel lanes | Positive horizontal drift; fixed span; no day-phase tint/frames/alpha. |
| `drifters@1` | Day-colored clouds, sparse distant silhouettes | Three-color mask palette; seeded positions/speeds and lane selection. A single huge three-color panorama sprite could pass with an open gap, but sacrifices full-color art and exact route timing. It cannot deliver the detailed concept coastline unchanged. |
| `flyby@1` | Occasional gulls/flying fish; frame-based dolphin leap across a narrow water lane | Seeded direction, straight travel plus sine wobble; no intensity variants or opacity and no authored arbitrary jump path. Night cutoff exists. |
| `backdrop-cycle@1` | Sky and static day/night scenery | Day crossfades, no horizontal drift; scaling it wide does not make a voyage. |
| `day-cycle@1` | Existing local-time day/night, stage tint and night overlays | Wall time, not simulated route time; does not select strip art. |
| `atmosphere@1` | Independent route/water/wind clocks; busyness-triggered variants | Intensities/channels are not day phase or arbitrary script conditions. |

**Core voyage: feasible, no new capability. Full illustrated night coastline: a real
gap.** `stage.tintByPhase` does not tint ambience. `overlay.alpha: night` is tied to
a static backdrop placement and would leave a beacon behind as its lighthouse moves.
`phase-frames` selects a fixed-position hourly/minutely sprite and cannot share strip
drift. Baking sunrise into the route would break the existing local day/night.

For the complete art direction, propose a separately reviewed generic capability,
provisionally **`phase-strip@1`** (not in today's catalogue): same strip placement,
wrap, clocks and motion rules, but same-sized frame sets by existing day-phase ids,
blended at one identical frame index and horizontal offset. A night frame can contain
lit windows and a beacon; a small synchronized phase-strip of beam frames can make it
sweep without animating the entire coastline. It must preserve old strip pixels and
validate phase references, sizes, frame counts, reduced-motion and fallbacks. No ship-id
branch, scripting, route hooks, new timer or general-purpose behavior system.

A data-only alternative keeps a neutral darker coastline and an always-lit small beacon.
That preserves the voyage plus day/night sky/ship, but does **not** meet “lighthouse
lights only at night.” A three-color drifter palette can emphasize a beacon at night,
but cannot faithfully preserve the full-color coastline/beam. Do not present either
compromise as the complete concept already supported by the engine.

## Life, rigging and retained behaviors

- Merchant/navy lane: a mostly transparent 1,536-pixel strip with a small merchant
  embedded, a blank crossfade variant at medium intensity, and a navy variant at the
  highest intensity (e.g. fade in from 0.8 to 1). All use identical frame counts and
  the same offset. A ship appears every few minutes; this is an occasional chase, not
  an immediate guaranteed pursuer on the first busy frame. For a constantly present
  pursuer, use a fixed `cycle` with intensity opacity near the stern instead. `flyby`
  cannot provide the activity switch. Neither mechanism implements AI pursuit.
- Dolphins: a few registered leap/re-entry/splash frames with waterline-aware art;
  `flyby` for crossings or an anchored `cycle` for repeated alongside arcs. Whale:
  small distant `cycle` with quiet frames and a short spout; reuse transparent/quiet
  frames to space appearances. Fish/gulls: sparse flybys. Perched gull and cat:
  stage-part cycles with quiet frames. These are authored poses, not procedural limbs.
- Separate the three sails, flag, rig accents and cat/gull from fixed hull art; use
  stage-part cycles/sway. Keep ladder pixels behind sail parts and a visible transit
  route. Lantern depth rows must lie behind the crew routes they illuminate.
- Preserve the four **state zones**, including multiple posts and crowd overflow,
  the reversible crow's-nest transit, cropped hatch rise, plank queue and finite
  shark/splash choreography, idle portholes, carrier-surface shark, all day phases,
  storm sea, lightning limits, kraken and serpent. Remap geometry deliberately to
  a larger proposed 640×400 stage; multiplying old coordinates is not sufficient.
- Opt into `stage-rock@1` gently (roughly 0.3° calm to 1° busy, then validate). Sky,
  panorama, water and carrier remain level. Leave full fit clearance at flag and bow.
  World portal effects do not rock with the ship; keep the departure handoff small
  and verify it at both extremes. No new motion is necessary for the static sketches.
- Keep scenery, ship dress, cast and navigation geometry separate with stable ids.
  Future reward work can replace/add art through a later explicit design without
  embedding levels, unlocks, persistence or progression in this stage.

## Image budget proposal

The 1,000,000-byte cap is the sum of named PNG files, including previews/fallbacks;
JSON/base64 overhead is separate. These are **allocation targets, not measurements**
of a built remaster. Full-resolution concepts are documentation and do not ship.

| Production allocation | Target bytes |
| --- | ---: |
| Hull, sails, flags, rig, dressed furniture and pet/perch frames | 170,000 |
| Crew looks, poses and idle windows | 150,000 |
| Sky phases, clouds, overlays and lightning | 70,000 |
| Coast panorama, including compact day/night plates if approved | 140,000 |
| Animated sea, foam, wake and storm alternatives | 160,000 |
| Dolphins, whale, fish, merchant and navy | 65,000 |
| Existing behavior set: shark carrier, departure effects, kraken/serpent | 100,000 |
| Preview, small fallbacks, contingency | 85,000 |
| **Total / headroom** | **940,000 / 60,000** |

Commission low-palette native pixels, indexed PNGs where appropriate, small independent
motion plates and reused sprite rectangles. One 2048×96 indexed coastline has 196,608
uncompressed palette indices before PNG compression; 140 KB for multiple sparse
plates is plausible, not guaranteed. Measure before approving production art; reduce
texture complexity/frame counts or route resolution if needed, never silently raise
the cap. Run pack lint and inspect the decoded result. A full-screen animation filmstrip
would waste this budget and make the future engine tests harder.

## Preserve the 81-shot baseline

The current [gate](../../deck-settings/gate.mjs) compares each revision's own Ship pack
through its server RPCs. Replacing `art/settings/ship` changes almost every shot, so
blanket expected-hash updates would erase the engine regression reference.

Before remastering, make a separate test-infrastructure change:

1. Copy today's exact manifest and every named PNG to a test-only directory such as
   `test/fixtures/deck/ship-baseline/`, with source commit and file hashes. Keep the
   manifest id `ship` in this test world. Place it outside `art/`, which keeps it out
   of both picker discovery and package delivery without adding a production `hidden`
   field (the strict schema has no such field).
2. Adapt the gate's **test host/RPC fixture wiring**, not production discovery, to
   feed those same frozen bytes to both compiled engines. Verify the adapter against
   the old 81 renders before moving on: same ids, metadata, deterministic clock,
   weather, full/lite/still, crowd, focus and departure scenarios. Pin/review fixture
   hashes; engine changes must not casually update them. Keep separate integration
   checks for the real installed-pack reader and fallback/selection behavior.
3. Separate tests intentionally tied to old Ship pixels in `test/ship-pack.ts` from
   lint/geometry tests of the installed remaster. Add a new remaster baseline and
   route-boundary/seam/day-night/tall-pane/rocking/crowd checks after approval.

Do not freeze the engine to an old commit: the stable **art/input fixture** should run
through current and candidate engines. No fixture migration, baseline rewrite or
81-shot gate run is claimed in this concept-only change. All runtime paths and
installed art remain byte-identical to the base revision.
