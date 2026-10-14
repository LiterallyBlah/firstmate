# The ship deck's polish: evidence

Three fixes to the moving deck (`docs/ship-deck-motion/`), still behind `FIRSTMATE_SHIP_DECK` and still
desktop only. No new art: the badges are drawn, and the sea, sky and gulls are left as they were.

## 1. Resizing no longer shrinks the ship

**Root cause.** `fitDeck` (`client/deck-pixi.ts`) rounded the deck's scale *down* to whole device pixels
per art pixel once there was room for two or more, to keep every art pixel the same size. The ship's
size was therefore a staircase over the pane's width. At 2×, a pane anywhere from about 666 to 1000 CSS px
drew the ship at 3 device pixels an art pixel. Drag the pane one step narrower and it fell to 2, a third
smaller in one frame, with the empty margin growing until the next step. At 125 % the steps fall at about
710 and 1065 px, with a drop from 2.4 to 1.6 CSS px an art pixel.

**Fix.** The exact fit at every size (0.96 of the pane, either way), with only the offset snapped to whole
device pixels. Sampled `nearest`, a fractional scale makes some art pixels one device pixel wider than
their neighbours. At the sizes the pane has, three or more device pixels an art pixel, that hardly shows;
a ship that jumps does.

Measured by `render.mjs`: the chat's edge dragged 10 px at a time, 24 steps out and 24 back, at 2× in Edge.
The ship's width is read off each frame's screenshot by colour alone, without any of the deck's code.

| Bundle | Canvas width over the drag | Ship's share of the canvas | Largest jump between two steps |
| --- | --- | --- | --- |
| origin/main | 508–748 CSS px | 0.647–0.957 | **426 device px** for a 20 device px drag (668 → 658 CSS px: 1278 → 852 px) |
| this branch | 508–748 CSS px | 0.960–0.960 | 20 device px for a 20 device px drag |

`resize-main-after-drag.png` and `resize-branch-after-drag.png` are the screen after the drag on each.
`client/deck-polish.test.ts` sweeps every width from 200 to 2400 px at 1×, 1.25×, 1.5×, 2× and 3×: the scale
never falls as the pane widens, never moves by more than a fraction of a pixel per pixel of pane, and
fills the same share at every width.

## 2. Each sailor says who it is

Pointing at a sailor shows a label over the canvas, the sailor ringed on deck:

- the card's **title**;
- its **state in the board's words**, with the badge: `Working`, `Working · waiting on a job it started`,
  `Ready · finished, waiting on the first mate`, `Blocked`, `Failed`, `Idle · stalled: said working, then
  stopped`, `Idle · its turn ended with no status line`, `Parked · paused`;
- its **project and host** (`This machine`, or the remote host's label);
- the **one line its card shows at rest** (`cardHeadline`): the captain's call, a status line, an error,
  a permission waiting; cut at 160 characters;
- for a greyed sailor, **why**: the feed lost, or its host out of reach.

The label is React, not pixel text: the app's own type at the app's own size, laid over the canvas as the
canvas's sibling (the host view stays childless), and it never takes the pointer. It goes above the
sailor when there is room and below its feet when not, and it stays inside the canvas. A touch keeps its
label until the next tap; a mouse's goes when it leaves the canvas. Under motion the label follows a
walking sailor, re-placed only when it moves more than two pixels, so idle motion does not re-render it.
Hit-testing uses the box each sprite is drawn in this frame, badge included. Where sailors overlap, the
one in front wins, as drawn.

`render.mjs` points at the middle of every sailor of the fixture fleet (12) at 2×. The label named the
sailor under the pointer every time: 9 as themselves, and 3 that the crowd at a shared anchor stands in
front of, as the one in front. It went when the pointer left. On a moving deck it held 29 frames a second
while hovering. `hover-{working,waiting,blocked,idle}-dark.png` and `hover-moving-light.png` show it.
**Persistent nameplates** were considered and left out. At the pane's sizes the deck is about 1.6–2 CSS px
an art pixel, sailors stand 10–20 art px apart, and a crowded anchor stacks them, so twelve names would
overlap each other and the crew. The persistent signal is the badge; the name is on hover.

## 3. Every state reads at a glance

Before, the poses carried the state alone: the art has one frame each for hauling, waiting and leaning,
and a blocked sailor stands in the plain front pose. An idle sailor at the rail and a blocked one in the
bow were two figures standing still. Now (`client/deck-badges.ts`):

- **A badge over every head**, a 7 × 7 sign in the state's colour with a 5 × 5 glyph: **▶** working,
  **hourglass** waiting, **!** blocked, **Z** idle. The ink is dark or light by the sign's lightness, so it
  reads in both themes. It rides with the head, greys with a stale sailor, and is hidden on the hatch's
  ladder.
- **An idle sailor dozes**: a small z rises off its badge and fades, every 3.2 s, out of step per sailor.
  Under reduced motion there is no z: the badge alone says idle.
- **The legend is the key**: each state's badge, its count, and where it stands — *hauling amidships*,
  *by the helm*, *in the bow*, *at the rail* — and a line saying to point at a sailor.

`badges-dark.png`, `badges-light.png` and `deck-1440-{dark,light}.png` are the still deck at 2×.

**Where a pixel artist would do better.** The badge is a stand-in for what the poses should say. A
moving pose per state would carry it: a real haul cycle with the rope, a seated or slumped doze for idle,
pacing or arm-waving for blocked, a toe-tap or glance at the horizon for waiting. Today each state is one
still frame nudged a pixel (`idleMotion`). With those poses, the badge would be the backup for a reader
who cannot tell them apart, and could shrink or show only on hover.

## Checks

- **Switch off:** the screen's DOM is origin/main's, character for character, at 1440 and 390 px; no
  canvas, no deck RPC, no `PIXI` global (`render-results.json`, `flagOff`).
- **The phone bundle:** `docs/ship-deck-canvas/compile.mjs` with Paseo 0.11.0's compiler: no Pixi and no
  `class` syntax in the branch's client bundle, which React Native 0.81's `hermesc` parses with default
  flags. The client bundle grows 12.8 KB over main's (the polish's share of the deck's code).
- **The still deck, art pixel by art pixel:** `docs/ship-deck-motion/render.mjs`, its 2D reference now
  drawing each sailor's badge in the sailor's own layer (`docs/ship-deck-canvas/host.jsx`), matches the
  WebGL canvas at all 32,057 compared art pixels in both themes, at 3.37 device pixels an art pixel. The
  exact, fractional fit samples every art pixel cleanly. The rest of that harness still passes: switch
  off identical to main, the hatch, the walk, a hidden window drawing nothing.
- **Performance** (that harness, Edge at 2×, 12 crew): GPU 28.8 fps walking and 29 settled, 3.0–3.4 ms of
  our JS a frame (2.3–2.5 ms before the badges and hover); SwiftShader 11.8 fps (`lite`); 0 hidden; 0
  under reduced motion. Its evidence files are left as the motion increment recorded them.
- `npm test`: `client/deck-polish.test.ts` (resize across widths, hit-testing, label placement, badges)
  and `client/ship-deck.test.ts` (the label's words for every state, in the view).

## Running it

```sh
cd docs/board-list && npm ci && cd ../..
node docs/ship-deck-canvas/compile.mjs   # needs the Paseo CLI's compiler; PASEO_COMPILER to point elsewhere
node docs/ship-deck-polish/render.mjs    # headless Edge
```
