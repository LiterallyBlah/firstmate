# Project mate context and setup recovery

The old reader treated README as a convention and refused any file over 64 KiB. A 24 KiB AGENTS.md with a 76 KiB README therefore stopped setup after the exact request input had already been saved.

The reader now carries complete AGENTS.md and CLAUDE.md files, separates README documentation with explicit excerpt coverage, and counts escaped JSON against the opening budget. The existing provenance, context-only authority, digest verification, confined paths, project/memory stability checks, selected session identity and cumulative spending remain in force. Create and resume still require an explicit captain app action. No live Create or Attach was invoked for this change.

| Acceptance | Evidence |
| --- | --- |
| 24 KiB AGENTS and 76 KiB README succeed | `server/project-runtime.test.ts`: full conventions including CLAUDE, README headings/opening, full-source digest, strict memory RPC parsing and actual opening through a synthetic receiver |
| Complete conventions above the old bound | 96 KiB AGENTS stays byte-for-byte intact; small README remains full documentation |
| Real refusals remain safe and actionable | Oversized AGENTS/CLAUDE; binary root files; a file changed during reading; encoded shared limit; existing corrupt-memory and project/memory changes |
| Stable Windows file identity | A deterministic cross-platform fixture models Node 23 Windows path `stat.dev=0` versus the open handle's volume ID. Each API retains its own before/after device identity; inode, size and times are also checked across APIs. A changed descriptor device, edited file or replaced path still refuses. |
| Projection stays faithful and bounded | Fenced code headings omitted, UTF-8 prefix preserved, heading counts and opening completeness; README above 1 MiB with a preamble parses through the RPC |
| Existing recorded request resumes once | Exact legacy input-only receipt, process restart, saved-input resume, duplicate presses and different request IDs yield one mate, one opening and 1/1 cumulative spend |
| Plain create/resume/stop | Actual mounted controls retain request identity, stale guards, explicit recovery and uncertain-stop behavior in `client/project-ownership.test.ts` |
| Both themes and widths | `node docs/project-mate-context/render.mjs`: 24 before/after captures of create, recorded resume and refusal at 1440×1000 and 390×844; overflow, console errors and read-only opening checks |

Install render dependencies with `npm ci --prefix docs/board-list`. Captures and `results.json` stay in ignored `.local/project-mate-context/`. The before implementation is pinned to main commit `2c1b1ed96c73385ce72293e06aaf97b2a93a99ac`. CI includes these files in the `deck-before-after` artifact. This browser fixture uses the real React Native component with synthetic host APIs; it does not exercise a native phone or a live daemon.

After installation the captain can reopen Ariadne's saved setup and choose **Resume setup**. The saved input and request ID are reused; installing the fix creates no mate and takes no extra conversation or turn by itself. **Stop setup** retains identity, used limits and any operation whose outcome is unknown.
