# The ship deck's drifting clouds: evidence

The five generated clouds in `art/ship-deck/clouds/` now drift across the Deck's sky, tinted with the time of
day. Served with the extras (`firstmate.deck.extras`, `extras.json`'s `clouds`), never in the client bundle;
drawn by `client/deck-environment.ts` from `client/deck-clouds.ts`.

## How it works

- **Where.** Seven clouds, one a lane, each with its bottom a seeded 30–188 sky pixels above the sky's horizon
  row, in the sky backdrop's own pixels and drawn with its placement and scale. Depth: sky, stars, **clouds**,
  gull, far sea, then the ship. So a cloud passes behind the masthead and sail and never over the ship, the
  crew or the sea. Smaller sprites go low, banks high, with a little chance either way.
- **Why so low.** The art manifest suggests sky rows 20–110. A pane that fits the deck's height shows only
  the sky's lowest ~96 rows, so clouds placed there would never be seen in it (`pane-wide-short.png`). The
  lowest three lanes are always in view; a taller pane shows the higher ones too.
- **Drift.** Right, about 0.2–0.8 sky pixels a second (the gull flies 26), in whole sky pixels. Higher clouds
  are a little faster, a gentle parallax. Each cloud wraps only once it is wholly outside the sky, which
  `skyPlacement` always makes at least as wide as what shows. So nothing pops in view, and its sprite and
  height stay the same on a wrap. The field is seeded from the clock's second the deck opens at, and start
  points are spread round the lap.
- **Tint.** Each sprite is exactly three colours (shadow, body, highlight). `cutCloudMasks` reads a decoded
  sprite back off a scratch canvas into three white masks (`ImageBitmap`s), each drawn as a sprite tinted to
  its slot of the showing phase's palette, from the art manifest's six stage palettes. The palettes are
  crossfaded with `skyBlend`'s own `t`, so clouds follow the sky through each 90-minute fade. A multiply
  tint could not do it: the afternoon palette is lighter than the source.
- **Motion rules.** Clouds drift only while the sea scrolls (`MotionPlan.ambient`), so they hold still
  under reduced motion and on a software renderer, while their colours still follow the clock. The 30 fps
  cap and pause-when-hidden are the loop's, unchanged. `layout` re-places the clouds as well as `draw`,
  because a still deck's camera can lay the sky out with no draw after it.

## Checked in Edge (`render.mjs`, `render-results.json`)

`node docs/ship-deck-canvas/compile.mjs` first (`compile-results.json` here: the branch's bundle still parses
under React Native 0.81's `hermesc` with default flags and has no `class`. The client grows 9,145 bytes of
code and no art). Then `node docs/ship-deck-clouds/render.mjs`:

1. **The day**: `sky-0530-dawn.png` warm, `sky-0800-morning.png` and `sky-1200-midday.png` neutral,
   `sky-1600-afternoon.png` lighter, `sky-1830-dusk.png` muted, `sky-2015-dusk-to-night.png` mid-fade,
   `sky-0200-night.png` dim blue among the stars.
2. **The drift**: at night, with no gull to move, the sky above the deck has changed after a minute on the
   fake clock (`drift-night-after-a-minute.png`).
3. **Reduced motion**: the same minute leaves the sky above the deck identical, pixel for pixel
   (`still-night.png`).
4. **The pane**: `pane-wide-short.png` fits the deck's height and shows the lowest lanes. `pane-fractional.png`
   is 1203 × 911 at a device scale of 1.25, and `pane-fractional-resized.png` is the same page resized to
   1517 × 703. `focused.png` is the camera closed in on a sailor, with the clouds behind the veil, and
   `focused-back-out.png` is after Esc.

No page errors or console warnings. A warning would have shown if any cloud had failed to cut.

## What a pixel artist could still improve

- The banks (`long-bank`, `twin-bank`) keep some angular, generated contours, and the twin bank's flat base
  shows when the sky is scaled up in a tall pane.
- `wisp` and `puff` are only 12–14 px tall. At the low lanes they read as specks behind the rigging, and a
  smaller, flatter horizon cloud set would sell the distance better than reusing them.
- Night uses the same shapes dimmed. A thinner night set, or clouds lit from below near the dusk horizon,
  would read better than a palette swap.
- The palettes are the art manifest's own. Dusk's highlight (`#B38B88`) and the afternoon's (`#F1DEC0`)
  could be tuned against the live sky, not the review sheet.
