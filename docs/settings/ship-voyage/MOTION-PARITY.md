# Element-by-element motion and parity

Compared with the byte-frozen original Ship. All animations use existing versioned capabilities;
the only new capability dependency is the already-landed `phase-strip@1`. This is an art/data audit,
with runtime screenshots and clips linked from the [evidence index](README.md).

| Element | Original | Voyage / motion / parity |
| --- | --- | --- |
| Stage | 426×161 hull with one sail | 640×400 registered broadside, bow left, larger hull and two masts; whole-stage swell bob and `stage-rock@1` about [325,300]. World horizon remains level. |
| Main sail | Clocked sway | Four subtle sail frames on `sail`; fore sail and jib also have four frames. Yard/rigging anchors retained in the static stage. |
| Flag | Sparse rig | Four Jolly Roger frames, 180 ms on `sail`; billows at the top of the mainmast. |
| Cannons, chest, rope, barrels | Sparse deck dressing | Generated deck furniture belongs to the rocked stage. Chest, barrels and mast have floor obstacles; no unnecessary independent motion. |
| Lanterns | Pixel glyphs, flicker and glow | Five lanterns retain the original light style/flicker, all row 230, behind deck crew. They rock with the ship. |
| Crew | Eight bandana looks; walking, state poses, fidgets, breath | All eight original cast definitions and sheets retained. Working rigging, waiting helm, blocked bow, idle hold preserve state meaning. 24 resting and working crew tested. |
| Crow's nest | Post transit with climb poses | Same capability, 190-pixel climb at 28 px/s. Ladder part is before sail parts; the original climb poses follow that access route to the nest. Nest rim sorts in front of the lookout. |
| Hatch | Rise entry | Same 1,100 ms rise, registered at [245,291] on the new hatch. |
| Plank | Queued finite departure, splash, shark | Horizontal 100×10 plank projects left from the bow over water. Rail [97,291], tip [25,291], splash [32,380]. Original impact/chomp events, frame timings, queue release and effect art retained. Shark approaches from the right to keep the whole sequence within fit. |
| Idle hold | Porthole appearance | 24 individually reachable 16-pixel-spaced windows; original porthole sprite and crew marker semantics. Exact-key click checks both still and rocking. |
| Suggestion shark | Four frames and loiter | Same four frames and target. Real `carrier-surface@1` split at row 36: submerged rows tinted and 35% opaque, animated foreground/background ripple. Independent world-water placement; click/keyboard route preserved. |
| Sky | Six local-time backdrop phases | Dawn, morning, midday, afternoon, dusk, night retained with brighter daytime palette transfer. Horizon placement scales to fill all space above the sea. |
| Ship tint | Day-phase tint | Six registered tints, including cooler night sails and warm dusk. Applies to stage and crew. |
| Stars | Night overlay | Original stars, hidden by overcast; new moon overlay uses the same night blend. |
| Clouds | Seeded palette drifters and storm variants | Original five cloud shapes, phase palettes, lane drift, wrap and storm transition retained. |
| Sea | Animated tile, storm variants and fallback | Original seamless tile shared between back/front bands, origin 205 and foreground 346; fills visible bottom at any height. Native hull bottom reaches 350, so water overlaps it. |
| Foam, wake, spray | Three-frame foam/wake and storm spray | Re-registered across hull 110…590 and stern waterline; original drift, swell clocks and variants retained. Wake remains on trailing right side. |
| Coastline | Empty horizon | Six 2048×112 phase plates; constant `voyage` clock, +1.7 px/s. Transparent gaps and exact common silhouette. Cove, fort, port and lighthouse pass every ~five minutes. |
| Port windows / lighthouse lamp | Absent | Emissive pixels appear only in night coastline plate; gradual night-phase crossfade, never activity-controlled. |
| Lighthouse beam | Absent | Four registered sweep frames at 700 ms on `life`, same `voyage` drift as coast. All non-night frames fully transparent. |
| Passing merchant | Absent | Four bob frames in a 1536-pixel empty lane, +2 px/s on `voyage`; crosses the horizon about every 12.8 minutes. Crossfades away between activity .35 and .7. |
| Navy chase | Absent | Four bob frames at 600 ms on `life`; frigate follows behind the stern, appearing between .8 and peak activity. White sails and navy cross flag distinguish it from the pirate ship. |
| Dolphins | Absent | Four generated leap/dive poses at 260 ms on `life`, then a quiet tail/splash interval; anchored in foreground water. |
| Whale | Absent | Distant back at horizon waterline, a quiet interval followed by three 550 ms spout frames on `life`. |
| Flying fish | Absent | Seeded 19-second flyby slots, 70% chance, one at most; 55 px/s, 8-pixel arc/wobble, dusk/night cutoff. |
| Flying gull | Seeded flyby | Original glide/flap art and seeded behavior, expanded sky lanes. |
| Yard gull | Absent | Perched below the main yard, four-step quiet/wing cycle, 900 ms on `life`. |
| Cat | Absent | Seated/stretch generated poses, six-step cycle, 700 ms on `life`; rides the deck. |
| Overcast | Activity-driven overlay | Original opacity/tint curve retained, independent of day-phase voyage. |
| Lightning | Seeded bounded flashes | Original flash behavior retained; observed at peak activity in the real canvas. |
| Rain | Absent | Four tiled rain frames on `water-drift`, fades in .65…1; screen-filling foreground layer. |
| Serpent | Loom/surface variant | Original four-frame variants and swell timing retained, registered in bow water. |
| Kraken | Loom/surface variant | Original four-frame variants and swell timing retained, registered in stern water. |

Full mode animates the ship, voyage and life. Lite keeps crew, low-cost stage parts and the new
life cycles; inherited heavy sea/cloud layers use their original lite policy, rain freezes,
flyers hide, and the engine freezes the carrier's loiter/ripple. Still mode stops the frame loop,
keeps state posts and all interaction targets, takes calm/first frames and hides storm effects.
The coast's phase blend still responds to local time; motion does not depend on changing fleets.
No ambient life can change a card, send a message, or alter intensity semantics.
