# vendor/

`pixi.min.js` is PixiJS's own prebuilt browser build, `dist/pixi.min.js` from the `pixi.js` package at
the version `package.json` pins as a devDependency (8.22.0), copied unchanged. PixiJS is MIT-licensed;
its copyright and licence notice is in the file's banner.

The daemon serves it to the ship deck (`server/ship-deck.ts`) while `FIRSTMATE_SHIP_DECK` is on. It is a
file rather than a dependency so that an npm install of the plugin does not pull Pixi's whole package.
It is not bundled, so a phone's Hermes never has to parse it.

To update: bump the `pixi.js` devDependency, `npm install`, then
`cp node_modules/pixi.js/dist/pixi.min.js vendor/`. `server/ship-deck.test.ts` fails while the two
differ. `.gitattributes` keeps Git from converting the file's line endings.
