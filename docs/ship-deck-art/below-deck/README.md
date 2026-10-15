# Below-deck porthole

An original `image_gen__imagegen` source, generated on 2026-10-15. The tool does not identify its backend
model. [prompt.json](prompt.json) preserves the exact prompt; [source/porthole.png](source/porthole.png)
stays outside the shipped package. No external art was used.

The runtime sprite is 16×16, feet `[8,16]`, with a two-pixel transparent border and binary alpha. It uses
eleven colours from the ship's approved palette. [build.mjs](build.mjs) registers the generated image,
block-median samples it and maps its colours to that palette; it draws no new shapes. The source hash,
crop, scale and finished hash are in [provenance.json](provenance.json). [contact.png](contact.png) is a
nearest-neighbour enlargement of the finished asset. The face is a deliberately tiny portrait; worker
identity comes from the unchanged hover label and focus panel.

The same builder writes ship pack 1.2.0's rest layout: eight preferred posts, explicit packing space for
24 handles at normal spacing, closer overflow beyond that, and a gap around the plank. The non-spill
corridor and room prevent ordinary working-deck overflow from entering the hull. Geometry and behavior
are manifest data; the generated PNG lives at `art/settings/ship/below-deck/porthole.png`.

Rebuild with `node docs/ship-deck-art/below-deck/build.mjs` after installing `pngjs@7.0.0` in the unshipped
`docs/board-list` harness (`--no-save --package-lock=false`). This builder only targets pack 1.2.0.
AI-generated assets use the repository's MIT license; no human authorship is claimed.
