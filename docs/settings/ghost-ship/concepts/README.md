# Ghost ship — concept selection

Stage 1, 2026-10-16. One coherent direction: weathered charcoal timber, jade seam-light, shredded mint sails,
silver mist by day and violet-blue haunted water by night. Friendly ghosts, skeletons and lantern-eyed pirates;
evergreen spooky, without seasonal decorations. The bow faces left and the raised stern faces right.

The approved source is `C:/Users/micha/.paseo/plugin-data/firstmate/home/data/deck-ghost-ship/spec.md`, read in full
including the settled decisions in section 10. Review base: `b1458b4f99a00a366ba008e8bdccab7b4aca7ac1`.
Work is isolated on `fm/deck-ghost-ship`, fetched and rebased onto `origin/main` before generation.

| Study | Image | Prompt brief |
| --- | --- | --- |
| Midday | [01-midday.png](01-midday.png) | Level broadside; pale sun, mist, four stations, eight varied crew, green hatch, translucent sails, sea depth. |
| Night showpiece | [02-night.png](02-night.png) | Same ship; moon and crossing wisps, full star field, jade glow, thicker fog, translucent crew, haunted lighthouse. |
| Peak storm | [03-storm-peak.png](03-storm-peak.png) | Same ship; pane-wide rain, green lightning, rough water, breaching ghost whale left, distant spectral ship right, kraken under plank. |
| Departure | [04-plank-kraken.png](04-plank-kraken.png) | Four key moments: horizontal plank walk, drop, large skeletal kraken capture, fully submerged final ripple. |
| Suggestion creature | [05-anglerfish.png](05-anglerfish.png) | Ghostly anglerfish with actual mid-body water split, underwater lower half, luminous lure and three square ellipsis dots. |
| Voyage panorama | [06-haunted-islands.png](06-haunted-islands.png) | Graveyard isle, skull rock, ruined chapel, broken-mast ship graveyard, ghost-lit lighthouse; continuous misty coast. |

These are image-generated concept studies, not engine renders or production sprite sheets. No alternative direction
was added: day, night and storm intentionally preserve the same ship. The departure and fish detail sheets develop
its signature moments. The panorama supplies the landmark sequence and lighting direction.

Generation used the **built-in `image_gen.imagegen` tool**. No API/CLI fallback or web documentation was used.
The installed Sakura coast and Sky pirates previews and Ship's canvas were inspected for style; all three installed
manifests, the authoring guide and the executable schema were inspected for capabilities. Each final PNG was copied
unchanged from the tool's generated-image folder. [inventory.json](inventory.json) records dimensions, bytes and
SHA-256; [prompts.json](prompts.json) contains every exact generation/edit prompt, including superseded first drafts.

The reference chain was midday → refined midday → night → storm → departure. The night image separately supplied
the anglerfish and panorama references. Departure's final edit removed the exposed kraken from the final rest frame;
anglerfish's final edit replaced cross-shaped marks with square dots. Only final selected outputs are retained here.

## Production constraints carried forward

The sketches establish art quality and mood. They do not waive any of the twenty hard gates. In particular:

- The mast ladder is vertical in the refined design, but the sketch still shows a climber in front of cloth.
  Production must put ladder and route behind the sail, using a torn-cloth opening to keep the climber visible.
- Four large illustrated sleeping bays are representative. Production needs twenty-four individually reachable,
  nonoverlapping sleeping targets; reserve the below-deck area before painting final portholes.
- Commission eight registered cast atlases with distinct silhouettes, rather than treating every painted figure
  as a separate usable sprite or relying on coat recolours alone.
- The storyboard shows capture and submergence; production must add explicit mouth-over-actor swallow keys,
  and time the complete eater moment to 1.5–2.5 seconds. Its last panel is the required empty-water rest.
- The panorama is a loop composition study. The production strip must have measured matching edge pixels and
  phase-registered coast/beam art; the generated image is not certified as a seamless texture.
- Keep sky/stars, fog, sea and coast as separate layers. Do not import a flattened screenshot as the pack.
- The high-resolution concepts total about 18.4 MB and remain under `docs/`. The installed PNG inventory must
  fit **1,000,000 bytes including `preview.png`**; final logical-pixel art and compact indexed atlases are separate work.

[FEASIBILITY.md](FEASIBILITY.md) maps the spec and all twenty acceptance gates. One literal requirement is unsupported
on the reviewed engine: **crew becoming more transparent at night**. Source-image alpha can make ghosts transparent
all day, but no cast day-phase alpha/sprite selector exists. The already-assigned weather-fill engine work is also a
dependency for the all-pane weather guarantee. Neither gap is silently relaxed or implemented in this concept commit.

Stage 2 awaits the first mate's look selection and disposition of the engine dependency. No pack, engine code,
other setting, installation, or PR is changed by Stage 1.
