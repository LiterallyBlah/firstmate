# The deck as a scene engine and setting packs: the migration's gate

The Deck is being split into a setting-independent **scene engine** and the ship as a pure-data **setting
pack** (`art/settings/ship/setting.json` and the PNGs it names), in nine reviewed steps. Every step has to
draw the ship exactly as main does. This folder is the check that holds each step to that.

## The gate: the ship, pixel for pixel, against main

```sh
npm install --prefix docs/board-list     # once: esbuild, Playwright, react-native-web
node docs/ship-deck-canvas/compile.mjs   # Paseo's compiler on this checkout and origin/main; Hermes; no `class`
node docs/deck-settings/gate.mjs         # needs Edge
```

`gate.mjs` takes origin/main as files, answers each checkout's deck RPCs from that checkout's own server code
and art, and renders each compiled bundle in headless Edge through one host (`host.jsx`, `stubs.jsx`) that
imports neither checkout's deck code — so the two can differ in every module and every RPC and still be
compared. Each scenario is rendered for both at the same moments and the screenshots, the whole window, are
compared pixel for pixel:

| Scenario | What it covers |
| --- | --- |
| `still-*` (reduced motion) | noon dark at 2× and light, night, dawn, dusk into night, eight working (still calm), all idle (the rest area's crowd), the feed lost (grey) |
| `moving-noon` | a minute of the sea, foam, wake, sail, bob, sway, clouds and gull on Playwright's fake clock, at 2× |
| `moving-storm` | eight working: the storm's variants, spray and overcast every five seconds for two minutes, and the first four lightning flashes as they show |
| `moving-night` | the night sky moving |
| `moving-crew` | state changes and the walk, a crewmate climbing out of the hatch, one done and walking the plank (shark and splash), one closed, at 2× |
| `focus` | a sailor focused from the keyboard, the camera's zoom and the way back out |
| `lite-software-renderer` | SwiftShader: the lite plan, at its own pace |

The deck draws only from its clocks, never `Math.random`, so a render is deterministic: `CONTROL=1` renders
main twice and compares it with itself first, and it is identical. `ONLY=<names>` renders some scenarios;
`SAVE=1` keeps the branch's shots in `docs/ship-deck-canvas/.generated/gate/shots/`; on any difference the
main, branch and diff images go to `docs/ship-deck-canvas/.generated/gate/`. Results are in
[`gate-results.json`](gate-results.json), and the compile's in [`compile-results.json`](compile-results.json).

## Step 1 — the package diet

`art/` is in the package's `files`, so everything under it went to every install: 155 files, about 11.5 MB, of
which 63 files and about 300 KB are what the deck serves. The other 92 — generation sources, prompts,
provenance, verification records, contact sheets, fit previews and review renders — moved to
`docs/ship-deck-art/` under the same relative paths (`docs/ship-deck-art/README.md`). The three tests that
compare the served art with its own generation records read them there. `server/ship-deck.test.ts` now fails on
any file under `art/` that no served manifest names, or on a name with no file, and on `art/` passing 400 KB.

Gate: every shot pixel-identical to main. The client bundle differs from main's only in five comments that
name the moved READMEs (+25 bytes); Hermes parses it, and it has no `class`.

## Step 2 — the format, the ship as a pack, and serving it

- **The format** is `shared/deck-setting.ts`: `firstmate.deck-setting`, format 1, as zod, with
  `settingProblems` — every image, pose, zone, exit, mark, effect, clock, channel, day phase and element a manifest
  names must be there, ids must not repeat, and `requires` must equal what it uses (`capabilitiesUsed`) — and the
  closed behaviour catalogue, `ENGINE_CAPABILITIES`. It is the report's §3, settled against the code: a part's
  `cutout`, `replacesPiece` and `fallback` say how the tall mast and the hull's own masthead stand in for each
  other; a piece's baseline can be `{ over: "near" }` (the plank); a choreography segment's `layer` and `layerAt`
  say when a worker steps in front of a piece; effect keys `alignX` a named point over a mark (the shark's mouth);
  the lanterns' glyph, glow and flicker waves are data; and the sky's overlays say `night` or a curve, `dayOnly`,
  and which overlays hide them (`hiddenBy`).
- **The ship is `art/settings/ship/`**: `setting.json` and the 60 images it names, moved from `art/ship-deck/`
  under the same paths. `docs/settings/ship/from-legacy.mjs` wrote the manifest once from the three manifests the
  deck was served (now records in `docs/ship-deck-art/legacy/`) and the constants in the deck's code, so every
  number came from where the deck had it. `client/ship-pack.test.ts` holds it equal to both while they last:
  read back as the old manifests (`legacyViews`) it is them exactly, and every constant it replaces — anchors,
  polygons, the plank's timeline, fidgets and breath sampled against `idleMotion` and `breathSink`, the bob and
  sway against `shipBob` and `mastSway` at every heave, the lanterns' flicker bit for bit — is what it holds.
- **Two RPCs replace three**: `firstmate.deck.settings` lists the packs, `firstmate.deck.setting` sends one whole
  (`server/deck-settings.ts`; contracts in `shared/deck-rpc.ts`). `firstmate.deck.art`, `.environment` and
  `.extras` are gone, with their manifests; the client and server bundles ship together, so the swap is atomic.
- **The client** fetches the pack once a session by id, decodes each image on its own, and reads it through
  `legacyViews` into the art, environment and extras the engine already draws from (`client/deck-mount.ts`'s
  `packArt`), with the old fallbacks: no backdrop, no deck; any of the sky and still sea missing, a plain sea;
  any extra missing, drawn without it. The format's rules stay on the server: the client bundle is 4.5 KB
  smaller than main's.
- **The pack linter**, `test/deck-settings.test.ts`, runs over every pack in `art/settings/`; the floor, zones
  and marks checks join it in step 3.

Gate: every shot pixel-identical to main.

The per-feature harnesses under `docs/ship-deck-*/` drove the RPCs and modules of their own PRs, and are kept
as those PRs' evidence; they are not maintained through the migration. This gate is how the deck is checked.
