# Office raster conformance

26 PNGs, 99 frames, **168,155 / 1,000,000 bytes**. All automated checks pass.

Every file is 8-bit truecolour RGBA, non-interlaced, explicitly sRGB, with binary alpha and only its contract palette. Strip width equals frame stride × count, with no gutters or trimming. SHA-256 digests and detailed results are in [verification.json](verification.json).

| Asset | File px | Frames | Anchor | Palette | PNG bytes | Result |
| --- | --- | ---: | --- | --- | ---: | --- |
| room.png | 420 × 240 | 1 | [0,0] | base | 7100 | PASS |
| desk-front.png | 260 × 22 | 1 | [0,0] | base | 2806 | PASS |
| props/printer.png | 20 × 24 | 1 | [10,24] | base | 810 | PASS |
| props/help-desk.png | 32 × 24 | 1 | [16,24] | base | 1210 | PASS |
| props/coffee-counter.png | 32 × 28 | 1 | [16,28] | base | 1235 | PASS |
| cast/navy.png | 240 × 32 | 10 | [12,32] | base | 6366 | PASS |
| cast/teal.png | 240 × 32 | 10 | [12,32] | base | 4780 | PASS |
| cast/ochre.png | 240 × 32 | 10 | [12,32] | base | 6331 | PASS |
| cast/plum.png | 240 × 32 | 10 | [12,32] | base | 5905 | PASS |
| cast/rust.png | 240 × 32 | 10 | [12,32] | base | 4566 | PASS |
| cast/slate.png | 240 × 32 | 10 | [12,32] | base | 5693 | PASS |
| city/dawn.png | 420 × 180 | 1 | [210,120] | sky:dawn | 15697 | PASS |
| city/morning.png | 420 × 180 | 1 | [210,120] | sky:morning | 15611 | PASS |
| city/midday.png | 420 × 180 | 1 | [210,120] | sky:midday | 15416 | PASS |
| city/afternoon.png | 420 × 180 | 1 | [210,120] | sky:afternoon | 15749 | PASS |
| city/dusk.png | 420 × 180 | 1 | [210,120] | sky:dusk | 15512 | PASS |
| city/night.png | 420 × 180 | 1 | [210,120] | sky:night | 15834 | PASS |
| city/lights.png | 420 × 180 | 1 | [210,120] | lights | 3448 | PASS |
| pigeon.png | 72 × 16 | 3 | [12,8] | base | 965 | PASS |
| clock.png | 192 × 16 | 12 | [8,8] | base | 2733 | PASS |
| coffee-steam.png | 48 × 20 | 3 | [8,20] | steam | 331 | PASS |
| background/quiet.png | 248 × 18 | 1 | [0,0] | base | 4030 | PASS |
| background/busy.png | 248 × 18 | 1 | [0,0] | base | 4200 | PASS |
| effects/lift-doors.png | 96 × 48 | 3 | [16,48] | base | 649 | PASS |
| effects/confetti.png | 144 × 40 | 3 | [36,40] | base | 832 | PASS |
| preview.png | 210 × 120 | 1 | [0,0] | base | 10346 | PASS |

Additional checks cover exact room transparency, opaque dark lift well, cast feet on row 31, hand-only typing changes, identical six-phase city geometry, registered night windows, unchanged quiet/busy architecture, twelve unique clock faces with fixed minute hands, open/half/closed door centres, and left-biased confetti. Visual review composites are in [review/](review/).

Anchors are metadata in the unchanged contract, not embedded PNG metadata. These checks verify their bounds and the applicable raster registrations; facing, poses, depth and composition are also visually reviewed. Runtime timing remains the separate pack-wiring task.
