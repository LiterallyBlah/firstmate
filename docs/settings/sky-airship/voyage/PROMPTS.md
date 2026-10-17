# Generated-art provenance

Built-in `image_gen` was used (not the CLI fallback). All project sources are copied into `sources/`. The final registered assets are under `art/settings/sky-airship/`; the build keeps source art out of the shipped pack.

## Island atlas — `sources/islands.png`

Prompt:

> Create ONE production sprite atlas for a charming 16-bit pixel-art sky pirate game, true transparent RGBA background, wide 1536x1024 canvas. Six separate floating-island sprites in a strict 3 column by 2 row grid, generously separated with entirely transparent gutters; each object fully contained in its own cell. No labels, no text, no border, no sky background, no scene-wide ground or cloud line. Side-on distant broadside silhouettes, matching classic detailed painterly pixel art, crisp stepped edges and limited palette, mossy green land, ochre and lavender floating rocks with tapered jagged undersides, ivory stone buildings and copper roofs, small white cloud wisps attached to individual islands. DAYTIME with every window dark, lamps unlit. Top left: a magnificent sky city with many elegant towers and little bridges on a wide floating rock. Top centre: a lush floating island with multiple luminous blue waterfalls pouring off its sides into thin disappearing mist, streams and a little stone bridge. Top right: a tall cloud lighthouse beacon tower on a compact floating rock, dark glass lantern room. Bottom left: a sky-dock, wooden projecting piers with TWO small moored dirigible airships visibly attached to the dock by short mooring ropes; all fully within cell. Bottom centre: ancient broken arches and overgrown column ruins on a floating rock. Bottom right: a small simple distant cluster of empty rocky islets, no buildings. Art must stay legible when each sprite is scaled to around 90-160 pixels wide. Make the five landmarks unmistakably distinct. Restrained sharp pixel-art colour clusters, not 3D, not vector, no blurry edges. All sky, gaps between towers, windows of broken arches and space around waterfalls must be transparent.

Generated 1536 x 1024 RGBA. The actual six sprite bounds are explicitly registered in `build.mjs` rather than assuming uniform cell widths. The existing offline palette workflow removes low-alpha glow and registers crisp pixel silhouettes. Night window pixels are authored at registered source coordinates; waterfalls use a separate synchronized glint plate.

## Clear sky — `sources/sky-day.png`

Edit target: #101's `art/settings/sky-airship/sky-day.png`.

> Edit this pixel-art sky panorama. REMOVE BOTH floating islands and all their tiny satellite rocks completely, replacing their areas with the same clear blue sky. Preserve the cloud ocean in the lower half, its horizon, the blue sky colours and broad composition. Produce a clean empty sky over a richly layered cloud ocean, suitable as a static backdrop behind independently scrolling islands. No islands, no buildings, no mountains, no ships, no creatures. Smooth sky with subtle pixel dithering rather than hard horizontal colour bands. Keep the style and 3:2 aspect ratio.

## Night sky — `sources/sky-night.png`

Edit target: the generated clear daytime sky above.

> Create the NIGHT phase of this exact pixel-art sky/cloud-ocean backdrop. Keep the same cloud shapes, horizon and composition. Deep navy and muted lavender-blue sky, softly moonlit layered cloud ocean. Fine crisp stars distributed evenly across the WHOLE open sky, from left through centre to right, and a modest pale moon high in the sky. Smooth subtly dithered sky without hard horizontal bands. No islands, mountains, buildings, ships, creatures or glowing windows. This is a clean background behind separate moving scenery.

Both sky sources are registered at the existing 600 x 400 size with two-pixel art sampling and 64 colours. Dawn and dusk are deterministic palette transfers of the same daytime geometry, following the pack's established authoring method. Sky coverage remains the engine's backdrop placement; scrolling scenery uses fixed world coordinates instead.
