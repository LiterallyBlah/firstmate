# Built-in imagegen prompts

All three outputs were generated with `transparent_background: true` and copied
unchanged into `sources/`. No model or seed parameter was exposed by the tool.
The registration script records their SHA-256 hashes.

## landmarks.png

Reference: PR #99's `coast-front.png`, style only.

Create a production pixel-art sprite atlas for a beautiful calm Japanese coastal voyage. The reference is STYLE ONLY: match its detailed restrained 16-bit pixel-art foliage, rocks, pink sakura, turquoise shoreline, hand-crafted high-quality pixels. Output a strict THREE COLUMN by TWO ROW grid of SIX separate complete coastal island sprites on a genuinely transparent background. No labels, no grid lines, no sky or ocean background, generous transparent padding between all six cells. Each island is seen level from the sea, not a bird's eye map; a consistent horizontal waterline with only a narrow fringe of foam and reflections at its foot. Each sprite must be fully inside its own cell, including shore and objects. Daylight, all lanterns and windows UNLIT. Top-left: cherry blossom isles with a large elegant vermilion torii gate standing on posts IN the shallow water beside the island, gate attached visually to the same shoreline composition. Top-middle: a graceful five-storey Japanese pagoda high on a green hill with cherry trees and a winding stone stair. Top-right: a Japanese fishing village, traditional timber houses with dark tiled roofs, clearly readable small rectangular windows and hanging paper lanterns, a jetty and two small wooden fishing boats MOORED to it at the same level waterline. Bottom-left: a distant blue snow-capped Mount Fuji-like peak above a low pine coast, atmospheric and less saturated than the nearer islands. Bottom-middle: a white Japanese cliff castle with layered dark tiled roofs on rugged sea cliffs, a few small windows, green pines and cherry trees. Bottom-right: a lush bamboo grove on a low rocky island with a tiny dark-roofed shrine and a stone lantern. Variety of silhouettes and heights; all are polished pixel art at the exact visual quality of the reference, readable when each is reduced to about 280 pixels wide. No characters, ships sailing in front, creatures, clouds, sunlight disks, glowing windows, text or water rectangles.

## landmarks-night.png

Reference: `landmarks.png`.

Make the NIGHT PALETTE AND LIGHTING VERSION of this exact pixel-art coastal landmark atlas. Preserve the exact 1536x1024 canvas, three-column two-row grid, ALL island silhouettes, exact pixel locations and shape of every building, boat, torii, tree, mountain, stair and shoreline; do not redraw, move, resize, add or remove anything. This is an animation phase asset and geometry must remain registered. Preserve transparent background and remove no transparency. Change only the colours to beautiful deep blue, muted teal and subdued purple moonlight. Add small warm amber illumination to the EXISTING fishing-village windows and paper lanterns, a few existing pagoda windows, existing castle windows and the bamboo shrine's existing stone lantern and doorway. The torii should remain vermilion-dark without an artificial glow. Snow remains a cool pale blue. Tiny restrained light reflections directly beneath the lit village windows and lanterns on its existing water fringe. All glow stays subtle, very local and pixel-art, no giant halos, no glowing trees or shores. No moon, stars, sky, background, labels or new objects. Preserve the original asset shapes exactly; only nighttime recolouring and lighting of existing windows and lanterns.

## snow-peak.png

Reference: `landmarks.png`.

Create ONE standalone complete sprite of the bottom-left snow-capped Japanese coastal peak from the reference, in exactly the same detailed restrained pixel-art style. A distant blue Mount Fuji-like mountain with a beautiful white snow cap, low pine-covered coastal hills with a few pink cherry trees in front, small rocky shore and only a thin narrow turquoise water fringe. Level view from the sea. The ENTIRE silhouette must be inside the image, with ample fully transparent space on all four sides, especially both ends of the shore. Both slopes descend naturally to low coast and end in complete small rocky points; no abrupt vertical cut, no cropped mountains, trees or shore. One isolated landscape sprite only, landscape 3:2 canvas, no other island, castle, buildings, sky, ocean background, fog halo, labels or border. Calm daylight with atmospheric pale blue distance. Preserve a genuinely transparent background.
