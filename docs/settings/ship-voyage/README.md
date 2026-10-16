# Pirate voyage

The approved [concepts](concepts/README.md) are now the installed `ship` pack, version 2.0.0.
The saved setting id and default selection are unchanged. Production is manifest data and PNGs;
no renderer, plugin lifecycle, activity semantics or levelling system changes.

The 640×400 stage retains the original eight bandana crew looks. Generated art supplies the
fully rigged, bow-left ship, cannons, chest, rope, cat, wildlife and coastline. Original crew,
departure and shark art retain their proven anchors and animation roles. The follow-up
[polish](POLISH.md) replaces the flat sea, stepped skies and small kraken, insets crew onto
the planks, gives marine visitors submerged rest states, and restores the picker thumbnail.
Exact generation prompts and reference roles are in [production-prompts.json](production-prompts.json);
original outputs are in [sources](sources/). `sources/preview-canvas.png` freezes the real
daytime canvas thumbnail (384 by 200 pixels, 48 colours), independently of later review captures.
Registration, palette reduction and finite frame
extraction are reproducible with `node docs/settings/ship-voyage/build-art.mjs`, followed by
`node docs/settings/ship-voyage/build-pack.mjs`. Neither script is shipped or executed by the pack.
The installed image payload is **984,461 bytes**, leaving 15,539 bytes below the 1,000,000-byte cap.

## The route

One 2,048×112 phase strip drifts **right at 1.7 art pixels/second**, opposite the ship's left-facing
bow. Its atmosphere clock has pace 1 at every activity level: **20 minutes 4.7 seconds per lap**,
about five minutes between landmark centres. Cove → ruined fort → port → lighthouse → cove,
with open-sea gaps between them. The images are ordered in descending source-x for that travel
direction. No teleport, random scene switch, route state or server timer is involved.

Six registered coast palettes share identical alpha silhouettes. Only the night plate transfers
the generated port-window and lighthouse-lamp light. A separate four-frame beam phase strip
shares the coast's width, drift clock and offset; its other five phase sets are transparent.
The existing day blend eases the light in and out at night transitions. The beacon sweeps once
per 2.8 seconds. Sea tiles and the horizon-anchored sky fill the visible world independently of
these transparent strips, including tall, narrow panes. The world horizon stays level while
the ship rocks around its waterline. Hidden panes pause the voyage under the normal engine policy.

## Evidence

All canvas evidence uses the compiled plugin, real setting RPC reader and WebGL renderer through
the repository's host fixture. The fleet is synthetic; this is not an installed Paseo session.
Run `node docs/settings/ship-voyage/review.mjs`; set `VOYAGE_LITE=1` for the software-renderer pass.
`node docs/settings/ship-voyage/visitors.mjs` checks marine motion, rest modes and pane resumption.
Set `SHARK_REVIEW=before SAKURA_PARITY=before` for the bow comparison from compiled main.
`node docs/settings/ship-voyage/night.mjs` repeats the focused night/moon/port/beacon captures.
The review harness uses `gifenc` from `.generated/motion-tools` (install with
`npm.cmd install --prefix .generated/motion-tools gifenc`). GIFs are screenshot sequences, not
ImageGen animation. The voyage clip samples 12 real scene seconds per frame and plays at **60×**;
the interaction and lighthouse clips play at their captured timing. Long-route sampling uses a
10 Hz test scheduler (100 ms per engine step), with the production engine and pack speed unchanged.

| State | Wide canvas | Tall, narrow canvas |
| --- | --- | --- |
| Day | [day](review/polish-final/day-canvas.png) | [day](review/polish-final/day-tall-narrow.png) |
| Dawn | [dawn](review/polish-final/dawn-wide.png) | [dawn](review/polish-final/dawn-tall-narrow.png) |
| Morning | [morning](review/polish-final/morning-wide.png) | [morning](review/polish-final/morning-tall-narrow.png) |
| Afternoon | [afternoon](review/polish-final/afternoon-wide.png) | [afternoon](review/polish-final/afternoon-tall-narrow.png) |
| Dusk | [dusk](review/polish-final/dusk-wide.png) | [dusk](review/polish-final/dusk-tall-narrow.png) |
| Night | [night](review/polish-final/night-wide.png) | [night](review/polish-final/night-tall-narrow.png) |
| Storm | [storm](review/polish-final/storm-wide.png) | [storm](review/polish-final/storm-tall-narrow.png) |
| Port at night | [lit waterfront](review/polish-final/port-night-wide.png) | ? |
| Lighthouse | [night beacon](review/polish-final/lighthouse-night-wide.png) | [night beacon](review/polish-final/lighthouse-night-tall-narrow.png) |

