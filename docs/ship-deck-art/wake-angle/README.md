# Steeper stern wake

Drop-in replacement for `art/ship-deck/water/wake/frame-{0,1,2}.png`, generated with eight built-in `image_gen__imagegen` calls. The far ridge now trails approximately **16 degrees down-right**, versus **6.6 degrees** before. This is the steeper direction available inside the existing upper-left-anchored canvas, aft of the left-facing ship. No rotation or shear was used to make the new angle.

The three **240x96** frames retain local anchor **(8,8)**, world anchor **(392,151)**, top-left **(384,143)**, frame order **0,1,2**, and **240ms** timing. Every visible colour belongs to the same thirteen-colour wake palette, itself a subset of the shipped deck/environment palette. Alpha is binary; transparent RGB is zero; all four borders are transparent. Sea, waterline foam, runtime manifests and client/server code are unchanged.

**Verdict: usable.** The angle is visibly steeper and the contact stays fixed. Regeneration also changes local foam detail: the wedge is narrower, the froth slightly finer, and the gentle loop reads as a shimmer rather than a physically advected flow. This is an offline art review, not a live-app test or install.

- [Before/after, all three poses](review/before-after-3x.png): old left, replacement right, phases top to bottom.
- [Hull C fit at 2x](review/hull-fit-2x.png), using the existing sea and foam at their unchanged coordinates.
- [Wake loop](review/wake-cycle.png) and [hull-fit loop](review/hull-fit-cycle.png): three-frame APNGs, 720ms. An APNG viewer is required for playback.
- [Verification](verification.json): decoded all ten current water PNGs; confirms unchanged sea/foam hashes, palette/alpha/size, strip equivalence, fixed contact, runtime manifest agreement and every cyclic transition. APNG CRCs and decompressed frames checked. Static poses and composites visually inspected; browser playback and live plugin were not tested.
- [Exact prompts](prompts.json), [provenance](provenance.json), and original generated outputs in `source/`. Sources 04, 07 and 08 supply the final frames; 01-03 explore angle/detail/contact, 05-06 are brighter animation alternatives.

Mechanical preparation uses `prepare.ps1`: each destination pixel samples a square source block at **8.2:1**, starting at source **(8,40)**. Retain samples with alpha >=192, require majority coverage, take median RGB and map to the nearest existing palette colour without dithering. The generated phase-zero first 20 columns are copied to phases one and two to freeze the contact. No trail geometry is drawn, rotated or sheared in code. `verify.mjs` checks the PNGs, assembles APNG previews and refreshes the companion water manifest.

From the repository root, reproduction is:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File docs/ship-deck-art/wake-angle/prepare.ps1
node docs/ship-deck-art/wake-angle/verify.mjs
```

The angle metric is the mean direction from anchor (8,8) to the uppermost opaque pixel in columns 160 through 195; it measures the far ridge, not the ship's heading or an exact centreline. All generation sources and review images stay under `docs/ship-deck-art/`. Only the three replacement PNGs ship under `art/`.
