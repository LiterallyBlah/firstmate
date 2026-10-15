# art/ship-deck/

An expansion adds [fitted Hull C sails and six crew variants](assets-2/README.md), with two sail states,
exact existing crew frame layouts, provenance and per-asset quality verdicts. The Deck draws them through
[`extras.json`](extras.json), served by `firstmate.deck.extras` (`client/deck-extras.ts`); without them it
draws a bare mast and the atlas's two outfits.

A [generated tall mast](mast/README.md) and a [generated plank](plank/README.md) are drawn through
`extras.json` too (its `mast` and `plank`): the mast in place of hull C's own short rig, which the Deck leaves
out of the hull (`clears`), with the [taller sail](sails/README.md) (`sails/main-sail.png`, now 114 × 84 a state) hung on
it; the sail is fitted to the tall mast and hangs on nothing else; the board in place of the plank once drawn in code.
Without the mast the Deck draws the short rig bare; without the board, the code board. `docs/ship-deck-mast/` shows both in place.

Generated environment assets (sea, six sky phases, stars and a gull flap cycle) are documented in
[ENVIRONMENT.md](ENVIRONMENT.md), with their own [manifest](environment.json). The Deck draws them in
place of its old code-drawn sea and gull, served by `firstmate.deck.environment` (`client/deck-environment.ts`);
they do not change `deck.json`.

The ship deck's art, served to the Deck by `firstmate.deck.art` (`server/ship-deck.ts`). Never bundled
into the client.

- `deck.png` is one atlas, 426 × 275, 48 colours, binary alpha, about 84 KB. It holds hull C's
  deck (426 × 161, the deck's coordinate space), the parts of the hull cut out again as depth pieces,
  nine poses of the sailor in two outfits, and a barrel, a crate and a coil of rope.
- `deck.json` says where each of those is in the atlas. It also gives each depth piece's place on the
  hull and the deck row it stands on, where each sprite's feet are, and the SHA-256 of every source
  image. `shared/ship-deck.ts` is its contract.

## Where it comes from

The sources are AI-generated images, made on 14 October 2026 with the built-in image-generation tool in
the captain's agent session. That tool does not name its backend model. The captain approved them from the
comparison in that experiment: hull **C, low rig** (`10-ship-low-rig.png`), the crew sheets
`01-crew-base.png` and `02-crew-outfit.png`, and the props `03-barrel.png`, `04-crate.png` and
`05-rope.png`. The crow's nest prop (`06-crows-nest.png`) is not used: hull C has its own. The sources are
not in this repository. `deck.json` records their hashes.

No third-party art is in it. None of the Sevarihk CC-BY tiles from earlier prototypes are used, so none
need attribution.

## How it is made

`docs/ship-deck-art/build-art.py <folder with the sources>` (Python 3, Pillow, NumPy) writes both files,
deterministically and mechanically, with no hand repainting:

1. **One logical pixel grid.** Each source was drawn at its own "pixel" size: the hull about 4.5 source
   pixels a cell, the crew about 7.5, the props about 50. The script cuts each to its pose or object and
   block-samples it onto one grid, where a standing sailor is 32 px tall and the hull is 426 px long.
2. **Binary alpha.** The sources' soft halos and part-transparent fringes are dropped.
3. **One shared palette** of 48 colours for hull, crew and props, without dithering.
4. **Depth pieces.** The script cuts out the mast, four bollards and `near` — the bow bulwark, the near
   gunwale, the stairs, the quarterdeck's front rail and the hull below them. Each piece records its deck
   row, so the canvas can draw it over a sailor standing behind it.

`docs/ship-deck-art/atlas-4x.png` shows the atlas. `depth-pieces-3x.png` shows the hull with each
depth piece tinted.

## How good it is

It is a clear step up from the placeholder shapes. The deck reads as one ship with one crew: wood, navy,
cream and skin come from the same palette, and the hull and sailors share a pixel scale. The hull holds
up well at this size.

**A human pixel artist is still wanted for final polish**, chiefly on the crew:

- At 32 px, the sampled sailors have muddy faces, broken stripes and some uneven outline clusters.
- The poses are separate generated drawings. They are not a consistent animation set: the "walk" frames
  are not a walk cycle, the feet do not share a pivot, and there are no back or left-facing views.
- The outfit sheet's hauling pose lost its rope.
- The props are drawn front-on, while the hull is seen from slightly above. They pass at this size, but
  a matched set would sit better.
- Mechanical sampling leaves single-pixel noise in places on the hull: plank grain, rigging and some
  edges.

The Deck's motion (`client/deck-crew.ts`) makes do: a walk is `walk-a`, `idle`, `walk-b`, `idle` on each
frame's own feet, with the body raised a pixel on the passing frames; the side poses are mirrored to walk
left; there is no back view, so a sailor walking up the deck shows the front frames. Idle motion is
whole-pixel shifts of the state's one pose. An idle sailor uses `side-idle`, not `leaning` — the lean's arm
reaching forward read as someone about to act — and breathes by drawing its head and shoulders a pixel
lower on the out-breath. A drawn at-ease cycle (a slump, a yawn, a weight shift) would say "idle" better. Because a still pose does not say enough, each sailor wears a
drawn badge for its state (`client/deck-badges.ts`) and an idle one breathes out a z: stand-ins for a
haul cycle, a doze, a pacing fret and a waiting toe-tap that an artist would draw.

Generated art can stand in for now. Animation and state poses beyond today's four, a second ship and any
interactive layer would be better served by art drawn for them.
