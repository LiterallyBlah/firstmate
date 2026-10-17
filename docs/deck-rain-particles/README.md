# Particle rain

`precip@1` replaces the four installed scenes' repeating rain tiles with individual seeded drops.
The engine owns the field, intensity, cap and motion modes. Each pack supplies three kinds, numeric
ranges, wind and a 36-sprite atlas from the rain art hand-off. No pack expressions or code are evaluated.
The original tile and strip renderers and frozen Ship fixture remain supported unchanged.

Pirate voyage has cool blue-grey rain; Sakura coast has finer silver rain; Sky pirates has faster,
strongly diagonal blue-lavender rain; Ghost ship has slower green-white rain drifting left.
The original onset intensities are 0.55, 0.55, 0.60 and 0.50 respectively. Their peak opacity curves
also retain the previous values. Only rain entries, their images and the required capability changed
in the packs; the Ghost ship and Sakura water work is retained.

Each fall samples its own position, speed, length, opacity and angle jitter. Kind ranges interpolate
with smoothstep over fleet intensity; position integrates velocity without seeking an animation.
Gentle gusts combine two slow waves. Far/mid/near drops occupy three drawing layers in a 3:2:1 mix.
The authored tip, visible length and angle register each padded atlas cell. Rotation applies only
the difference from the authored angle, and velocity follows the resulting downward streak.

The pool scales with pane CSS area, one slot per 6,000 pixels and at most 600, including optional
splashes. DPR and camera zoom cannot increase that cap. A resize covers the entire visible world,
including negative sky rows. One emitter per pack prevents multiple emitters bypassing the cap.
Lite holds a deterministic peak field at time zero and caches it as one texture, refreshed on layout
changes; live intensity changes only the parent's opacity, just as the old first-frame tile policy did.
Still and reduced motion suppress rain. Hidden panes retain the existing paused deck clock.
Optional splash frames appear on authored stage rows when drops cross them; the four atlases do not
provide splashes. Missing splash art omits splashes; a missing drop depth omits that rain element.

## Reproduce the checks

```powershell
npm.cmd ci --no-audit --no-fund
npm.cmd ci --prefix docs/board-list --no-audit --no-fund
npm.cmd run typecheck
npm.cmd run lint:deck-packs -- --testTimeout=30000 --maxWorkers=2
npm.cmd test -- --testTimeout=30000 --maxWorkers=2
node docs/ship-deck-canvas/compile.mjs
node docs/deck-settings/gate.mjs
node docs/deck-rain-particles/render.mjs
node docs/deck-rain-particles/bench.mjs
```

The render scripts use the repository's compiled-plugin/RPC harness, Edge and a fixed session clock.
They record drizzle/rain/downpour at four/five/six working crew in wide and tall panes: 24 stills and
four-second, 10 fps clips. `RAIN_SMOKE=1` captures one downpour still. The encoder uses Playwright's
FFmpeg in `.local/browsers/ffmpeg-*/`, or `FFMPEG` can name another executable.

The benchmark isolates each scene's rain at 3840×2160 on the same engine and scale. It alternates
the current particles with `origin/main`'s tiles in three batches, each with 30 warmup and 60
measured frames, reporting update/render submission and synchronous WebGL readback times separately.
Full mode uses the hardware renderer; lite uses SwiftShader. This measures rain's cost, not
whole-application latency. Hardware and baseline commit are recorded beside the frame-time table.

Evidence is never committed. Outputs go to `.local/rain-evidence/`; the review copies are in
`C:\Users\micha\.paseo\plugin-data\firstmate\home\data\deck-rain-particles\evidence\`.
The pack art is cherry-picked from `fm/deck-rain-art` commit
`8c8266a9a06541c74a52b656f6d7c5214c96bf9d`; its generation provenance remains in the separate art evidence.
