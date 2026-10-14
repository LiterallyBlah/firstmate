# The ship deck canvas: evidence

The open question was whether a PixiJS 8 WebGL canvas can live inside the plugin's react-native-web UI.
The prototype (`fm-ship-deck-prototype/.local/ship-deck-prototype`) proved the look, standalone. This is
the plugin-side half: the Deck pane, behind `FIRSTMATE_SHIP_DECK`, drawn from the board's own cards.

## How it is wired

- **Switch.** `FIRSTMATE_SHIP_DECK=1` in the daemon's environment. The fleet load then carries
  `shipDeck: true`, and the wide layout's Crew/Files switch gains **Deck** in a web renderer. Off, the load
  has no key and nothing new is offered (`server/ship-deck.ts`, `client/deck-scene.ts`).
- **Escape hatch.** A childless react-native-web `View`, whose ref on the web is the DOM `<div>`; Pixi's
  `<canvas>` is appended to it by hand (`client/deck-mount.ts`). No DOM JSX and no forbidden host module.
- **Pixi is served, not bundled.** Pixi's prebuilt browser build is shipped as `vendor/pixi.min.js`.
  The daemon sends it through `firstmate.deck.engine`, refused while the switch is off. The client
  evaluates it with `new Function`, only after a host and WebGL have been found.
- **Scene.** One sailor per live crew worker, from the cards the board already loads, placed by column:
  - Working: at the stations;
  - Ready, or Working with the `waiting` note: by the helm;
  - Blocked or Failed: in the bow;
  - Idle or Parked: at the rail.

  Queued and Done cards, closed agents and followed sessions are left off.

## Why Pixi is not in the bundle

The first build bundled Pixi behind `import()`. Paseo's real compiler took it: 1.6 MB, every Pixi module
a lazy `__esm` initialiser that only the import starts. It painted in Edge. But react-native 0.81's
`hermesc` refused that bundle at its first `class` expression, and main's bundle contains no `class` at
all. A phone parses the whole bundle before running any of it, so lazy is not enough. Whether the app's
Hermes enables ES6 classes at run time was not checked on a device; serving Pixi avoids the question.
`compile-results.json` records the vendored build refused by `hermesc` too, with and without
`-Xes6-class`.

## Proven offline

`compile.mjs` (Paseo 0.11.0's own `compilePlugin`, the global CLI's copy), into `compile-results.json`:

- origin/main and this branch both compile. The client bundle grows by about 16.6 KB (401,649 → 418,216
  bytes) and the server's by about 2.2 KB.
- Neither bundle has Pixi or `class` syntax, and `hermesc` parses both with default flags.

`render.mjs` (headless Edge, no daemon) evaluates those compiled bundles with `(0, globalThis.eval)` and a
host `require`, the way the app does. It renders the screen with the board-list fixture fleet, into
`render-results.json`:

- **Switch off:** the screen's DOM is identical to origin/main's, character for character, at 1440 and
  390 px. There is no Deck, no canvas, no `firstmate.deck.engine` call, and no `PIXI` global
  (`flag-off-1440-dark.png`).
- **Switch on:**
  - Deck starts Pixi 8.22.0 on WebGL 2; the canvas says `data-firstmate-deck="webgl"`.
  - The canvas is inside the deck's `role="img"` view and fills it.
  - 12 sailors (5 working, 1 waiting, 4 blocked, 2 idle). Each has its state's colour in the screenshot
    where the scene puts it, and the deck's colour is on the deck. Checked in dark and light
    (`deck-1440-dark.png`, `deck-1440-light.png`).
- **Live behaviour:**
  - A poll that lets two crewmates go redraws 10 (`deck-1440-dark-after-poll.png`), with no second fetch
    of Pixi.
  - A narrower window resizes the canvas with its view.
  - Leaving the Deck removes the canvas.
- **No WebGL** (`--disable-webgl --disable-3d-apis`): a plain sentence, no canvas, and Pixi is never
  fetched (`deck-no-webgl.png`).
- No page errors and no console errors.

`npm test` covers the rest, with stand-ins:
- the scene;
- the switch, including that the load is byte-identical off and that the RPC refuses before reading;
- the vendored file, byte-identical to the pinned `pixi.js`;
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
- that `firstmate.deck.engine`, about 840 KB of text, comes back through the daemon's plugin RPC path,
  and that `paseo plugin ls` points the server at a folder with `vendor/` in it.

Steps, on the captain's word only. Installing reloads the first mate.

1. Install or update the plugin, from the merged main or this branch. Check `vendor/pixi.min.js` is in
   the installed folder (`paseo plugin ls --json` gives the folder).
2. Restart the daemon with `FIRSTMATE_SHIP_DECK=1` in its environment, then reload the plugin.
3. Open FirstMate in the desktop app, wide enough for the chat and the right pane side by side. Press
   **Deck** in the header's Crew/Files switch.
4. Expect the caption "Preview · drawn with WebGL · N on deck", with N the live crew in Working, Ready,
   Blocked, Failed, Idle and Parked. Expect a sailor per crewmate, in its column's place.
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
node docs/ship-deck-canvas/render.mjs   # headless Edge
```
