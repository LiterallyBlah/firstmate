# Files saves and recovery

Files reads carry SHA-256 of the exact bytes shown, including BOM and line endings.
Every save checks that hash. `force` records the explicit **Replace with my text**
choice; it never skips the check. Old clients sending only modification times cannot
save through the new RPC. Modification time remains list/display information.

On conflict the draft stays in the editor. **Compare copies** reads the current
file without loading it into the draft and shows Yours, Theirs and Original.
Task removals and completed work made unfinished are listed explicitly. A checkbox
acknowledges those exact losses; the server recomputes the list against the proposed
text. A later disk edit requires another comparison. Choosing the saved copy uses
the existing unsaved-changes confirmation. Copy and Keep editing preserve the draft.

`server/file-save.mjs` and `templates/tools/file-save.mjs` are byte-identical
dependency-free code used by the daemon's Files writer and installed launch helper.
A regression test enforces that identity; the copy is needed because Paseo only
permits imported plugin modules under client/server/shared. Existing internal checked text edits also
use it. Home preparation refreshes this helper before launch. It creates no agents.

## Save protocol

1. Resolve the canonical file inside the home. Acquire its exclusive cross-process
   lock and reread it. Backlog uses `data/.backlog.lock`; other files have a hidden
   per-file lock beside them. Busy or stale locks stop the save; they are never
   broken automatically. Files' existing in-process queue remains too.
2. Check the expected content hash and, for Files data records, the reviewed task
   losses. Write exact previous bytes and a `prepared` audit record, then stage and
   sync the new bytes beside the destination, preserving the existing file mode.
3. Reread and check again. Rename the destination into a unique capture file,
   inspect those actual displaced bytes, and save them too if an outside writer
   landed at the final check/capture boundary. Changed bytes stop the save and
   restore the captured file into an absent destination.
4. Install by exclusive hard link, never overwrite-rename. If an outside writer
   creates the destination during capture, its file wins and the save reports a
   conflict. Persist `saved` or `stopped`, including before/after hashes, displaced
   hash, actor (`files`, `launch`, or `home.edit`) and the force flag. Check the full
   saved bytes once more and clean temporary files.

This requires a filesystem supporting hard links, as the launch helper already
does. An unsupported filesystem fails the save and restores the previous path.
There is a short interval while the destination is captured when a reader may see
it absent. A process crash in that interval leaves the lock and capture beside the
destination, plus the synced previous copy and prepared audit. No startup code
silently restores or chooses a copy.

An arbitrary editor or agent need not use this lock. This change does not intercept
those writes, sandbox them, or claim compare-and-swap against a process keeping an
old open file descriptor across capture. The checked previous copy remains available
even in that case. Files and launch no longer unconditionally discard a destination
that changed at their final check/rename boundary.

## Where previous copies live

For `data/backlog.md`, copies are
`recall/files/data/backlog.md/<sha256>.bin` and audit entries are in its `history/`
subdirectory. `.bin` means exact original bytes; a Markdown file is still readable
as text in Files. Other `data/` files use their full relative path the same way,
including nested records and non-Markdown files. Copies are always enabled,
independently of the optional receipt journal. An unchanged save writes nothing.

Keep the 50 most recently retained distinct contents and the latest 100 audit
entries per file. Reusing the same content verifies the saved copy and refreshes
its retention time. Failure to preserve the previous bytes stops replacement.
These are local recovery copies, under the same home, not an independent backup.

To recover, inspect the current file, the audit's before/after/displaced hashes,
and the matching saved copies. Copy the wanted text into Files and use its checked
save and loss review. Do not blindly replace a newer file. After a crash, inspect
the adjacent `.previous` capture too and check that the lock's PID is gone before
removing the lock (`launch.mjs unlock <id> --backlog` supports the backlog lock).
No automatic recovery or force-without-version option is provided.

## Verification

The Files tests reproduce an hour-old draft losing ten tasks and moving two Done
items back to In flight, same-millisecond content changes, final capture/install
boundary writes, exact recovery bytes, and bounded retention. Launch tests run an
actual launch process while Files holds the backlog lock and exercise its final
capture conflict. UI tests cover both layouts, retained drafts, all three copies,
the acknowledgement, stale reviewed hashes and typing during a save.

`node docs/files-safe-save/render.mjs` renders the real Files view with synthetic
RPCs at desktop/phone widths in both themes, checks the replacement gate and retained
draft, and writes screenshots/results only to `.local/files-safe-save/ui/`.
It requires the existing `docs/board-list` render dependencies. These are fixture
checks, not a claim of testing an installed desktop or physical device.
