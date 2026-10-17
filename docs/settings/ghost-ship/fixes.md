# Surface and motion corrections

The captain removed the underwater cutaway from the approved design. `underwater.png`, the flat
`deep-water.png`, all eight jellyfish sprites and the obsolete water frames are removed. The fit is
now −8…520 instead of −8…600. The enlarged cast, actor height 66 and crew posts from PR #106 are
preserved, as is departure choreography. The authoring recipe retains those merged crew settings.

The commissioned sea atlases from `df3469c2023013297838e5355e9aef340f91b49a`, with the revised deep
pair from `b273ab75bd651bb2cb1f6af1afb08de50a65e873`, are registered byte-for-byte.
The deep surface uses one tile origin at row 265 for both the background and the foreground from row
448. The far, middle and near strips sit at rows 265, 326 and 428. Their 16 frames run at 200 ms each;
the deep field's four 768×512 frames run at 800 ms. A separate sea clock speeds these by 1.25 at peak storm,
giving the artist's 2.56-second storm loop without accelerating rain or carrier motion again. Calm
drift is 0.4/0.75/1.0/0.6 pixels per second for far/middle/near/deep. The inherited whole-pixel scroll
and renderer remain unchanged. Still/reduced motion holds frame zero.

Native tall-pane review found the first deep field's 96-row repeating motif and faint joins every
384 columns. The artist replaced it with broad, sparse swells in larger cells. The revised day,
night and storm captures have no visible tile boxes or seams. There is no transparent gap or
separate flat fill at the hull. The eight delivered atlases have not been edited.

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
- `final-water/`: corresponding final-water views, bottom crops and native-size water clips.
- `final-native/`: near-1:1 art-pixel tall-pane renders of the revised deep field.
- `motion-before/`, `final-motion/`: storm crow's-nest and rain detail clips.
- `final/`: the six-phase/aspect overlays, 24-crew checks in all four states, exact focus
  receipts, arrival/lookout, anglerfish, plank/kraken, peak storm and reduced-motion evidence.

The final payload is **971,510 image bytes**, leaving **28,490 bytes** below the 1,000,000-byte cap,
including the updated picker preview. It is recorded in `final/weather-audit.json`.
All generated captures and logs stay under `.local/` before copying to the review folder.

Local validation: pack lint 85/85; typecheck passed; full suite 1,226 passed and 3 skipped across
104 files with `--testTimeout=30000 --maxWorkers=2` to accommodate host load. Hermes parsed both
client bundles; the frozen Ship gate and visual results are recorded alongside the evidence.
The phase/shape matrix produced 42 scene/overlay captures. Full/lite/still checks and 96 exact crew
focus clicks passed. Frame zero of the basket/flag composite is pixel-identical to the original,
and all eight commissioned water atlases are byte-identical to the artist's respective commits.

```powershell
npm.cmd ci
npm.cmd ci --prefix docs/board-list
npm.cmd install --prefix .local/tools --no-audit --no-fund gifenc omggif
node docs/settings/ghost-ship/fix-motion.mjs
node docs/settings/ghost-ship/build-pack.mjs
npm.cmd run lint:deck-packs -- --testTimeout=30000 --maxWorkers=2
node docs/ship-deck-canvas/compile.mjs
$env:GHOST_EVIDENCE='.local/ghost-ship-fixes/final'
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
npm.cmd test -- --testTimeout=30000 --maxWorkers=2
```

The renderer tests use real compiled client code and synthetic host data. The installed plugin was
not changed, installed or reloaded. The frozen Ship fixture and its 81-shot expectations are untouched.
