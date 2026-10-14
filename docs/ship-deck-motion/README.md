# The ship deck in motion: evidence

The canvas (`docs/ship-deck-canvas/`) and the art (`art/ship-deck/`) put hull C, its crew and its props on
screen, standing still. This increment makes it move: sailors walk to their state's place as their state
changes, join and leave through the hatch, idle with small motions, and the ship rides a living sea. Still
behind `FIRSTMATE_SHIP_DECK`, still desktop only.

`deck-motion.png` is the first ten seconds after a state change, at one pixel per art pixel and ten
frames a second (an animated PNG; open it in a browser). A working sailor leaves for the bow, a blocked
one goes to work, the one waiting at the helm walks down the stairs to a station, a gull crosses, the sea
drifts and the ship bobs.

## What moves

| What | How | Where |
| --- | --- | --- |
| **Sailors walk** to their state's anchor | A* over a 2 px grid of the walkable deck, pulled tight; 32 art px a second | `client/deck-geometry.ts`, `client/deck-crew.ts` |
| **State first, then movement** | `applyCrew` sets the state (mark, legend, label) on the poll; the sprite catches up | `client/deck-crew.ts` |
| **The hatch** | A newcomer climbs out (its sprite cropped to the rows above the grate, 0.7 s), then walks; one whose card leaves walks back and climbs down | `client/deck-crew.ts`, `client/deck-pixi.ts` |
| **Idle motion** | Working hauls (a pixel into the line and back, 0.9 s); waiting and idle breathe (a pixel, 2.6 s and 3.4 s); blocked frets foot to foot for 1.2 s in every 4 | `idleMotion` |
| **The sea** | Pre-drawn crest rows that scroll at their own pace, nearer rows faster; foam laps the hull in two shapes | `client/deck-ambient.ts` |
| **The ship** | Bobs a pixel over 6.2 s, crew and all; the sea does not | `shipBob` |
| **Masthead and rigging** | The crow's nest, topmast and the tops of the stays sway a pixel each way, a beat behind the bob | `mastSway`, `MASTHEAD` |
| **Lanterns** | Three (stern post, quarterdeck post, mast), glass and glow flickering on three out-of-step sines | `lanternFlicker` |
| **Gulls** | Now and then one crosses above the masthead, flapping in bursts, gliding between; seeded, so the same clock gives the same gulls | `gullsAt` |

**The walk frames are derived, not a cycle.** The atlas has `front-walk-a`, `front-walk-b`,
`side-walk-a` and `side-walk-b`, separate generated drawings with their own feet (`art/ship-deck/README.md`).
The deck plays `walk-a, idle, walk-b, idle` at 150 ms a step, each on its own feet, and raises the body a
pixel on the passing frames. The side poses are mirrored to walk left. There is no back view: a sailor
walking up the deck shows its front frames. A pixel artist would give it a real four-frame cycle in four
directions, and state poses that move (the haul, the fret).

## The interaction layer

