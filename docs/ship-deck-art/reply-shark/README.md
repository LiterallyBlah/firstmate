# Reply shark art

Original art generated with the built-in `image_gen__imagegen` tool in generate mode for this enrichment
pass. [Exact prompt](prompt.txt), [source](source/shark.png), [provenance](provenance.json) and
[4× contact sheet](contact.png) stay here, outside shipped `art/`.

`node docs/ship-deck-art/reply-shark/build.mjs` registers the four source cells, reduces them to **64×48**,
quantizes to the prompt's eight colours and binary alpha, and reuses the generated first bubble across
the four frames. It draws no shapes. Every frame has a two-pixel clear border. The quiet, closed-mouth
shark and three-dot bubble remain separate from the ship's departure shark.

Only four small PNGs ship in `art/settings/ship/reply/`, named by ship pack **1.3.0** with sizes and SHA-256
hashes. The carrier sits at `[4,122]`, with a `[2,1]` pixel loiter inside the existing fit; it never changes
the hull, portholes, working deck or plank. Frame time is 450 ms; the shared scene clock drives the cycle.
Lite and reduced motion hold frame zero, including the speech bubble.
