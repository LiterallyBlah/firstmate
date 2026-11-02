# Supervisor cleanup

The six slices from the Supervisor redundancy audit, one PR each. Render evidence stays in ignored
`.local/supervisor-cleanup/`; only the small comparison sheets linked from a PR live in `evidence/`.

## Slice 2: no mate switcher or @-mentions in the FirstMate chat

The chat listed every project or plan scope that had ever been bound as a separate conversation
("Ariadne mate", "Starpath mate"), polled each one's history every 15 seconds, and offered `@`
routing with "No project mates yet. Set one up". All of that is removed: Home shows FirstMate's
conversation alone and makes no scope read. A scoped discussion still opens from an explicit route
(Plans' "Discuss with this plan's owner", Needs you's "Discuss with…"), with its own recipient
control and Back to FirstMate. `sameConversationTarget` moved to `client/conversation-target.ts`.

`node docs/supervisor-cleanup/chat-render.mjs` (after `npm ci --prefix docs/board-list`) mounts the
real Home through the slice-11 synthetic host with two bound project scopes, Ariadne and Starpath,
beside a plan helper. It builds `45f0488` (before) and the working tree (after), captures Home, the
open switcher, `@` typed and an explicit scoped route in both themes at 1440 and 390 pixels, and
checks that after the change no switcher, mention panel or bound-history read appears, `@` prose is
sent to FirstMate as written, and the explicit route still sends to its owner and returns. CI runs it.