| Motion / interaction | Evidence |
| --- | --- |
| Continuous voyage | [complete lap, 60×](review/polish-final/voyage-60x.gif) |
| Rig, ship rocking and life | [scene alive](review/polish-final/scene-alive.gif) |
| Hatch arrival and crow's nest | [arrival and climb](review/polish-final/hatch-and-lookout.gif) |
| Projecting plank, splash and shark | [departure](review/polish-final/plank-shark-departure.gif), [contact sheet](review/polish-final/departure-contact-polish.png) |
| Navy chase and peak storm | [frigate chase](review/polish-final/frigate-chase.gif), [lightning](review/polish-final/storm-lightning.png) |
| Night beacon | [lighthouse sweep](review/polish-final/lighthouse-night.gif) |
| Real surface split | [suggestion shark](review/polish-final/suggestion-shark.gif) |
| Marine life | [distribution](review/polish-final/marine-distribution.png), [dolphin leaps, real time](review/polish-final/dolphin-leaps.gif), [whale passage, 5?](review/polish-final/whale-passage-5x.gif), [reduced](review/polish-final/visitors-reduced.png), [lite](review/polish-final/visitors-lite.png) |
| Bow clearance | [before](review/polish-final/bow-before.png), [after](review/polish-final/bow-after.png) |
| Picker | [name and thumbnail](review/polish-final/picker.png) |
| Geometry and depth | [floor overlay](review/polish-final/floor-overlay.png) |
| Crowds | [24 resting crew](review/polish-final/sleepers-24.png), [24 working](review/polish-final/crew-24-working.png), [24 waiting](review/polish-final/crew-24-waiting.png), [24 blocked](review/polish-final/crew-24-blocked.png), [96 state clicks](crowd-all-states.json), [24 exact focus labels](crowd-focus.json), [24 moving targets](crowd-rock-focus.json) |

The [motion and parity audit](MOTION-PARITY.md) maps every original and new element to its behavior,
clock and fallback. [Full](motion-full.json) and [lite](lite.json) reports record assertions and
browser errors. The source-level voyage tests protect alignment, direction, night-only light,
depth order and behavior retention; generic pack lint still validates actual pixels, paths,
crowds, fit and budget. [Compiler evidence](compile-results.json) includes Hermes parsing and
identical client/server bundle sizes: this remaster adds no runtime code.

## The engine baseline stays frozen

`test/fixtures/ship-baseline/` contains the original manifest and all 84 PNGs copied byte-for-byte
from Git revision `890348a83c2d87a2e58f114892b0e2e9d89b7896`, with a SHA-256 inventory alongside it.
Git's `-text` attribute protects the manifest bytes on Windows. The fixture is outside `art/`,
outside the npm package's `files`, and never appears in either picker.

The gate injects this same fixture into **both** compared engines. The fixture reader rejects
changed source hashes. Historical engine/legacy tests also read it through `test/ship-pack.ts`;
installed-pack RPC and lint tests read the remaster. No production loader or picker special case
was added. An installed-original control run was taken before replacing the pack, followed by
the fixture-wired run: their entire 81-shot result arrays (hashes, pixel differences and canvas
metadata) are identical. Both have zero changed pixels, zero flakes and zero browser errors:
[installed control](baseline-installed.json), [frozen fixture](baseline-fixture.json).
No screenshot hashes were updated to accommodate the remaster.

For a local test run confined to this worktree, set TEMP/TMP to `.generated/tmp` and put
`{"type":"commonjs"}` in that directory's `package.json`; process fixtures otherwise inherit
this repository's ESM package type. Finish gate/compile jobs before the test suite so temporary
source archives are removed and cannot be rediscovered as duplicate tests.

Future reward levels can select different named art parts or manifest data in a separately
reviewed feature. This pack adds no progression state, thresholds or locked layout assumptions.
