# The ship's pack: how it was made

`art/settings/ship/` is the ship as a deck setting: `setting.json` and the 60 images it names. Nothing else in
that folder is shipped or allowed (`test/deck-settings.test.ts`).

- **The art** is the generated art of the ship deck's PRs, made and cleaned up as `docs/ship-deck-art/README.md`
  and the READMEs beside it say; their sources, prompts, provenance and reviews are there.
- **The manifest** was written once, at step 2 of the deck-settings migration, by `from-legacy.mjs` here: from the
  three manifests the deck was served before packs (`docs/ship-deck-art/legacy/`) and the constants in the deck's
  code at the time. Every number came from where the deck had it. From then on `setting.json` is the source:
  tune the ship by editing it, and run the pack linter and the gate (`docs/deck-settings/README.md`).
