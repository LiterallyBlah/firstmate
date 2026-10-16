# Ship's voyage — concept decision

Stage 1 only, 2026-10-16. Six built-in ImageGen concepts of one remastered original
ship: honey wood, navy bands, bow left, raised stern right, central crow's nest,
second mast and jib, Jolly Roger, cannons, chest, rope, lanterns and a ship's cat.
No alternative design, pack, engine change, levelling system or plugin reload is included.

| Image | What to judge |
| --- | --- |
| [01 — Treasure cove by day](01-treasure-cove-day.png) | Master ship identity, palms, skull rock, fuller rig and open crew paths. |
| [02 — Port town at dusk](02-port-town-dusk.png) | The same ship passing the waterfront and ruined fort; warm windows and reflections. |
| [03 — Open-sea life](03-open-sea-life.png) | Dolphins, flying fish, distant whale spout and merchant, with breathing room. |
| [04 — Lighthouse at night](04-lighthouse-night.png) | Silver-blue sails, amber deck lamps, distant beacon and water contact. |
| [05 — Storm and pursuit](05-storm-navy-chase.png) | Navy frigate behind the stern, kraken, serpent, rough sea and readable deck. |
| [06 — Continuous route panorama](06-voyage-panorama-loop.png) | Cove → reefs → fort → port → lighthouse → open water → cove; one coherent daytime coastline. |

Exact prompts and reference-image roles are in [prompts.json](prompts.json), one entry
per image. Image 01 uses the existing Ship render plus Sakura/Sky preview references;
02–06 use image 01. Generated outputs are retained unchanged. These are art-direction
sketches, not registered sprites, pixel-perfect loop textures, or runtime screenshots.
Dimensions, SHA-256 hashes, PNG integrity checks and measured installed-pack sizes
are recorded in [review.json](review.json). All local documentation links were checked.
The prompt's phrase “approved ship identity master” was a generation consistency cue;
it does **not** record captain approval. The captain's pick remains pending.

**Voyage verdict:** the slow looping route is possible now with `strip@1`, one compact
2048×96 coastline repeat and a constant atmosphere clock at 1.7 pixels/second:
about five minutes between landmark centers and twenty minutes per lap. Sea tiles,
cloud drifters, animated ship parts and occasional life provide faster motion around it.
An image-budget allocation of 940,000 bytes is plausible but unproven until production
assets are made and measured; these high-resolution concepts are outside that budget.

**One fidelity gap:** existing strips have no day-phase frames/tint or night alpha.
A full-color moving coastline whose lighthouse lights only at night needs a small,
generic, versioned phase-aware strip capability, separately reviewed before the pack.
The data-only compromise is a neutral coastline with an always-lit beacon. Day/night
sky and ship tint already work. No route controller or general scripting is needed.
The [feasibility note](../FEASIBILITY.md) records the contract, all three packs' slot
maps, motion choices, exact limitations and budget.

**Regression recommendation:** preserve today's Ship manifest and PNGs byte-for-byte
as a test-only fixture outside `art/`, hidden by being outside discovery. Feed that
same fixture to both engines in the 81-shot gate. Keep the remaster's own visual checks
separate; do not replace all 81 expected hashes with remastered screenshots.

Production must refine the sketches: reserve rocking clearance above the flag, give
the shark the engine's actual submerged split (its belly is too exposed here), register ladders behind sails and lights
behind every crew route, and verify all four state zones, hatch, lookout climb and
plank/shark departure at crowd scale. The panorama needs a deliberately matched seam;
its left-to-right reading order is illustrative, not the engine texture's travel order.

Decision pending: accept this ship/art direction and either the phase-aware coastline
scope or the documented data-only compromise. Stage 1 stops here.
