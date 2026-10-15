# Animated water for Hull C

**Wake angle revision (2026-10-15):** the shipped wake is now the [regenerated steeper trail](../wake-angle/README.md), with the far ridge increasing from about 6.6 to 16 degrees down-right. The same three 240x96 frames, names, stern anchor and timing are retained. The [current manifest](manifest.json) and [current verification](../wake-angle/verification.json) describe the replacement. Original wake sources and review images in this directory remain historical evidence; the current strip is `wake/strip.png`.

Generated sea, hull-contact foam, and a connected stern wake. This began as an **assets-only handoff**;
the Deck now draws it through [`extras.json`](../../../art/ship-deck/extras.json)'s `water`, which copies the frames, timing
and placement below (`client/deck-water.test.ts` holds the two to each other). The companion
[manifest](manifest.json) describes these frames; it is not an instance of the runtime
`DeckEnvironmentManifestSchema` or `DeckExtrasManifestSchema`.

| Asset | Frame size | Frames | Loop | Verdict |
| --- | --- | --- | --- | --- |
| `sea/frame-{0,1,2,3}.png` | 256 x 128 | 4 | 960 ms | usable |
| `foam/frame-{0,1,2}.png` | 256 x 16 | 3 | 720 ms | usable-with-cleanup |
| `wake/frame-{0,1,2}.png` | 240 x 96 | 3 | 720 ms | usable |

Each folder also contains `strip.png`, with the same frames **left to right, no padding**.
Play frames in ascending order at **240 ms per frame**, looping to zero. Hold frame zero for reduced
motion. These are distinct generated poses: crests and eddies change shape even with sea drift disabled.
Use nearest-neighbour filtering at the existing deck's world scale: one image pixel is one logical
pixel of the 426 x 161 hull and 32 px sailor. Do not stretch the wake independently.

## Placement

Coordinates below are Hull C's deck-world coordinates, x right, y down, with the hull at `(0,0)`.
The ship sails **left**. Draw sky/clouds, far sea, hull/crew, near sea, wake, then foam.

- **Sea:** one tile works for both bands. Far sea starts at `y=96`. Near sea starts at `y=151`, in
  front of the bottom of the hull. Both must use the **same frame, drift and tile origin**. Sample
  `x = positiveModulo(worldX - driftX, 256)` and `y = positiveModulo(worldY - 96, 128)`. Thus the
  near band's first texture row is **55**, not zero. Optional whole-pixel drift is 10 px/s to the right,
  matching the current implementation; independent frame cycling supplies the wave motion.
- **Waterline foam:** place its top at **y=142**, with source row **9** at waterline **y=151**.
  Repeat horizontally and clip to **x=68 through x<392**. The new top differs from the old strip's
  `FOAM_TOP=145`: using the old top would lower this band by three pixels. No vertical repetition.
  Keep it in environment world coordinates, like the existing foam; the crest height bridges hull bob.
- **Wake:** local anchor **(8,8)** goes on stern water contact **(392,151)**, so the sprite top-left is
  **(384,143)**. It occupies a 240 x 96 canvas, opening right and down. Keep that anchor fixed and
  cycle its textures; do not translate the whole wake with the sea's drift. A compact foam knot extends
  two pixels above the nominal waterline to overlap the stern, while the widening arms lie below it.
  Avoid hard-clipping that knot at y=151. All outside borders are transparent. It is **not a tile**.
  Replace `wakeRuns` / `wakeLayer` output rather than drawing both. This asset supplies a stern V;
  it intentionally does not duplicate the old code's long bow-wave arm.

These coordinates map directly to `HORIZON`, `WATERLINE`, `FOAM_SPAN`, and `STERN` in the current
`client/deck-ambient.ts`, `client/deck-environment.ts`, and `client/deck-wake.ts`. No changes to those
files are part of this branch. The integrator will need to extend the loading/animation contract.

## Palette, seams and provenance

All nontransparent runtime pixels are exact members of the **existing 64-colour environment palette**,
including the unchanged 48 deck colours. No new colours, antialiasing or dithering. Sea uses eight
navy/blue colours; foam eight blue-grey/cream colours; wake thirteen. Alpha is opaque for sea and binary
for foam/wake, with zero RGB in transparent pixels.

Every sea frame has byte-identical opposite columns **and** rows. Every foam frame has identical
opposite columns and clear top/bottom rows. The [2 x 2 repeat](review/sea-repeat-2x2.png) was visually
inspected as well as checked numerically. Wake borders are transparent, but seamless tiling is neither
required nor claimed for a finite stern trail.

The original set was made with **four built-in `image_gen__imagegen` calls** on 2026-10-15; the later wake angle revision used eight additional calls, documented above. The backend model is not disclosed
by the tool. [Provenance](provenance.json) contains every exact prompt, reference hash and source hash;
all four original generated sheets are retained under `source/`. The first wake sheet was superseded
by a generated correction that lowers its upper arm to fit the stern's water plane.

Cleanup was mechanical: crop frames, block-median sample onto the deck pixel grid, register the third
foam/wake pose by one pixel, threshold alpha, map to the fixed palette, and reconcile tile edges.
The manifest records every crop, threshold and seam rule. No wave shapes were drawn in code.
Review composites only layer those generated assets with the existing hull and sky. Distributed under
the repository MIT license; AI-generated artwork, without a claim of human authorship or exclusive
copyright. No third-party art was used.

## Original-generation review and limitations (historical)

[Hull fit at 2x](review/hull-fit-2x.png) shows the palette, contact and wake direction. The
[contact sheet](review/contact.png) shows every pose. Animated PNGs are supplied for the
[sea](review/sea-cycle.png), [foam](review/foam-cycle.png), [wake](review/wake-cycle.png),
[tiled sea](review/sea-repeat-cycle.png), and [combined hull fit](review/hull-fit-cycle.png).
An APNG-capable viewer is needed; other viewers display the first frame. The composite uses the original
bare Hull C atlas to isolate the water fit; it is not a screenshot of the live deck.

- **Sea — usable:** broader connected wavelets and restrained four-pose shimmer. The 2 x 2 repeat has
  no visible boundary. Large wave patterns remain recognizable across wide expanses; this is a calm
  pixel-art cycle, not a fluid simulation.
- **Foam — usable-with-cleanup:** aligned, tiling and ready to animate, with thinner crest highlights
  than the shipped white blobs. Crest clusters still rise unevenly and the baseline sometimes reads
  as a narrow ribbon. A pixel artist could refine that breakup further.
- **Wake — usable-with-cleanup:** a clear connected V with disturbed blue water and foamy arms,
  fitted astern rather than scattered dashes. Generated interior eddies morph between key poses;
  far tips change silhouette slightly. A pixel artist could improve directional flow and in-betweening.

[Verification](verification.json) records dimensions, hashes, colour membership, alpha, edges, bounds,
and every cyclic frame transition, including last-to-first. Pixel/strip/APNG checks and static frame
composites were inspected. Browser playback was unavailable in this session, and runtime integration
was outside scope; neither is claimed as tested. No asset requires a human artist to wire it in,
but the foam and wake verdicts deliberately retain their animation-polish caveats.
