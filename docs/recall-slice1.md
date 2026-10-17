# Recall slice 1

Approved orchestration plan D5, section 3: a dependency-free Node BM25 catalog of existing home
records and dated backlog history. `templates/tools/recall.mjs` and the plugin-owned
`templates/data/recall.md` are registered templates and supplied by `prepareHome`. They ship under
the existing `templates/` package entry. No watch, config, charter or conversation-capture change.
The installed guide documents commands, provenance, digest domains, source selection, privacy,
staleness and history gaps. Installing supplies code only; rebuilding is an explicit action.

The JSONL catalog has one metadata row per source unit: id, kind, task, project, date/dateBasis,
title, description (at most 200 characters), path, anchor, unit sha256 and exact source-file digests.
Rows have stable IDs from path/anchor/kind. Line anchors are source positions, not durable message
identities: editing earlier lines requires rebuilding. Item threads use their existing message IDs
and JSON projection `{message,delivery,reply}`, with the separate reply file tracked as a dependency.
Absent replies are tracked too. Unknown project/task remains null. Every unit is historical;
source mtime is labelled as such rather than passed off as the date a decision occurred.

BM25 uses Unicode letter/number tokens, NFKC/lowercase normalization, k1=1.2, b=0.75, and IDF
`ln(1 + (N-df+0.5)/(df+0.5))`. Title/task/project and the complete verified unit are tokenized.
Ties use date descending then ID ascending; byte-order sorts avoid machine-locale variation.
Search verifies catalog rows against the current allowlisted sources, omits stale/deleted rows,
and ranks only verified text. A source error prevents a partial answer. Search/show are read-only.
The generated catalog is atomically replaced under a refusal-on-contention lock, with private
file modes on Unix. Links/junctions in source/output components are refused. This is trusted local
code, not a sandbox against a concurrent malicious filesystem writer.

Backlog snapshots belong to the existing opt-in baseline watch. Rebuild consumes exactly its UTC
minute filenames, including same-minute hash suffixes; hashes in filenames must match exact bytes.
It never creates snapshots, starts a watch or writes the current backlog. Duplicate lines remain
in dated catalog rows, with identical ledger search hits collapsed to their latest occurrence.

## Validation and adoption

Synthetic isolated fixtures cover determinism, source metadata, digest domains, historical wording,
rolled-off outcomes, stale/deleted sources, reply arrival, output caps, source selection and privacy
boundaries. No private home fixtures, generated corpora, review evidence or probes belong in Git.

The private frozen 40-probe set and reproducible protocol are delivered in the authorized home
task evidence directory, excluded from indexing by depth and explicit probe/evidence filenames.
The first mate will supervise the later fresh-session trial: one provider, 40 probes × 2 arms ×
2 repetitions = 160 runs, at most 2M tokens. Native memory is documented and controlled; expected
answers and scoring are frozen before runs. Adopt only if accuracy improves by at least 20
percentage points and false-current answers do not increase. No trial result or operational
adoption is claimed by this build. Add a second provider only after a positive pilot.
