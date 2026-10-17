# Surface and motion corrections

The captain removed the underwater cutaway from the approved design. `underwater.png`, the flat
`deep-water.png`, all eight jellyfish sprites and the obsolete water frames are removed. The fit is
now −8…520 instead of −8…600. Cast, actor height, crew posts and departure choreography are unchanged.

The commissioned sea atlases from `df3469c2023013297838e5355e9aef340f91b49a` are registered byte-for-byte.
The deep surface uses one tile origin at row 265 for both the background and the foreground from row
448. The far, middle and near strips sit at rows 265, 326 and 428. Their 16 frames run at 200 ms each;
the deep field's eight frames run at 400 ms. A separate sea clock speeds these by 1.25 at peak storm,
giving the artist's 2.56-second storm loop without accelerating rain or carrier motion again. Calm
drift is 0.4/0.75/1.0/0.6 pixels per second for far/middle/near/deep. The inherited whole-pixel scroll
and renderer remain unchanged. Still/reduced motion holds frame zero.

**Visual review is pending an artist revision of the deep field.** Native tall-pane captures expose
the 96-row repeating motif and faint joins every 384 columns. These are also visible in the artist's
repeat proof. There is no transparent gap or separate flat fill at the hull. Numeric edge contrast
alone does not catch the visible pattern. The eight delivered atlases have not been edited.

The old water was the same noisy texture shifted roughly three pixels per frame, then reset by
roughly nine pixels at its four-frame loop. That stepped motion opposed its slow horizontal drift.
Calm frames also applied a row-dependent warp. Whole-pixel scrolling and continuous clocks were
already correct; no engine change was needed for the replacement sequence.

The rain frames previously moved the streak field three pixels left and seven pixels up on each
ordinary transition. Following PR https://github.com/LiterallyBlah/firstmate/pull/101, the same existing
streak pixels now form a 32-row repeat, advancing eight rows down per frame, including frame 3 → 0.
The existing weather opacity, clock and lite/still policies remain. No new rain was painted.

The crow's nest's right half was embedded in the Jolly Roger plate and warped with the flag, while
its left half stayed in the fixed mast. `fix-motion.mjs` transfers those existing pixels into the
fixed image and excludes them from flutter frames. The basket and mast now share the stage's rigid
bob/rock transform; cloth still flutters. No new mast or basket art was needed.

## Evidence and reproduction

Review evidence is excluded from git. The review copy is at:

`C:\Users\micha\.paseo\plugin-data\firstmate\home\data\ghost-ship-fixes\evidence\`

- `before/`: original day/night/storm views and bottom crops at wide, square and tall-narrow sizes;
  native-resolution calm/storm water clips.
- `water-integrated/`: corresponding commissioned-water views and clips.
- `new-water/`: near-1:1 art-pixel tall-pane renders exposing the deep-field issue.
- `motion-before/`, `motion-after/`: storm crow's-nest and rain detail clips.
- `integrated/`: the six-phase/aspect overlays, 24-crew checks in all four states, exact focus
  receipts, arrival/lookout, anglerfish, plank/kraken, peak storm and reduced-motion evidence.

The pack uses **973,707 image bytes** of the 1,000,000-byte cap, before any further artist revision.
All generated captures and logs stay under `.local/` before copying to the review folder.

Local validation: pack lint 85/85; typecheck passed; full suite 1,204 passed and 3 skipped across
102 files; Hermes parsed both client bundles; the frozen Ship gate was 81/81 pixel-identical.
The phase/shape matrix produced 42 scene/overlay captures. Full/lite/still checks and 96 exact crew
focus clicks passed. Frame zero of the basket/flag composite is pixel-identical to the original,
and all eight commissioned water atlases are byte-identical to the artist's commit. These checks
do not override the pending deep-field visual correction. PR/CI completion follows that revision.

```powershell
npm.cmd ci
npm.cmd ci --prefix docs/board-list
npm.cmd install --prefix .local/tools --no-audit --no-fund gifenc omggif
node docs/settings/ghost-ship/fix-motion.mjs
node docs/settings/ghost-ship/build-pack.mjs
npm.cmd run lint:deck-packs -- --maxWorkers=1
node docs/ship-deck-canvas/compile.mjs
$env:GHOST_EVIDENCE='.local/ghost-ship-fixes/integrated'
node docs/settings/ghost-ship/render.mjs
$env:GHOST_REVIEW='matrix'; node docs/settings/ghost-ship/render.mjs
Remove-Item Env:GHOST_REVIEW
$env:GHOST_LITE='1'; node docs/settings/ghost-ship/render.mjs
Remove-Item Env:GHOST_LITE
node docs/settings/ghost-ship/make-preview.mjs
node docs/settings/ghost-ship/audit-art.mjs
node docs/settings/ghost-ship/audit-weather.mjs
node docs/deck-settings/gate.mjs
npm.cmd run typecheck
npm.cmd test -- --maxWorkers=1
```

The renderer tests use real compiled client code and synthetic host data. The installed plugin was
not changed, installed or reloaded. The frozen Ship fixture and its 81-shot expectations are untouched.
