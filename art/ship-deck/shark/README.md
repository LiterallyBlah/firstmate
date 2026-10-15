# Shark exit and splash art

Generated shark and water-impact keys for the near sea in front of hull C. This is an asset-only
handoff; nothing is wired into the Deck, and no existing runtime manifest is changed.
All paths in [manifest.json](manifest.json) are relative to `art/ship-deck/`, including its sibling
`splash/` directory. The manifest is a new integration contract, not an existing RPC schema.

| Asset | Frame / sheet size | Verdict | Limitation |
| --- | --- | --- | --- |
| `fin.png` | 64 x 64 | usable | One fin-and-ripple key; translate it to approach. |
| `surface.png` | 64 x 64 | usable | One closed-mouth surfacing key. |
| `chomp.png` | 64 x 64 | usable | Open jaws and teeth read clearly; no separate jaw-closing drawing. |
| `submerge.png` | 64 x 64 | usable | Low head/back/fin key; hide after the splash. |
| `strip.png` | 256 x 64, four cells | usable-with-cleanup | Four action keys, not a fluid anatomical cycle; an artist could add inbetweens and a jaw-close. |
| `../splash/impact.png` | 48 x 40 | usable | Compact crown and droplets, 24 x 24 visible pixels. |
| `../splash/burst.png` | 48 x 40 | usable | Wider falling burst, 38 x 21 visible pixels. |
| `../splash/strip.png` | 96 x 40, two cells | usable | Two keys; hide to finish rather than looping indefinitely. |

The optional plank was skipped. A simple board drawn by the integration worker can fit the selected
rail exit without constraining that exit to a new prop's perspective. No asset is classified
`human-artist-wanted` as a blocker, but a human animation pass would improve the shark's motion.

## Pixel scale, colour and anchors

Use one asset pixel per hull pixel, with nearest-neighbour sampling. The existing hull is 426 x 161,
and its standing sailor is 32 pixels high. The largest shark frame is 52 x 44 opaque pixels including
its ripple: somewhat larger than a sailor, still small beside the ship. Do not resize each pose to its
opaque bounds: the padding is part of the shared registration.

Every shark cell has water-contact anchor **(32,50)**; all four waterline bottoms occupy row 52.
The splash anchor is **(24,32)**; both splash silhouettes end at row 33. These anchors describe the
water contact, not feet or the centre of the image. To place a frame at water point `(wx,wy)`, draw
its top left at `(wx-anchor.x, wy-anchor.y)`.

All opaque colours are exact members of `environment.json`'s existing 64-colour palette; **zero new
colours** were introduced. The splash uses precisely the six colours of `sea/foam-strip.png`:
`#2C4869`, `#45617A`, `#64849A`, `#8FA8B4`, `#BECAC6`, `#E8CCA6`. The shark adds only existing dark
navy shades. Each runtime PNG has alpha 0/255, transparent RGB zero, and transparent edge padding.
No quantization or alpha cleanup is left for integration.

## Placement and bite cue

`client/deck-ambient.ts` places the existing waterline at **y=151**. The fit preview places the shark's
water anchor at **(250,177)**, 26 pixels in front of that line; its top left is **(218,127)**. Its open
mouth centre is approximately **(45,28)** within the chomp cell, or **(263,155)** in this example.
That is **(+13,-22)** relative to the shark water anchor. It is an animation cue, not a precise
collision shape.

For a sailor landing beneath those jaws, place the splash water anchor at **(263,177)**, top left
**(239,145)**. The integration can choose another near-sea point and translate these offsets together.
Do not stretch the splash to the shark cell size. For a left-facing encounter, mirror about the water
anchor and negate the mouth's horizontal offset.

Draw in this order: ship and deck crew; near sea, wake and hull foam; falling sailor; shark; splash.
The shark's body can overlap the lower hull naturally because it is in the foreground. Attach effects
above `scenery.front`, outside the ship's bob transform. Their anchors stay in world space; neither the
ship bob nor the sea texture scroll should move the contact point during the bite.

**Reserve space below the hull.** The example has opaque pixels through world y=179. A viewport bottom
of at least 181 is needed, with 190 recommended for breathing room. The existing 161-pixel hull fit does
not guarantee this space; the integration worker must account for viewport clipping. This branch does
not change viewport geometry or the sailor's rail path.

Suggested one-shot playback: fin 300 ms, surface 160 ms, chomp 180 ms, submerge 180 ms, then hide.
At water impact, play splash impact 100 ms then burst 140 ms; reuse burst over submerge for the bite
finish if desired. Hide the sailor during the chomp cue, before submerge. The open jaws plus the burst
carry the gag; no gore, victim, or disappearing sailor is baked into any texture. Avoid looping the
entire attack. Reduced-motion handling belongs to integration.

## Provenance and evidence

Generated on 2026-10-15 with the built-in `image_gen__imagegen` in **two calls**, well within the
15-20-call budget. The tool does not disclose its backend model. References were the shipped
`deck.png` and `environment-detail.png`; the splash also followed the generated shark style in context.
No third-party art was introduced. [provenance.json](provenance.json) preserves the exact prompts,
source SHA-256 hashes, dimensions, retained source paths and mechanical sampling recipe.

Cleanup used C# `System.Drawing`: block-median sampling of source pixels with alpha >=192, majority
coverage for binary alpha, and nearest squared-RGB palette mapping without dithering. All shark frames
use the same 9.2 source-pixels-per-logical-pixel scale; both splashes use 19. The differing source grid
sizes are normalized to the common shipped pixel grid. There was no hand repainting or procedural
replacement of the generated artwork. Original high-resolution PNGs remain on the generation host
outside the checkout; hashes identify them and no build-time dependency on them is introduced.

- [Contact sheet, 6x](contact-6x.png): four shark keys above both splashes, transparent background.
- [Hull fit, 2x](hull-fit-2x.png): fin, surface with impact, chomp, submerge with burst; original sea,
  foam and hull, with an original 32-pixel sailor standing on deck for scale.
- [Chomp fit at native scale](hull-fit-native.png): review composite, not a runtime sprite.
- [Verification report](verification.json): independent final-PNG reload, palette membership, binary
  alpha, transparent RGB, padding, and pixel-for-pixel strip/individual-frame equality.

Only the eight runtime PNGs listed under `assets` are integration textures. Previews are review images.
Validation covers these files and static composites; the plugin was not wired, run, installed or
reloaded. Distributed under the repository's [MIT license](../../../LICENSE); AI-generated provenance
is not a claim of human authorship or exclusive copyright.
