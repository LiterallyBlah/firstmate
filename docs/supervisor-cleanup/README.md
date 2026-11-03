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

## Slice 3: Work details becomes Supervisors

Work details was still the pre-pivot "Saved project mates, plan help and routine checks" dialog, led by a
"Project mates" board offering "Create ‹project› mate". It is now **Supervisors**, mounted where Work
details was (Home's header and Settings). `firstmate.supervisors.read` (`supervisorList` in
`server/supervisor-configuration.ts`) lists every plan, project and routine-check scope with a binding or a
saved configuration, from the journal alone: title, kind, state, the profile the exact session runs, usage
against its effective limits (a bound configuration's caps within the allocation, as reservation applies them)
and the last failed effect. Each row reuses Supervisor settings and opens its native
session. Plan rows name the watches assigned to them. Add points plan help to Plans, keeps watch-input
assignment, and adds a routine checks Supervisor through the existing admission review (the routine-check
board's `listed` mode, which leaves owners to the list). The plan-help board stays mounted there too, so a
prepared or barrier handover keeps its inspection and original-command recovery before Plans shows it on commit. Projects are a read-only context section
(`client/project-context.tsx`): name, folder, status, memory, associated plans and record recovery. No
project-mate setup, provisioning, "Mate active" label or setup-count badge remains in this surface.

`node docs/supervisor-cleanup/supervisors-render.mjs` builds `bbf29e7` (before) and the working tree
(after) on the live-shaped smooth-pr6 project census, with the owner's two bound project Supervisors
(Ariadne, Starpath). It captures Home, the opened dialog, the expanded project section and Settings in both
themes at 1440 and 390 pixels, checks that browsing makes no write, and that the header keeps one row at 638
and 900 pixels. It replaces `docs/smooth-pr6/live-render.mjs`, `docs/smooth-pr9/work-details-render.mjs` and
`docs/project-mate-context/render.mjs` in CI, which pinned the old board.

`removed-at-baseline.mjs` lets a render harness's baseline build keep importing modules a later slice
removes: a missing relative client/shared module is read from that harness's baseline commit, and a harness
that builds today's Home or Settings around a few baseline files can show the baseline's Work details in
place of Supervisors (`SUPERVISORS_AS_WORK_DETAILS`). The smooth-pr2, -pr5, -pr6, -pr10 and smooth-rollout
harnesses use it; their "after" stages now open Supervisors and Projects where they opened Work details.
