# The ship deck canvas: evidence

> The Deck has since become a standard feature, and the `FIRSTMATE_SHIP_DECK` switch this describes is gone
> (`docs/ship-deck-default/README.md`). What follows is the evidence as it stood when it was written, behind the switch.

The open question was whether a PixiJS 8 WebGL canvas can live inside the plugin's react-native-web UI.
The prototype (`fm-ship-deck-prototype/.local/ship-deck-prototype`) proved the look, standalone. This is
the plugin-side half: the Deck pane, behind `FIRSTMATE_SHIP_DECK`, drawn from the board's own cards.

The canvas first drew placeholder shapes. It now draws the captain-approved generated art: hull C's deck,
a sailor sprite per live crewmate and three props. The deck is depth-layered, so a sailor behind the mast,
a bollard or the near rail is hidden by it. `art/ship-deck/README.md` covers where the art comes from,
how it is made and how good it is.

## How it is wired

- **Switch.** `FIRSTMATE_SHIP_DECK=1` in the daemon's environment. The fleet load then carries
  `shipDeck: true`, and the wide layout's Crew/Files switch gains **Deck** in a web renderer. Off, the load
  has no key and nothing new is offered (`server/ship-deck.ts`, `client/deck-scene.ts`).
- **Escape hatch.** A childless react-native-web `View`, whose ref on the web is the DOM `<div>`; Pixi's
  `<canvas>` is appended to it by hand (`client/deck-mount.ts`). No DOM JSX and no forbidden host module.
- **Pixi is served, not bundled.** Pixi's prebuilt browser build is shipped as `vendor/pixi.min.js`.
  The daemon sends it through `firstmate.deck.engine`, refused while the switch is off. The client
  evaluates it with `new Function`, only after a host and WebGL have been found.
- **Art is served too.** `firstmate.deck.art`, refused while the switch is off, sends `art/ship-deck/deck.png`
  (one 84 KB atlas) as base64 with its manifest `deck.json`. The client decodes it once a session, alongside
  Pixi, and samples it `nearest`.
- **Scene.** One sailor per live crew worker, from the cards the board already loads, placed by column, on
  the hull's own pixel coordinates (426 × 161):
  - Working: hauling at the stations amidships, round the mast, facing it;
  - Ready, or Working with the `waiting` note: arms folded by the helm on the quarterdeck;
  - Blocked or Failed: in the bow;
  - Idle or Parked: leaning at the near rail.

  Queued and Done cards, closed agents and followed sessions are left off. Each sailor keeps one of two
  outfits by its card's key, and a small mark in its state's colour under its feet matches the legend.
- **Depth.** The hull is the backdrop. `deckLayers` (`client/deck-scene.ts`) then draws props, sailors and
  the hull's depth pieces in order of the deck row each stands on. The pieces are the mast and four
  bollards, and last the near rail, stairs and quarterdeck front. A piece cut from the hull covers a
  sailor standing behind it and is covered by one in front.

## Why Pixi is not in the bundle

The first build bundled Pixi behind `import()`. Paseo's real compiler took it: 1.6 MB, every Pixi module
a lazy `__esm` initialiser that only the import starts. It painted in Edge. But react-native 0.81's
`hermesc` refused that bundle at its first `class` expression, and main's bundle contains no `class` at
all. A phone parses the whole bundle before running any of it, so lazy is not enough. Whether the app's
Hermes enables ES6 classes at run time was not checked on a device; serving Pixi avoids the question.
`compile-results.json` records the vendored build refused by `hermesc` too, with and without
`-Xes6-class`.

## Proven offline

