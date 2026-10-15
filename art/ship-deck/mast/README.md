# Taller mast for hull C

**Verdict: usable.** Generated with the built-in `image_gen__imagegen`, then mechanically sampled to the shipped deck's pixel grid and exact palette. The crow's nest sits well above the crew, with room for the existing yard and sail below it. The foot and lower shaft are copied pixel-for-pixel from hull C so the deck join stays exact.

This is an assets-only handoff from `92e1e4c72e1ad15e238513c2b9042e0a86704e73`. No runtime wiring or existing art was changed. No plugin was installed or reloaded.

| Asset | Dimensions | Placement in hull coordinates |
| --- | --- | --- |
| `tall-mast.png` | 48 x 224 | Top-left **(187, -112)**; local anchor **(24, 222)** maps to hull **(211, 110)** |
| `mast-occluder.png` | 19 x 64 | **(202, 48)**, depth baseline **110**; identical pixels to the existing sail occluder |
| `fit-preview.png` | 1704 x 608 | Review only: original left, proposed right, both enlarged 2x |

Both runtime sprites have binary transparency (alpha 0/255), no background, no dithering and no RGB colours outside the exact 48-colour `deck.png` palette. The mast uses 43 of those colours. One art pixel equals one hull pixel; enlarge with nearest-neighbour sampling.

## Fit and height

The main shaft occupies **hull x207..215 inclusive (9 px)**, with its 19 px foot at **x202..220**. Its top is now **hull y=-110**, compared with the original tip at **y=1**: **111 px added upward**. Tip-to-baseline height increases from 109 to 220 px. The sprite continues to hull y111, matching the original foot's bottom edge. Hull rows 73..111 of the lower depth piece are pixel-identical to the original.

The crow's nest occupies sprite **[6,22,37,23]**, or hull **[193,-90,37,23]** (x, y, width, height). Small side attachment lugs are centered around sprite **(16,46)** and **(32,46)**, mapping to hull **(203,-66)** and **(219,-66)**. The mast tip extends above the basket. Long rigging is left to the build worker.

## Sail and compositing handoff

The existing `../sails/main-sail.png` has two 114 x 27 frames. The preview places either frame at **hull (154,-15)**, without scaling. Its local yard lashing pivot **(57,3)** then meets the new pole at **hull (211,-12)** / **mast-local (24,100)**. This is 61 px above the old sail position. There is a continuous clear shaft from local y49 through y184, so the build worker can adjust that position or refit the cloth. No yard or cloth is baked into this mast.

Remove the old baked crow's nest, upper mast and old diagonal ropes when compositing the replacement. Draw the new mast behind the sail and crew, then use the supplied lower mast occluder in the existing depth pass at baseline 110. The original sail occluder can also be reused: the included copy is pixel-identical. Crew passing behind the foot retain the existing occlusion.

Allow negative hull y in scene bounds and masthead motion; the original 426 x 161 hull rectangle would clip this sprite. Keep the foot fixed while fitting any sway or rigging. The preview is a static fitting study, not a replacement hull: old rope remnants at the deck edge remain, and new long ropes have not been added. It uses identical shipped 32 px crew on both sides to make the height comparison clear.

## Provenance and checks

[Manifest](manifest.json) records coordinates, palette, normalization, provenance and verdict. [Prompts](prompts.json) records the exact single built-in generation call and its reference crop. The tool does not disclose its backend model. [Source PNG](source/generated-mast.png) is the unmodified 734 x 2142 generated artwork, retained for provenance and resampling; it is **not a runtime sprite** and is not constrained to the final palette.

Cleanup used C# `System.Drawing`: majority coverage at alpha >=128, median opaque RGB per source block, and nearest squared-RGB mapping to the deck's 48 colours. The generated shaft was normalized to nine logical pixels, with no hand drawing. The original lower mast was copied in for an exact join; the generated foot was discarded. The manifest records the exact sampling transform and source hash.

[Verification](verification.json) records exhaustive checks after independently reloading the PNGs: no partial alpha, no colours outside the deck palette, exact shaft width, exact lower section and occluder, anchor arithmetic, sail pivot and SHA-256 hashes. The normalized mast and side-by-side preview were visually inspected. No application tests were run for this assets-only addition.

At native scale the sprite is usable with the current deck art. Mechanical sampling leaves some uneven wood-grain clusters when enlarged, as in the shipped assets. Runtime clipping, rope fitting and motion remain integration work, rather than defects concealed by the verdict.