- **Walkable deck.** Three polygons in feet coordinates: the main deck from the bow to the foot of the
  stairs (rows 86 to 119, following the bow's near rail), the stairs, and the quarterdeck in front of the
  wheel (rows 90 to 96). They meet only on the stairs, so the helm is reached by climbing them. The stairs
  are part of the hull's `near` piece, so a climbing sailor passes behind their balustrade.
- **Obstacles.** The mast's foot, three bollards, the barrel, the crate, the rope and the wheel.
- **Anchors.** 22 named spots: seven stations (both sides of the mast, behind it, the barrel, the crate,
  the rope, beside the hatch), seven rail spots, four helm spots, four bow spots, and the hatch. Each has a
  facing.
- **Reservation.** A sailor takes the free anchor at its place nearest to where it stands, and keeps it
  from poll to poll. When every anchor at a place is taken, it stands beside the least crowded one, on the
  same deck and never within a few pixels of another sailor. A crowd too big for the quarterdeck spills
  down toward the stairs. The crow's nest is not an anchor: the nest is part of the hull image, so a
  sailor in it would stand on top of it, and climbing needs frames the art does not have.
- **Depth while moving.** Every frame sets each sailor's `zIndex` from its feet's row, so it passes
  behind the mast, the bollards and the stairs and in front of them on its way back.
- **Stale.** A failing fleet load greys the whole crew. A remote host that cannot be reached greys its
  own workers. A stale sailor keeps its last state and place, its mark goes hollow, its idle motion stops,
  and the pane says the feed is lost. It never turns idle.

## Performance and accessibility

- **30 fps cap.** `requestAnimationFrame`, but a frame is drawn only once a thirtieth of a second has
  passed (less a little slack), so 60, 120 and 144 Hz displays all draw about 30.
- **Pauses when hidden.** `document.hidden` or a pane with no size stops the loop: no frames are even
  requested. Leaving the Deck tears the canvas down, as before. The scene clock is the time the loop has
  run, so nothing jumps on resume, and no step is longer than 100 ms.
- **Reduced motion.** `prefers-reduced-motion: reduce` runs no loop. The deck is drawn once per change,
  every sailor at its anchor and every state still shown by place and mark. Turning it on mid-walk
  settles everyone at once.
- **Software rendering.** When the WebGL context names SwiftShader, llvmpipe, softpipe or the basic render
  driver, the deck runs `lite`: 12 fps, crew, bob, sway and lanterns, with no sea drift and no gulls.
- **No shaders.** Pass 3 of the prototype found its two full-screen shaders cut SwiftShader to 20 fps.
  Here the sea is pre-drawn rows that move, so a software renderer pays only for sprites.

The canvas says which plan is in force: `data-firstmate-deck-motion` is `full`, `lite` or `still`.

### Measured (`render-results.json`)

Headless Edge, 1440 × 900 at 2× (the canvas about 750 × 680 CSS px, 3 device pixels an art pixel), the fixture's 12 crew. The
crew was set walking just before measuring.

| Renderer | Plan | Crew walking | Settled | Window hidden |
| --- | --- | --- | --- | --- |
| GPU (AMD Radeon 880M, D3D11) | full | 29.0 fps, main thread 12.0% busy, 2.4 ms JS a frame | 28.8 fps, 12.6% | 0 fps, 2.6% |
| GPU, reduced motion | still | 0 draws, 4.0% | 0 draws, 4.0% | 0 draws, 3.3% |
| SwiftShader (CPU) | lite | 11.8 fps, 4.6% busy, 2.1 ms a frame | 11.8 fps, 4.4% | 0 fps, 1.8% |
| SwiftShader, reduced motion | still | 0 draws, 3.8% | 0 draws, 3.0% | 0 draws, 2.1% |

"Main thread busy" is CDP's `TaskDuration` over five seconds, all of the page's work, not only the deck's.
The hidden and still rows are the screen's other work, such as the chat and the board's poll. "JS a frame"
is everything inside the animation-frame callback, Pixi's render included. GPU time was not measured.

## Proven offline

`compile-results.json` (`node docs/ship-deck-canvas/compile.mjs`, Paseo 0.11.0's compiler):

- The client bundle grows by 32,003 bytes (424,448 → 456,451). It is all code, with no Pixi and no art in it.
- It has no `class` syntax, and React Native 0.81's `hermesc` parses it with its default flags.
- The server is unchanged.

`render.mjs` (headless Edge, no daemon, the compiled bundles evaluated as the app does), into
`render-results.json`:

- **Switch off:** the screen's DOM is main's, character for character, at 1440 and 390 px. There is no
  Deck, no canvas, no deck RPC, no `PIXI` global and no draw.
- **Reduced motion** (`still-1440-dark.png`, `still-1440-light.png`, `still-canvas.png`):
  - The canvas says `still`, and it draws nothing in two idle seconds.
  - The WebGL canvas matches an independent 2D composite at **31,720 of 31,720** art pixels in both
    themes. The composite is built from the same scene, the same crew placement (`applyCrew`), the same
    atlas and the same layer order. It is compared above the waterline, outside the marks and the
    lanterns' glow, which the composite does not draw.
  - Every sailor is mostly visible.
- **Motion, on Playwright's fake clock**, so each frame is at a known moment:
  - `01-aboard.png` — the crew as the Deck opens, at their anchors.
  - `02-state-changed.png` — 150 ms after a poll that changes three states: a working sailor blocked, a
    blocked one back to work, the job-waiting one answered. The label already reads
    "6 working, 0 waiting, 4 blocked, 2 idle", while the sprites have barely moved.
  - `03-walking.png`, `04-arrived.png` — three seconds into the walks, then settled.
  - `05-hatch-arriving.png`, `06-new-crewmate-walks.png` — a new crewmate half out of the hatch, then on
    its way to a station.
  - `07-leaving.png` — an archived crewmate walking back to the hatch.
  - `08-feed-lost.png` — the fleet load failing: the banner, "The crew's feed is lost…", every sailor
    greyed in place, the legend "12 stale", and the label "… feed lost: last known".
  - Window hidden: **0 draws in 3 s**. Shown again: 32 in the next second.
- No page errors and no console errors.

`npm test` (`client/deck-motion.test.ts`, `client/ship-deck.test.ts`):

- Walkable cells, anchors and paths:
  - every walkable cell is on the hull, and none is hidden by the near rail except on the stairs;
  - every anchor and the hatch is on open deck;
  - every path between any two anchors, both ways, stays on the deck all the way;
  - the helm is reached by the stairs.
- Anchors:
  - one per sailor, kept from poll to poll and freed for the next;
  - crowds of up to 30 a place on distinct spots, all on open deck.
- The state shows before the sailor moves. A walk turns round mid-way from wherever the sailor is.
- The walk frames, mirrored when walking left.
- The hatch both ways, a card returning mid-leave, and a newcomer sent straight back down the ladder.
- Stale sailors keep their state and place and lose their idle motion. The whole crew greys for a lost
  feed, a remote host's workers for an unreachable host.
- Reduced motion jumps every change, and settles walkers when switched on mid-walk.
- Depth while walking past the mast.
- The ambient functions' ranges and determinism. The software-renderer test.
- The frame loop:
  - 30 fps on a 120 Hz display, 12 on software;
  - no frames requested while hidden or sized zero, and no jump on resume;
  - no loop under reduced motion.
- The browser signals: `matchMedia`, `visibilitychange`.
- The view's stale caption, legend and label.

## Only an install can confirm

Steps, on the captain's word only. Installing reloads the first mate.

1. Install or update the plugin from this branch, restart the daemon with `FIRSTMATE_SHIP_DECK=1`, and
   reload. Open FirstMate on the desktop app's wide layout and press **Deck**.
2. In DevTools, `document.querySelector("canvas[data-firstmate-deck]").dataset.firstmateDeckMotion`
   should be `full` (`lite` if the app is on software rendering).
3. Watch a crewmate change state, from a poll or by asking the first mate. Its mark should change first,
   then the sailor should walk.
4. Put the app in the background: in DevTools' Performance panel the deck should draw nothing.
5. Turn on the system's reduce-motion setting. The deck should be still and say `still`.

## What remains

- **Multiple ships for multiple hosts.** One ship carries every host's crew today, with unreachable hosts
  greyed.
- **A pixel artist**, chiefly for:
  - a real walk cycle in four directions, back view included;
  - moving state poses (hauling, fretting, leaning);
  - a climbing set, which would open the crow's nest;
  - lanterns and a gull drawn rather than coded.
- **The real app.** The harness is Edge with react-native-web; the Paseo desktop app is Electron. Its
  frame rate, its `prefers-reduced-motion` and its background throttling are expected to match, but are
  unconfirmed until installed.

## Running it

```sh
(cd docs/board-list && npm ci)           # esbuild, playwright, react-dom, react-native-web
node docs/ship-deck-canvas/compile.mjs   # Paseo's compiler → docs/ship-deck-canvas/.generated/
node docs/ship-deck-motion/render.mjs    # headless Edge, a few minutes
```
