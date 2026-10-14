# The ship deck's generated sea, sky and gull: evidence

> The Deck has since become a standard feature, and the `FIRSTMATE_SHIP_DECK` switch this describes is gone
> (`docs/ship-deck-default/README.md`). What follows is the evidence as it stood when it was written, behind the switch.

The Deck (still behind `FIRSTMATE_SHIP_DECK`, still desktop only) now draws the generated environment from
`art/ship-deck/ENVIRONMENT.md` in place of its code-drawn sea and gull, and has a sky that follows the
machine's local time of day.

## What is wired

| Asset | Where it is drawn | Motion |
| --- | --- | --- |
| `sea/water-tile.png` | Behind the hull from the horizon (row 96) down, and again in front of it from the waterline (row 151), cut so the two line up | Scrolls 10 px/s in whole pixels; still under reduced motion and on a software renderer |
| `sea/foam-strip.png` | Over the hull's waterline only (x 68–392), cut from its repeat into at most three crops a frame | Scrolls 6.25 px/s with the water; still likewise |
| `sky/{dawn,…,night}.png` | Behind everything, centred on the ship, row 213 on the horizon, at the hull's pixel scale, scaled up only as far as the pane needs | Follows the local clock (below) |
| `sky/stars.png` | Over the sky, behind the gull and ship | Fades with the night's share |
| `gull/flap-strip.png` | Behind the ship, at about the masthead's height, beak-registered at `[26,20]`, mirrored to fly left | `up mid down mid` at 125 ms while flapping, `mid` gliding; none at night or under reduced motion |

Depth, back to front: sky, stars, gull, far sea | ship, its deck, props, depth pieces, lanterns and crew |
near sea, foam | the React hover label and legend. Without the environment (it fails to load, or lacks an
image), the deck draws its ship and crew on a flat navy sea and asks again on the next open.

## How the day and night are driven

`client/deck-sky.ts`, from `new Date()` in the browser (local time zone), every frame while the deck runs
and once a minute while it is still (reduced motion), never while hidden:

| Local time | Sky |
| --- | --- |
| 04:00–05:30 | night fading into dawn (stars fading out) |
| 05:30–06:30 | dawn |
| 06:30–08:00 | dawn fading into morning |
| 08:00–10:30 | morning |
| 10:30–12:00 | morning → midday |
| 12:00–14:30 | midday |
| 14:30–16:00 | midday → afternoon |
| 16:00–17:00 | afternoon |
| 17:00–18:30 | afternoon → dusk |
| 18:30–19:30 | dusk |
| 19:30–21:00 | dusk → night (stars coming out) |
| 21:00–04:00 | night |

Anchors are the manifest's wall-clock hours; each fade is the 90 minutes before the next anchor, eased
(smoothstep), the earlier sky drawn whole and the next over it, as the manifest asks. No location or
season is read. An invalid clock shows midday. `client/deck-sky.test.ts` checks every minute of the day
with an injected clock: two neighbours only, no phase's share moving more than 3 % a minute, midnight
included.

## Checked in Edge (`render.mjs`, `render-results.json`)

`node docs/ship-deck-canvas/compile.mjs` (Paseo 0.11.0's compiler; the branch's bundle parses under
React Native 0.81's `hermesc` with default flags, no `class` syntax; the client bundle grows 10,741 bytes,
none of it art), then `node docs/ship-deck-environment/render.mjs`:

1. **Switch off** — the screen's DOM is main's, character for character, at 1440 and 390 px; the
   environment is never asked for.
2. **The day** — a still deck at each anchor and between: `sky-0530.png` dawn, `sky-0800.png` morning,
   `sky-1200.png` midday, `sky-1600.png` afternoon, `sky-1830.png` dusk, `sky-2015.png` mostly night with
   dusk fading, `sky-2100.png` and `sky-0200.png` night with stars. The canvas's `data-firstmate-deck-sky`
   names the expected phase every time. `deck-1440-dark-dusk.png` and `deck-1440-light-morning.png` are
   the whole screen.
3. **Real time passing** — a still deck at 19:29 (dusk), its page clock moved to 23:00: the minute timer
   redrew it once, as night, 60 s later, with no frame loop.
4. **Motion** — at noon: 169,983 sea pixels changed in a second while the high sky's did not; 31 frames a
   second (cap 30, with slack); `moving-gull-noon.png` catches the gull behind the masthead's plane.
5. **Resizing** — the chat's edge dragged across canvases 348–1048 CSS px wide: every corner of the canvas
   is sky or sea, never the theme's background. `resized-wide-noon.png` is the narrowest.

The polish harness (`docs/ship-deck-polish/render.mjs`) was re-run against this bundle and passed — switch
off identical to main, hover on all 12 sailors, the drag measured, 32 frames a second — and its committed
outputs left as they were.

## What still wants a human artist

- **Foam** — the strip's scallops are regular and read as a rope up close, and it is generic, not fitted to
  hull C's curved contact with the water: it is laid straight along the waterline and cut at the hull's
  ends. An artist should break up its rhythm and shape it to the hull.
- **Gull** — the three poses vary slightly in shape and the middle one is an angled wing, not a level
  glide; the wing sweep is approximate.
- **Sea** — one tile; its glints repeat visibly across a wide pane. A second, less regular tile would help.
- **Lighting** — the hull, crew and sea are not tinted for dusk or night; only the sky changes.
