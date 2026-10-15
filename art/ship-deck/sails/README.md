# Taller sail for the taller mast

**Verdict: usable.** Two newly generated billow frames replace the short reefed sail, with the same 114 px width and a new 84 px height (previously 27 px). The wooden yard is included, centered on the taller mast. The cloth fills the longer lower pole while retaining clearance above the crew and mast foot.

Generated with the built-in `image_gen__imagegen` in **two calls**, then mechanically sampled to the shipped deck's logical pixel grid and exact 48-colour palette. The final sprites use 38 of those colours, binary alpha, and no dithering. No sail shapes were drawn in code. Sources and exact prompts are retained here.

This is an assets-only handoff based on `7f7a00c360975fb09531e7efe69825e811c3aaf8`. It depends on the mast geometry in branch `fm/deck-mast-art`, commit `f09fb4ec6f4a9b5bc79493669fdb30636eafccf6`. No client wiring, plugin install, reload or PR is included.

## Files and attachment

| Asset | Size | Placement |
| --- | --- | --- |
| `main-sail.png` | 228 x 84 | Two horizontal 114 x 84 frames, rest then billow; selected frame at hull **(154, -15)** |
| `rest.png`, `billow.png` | 114 x 84 each | Standalone copies of the strip frames |
| `hull-c-frame-0.png`, `hull-c-frame-1.png` | 426 x 176 each | Alternative transparent overlays at hull **(0, -15)**; use these OR the strip |
| `mast-occluder.png` | 19 x 64 | Unchanged at hull **(202, 48)**, depth baseline **110** |

The sail's local yard pivot **(57, 3)** maps to hull **(211, -12)** and tall-mast-local **(24, 100)**, exactly matching the mast manifest. The tall mast is placed at **(187, -112)**. The yard stays 114 px wide, with no horizontal scaling or off-center attachment.

The sail extends no lower than hull **y68**, leaving rows 69-72 clear before the opaque lower mast overlay begins at y73. Its 84 px canvas is **57 px taller / 3.11 times** the old sail's 27 px canvas. The mast itself gains 111 px upward; its recommended yard position moves 61 px upward. Increasing cloth height by 57 px uses that new room while keeping the hem slightly above its former deck clearance.

Draw the cleaned hull, tall mast, then sail, followed by depth-sorted crew and the unchanged lower mast occluder. Remove the old baked upper mast, nest and old rigging as required by the mast handoff. Do not draw the original mast depth piece over the cloth. Allow negative hull y in scene bounds. One art pixel equals one hull pixel; display with nearest-neighbour sampling.

## Animation and integration metadata

Keep the existing **two-frame loop at 850 ms per frame**, sequence `[0, 1]`, with frame 0 for reduced motion. Both frames have the same yard/top eight rows and fixed corner strips. The generated lower cloth changes in 922 of 9,576 frame pixels, chiefly fold shading and a small 2-3 px center-hem lift. There is no attachment jitter.

`extras.json` remains unchanged, as required by the assets-only scope. **The branch must be integrated with the taller mast and updated frame metadata**; loading its replacement texture with the old 27 px frame height would crop it. The integrating change should use:

```json
{
  "texture": "sails/main-sail.png",
  "frameSize": [114, 84],
  "frames": 2,
  "position": [154, -15],
  "frameMs": 850
}
```

The existing occluder metadata stays valid. The alternative overlays are now 426 x 176 at (0, -15), rather than 426 x 161 at (0, 0), to include the complete yard above hull y0. The [new manifest](manifest.json) supersedes the original sail section in `../assets-2/manifest.json`; that historical file describes the original short sail and crew generation.

## Provenance and cleanup

[prompts.json](prompts.json) records both exact built-in prompts. Frame 0 used the shipped short sail, atlas, and tall-mast fitting study as references. Frame 1 was generated as a small billow edit of frame 0. The backend model was not disclosed. No third-party art was introduced.

The unmodified 1460 x 1077 source PNGs are retained under [source/](source/). They are provenance only and are not constrained to the final palette. Their SHA-256 hashes and alpha bounds are recorded in the manifest and verification report.

Mechanical cleanup used C# `System.Drawing`: both sources use frame 0's crop **[140, 148, 1182, 732]**, mapped to 114 x 84. Each output pixel uses the channel median of source pixels with alpha >=128 in its floor-bounded sampling block, kept only at majority coverage, then snapped to the nearest squared-RGB match in the deck palette. The shared crop preserves the generated lower hem motion. Frame 1's yard/top rows 0-7 and corner strips x0-11/x102-113 are copied from generated frame 0 for fixed rigging. No freehand or procedural repainting was used.

## Review and validation

- [4x contact sheet](contact-4x.png): rest and billow, side by side.
- [2x fitting comparison](fit-preview-2x.png): tall mast with old sail, new rest, new billow, left to right. All share the same 32 px crew and mast.
- [Native rest fit](fit-native-0.png) and [native billow fit](fit-native-1.png): 426 x 304, hull origin at (0, 130) within each review image.
- [Verification](verification.json): independently reloaded PNGs, exhaustive palette/alpha checks, exact frame extraction, fixed attachments, full overlay equivalence, unchanged occluder and SHA-256 hashes.

Review composites clear the old upper rig for fitting and omit replacement long ropes; they are not runtime hull assets. Runtime files have zero off-palette or partial-alpha pixels. Both generated sources, the cleaned contact sheet and fitted composites were visually inspected. Application tests were not run for this assets-only change.

The sail is usable at the deck's existing art quality. The two-frame breathing is deliberately restrained, not a physically authored cloth simulation. Enlarged views retain some uneven seam and wood clusters from mechanical sampling, consistent with the shipped art. Final rigging and runtime placement remain integration work.
