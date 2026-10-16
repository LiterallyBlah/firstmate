# Sakura coast animation audit

The approved broadside revision `815bcca3` had a **static sail**. Whole-canvas motion
was insufficient evidence: the hull and water could move while the cloth stayed frozen.
This revision adds the missing motion entirely through the existing pack catalogue.

![Sail billow and masthead sway, real day render](review/sail-motion.gif)

[Eight-second whole-scene preview](review/day-motion.gif) ·
[Resting sail frame](review/sail-frame-0.png) · [Billowed sail frame](review/sail-frame-1.png)

## Element-by-element comparison

This table describes **full motion**. “Before” means the approved Sakura pack at
`815bcca3`; the original Ship is `art/settings/ship/setting.json` on main `e5c7f75`.

| Element | Original Ship | Sakura before | Sakura now |
| --- | --- | --- | --- |
| Sail billow/sway | Animated: two cloth frames, 850 ms base timing, activity-scaled sail clock and billow duty. Rides hull bob; no separate sail sway transform. | **Static cloth**, baked into ship.png; only rides hull bob. | **Animated**: approved cloth plus generated billow frame, with a two-pixel belly sway encoded in the second frame. Same 850 ms timing, sail clock and billow duty. Spar attachment rows stay fixed. |
| Mast/rigging | Animated topmast/masthead: whole-pixel horizontal sway, 6.2-second swell clock, ±1 pixel. Main mast, ladder and lower taut rigging are fixed relative to hull. | **Static** relative to hull. | **Animated** topmast and upper triangular rigging with the same sway parameters. Main mast, ladder and lower taut ropes remain fixed, as on the original Ship. |
| Clouds | Animated seeded cloud drift, seven lanes, day-phase colours. | **Static**, baked into day/night backdrops. | **Animated** original cloud shapes, three lanes to retain the approved scene's cloud density, wind-scaled drift and day/night colours. Separate coast foreground keeps clouds behind the island. |
| Hull bob | Animated swell-clock heave. | **Animated** already, 7.4-second bob. | **Animated**, unchanged. Horizontal broadside hull and all anchors unchanged. |
| Water/wake | Animated scrolling/cycling water and three-frame wake. | Water **animated** by tile drift; wake foam **static** one-frame sprite (opacity changes with fleet intensity). | Water drift retained; wake **animated** with three registered foam frames, 240 ms base timing. Attachment position unchanged. |
| Crew at ease / idle | Animated working, waiting and blocked fidgets. Settled sleeping-window bodies are static; the zone appearance suppresses ordinary body breath/fidgets. | Working **animated**; waiting/blocked **static**. Settled sleeping-window bodies static. | Working retained; waiting/blocked now **animated** using existing stand/wait/side poses and the original Ship's fidget periods. Sleeping-window bodies remain static, with animated Zs. |
| Shark swim/reply | Animated four-frame tail/swim cycle and loiter; reply target focuses in place. | Loiter **animated**; body/tail **static** single frame. Reply/focus already works. | **Animated** four-frame tail cycle plus existing loiter. Head, bubble, target bounds and focus-in-place behavior unchanged. |
| Below-deck sleeper Zs | **Animated**, engine-owned rise/fade. | **Animated** already. | **Animated**, unchanged. |
| Day/night | **Animated** wall-clock palette/backdrop crossfades across six authored phases. | **Animated** day/night crossfade already, two approved backdrops with 90-minute transitions. | **Animated**, unchanged two-backdrop cycle and phase tint. No invented dawn/dusk art. |

Reduced motion freezes motion at the authored resting frame, while wall-clock day/night
still updates. Software WebGL keeps sail billow, mast sway, hull bob, crew and sleeper
Zs; it freezes clouds, water, wake and shark motion, matching the original engine policy.
Hidden panes stop the shared frame loop. No timers, shaders, engine changes or pack code.

## Art and preservation

`ship.png` is byte-identical to the approved broadside. Its upper rig is separated into
fixed rig, moving masthead and two cloth frames. `build-motion.mjs` reconstructs frame
zero and asserts it is pixel-identical to the approved rig crop. Only the cloth's
alternate frame uses the generated billow; it is mapped to the locked 48-colour palette.
The mast's depth piece and vertical ladder remain below/behind the cloth.

The original generated clouds are detached into three-colour sprites. The clear-sky
imagegen edits contribute pixels only under the original cloud footprints, colour-matched
to the surrounding approved sky. Island, mountains and sea are retained; matching
transparent day/night foregrounds keep clouds behind the coast. Wake and shark motion
are offline whole-pixel registrations of their original generated pixels, with exact
original first frames, colours and anchors. No extra text, flags or decorative art.

The [prompts](motion-prompts.json), original tool outputs in `sources/`,
[registration hashes](registration.json) and [art audit](motion-art-audit.json) record
the derivation. The original [broadside audit](broadside-audit.json) is historical evidence
for the angle revision, not a claim that the newly separated sky images have the old hashes.
The pack now has 20 PNGs and 19 existing catalogue capabilities; all sources, scripts,
audit files and GIFs stay outside the shipped plugin.

## Verification

`check-motion.mjs` runs against the real compiled client, served pack and Pixi renderer.
A documentation-only observer records live sprite texture rectangles/positions; it does
not replace the renderer, animate sprites itself, or change the plugin bundle. Across
32 fake-clock samples, 250 ms apart, it verifies:

- Two different live sail textures **and** two different rendered cloth hashes after
  compensating for hull bob. A static sail with a bobbing ship fails this check.
- Independent mast sway, hull bob, cloud drift, wake frames, all three on-deck crew
  fidgets, shark tail/loiter and sleeper Z rise/fade.
- Stable reduced-motion screenshots and sprite state; the correct software-renderer
  freeze policy. [Full evidence](motion-full.json), [lite evidence](motion-lite.json).

The GIFs are real renderer captures, not an artist's mockup. The whole scene is resized
to 800 pixels wide and the sail crop to 460 × 354 using nearest-neighbour sampling;
both run eight seconds at four captured frames per second. GIF quantization affects
only review previews, never shipped art. The two PNG sail frames retain capture quality.

Full suite, typecheck, pack lint, Paseo compiler/Hermes and the 81-shot original-Ship
gate are rerun for this revision. The gate still expects zero pixel differences against
main: **no original-Ship baselines need regeneration**. Sakura's day/night, interaction,
motion and narrow-footer review captures are refreshed. #79, the condensed footer,
shark focus and FirstMate tab chrome are untouched. No merge or install is performed.

## Reproduce motion review

After the ordinary art/pack build and compiler commands in README:

```powershell
npm.cmd install --prefix .generated/motion-tools --no-save --package-lock=false gifenc@1.0.3
$env:CHECK_JAPANESE_MOTION='1'
node docs/deck-settings/render.mjs '?setting=japanese-ship'
$env:CHECK_JAPANESE_LITE='1'
node docs/deck-settings/render.mjs '?setting=japanese-ship'
Remove-Item Env:CHECK_JAPANESE_LITE
Remove-Item Env:CHECK_JAPANESE_MOTION
```

`gifenc` is a local review-tool dependency under ignored `.generated/`, not a plugin dependency.
