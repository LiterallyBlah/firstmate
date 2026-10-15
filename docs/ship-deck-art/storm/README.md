# Heavy-weather deck art

Generated assets for high atmosphere on branch `fm/deck-storm-art`, based on `origin/main` at `cd9b12c`.
This is an assets-only handoff: no renderer, loading/schema, installation or PR changes.

The runtime [manifest](../../../art/ship-deck/storm/manifest.json) records each frame, size, timing,
palette, transparency, intensity ramp and calm-asset mapping. The 19 runtime PNGs total **43,086 bytes**
(42.1 KiB). Only those PNGs and the manifest are added under shipped `art/`; no duplicate strips.
All ten generation sources, prompts, mechanical cleanup recipes and review renders are here in `docs/`.
[`npm pack --dry-run` inspection](pack-verification.json) confirms exactly 20 added runtime files
(PNG frames plus manifest), **55,242 bytes** total, and zero storm documentation/source files shipped.

| Asset | Canvas / frames | Starts → full intensity | Verdict |
| --- | --- | --- | --- |
| Rough sea | 256×128 / 4, 240 ms each | 0.55 → 0.90 | usable |
| Storm wisp | 44×12 / 1 | 0.50 → 0.85 | usable |
| Storm puff | 36×14 / 1 | 0.50 → 0.85 | usable |
| Storm cumulus | 62×21 / 1 | 0.50 → 0.85 | usable |
| Storm long bank | 92×25 / 1 | 0.50 → 0.85 | usable |
| Storm twin bank | 80×24 / 1 | 0.50 → 0.85 | usable |
| Heavy wake | 240×96 / 3, 240 ms each | 0.65 → 0.95 | usable-with-cleanup |
| Spindrift | 64×32 / 4, 120 ms each | 0.75 → 1.00 | usable-with-cleanup |
| Distant lightning | 32×48 / 2, 80/120 ms | 0.92 → 1.00 | usable |
| Optional overcast sky | 512×320 / 1 | 0.50 → 0.90 | usable |

These are normalized atmosphere suggestions, not worker counts. Use the manifest's smooth ramps in
both directions as activity changes. Lightning is a small distant fork behind the banks, capped at
28% opacity and spaced 18–35 seconds apart, not a whole-screen flash. Spray caps at 65% opacity and two
short bursts at once. Rain is deliberately omitted. Keep lightning/spray off in reduced-motion modes.
The overcast overlay caps at 70% and fades out with night weight to avoid brightening the night sky.

Sea/wake frame counts, canvases, clocks and anchors match the existing calm sets exactly. Both sea
bands share the tile origin at world y=96; near sea at y=151 begins at source row 55. The heavy wake
keeps `(8,8)` on stern contact `(392,151)`, with top-left `(384,143)`. Existing hull-contact foam remains.
Clouds keep their ids, canvases and top-left anchors. Their source RGB slots are darker than the calm
slots: `#1D314E`, `#45617A`, `#7795A5`; the future loader must use those slots, with the supplied storm
time-of-day maps, rather than recolouring them back to the calm daytime palette. They retain the live
deck's cloud lanes and wrapping, not the older cloud README's suggested placement rows.

For transparent paired sprites, linear premultiplied RGBA blending avoids a midpoint opacity dip.
Normal opposing sprite-opacity ramps are an acceptable simpler integration with that small caveat.
The variant silhouettes are intentionally heavier, so crossfading is not a pixel-identical morph.

## Generation and reproducibility

Made with **ten built-in `image_gen__imagegen` calls** on 2026-10-15, below the 20–25 call ceiling.
The tool does not disclose its backend model. [prompts.json](prompts.json) contains every exact prompt
and original saved path; [provenance.json](provenance.json) hashes every retained source and reference.
No third-party art was used. Repository MIT license; AI-generated artwork without a claim of human
authorship or exclusive copyright.

No wave, cloud, droplet or lightning shapes were drawn in code. [build.mjs](build.mjs) mechanically
crops, block-median samples, registers, thresholds alpha and maps the generated pixels to subsets of
the exact 64-colour palette in `environment.json`. It reconciles sea edges over eight columns/six rows.
Clouds have two clear pixels on each side. Wake/spray/lightning are registered at a fixed sample scale
instead of independently resizing each frame's silhouette. The overcast sky applies median generated
colours to the calm sky's existing colour regions, preserving its band geometry for crossfading.
[cleanup.json](cleanup.json) records all crops, scales, anchors and the sky colour-region map.

Lossless indexed-PNG packing reduces the 175 KB initial RGBA output to 43 KB, with a decoded-pixel
equality check for each file. No lossy optimizer runs after palette mapping.

From repository root, with Node and npm available:

```powershell
npm.cmd install --prefix .local/storm-tools --no-audit --no-fund pngjs@7.0.0
node docs/ship-deck-art/storm/build.mjs
node docs/ship-deck-art/storm/verify.mjs
```

## Review and limitations

Open [the animation review](review/index.html) in a browser, or inspect the
[calm / half-blend / storm composite](review/calm-blend-storm.png),
[contact sheet](review/contact.png), [2×2 sea repeat](review/sea-repeat-2x.png), and
[12-step sea/wake composite animation](review/storm-cycle.png). Review images use the bare Hull C
atlas so water contact is easy to assess. They are not screenshots of a running plugin.

- **Sea — usable:** connected rolling swells and sparse broken whitecaps read distinctly rougher than
  the calm wavelets. Opposing edges match in every frame and the repeated image has no hard seam.
  Broad swell patterns remain recognizable across a wide area; generated crests shimmer between poses.
- **All five clouds — usable:** simple dark stepped masses with the existing dimensions and three-colour
  format. The larger banks' bases are angular at enlarged size. They drift as whole sprites, without
  deformation; the new shapes are not silhouettes copied from the calm set.
- **Heavy wake — usable-with-cleanup:** connects to the stern and remains inside its transparent canvas,
  with stronger foam/churn. Interior eddies and tips morph instead of following ideal downstream paths.
  A human pixel artist could improve in-betweens; no geometric fix is required to load it.
- **Spindrift — usable-with-cleanup:** sparse small crest spray with a shared base anchor. The curl and
  droplets change shape; a human artist could improve trajectories. Keep the documented low opacity
  and cadence rather than treating it as a continuous particle field.
- **Lightning — usable:** a thin distant fork with a dim broken second phase, intended behind clouds.
  It is not a lighting system or a full-screen flash.
- **Overcast sky — usable:** subdued palette transfer from generated weather, exactly registered to the
  calm sky bands. It is a single daytime treatment; preserve the underlying night palette.

[verification.json](verification.json) records all runtime hashes, sizes, exact colour membership,
alpha values, bounds, transparent RGB, repeat seams and frame differences including loop closure.
All checks pass, including the opaque wake anchor in all three frames. Static contact/repeat/composite
inspection covers palette, fit and every pose. Browser playback could not be inspected because this
session exposed no browser. APNG review cycles are supplied, but smooth playback is not claimed as
tested. Actual plugin integration is intentionally untested and
outside this branch's scope. No asset has a `human-artist-wanted` verdict; the two cleanup verdicts are
animation-polish limitations rather than claims that generation produced perfect in-betweens.
