# Office art delivery

The 26 finished PNGs are in **[art/](art/)**, using exactly the paths and frame order in
[art-contract.json](art-contract.json). The inventory and per-asset dimensions, frames, anchors,
palettes, byte counts and SHA-256 hashes are in [CONFORMANCE.md](CONFORMANCE.md) and
[verification.json](verification.json).

This is an **uninstalled commission**, following the existing office brief. The pack linter requires
every directory under `art/settings/` to have a complete, supported `setting.json`; the office draft
still has null digests and pending capabilities. This PR therefore stages the finished raster folder
under documentation for the separate data-wiring review. That worker can copy its contents unchanged
to `art/settings/office/` and use the recorded digests. No installed art, engine, TypeScript, manifest,
selection setting or dependency lockfile changes here.

## Sources and assembly

All source imagery was generated with the built-in `image_gen.imagegen` tool. The nineteen accepted
source rasters are in [sources/](sources/), and the complete prompts are in [prompts.json](prompts.json).
They are outside the delivery folder and outside the npm package. Rejected exploratory outputs are
not included.

The offline [build-art.mjs](build-art.mjs) assembles the accepted rasters at the contract's logical
resolution: crops source cells, samples on an integer pixel grid, removes isolated source artefacts,
maps colours to the fixed palettes, and thresholds alpha to 0/255. Delivered strips keep their whole
cells. Review images alone are enlarged with nearest-neighbour sampling. The script is documentation
tooling, never pack or engine code.

- Room: generated architecture and floor, with the exact three city openings, interior glass and
  dark lift well re-registered. Generated desk backs/chairs repeat at the twelve specified posts.
  The foreground remains clear; the front desk strip and three props are separate images.
- Cast: six generated ten-pose sheets, assembled left-to-right into 24 × 32 cells. Feet touch row 31;
  the `[12,32]` anchor is on the bottom edge. The typing pair shares head/body/feet and changes hands.
- City: one generated skyline, mapped to one common pixel layout and six phase palettes. The separate
  night-light mask comes from its window pixels, preserving registration across every phase.
- Distant office: the busy image adds generated cast silhouettes over the unchanged quiet architecture.
- Effects: generated pigeon and steam sequences; generated clock rim/face with twelve integer-pixel
  hour-hand positions; generated lift leaves translated into three opening states; generated confetti
  composed left of its threshold anchor.
- Preview: completed midday assets composited at the contractual positions and reduced to 210 × 120,
  then mapped to the base palette. No words, badges or runtime state graphics are baked in.

## Reproduce and inspect

From the repository root, using Node 24:

```sh
npm install --prefix .local/office-art-tools sharp@0.35.5 pngjs@7.0.0 --no-audit --no-fund
node docs/settings/office/build-art.mjs
node docs/settings/office/verify-art.mjs
npm run lint:deck-packs
```

On PowerShell with script execution disabled, use `npm.cmd`. These helper dependencies remain in
the ignored `.local/` directory; no application dependency is added.

[review/office-midday.png](review/office-midday.png), [night](review/office-night.png),
[24-person break crowd](review/office-crowd.png), [all cast poses](review/cast.png) and
[effects](review/effects.png) are offline review composites. They show art registration and layering;
they do not claim to exercise the still-uninstalled office renderer. Animation timing, badges,
phase tinting and full/lite/still runtime integration belong to the separate wiring review.

The installed ship and all shared runtime files remain byte-identical to the branch's base
`7842eee`; this documentation-only commission does not alter the live ship deck.