`compile.mjs` (Paseo's own `compilePlugin`), into `compile-results.json`:

- The canvas PR ran Paseo 0.11.0's compiler. Origin/main and that branch both compiled, the client
  bundle grew by about 16.6 KB (401,649 → 418,216 bytes) and the server's by about 2.2 KB.
- The art increment ran the copy on this host, Paseo 0.9.2's (`PASEO_COMPILER` pointed at it). It
  compiled origin/main (2ae3fc8, the canvas) to the same 418,216-byte client bundle as 0.11.0 did. The
  branch's client is 424,448 bytes: 6,232 more, all code, with no art in it. The server is 3,103 bytes
  more.
- Neither bundle has Pixi or `class` syntax, and `hermesc` parses both with default flags.

`render.mjs` (headless Edge, no daemon; since the deck moves, `docs/ship-deck-motion/render.mjs`, which
holds a still deck to the same reference and adds the motion's checks) evaluates those compiled bundles with `(0, globalThis.eval)` and a
host `require`, the way the app does. It renders the screen with the board-list fixture fleet, into
`render-results.json`:

- **Switch off:** the screen's DOM is identical to origin/main's, character for character, at 1440 and
  390 px. There is no Deck, no canvas, no `firstmate.deck.engine` or `firstmate.deck.art` call, and no
  `PIXI` global (`flag-off-1440-dark.png`).
- **Switch on**, on a 2x display:
  - Deck starts Pixi 8.22.0 on WebGL 2; the canvas says `data-firstmate-deck="webgl"`.
  - The canvas is inside the deck's `role="img"` view and fills it.
  - Pixi and the art are each fetched once.
  - 12 sailors (5 working, 1 waiting, 4 blocked, 2 idle) on hull C, at 3 device pixels per art pixel.
  - **The WebGL canvas is the expected deck, pixel for pixel.** `host.jsx` draws the deck again with a 2D
    canvas, independently, from the same scene, atlas and layer order. The screenshot, read at the centre
    of every art pixel, matches it at 67,506 of 67,506 pixels in both
    themes. The only pixels skipped are the soft state marks under the sailors' feet.
  - So a sailor stands where its state puts it, in its pose, and is hidden exactly where a piece stands
    in front of it. In the fixture, `work-2` is behind the mast and
    `block-0` behind a bow bollard (`render-results.json` lists each sailor's
    hidden pixels by piece).
  - Screenshots: `deck-1440-dark.png`, `deck-1440-light.png`, and the canvas alone,
    `deck-1440-dark-canvas.png`.
- **Live behaviour:**
  - A poll that lets two crewmates go redraws 10, again matching the reference
    (`deck-1440-dark-after-poll.png`), with no second fetch of Pixi or the art.
  - A narrower window resizes the canvas with its view.
  - Leaving the Deck removes the canvas.
- **No WebGL** (`--disable-webgl --disable-3d-apis`): a plain sentence, no canvas, and neither Pixi nor
  the art is fetched (`deck-no-webgl.png`).
- No page errors and no console errors.

`npm test` covers the rest, with stand-ins:
- the scene;
- the switch, including that the load is byte-identical off and that both RPCs refuse before reading;
- the vendored file, byte-identical to the pinned `pixi.js`;
- the art: the served atlas is the file, its manifest is the contract, and it ships in `files`;
- every place on deck, however crowded: feet on the hull's deck, never on the near rail. This is read
  from the atlas's own pixels;
- the draw order, with a sailor behind the mast or a bollard before it and one in front after it;
- the fit: whole device pixels per art pixel from twice the deck's size up;
- the build evaluating to Pixi's namespace and keeping it out of globals;
- every path of the mount: no host, no WebGL, a probe that throws, Pixi failing to load or start, a
  teardown before or during the start;
- the view mounted through react-test-renderer on web and on a phone.

## Only an install can confirm

The harness is Chromium (Edge) with react-native-web 0.21, the board-list host stubs and a fake client.
The Paseo desktop app is Electron (Chromium) with its own host. What only the real app shows:

- that its renderer has WebGL. If hardware acceleration is off or the GPU is blocklisted, Chromium may
  have no WebGL, and the deck says so;
- that its `require` and react-native-web behave as the harness's, and that `new Function` is allowed.
  The app's own `globalThis.eval` of the bundle suggests it is;
- that `firstmate.deck.engine`, about 840 KB of text, and `firstmate.deck.art`, about 115 KB, come back
  through the daemon's plugin RPC path. Also that `paseo plugin ls` points the server at a folder with
  `vendor/` and `art/` in it.

Steps, on the captain's word only. Installing reloads the first mate.

1. Install or update the plugin, from the merged main or this branch. Check `vendor/pixi.min.js` is in
   the installed folder (`paseo plugin ls --json` gives the folder).
2. Restart the daemon with `FIRSTMATE_SHIP_DECK=1` in its environment, then reload the plugin.
3. Open FirstMate in the desktop app, wide enough for the chat and the right pane side by side. Press
   **Deck** in the header's Crew/Files switch.
4. Expect the caption "Preview · drawn with WebGL · N on deck", with N the live crew in Working, Ready,
   Blocked, Failed, Idle and Parked. Expect hull C's deck, and a sailor per crewmate in its column's
   place, behind the mast where it stands behind it.
5. In DevTools (View › Toggle Developer Tools, where the app offers it):
   - `document.querySelector("canvas[data-firstmate-deck]").dataset.firstmateDeck` is `"webgl"`;
   - the Sources panel lists `firstmate-pixi-8.22.0.js`;
   - `"PIXI" in window` is `false`.
6. Watch it follow the board for a poll or two. Drag the chat's edge and the canvas resizes. Press Crew
   and the canvas goes.
7. Unset the switch, restart the daemon and reload. Deck is gone and the screen is as before.

## Gotchas found

- A plugin's client bundle must stay free of `class` syntax: see above, and AGENTS.md.
- Pixi's types pull in `lib="dom"` through `@xmldom/xmldom`, so they are not imported. `deck-pixi.ts`
  declares the narrow shape it uses, and the test checks it against the build.
- Paseo's compiler took about 70–90 s on the bundled-Pixi spike, against a few seconds for the plugin
  itself. The served build keeps installs and reloads at their old speed.
- `paseo plugin install` from npm runs `--omit=dev`, so a runtime `pixi.js` dependency would pull its
  whole ~76 MB package into every install. The vendored 840 KB file avoids that; `ship-deck.test.ts`
  keeps it equal to the pinned devDependency.

## Running it

```sh
(cd docs/board-list && npm ci)          # esbuild, playwright, react-dom, react-native-web
node docs/ship-deck-canvas/compile.mjs  # needs the Paseo CLI's compiler; PASEO_COMPILER to point elsewhere
node docs/ship-deck-motion/render.mjs   # headless Edge: the browser checks, now for a moving deck
py docs/ship-deck-art/build-art.py <sources>  # only to rebuild art/ship-deck/ from the generated PNGs
```
