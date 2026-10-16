# Sky pirates motion audit

Full-motion comparison with the installed Ship's deck. The GIFs are sequences
captured from the real compiled renderer with a controlled clock, resized with
nearest-neighbour sampling. No Pixi internals or texture metadata are inspected.

| Element | Ship's deck | Sky pirates |
| --- | --- | --- |
| Hull | Whole-ship vertical bob on swell clock | Whole-ship bob, 5.6-second base period, 2 pixels calm to 4 at peak; level broadside retained |
| Sideways hull motion | No whole-hull sideways transform | **whole-hull sideways rock: not supported by the engine (same as Ship's deck)** |
| Balloon / sail cloth | Two-frame sail billow | Four generated-pixel balloon frames breathe and sway; both side sails billow with a two-pixel belly displacement |
| Rigging / masthead | Upper mast sway; lower rig and ladder fixed to hull | Four rig frames with one-pixel lateral displacement; pennant sway; central access ladder remains fixed relative to hull |
| Flag | Part motion above the deck | Four flutter frames, 180 ms base timing, plus independent lookout-pennant sway |
| Propulsion / wake | Cycling wake and scrolling water | Four propeller poses at 90 ms; four vapour frames and four chimney-smoke frames on engine/wind clocks |
| Lanterns | Light flicker | Four deck lanterns plus a flickering engine firebox using the original light style |
| Working crew | Working fidgets and walk cycles | Two crank poses, walking frames, two clothing palettes and white sailor caps |
| Waiting / blocked crew | State fidgets and at-ease breath | Waiting/stand and side/lookout fidgets; waiting breath; bow and stern posts |
| Resting crew | Static sleeping-window body, animated Zs | Static hammock-window body, animated engine Zs; 24 disjoint selectable windows |
| Raised station | Post-transit crow's-nest climb | Two climb poses up the rope ladder to the balloon lookout; settled lookout pose |
| Arrival | Hatch rise | 1.4-second rise through the deck hatch |
| Departure | Plank, splash, shark swallow | Plank, fall, four cloud-puff frames and four sky-whale breach/swallow/sink poses |
| Attention carrier | Four swim frames, loiter, half-submerged surface ripple | Four small whale poses, two-pixel horizontal/one-pixel vertical loiter, mist arcs at the tinted cloud line |
| Sea / foam | Cycling and drifting tiles/strips | Three wide volumetric banks: far/mid/near drift at 0.65/1.8/3.8 px/s on the wind clock; independent mist at 3 px/s on cloud pace. All three banks and mist crossfade to registered storm art together |
| Clouds | Seeded, independently drifting cloud field | Six varied shapes: small puff, broken bank, tall tower, feather, curl and anvil. Separate high-wisp and sea-tower fields; dawn pink, dusk gold and moonlit blue phase palettes; storm palette variants |
| Birds / passing ship | Seeded flybys | Flapping gulls and a distant airship flyby, disabled at night |
| Day cycle | Backdrop phase crossfade and tint | Pink-gold dawn, blue day, amber dusk and night with stars/moon; phase tint and lantern light |
| Busy fleet | Faster environmental clocks | Faster clouds, cloth, smoke, propeller and increasing heave as work builds |
| Storm | Rain, lightning and peak creature | Dark cloud variants, thunderhead, four rain frames, bounded lightning, four sky-serpent poses at peak |
| Islands / distant mountains | Fixed backdrop scenery | **Static** island and mountain art; no waterfalls are present, so no waterfall animation is claimed |
| Stars / moon | Backdrop features | **Static** within night backdrop; the day-cycle transition changes their visibility |

The balloon, rig and sail sway is encoded in finite PNG frames, driven by the
existing part-cycle catalogue; the pennant also uses the catalogue's sway directly.
This uses the approved Ship's deck motion model without adding engine behavior.
The fixed hull detail, wheel, figurehead and rails move with the hull, but have no
independent articulation. The thunderhead's one-frame shape is static while its
intensity opacity changes; drifting dark clouds and rain supply storm movement.
The new sea-bank textures are **static within each bank**: their independent
horizontal drift provides parallax, rather than cyclically deforming the billows.
Their storm variants use the same day silhouette so no pale base slivers remain
at peak weather. The far bank continues beyond the camera's bottom; there is no
vertical tiling or bottom row of leftover white puffs. Bank periods are 1920,
1664 and 1408 pixels, longer than the stage and offset by different speeds.
See the [cloud revision](cloud-review.md) for source registration and preservation.

## Evidence and limits

[Scene alive](review/scene-alive.gif), [departure](review/whale-departure.gif),
[small whale](review/suggestion-whale.gif), [hatch/lookout](review/hatch-and-lookout.gif)
and [storm](review/storm-alive.gif) show the running scene. The departure
[contact sheet](review/departure-contact.png) makes the finite sequence reviewable.
[Pixel hashes](motion-full.json) record 40 samples over eight seconds in 14 regions.
Those regional hashes establish visible change, but do not by themselves isolate
each overlapping layer; the frame art, authored timings and visual sequence are
reviewed together. This avoids mistaking hull bob alone for cloth animation.
[Frame audit](frame-audit.json) also records the distinct frame counts and changed
pixel counts for every authored cycle. Balloon breathing uses inverse nearest
sampling to avoid holes, and rain retains the generated translucent stroke cores
before native-scale registration rather than losing them to the opaque-art cutoff.

Reduced motion freezes at the resting frame with stable pixel output; wall-clock
phase changes still update. Lite keeps authored part cycles, bob and crew motion,
freezes rain/serpent and the attention carrier, and hides lightning and flybys.
Hidden panes retain the existing engine pause behavior. No new motion loop exists.

All fixture verification is local browser evidence, not a physical-device test.
