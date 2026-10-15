# Office: art commission and uninstalled pack draft

Status: **needs art**. This is the step-9 authoring scaffold, outside `art/settings/` and outside the npm
package. It creates no pixels. `setting.draft.json` is an envelope around a proposed manifest, with null
image digests and two pending capabilities; it is deliberately not installable. `art-contract.json`
is the machine-readable delivery contract for **26 PNGs / 99 frames**. The tables below are its brief.

The engine supports `stable-posts@1`, `pose-fidgets@1` and `walk-in@1`. Still required before
the pack can ship: generic `phase-tint@1`, `phase-frames@1`, then the commissioned art and its
pixel checks. These are separate engine reviews followed by a data/art-only pack PR. The draft fields for
those two capabilities are proposals, not accepted schema. The draft's walking entry is now checked directly,
including its off-floor corridor, actor fit and furniture clearance. No office branch belongs in the renderer.

## Coordinate and palette contract

- Three-quarter open-plan office, **420 x 240 logical pixels**, fit `[0,240]`, margin `0.96`, actor plus badge
  height `40`. The report's 420 x 180 sketch could not fit 24 full-height break-area colleagues with reachable
  badges; the extra foreground is a tested crowd area, not extra background decoration.
- PNGs: **8-bit RGBA, non-interlaced, sRGB**, alpha **0 or 255**, no antialiasing, filtering, matte fringe,
  upscaling, trimming or gutters. Pixel art at final logical resolution. Each strip is horizontal; frame
  indices below run left to right. All anchors are measured from the **frame's** top-left, not the strip.
  Feet anchors may be on the bottom edge. No text, logos, badges or interactive state icons in the art.
- Room, furniture, colleagues, bird, clock, doors and confetti use only the **24-colour `base` palette** in
  `art-contract.json`. Each city phase has its own exact **12-colour `sky:<phase>` palette** there. City-light
  pixels use `#D8B765` / `#F0E5CE`; steam uses `#95A3A8` / `#CCD0C6` / `#F0E5CE`. Transparency is additional.
  The preview uses the base palette. No runtime palette quantization is assumed.
- Total served PNG bytes must be **at most 1,000,000**. Generation sources, contact sheets and review
  composites are delivered separately under documentation, never in the installed pack. Packs carry no code.

## Exact PNG inventory

Dimensions are final **file width x height**; frame dimensions are included for strips. All unlisted
animation is absent. Room, city backgrounds and distant crowd are authored rasters, never engine-drawn art.

| File(s) | Purpose | File / frame dimensions | Frames, intended timing | Anchor |
| --- | --- | --- | --- | --- |
| `room.png` | Room shell, desk backs/chairs, opaque floor, dark open lift well | 420 x 240 | 1 static | `[0,0]` top-left |
| `desk-front.png` | Six-desk front, reused for both rows; covers seated lower legs | 260 x 22 | 1 static | `[0,0]` top-left |
| `props/printer.png` | Printer and paper tray | 20 x 24 | 1 static | `[10,24]` feet |
| `props/help-desk.png` | Help counter and monitor | 32 x 24 | 1 static | `[16,24]` feet |
| `props/coffee-counter.png` | Kitchenette counter and cup | 32 x 28 | 1 static | `[16,28]` feet; steam source `[16,4]` |
| `cast/navy.png`, `cast/teal.png`, `cast/ochre.png`, `cast/plum.png`, `cast/rust.png`, `cast/slate.png` | Six colleague looks, varied skin/hair/clothes, identical registration | **Each** 240 x 32; 24 x 32 per frame | **Each** 10 poses listed below; walk 180 ms/frame, typing 250 ms/frame | `[12,32]` feet in every frame |
| `city/dawn.png`, `city/morning.png`, `city/midday.png`, `city/afternoon.png`, `city/dusk.png`, `city/night.png` | Six opaque city skies; skyline geometry identical in every phase | **Each** 420 x 180 | **Each** 1; engine crossfades by local day phase | `[210,120]` horizon centre |
| `city/lights.png` | Only the city windows that light at night; all else transparent | 420 x 180 | 1; opacity follows night share | `[210,120]`, exactly city-registered |
| `pigeon.png` | Right-facing bird passing behind the room/windows | 72 x 16; 24 x 16/frame | 3: up, level, down; sequence 0/1/2/1 at 125 ms, level glide | `[12,8]` centre |
| `clock.png` | Wall clock showing the local hour | 192 x 16; 16 x 16/frame | 12: frame 0 is 12, then 1 through 11; minute hand fixed at 12 | `[8,8]` centre |
| `coffee-steam.png` | Three registered steam shapes | 48 x 20; 16 x 20/frame | 3: low, middle, high; 300 ms/frame | `[8,20]` cup source |
| `background/quiet.png`, `background/busy.png` | Distant colleagues behind interior glass; static density variant, same furniture | **Each** 248 x 18 | **Each** 1; intensity crossfade, no walking | `[0,0]` top-left |
| `effects/lift-doors.png` | Door leaves and jamb; open centre transparent over the room's dark well | 96 x 48; 32 x 48/frame | 3: open, half, closed; departure closes over 150 ms, holds 450 ms, reopens over 300 ms | `[16,48]` threshold |
| `effects/confetti.png` | Small completion burst directed left into the room, no flash | 144 x 40; 48 x 40/frame | 3: pop 120 ms, spread 180 ms, fall 240 ms | `[36,40]` threshold, deliberately off-centre |
| `preview.png` | Finished office thumbnail, a few colleagues, no text or badges | 210 x 120 | 1 static | `[0,0]` top-left |

