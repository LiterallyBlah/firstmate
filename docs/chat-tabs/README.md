# FirstMate Chat workspace tab

Chat is a fourth fixed workspace panel (`firstmate-chat`), alongside Deck, Board and Crew. The hub
launcher opens it in the verified FirstMate home workspace. A Chat tab selected in any other
workspace still follows the **current configured first mate**, including replacement and release.
It uses Home's `MateChat`, launch/adopt state, filtered transcript, permission cards and read marking.
Home-file links open the Files view in a dialog without moving the hub's saved pane selection.

The old workspace/agent panels are **FirstMate here**. Their cards and contextual message box remain;
outside the mate's own agent panel, **Open chat** opens the dedicated panel (home workspace preferred,
current workspace as fallback). No plugin install or daemon mutation was used for validation.

## Shared state and review

Both composers subscribe to the existing per-mate draft and attachment stores; sent images use the
same message-id store. The existing per-mate send gate synchronously rejects overlapping submissions.
Send now reads the stores at click time, so an older render cannot send a draft another copy already
cleared. New text typed during a pending send survives success; a failed send restores into mounted
copies. Each transcript has independent scroll position with the same follow/jump rules as Home.
Filtering is unchanged. Registration callbacks use a `forEach` parameter to preserve each view's
identity under Hermes. Self-review covered every changed file and checked lifecycle, routing,
failure recovery, navigation binding and the absence of server or scene changes.

## Checks

- `npm test -- --maxWorkers=1`: 90 files, 1,076 passed, 3 skipped. A four-worker run also passed;
  a later run alongside browser compilation hit the pre-existing remote poll/count timing race.
  The final run was isolated and sequential; no remote tests or production code were changed.
- `npm run typecheck`; `npm run lint:deck-packs` (36 checks); changed-code Prettier; `git diff --check`.
- `node docs/shell-phase1/check-bundle.mjs`: Paseo 0.11 compiler, zero client `class` tokens,
  React Native 0.81 Hermes parsing with default flags.
- `node docs/chat-tabs/render.mjs`: real components through React Native Web, synthetic host APIs,
  headless Edge. Checks registration, launcher/context routing, foreign workspace, read marking,
  hidden watch payload, two simultaneous composers, shared draft/attachments/sent image, delayed
  send gate, failed-send restoration after closing a copy, remount, mate replacement, launch state,
  390×844 phone light/dark and desktop. Screenshots in ignored `.generated/` were visually reviewed.

Reproduce with `npm ci` and `npm ci --prefix docs/board-list` first. This does not claim a live Paseo
tab persistence test or native iOS/Android verification. No deck scene, pack, canvas or snapshot changed.
