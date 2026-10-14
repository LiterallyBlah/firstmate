# Hull C sails and crew variants

Assets-only expansion based on `ece9161c354874d73c0cc07defd594e7fea317c2` (`origin/main` at the fresh clone). Existing art and manifests are unchanged. The Deck now draws the sail strip, the mast occluder and the six crew textures through `../extras.json` (`client/deck-extras.ts`); the review images and full-canvas overlays here are not loaded.

[Manifest](manifest.json) contains dimensions, exact frame rectangles and feet, palette, hull attachment coordinates, generation provenance and per-asset verdicts. Paths in the manifest are relative to `art/ship-deck/`, except `promptFile`, which is relative to this folder. [Verification](verification.json) records delivered PNG hashes and pixel checks. [Prompts](prompts.json) records all eight built-in `image_gen__imagegen` calls; the tool does not disclose its backend model.

## Sail integration

`../sails/main-sail.png` is a **228 x 27** transparent strip containing two **114 x 27** frames. Draw the selected frame at **hull (154,46)**. Its local lashing pivot **(57,3)** maps to the existing mast at **(211,49)**. Hull C has one mast, so this pack supplies one low, partially reefed square sail with two billow states. The lower edge stays above hull y=73, preserving the open deck. It introduces a yard attached beneath the existing crow's nest, without extending the mast.

For a simpler placement path, `hull-c-frame-0.png` and `hull-c-frame-1.png` are equivalent full **426 x 161** overlays: draw at **(0,0)** with no resizing. Use either the strip or these overlays, not both.

Draw hull background, sail, then the depth-sorted crew and foreground pieces. While the sail is visible, replace the existing mast depth texture with **`../sails/mast-occluder.png`**, a **19 x 64** frame at **(202,48)** with baseline **110**. It retains the original mast pixels below hull y=73, while its upper rows are transparent. This prevents the original mast depth pass from painting through the sail. The underlying hull still provides the mast behind the cloth. Restore the original mast piece when hiding the sail. All other pieces retain their existing order.

Suggested animation: alternate frames 0 and 1 every **850 ms**; freeze frame 0 under reduced motion. The yard, central lashing and lower corner ties are pixel-identical in both frames. Inherit whole-ship bob, but not the separate masthead sway. The two frames change 466 pixels, mostly cloth shading, so the effect is a subtle puff/shimmer rather than a full sailing simulation.

## Crew integration

Each `../crew-variants/*.png` is a **426 x 275** transparent texture using **exactly the existing `deck.json` crew frame rectangles and foot pivots**. Both `base` and `outfit` slots are populated with the named identity; these are compatibility lanes, not two additional costumes. All pixels outside those 18 rectangles are transparent. Keep drawing ship and props from the original atlas; select one variant texture per crewmate when creating crew frames. These are not full replacement hull atlases.

All nine current poses are included in each lane: `front-idle`, `front-walk-a`, `front-walk-b`, `side-idle`, `side-walk-a`, `side-walk-b`, `hauling`, `leaning`, `waiting`. Preserve the existing walk order and mirroring. No back or left-facing drawings are added. Frame names, frame sizes, source rectangles and feet metadata need no remapping.

The textures are one logical pixel per shipped deck pixel, with 32-pixel front poses and the existing 30/31-pixel state/profile slots. Boot alignment includes the lifted boot in the bottom eight rows to avoid shrinking walk silhouettes around a single planted foot. All 108 delivered frame slots have their boot baseline and this horizontal pivot checked against the manifest. Some narrow slots still require horizontal compression, particularly leaning poses.

## Quality verdicts

| Asset | Verdict | Remaining limitation |
| --- | --- | --- |
| Main sail, rest and billow | **usable** | Reads as a low reefed sail. Motion is chiefly cloth shading; not a full unfurled rig or physically authored billow cycle. |
| Mast occluder | **usable** | Mechanical extraction from the shipped mast, only for use while this sail is enabled. |
| `01-bosun` | **usable-with-cleanup** | Broad body, bare head, deep brown skin and navy waistcoat read distinctly. Face has low contrast at native size; leaning pose narrows. |
| `02-old-salt` | **usable-with-cleanup** | Navy cap, cream-grey beard and ochre shirt read clearly. Beard/face clusters and leaning silhouette could use artist polish. |
| `03-navigator` | **usable-with-cleanup** | Cream headscarf, black braid, navy top and brown trousers distinguish this slim look. Braid details simplify in the 11-pixel profile slot. |
| `04-carpenter` | **usable-with-cleanup** | Brimmed hat, copper beard, suspenders and stout front view remain recognizable. The fixed narrow profiles cannot preserve the full stout build. |
| `05-rigger` | **usable-with-cleanup** | Dark curly puff, deeper skin, cream sleeveless top and ochre trousers separate this look. Hair and arms compress in leaning/profile slots. |
| `06-deckhand` | **usable-with-cleanup** | Copper hair, clean-shaven face and cream trousers give a strong contrast. Face and hand clusters remain rough in walk poses. |

The crew are usable at the shipped art's level, with visibly different identities. They remain separate generated drawings, not artist-authored animation cycles. A human pixel artist is wanted for final motion and face polish, but no whole asset is classified `human-artist-wanted`/unusable. No costume reassignment or animation wiring is included here.

## Provenance and cleanup

Six crew sheets were generated as edits of the original `01-crew-base.png`, whose SHA-256 is already recorded in `deck.json`. The sail was generated using a direct crop of the shipped hull as its style reference; frame B was generated as an edit of frame A. No existing sailor was merely palette-swapped to make this set. No third-party art was introduced.

Generated source PNGs are retained on the generation host under `C:/Users/micha/ship-deck-imagen-results/asset-work-2/source/`; their names, dimensions, hashes and crop rectangles are recorded in the manifest. The unmodified tool copies also remain in the generator's output directory. Raw high-resolution sources are not shipped in this branch. The exact prompts are included; regeneration is not guaranteed to reproduce the same pixels.

Mechanical processing used C# `System.Drawing`: alpha >=128 bounds; block sampling with median opaque RGB; majority alpha threshold; nearest squared-RGB distance to the **48 opaque colours extracted from `deck.png`**, without dithering. No new palette colours were introduced. Crew were fitted to the existing rectangles and pivots; sail crop bounds were normalized to 114 x 27. Frame B's yard and corner regions were copied from generated frame A to hold rigging still. Final PNGs have only alpha 0/255. This processing is cleanup of generated artwork, not substitute procedural drawing.

## Evidence

- [Crew contact sheet](crew-contact.png): all nine base-lane poses for all six looks, enlarged 4x.
- [Sail fitting comparison](sail-fit.png): both states on hull C, with all six crew, plus enlarged sail frames.
- [Native composite 0](hull-c-composite-0.png) and [native composite 1](hull-c-composite-1.png): 426 x 161 review images; not runtime overlays.
- [Verification report](verification.json): independent reload of final PNGs; palette, binary alpha, all 108 crew frame rectangles/pivots, no frame bleed, pairwise texture differences, sail attachment and fixed rigging, exact full-canvas overlays, lower mast extraction, source hashes and generation count.

Review images may contain checkerboard/text colours outside the game palette. Only runtime textures in `sails/` and `crew-variants/` are subject to the exact palette contract. Validation covers asset files and static compositing; the plugin was not installed, reloaded, wired or run.
