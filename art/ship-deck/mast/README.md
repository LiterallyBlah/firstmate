# Trimmed tall mast for hull C

**Verdict: usable.** The crow's nest is 32 logical pixels lower, with 23 clear rows between the basket bottom and fixed yard pivot instead of 55. Tip-to-deck-baseline height is 188 px, compared with 220 px for the previous tall mast and 109 px for the original short mast.

Assets-only handoff on `fm/deck-mast-trim`, based on `0355284c5ce6e97f30cd79cdd1906103b6979777`. Eight built-in `image_gen__imagegen` edits were compared; candidate 6 supplies the shortened wood join. The shipped masthead, complete nest and lugs are preserved pixel-for-pixel, as is everything from the yard down through the foot. No art was hand-drawn in code.

| Property | Previous tall mast | Trimmed tall mast |
| --- | --- | --- |
| Texture | 48 x 224 | **48 x 192** |
| Texture origin in hull | (187, -112) | **(187, -80)** |
| Local base anchor | (24, 222) | **(24, 190)** |
| Base anchor in hull | (211, 110) | **(211, 110), unchanged** |
| Tip in hull | y=-110 | **y=-78** |
| Nest bounds in hull, XYWH | (193, -90, 37, 23) | **(193, -58, 37, 23)** |
| Yard pivot in hull | (211, -12) | **(211, -12), unchanged** |
| Yard pivot in mast texture | (24, 100) | **(24, 68)** |
| Basket-to-yard clear rows | 55 | **23** |

The 23-row interval is hull y=-35 through -13 inclusive, below the basket and above the yard pivot. The retained small lugs occupy its first few rows; 19 rows are clear pole below the lugs. The nest itself is 23 px high. The 9 px shaft still occupies hull x207..215; the 19 px foot still occupies x202..220. The opaque mast spans 190 rows including the foot below baseline. All yard-to-foot pixels retain their exact hull positions.

## Sail and integration

The current `../sails/main-sail.png` is a 228 x 84 strip containing two **114 x 84** frames. It is unchanged, at hull **(154, -15)**; its local yard pivot **(57, 3)** remains hull **(211, -12)**, exactly **122 px above baseline 110**. The sail manifest's old mast-local coordinate (24,100) refers to the previous mast; this manifest supersedes that mast-local coordinate only.

Apply the mast's new **size [48,192] and position [187,-80]** when integrating. `../extras.json` remains unchanged and still describes the previous 48 x 224 mast at (187,-112); replacing only the PNG under that origin would lift the foot incorrectly. The [manifest](manifest.json) contains the exact `integration.metadataToApply`. Retain the sail placement, foot anchor, crew scale and occluder. Any nest rigging must follow the lowered attachment points at hull (203,-34) and (219,-34).

`mast-occluder.png` is unchanged at 19 x 64, positioned at hull (202,48), depth baseline 110. No wiring, PR, install or reload is part of this branch.

## Review assets

- [fit-preview.png](fit-preview.png): 1704 x 608, current tall mast left and trimmed mast right, both at 2x with the same current tall sail, hull and crew.
- [fit-native.png](fit-native.png): 426 x 304, trimmed fit at native resolution; hull offset (0,130).
- [candidates-3x.png](candidates-3x.png): eight normalized candidates, left to right 1 through 8. Only the generated join varies; candidate 6 is selected.

These are transparent static fitting studies, not runtime textures. They reuse the sail's existing fitting study, which omits long rigging. Native and 2x views show a snug nest-to-sail gap and an unchanged sail/deck relationship. No runtime motion or rope-fitting claim is made.

## Generation and cleanup

[prompts.json](prompts.json) records all eight exact prompts, source hashes and sampling crops. The built-in tool does not disclose its backend model. [source/generated-trim-06.png](source/generated-trim-06.png) is the unmodified selected 887 x 1774 generated output. Its raw palette and partial alpha are provenance only. The previous mast, original raw generation, manifest and prompt are retained under `source/`.

Mechanical C# `System.Drawing` cleanup samples source crop **[414,443,59,177]** into **9 x 19** pixels at new mast **[20,49]**. Each floor-bounded block requires majority alpha >=128, takes median opaque RGB per channel and maps to the nearest squared-RGB colour from the shipped 48-colour palette. Alpha becomes binary, with no dithering or smoothing. Previous rows **0..48** are copied to **0..48**; previous rows **100..223** are copied to **68..191**. No generated nest or foot replaces the original.

[verification.json](verification.json) records independent exhaustive checks of the saved PNG: binary alpha, exact palette membership, shaft width, preserved nest and lower shaft, unchanged occluder, base/yard anchor arithmetic and unchanged sail hashes. The generated join has slight grain variation at large zoom, consistent with the shipped art. Application tests were not run for this assets-only change.
