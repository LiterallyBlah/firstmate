# PR 88 departure and ladder revision

Generated with the built-in imagegen tool on 2026-10-16, with transparent-background enabled. Sources are saved in this directory's `sources/`; exact hashes are in `registration.json`. Only registered PNGs ship. The original sea-dragon image was supplied as a style/identity reference, not an edit target. No engine behavior changed.

## Sea dragon prompt

Generate a replacement animation sprite atlas, 4 columns by 2 rows of equal cells, transparent background, no labels or grid. Reference is style and creature identity only: Japanese sea dragon, teal/navy scales, ivory antler horns and whiskers, crisp enlarged pixel art with restrained 24-colour palette, designed for 92x128 logical-pixel cells. All EIGHT cells use exactly the same scale, fixed central body axis and waterline near the bottom edge. Face LEFT. Read left to right, top then bottom: 1 a very low emerging crest in ripple; 2 head and neck halfway rising; 3 dramatic full-height towering serpentine breach, long neck above foamy water; 4 tall neck curls down LEFT with opening jaws to lunge at the surface; 5 jaws wide open DOWN LEFT at water level to swallow a swimmer (no swimmer drawn); 6 jaws snapped shut at water level, curved neck still visible; 7 sinking crest, foam; 8 only a fading oval ripple, no dragon. In frame5 and6 the jaw must be in lower-left quarter of cell, just above waterline. Tallest frame fills cell height, low frames remain low with empty transparent space above. Bold readable silhouette and jagged pixel highlights matching reference. No wings, no gore, no text, no scenery, no shadows outside sprites. Clear space separates cells.

Registration corrects two generation deviations: the row gutter falls at y=620, and the first three cells face right. Crops use that actual gutter; a shared scale preserves emergence heights and the first three cells are flipped. Binary alpha cleanup removes transparent edge haze, as in the original art pipeline.

## Bow plank prompt

Single game sprite: a long narrow HORIZONTAL cedar gangplank, side-on with a slightly visible top surface. Aspect ratio about 8:1; left free end rounded a little, right end cut square where it mounts on a Japanese wooden ship. Rich warm cedar brown, dark navy pixel outline, subtle ochre wood grain, two small dark iron fasteners at right end. Crisp chunky low-resolution pixel art designed for an 80x10 pixel sprite. Board extends left to right across frame at exactly the same height, no diagonal or upright board, no supports, no ropes, no environment, no labels. Transparent background.

The board runs from x=0 to 80 at y=246. The rail and tip share y=248, so the side-walk is horizontal. The bow slopes inward at this row, leaving the free end visibly over open water. The dragon's complete effect bounds are x=0–92 and y=185–313, inside the 480×320 fit. The suggestion shark remains at its approved position and keeps its independent click target.

## Ladder depth

The eight mast-rung segments precede the sail in the existing ordered parts list. The sail covers their middle section; the ladder shows above its upper yard and below its lower yard. The original sail frames and rig images are unchanged. `post-transit@1` continues to draw the climber ahead of the named perch piece, preserving its visible body and click target throughout the climb.