Colleague frames **0 through 9**, for every look: `stand`, `walk-front-a`, `walk-front-b`, `walk-side-a`,
`walk-side-b`, `seated-type-a`, `seated-type-b`, `stand-cup`, `hand-on-head`, `lounge`. Side and typing
poses face right; the engine mirrors where needed. The typing pair changes hands only, keeping head/body
and feet stable. Waiting holds a cup, blocked uses hand-on-head, idle lounges with a chair/seat contained
in the pose. Keep every pixel within its 24 x 32 cell, including chair, hands and feet. No separate chair
sprite follows a worker. Every look must contain all ten poses, even if some share pixels.

## Room registration and reserved space

- `room.png` is opaque everywhere except city windows `[24,18,112,44]`, `[144,18,112,44]`,
  `[264,18,112,44]` and interior glass `[24,68,248,18]` (rectangles are x/y/width/height). Window frames
  stay outside these exact openings. The interior glass is filled by quiet/busy background art at `[24,68]`.
- The room's lift well is `[388,64,32,48]`, threshold `[404,112]`; it is opaque and dark. Door overlays use
  that threshold. Idle doors are open; finite entry/exit effects return open, requiring no persistent
  door-state script. Confetti uses the same threshold; its left-biased anchor keeps the full burst within x=420.
- Desk fronts go at `[24,96]` and `[24,126]`, depth baselines **108 / 138**. Six chair feet per row are
  x=`44,84,124,164,204,244`, y=`102 / 132`. Keep the desk backs, chair registration and monitors aligned
  to these positions. Desk/front footprints are `[26,92,244,8]` and `[26,122,244,8]`; aisles around them
  must read as open floor. Don't bake foreground desk fronts into the room; they are depth pieces.
- Printer feet `[352,84]`; waiting posts `[350,96]`, `[366,96]`, `[382,96]`. Help desk feet `[310,112]`;
  help posts `[286,114]`, `[286,126]`. Coffee-counter feet `[330,138]`; steam starts at `[330,114]`.
  These three props are separate transparent sprites; do not duplicate them in the room.
- Open floor covers x=`20..399`, y=`88..235`, apart from the explicit furniture footprints in the draft.
  The entire foreground break area `[20,176,380,60]` stays clear: no baked sofa, plants, rugs with holes,
  rail or opaque foreground trim covering workers. It has eight initial posts and room for 24 colleagues
  at 26 x 44 spacing. Lounge seats are in the cast pose. Labels hang at row 238.
- Clock centre `[286,78]` is on wall between glass and floor. City art's horizon row 120 is placed at stage
  row 70; its top is therefore 50 pixels above the room. Sky geometry is shared across all phases and lights.

## Acceptance and next slices

`test/office-draft.test.ts` checks image inventory, frame grids, palettes, anchors, current schema fields,
cast/effect registration, all-pairs floor paths, and a 24-person break crowd with every other post occupied.
It cannot check real opacity, palette pixels, hashes, compressed bytes, window seams, feet, or depth appearance
until art arrives. A test-only adapter substitutes sentinels for missing hashes and omits unsupported fields;
it never writes or installs that adapted manifest. `npm run lint:deck-packs` includes these draft checks.

Review and land the remaining two generic capabilities. After the commission, fill real SHA-256 values,
validate every PNG with the full pack linter, inspect office full/lite/still, entry/exit, focus and crowd views,
then land `art/settings/office/` as an art/data-only PR. The ship must remain 81/81 pixel-identical at every
engine slice. Global selection, calm reduced motion and engine-owned intensity remain unchanged.
