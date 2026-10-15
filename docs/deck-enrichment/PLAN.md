# Deck enrichment

Four incremental reviewed PRs, rebased on `origin/main`, never merged by this worker:

1. Weather atmosphere: generated sea creatures and more legible distant lightning, using the existing generic intensity-driven catalogue.
2. Idle crew: a pack-authored below-deck rest zone with persistent clickable targets.
3. Reply shark: a pack-authored attention carrier with a speech bubble opening Converse for its worker.
4. Ship polish: generated foam, gull, sea and expressive crew art; phase tint and climbing.

Each slice records its intentional visual changes, exact screenshot expectations, art provenance and review. Sources stay under `docs/ship-deck-art/enrichment/`; only registered, hashed runtime PNGs go under `art/settings/ship/`. Run typecheck, the full suite, pack lint, Paseo/Hermes compilation (no class) and the 81-shot gate; wait for green CI before reporting a PR complete.

Starting main: scene migration and global selector already landed. Weather uses existing `cycle@1`, `variants@1` and `flash@1`; no new DSL or setting-specific runtime branch is needed. Reduced motion remains calm. New capabilities, if needed for subsequent slices, are generic and versioned.
