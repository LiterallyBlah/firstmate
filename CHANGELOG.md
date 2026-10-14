# Changelog

Notable changes to this private FirstMate copy. Upstream history is retained below.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the version numbers
follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html). Install this copy from its private
Git repository or local directory; it is marked private to prevent accidental npm publication.

## [Unreleased]

### Fixed

- FirstMate chat and Watch keep separate assistant messages apart, including a worker-triggered
  turn whose system prompt Paseo omits. Continuous streaming chunks still join without added
  whitespace, preserving Markdown through snapshot refreshes and reconnects.

### Added

- An observe-only receipt journal, behind `FIRSTMATE_RECEIPT_JOURNAL=1` and off by default: a persisted,
  append-only, hash-linked record of every plugin send (with an original message id, now on board steers,
  asks and Compact too), its result and the first-mate generation it belongs to; a generation ledger of
  launches, restarts, adoptions, releases and handovers; before/after hashes of every plugin write into
  the home, bound to an action id; the first mate's own Paseo tool calls; and crewmate finishes, marked
  uncertain. A read-only `firstmate.receipts.timeline` RPC pages the first mate's and crew's timelines
  with Paseo's `gap`/`staleCursor`/`hasOlder`. With the switch off nothing is sent, written or recorded
  differently.

- FirstMate chat recognizes exact host/workspace provenance in Markdown file-link titles.
  Links show the workspace-relative filename and line information, then open that workspace
  through supported Paseo navigation for manual file selection. Bare absolute paths require
  unambiguous ownership; relative links require provenance, including `firstmate:home` for
  confined home files. Missing/ambiguous targets explain the problem and HTTPS stays external.
  No automatic file pane, file existence check or workspace file read is added.

- Explicit watch session, reasoning and notification fields in creation/configuration RPCs, the home
  tool and Watches UI. The opt-in Board review preset runs a separate parentless read-only inspection
  at Medium on the current provider/model; unchanged outcomes stay silent. Durable reports and result
  receipts survive handover, with failures escalated, overlap prevented and evidence retained after
  inspector archive. Existing scripts keep current-session defaults and unchanged mate reasoning.

- **Switch provider/model** transfers the first-mate role to a fresh session with target-specific
  permission and thinking settings, retained home records, a bounded saved handoff and links to old
  conversations. A durable journal supports recovery after creation, retirement or delivery failures;
  queued watches and board crew notes wait for the handover. Migration refuses children in the mate's
  workspace because Paseo would archive them too; crew in separate workspaces and remote ownership
  continue. No native conversation or provider state is transferred.

- A remembered **List / Board** switch. List is the new default, grouping full-width task rows into
  Needs you, Working, Queued, Idle / stalled and Done, with one task scroll container. Done starts
  collapsed to a count and expands in place. Rows reuse the existing card details and local/remote
  actions, and offer the full title in a tooltip and screen-reader label.
- Reproducible renders under `docs/board-list/`: main before the change and both new views at
  2866×1694 with a 45% chat split, plus 390×844 phone renders, using 45 sample tasks.

- `tools/remote.mjs` takes `--prompt-file <file in the home>` on `run` and `send`, also inside a
  request file, and sends the file's text unchanged, Windows backslashes included.
- `permit ls` through the helper adds each agent's latest tool calls, which show a pending Bash
  command. The remote guide explains answering a question with `permit allow --input`.
- `data/remote-follow.json` lets the first mate follow remote agents that aren't its crew, such as the
  captain's own sessions it was asked to steer. The catalog reads them through `inspect`, `logs` and
  `permit ls` only. It never labels or changes them. `remote-watch` reports them the same way as crew.
- The remote catalog carries each worker's final message (`lastMessage`) and what each pending
  permission asks (`pendingPermissions`: request ID, tool and description). A waiting worker carries
  `recentTools`, the same latest tool calls the helper's `permit ls` adds, and `remote-watch` quotes them.
- Remote work is on the board's columns. Backlog items with `(host: …)` or `(on-host: …)` are matched
  to their remote worker by host plus agent id or `firstmate.task` label, and filed by its live status
  and status line; remote workers without an item get their own cards. Cards show their host.
- Remote cards have Watch (the worker's recent log, read-only), Steer, Interrupt and End, routed through
  the plugin's remote request path. Relaunch is shown disabled with its reason. Followed sessions (the
  captain's own) are marked and never offered End. A worker's last message, where the poll keeps it,
  gives the status line, and pending permissions are spelled out on the card with the worker's latest
  tool calls. A steer is sent after `--`, so words starting with a dash are sent as written.
- Remote card times are corrected by the host's measured `clockSkew`, and a host three minutes or more
  off shows it in its health.
- Host tabs above the board — All, This machine, and each saved host — with counts, the host's health on
  its tab, and the choice remembered. No tabs without saved remote hosts.
- The sidebar badge counts remote workers that are working or idle.

### Changed

- Board columns occupy one full-height row on wide screens and scroll sideways; empty columns stay
  hidden and folded columns become strips. Headers and count pills keep their width. On phones,
  Board continues to stack columns in one scroll view.
- Suggestions occupy a slim row above List or Board, with overflow under More and separate send,
  expand and delete controls. Watches move from a board box to the header icon.
- Remote health lives in the host tabs on All. A host's own tab shows an expandable summary with
  reachability, worker count and any clock warning, without repeating the worker list.

- **Idle no longer stands in for Working.** A worker that ended its turn with `working:` or `paused:`
  waiting on something outside itself — a gate, a run, a watcher, another worker, "until …" — is filed
  in Working with a "waiting" chip. A finished worker (`done:`, `resolved:`) waits in a new **Ready**
  column for the first mate. Idle is left for a worker that stopped with no status line or stalled
  (`working:` with nothing to wait on, chip "stalled"). In-flight backlog items with no worker the board
  can see are in Working, marked "no worker seen", or Blocked when held for the captain. Local and remote
  workers, followed sessions included, follow the same rules. Saved column layouts gain Ready at their
  end, and the sidebar badge counts Ready too.
- The board is calmer. A card at rest shows its title (two lines at most), its state, its project and
  host as small tags, when it last moved, and one line of its latest status — the most pressing of a
  waiting permission, an error, the captain's call and the status line. Pressing it opens the rest
  (kind, task id, mode, since, model, agent id, the full status line, the pull request, the report)
  with its actions, as before. Columns lose their borders and get more room between them and their
  cards, and headers show their count in a small pill.
- Done shows its three most recent cards, newest first by the date the backlog records, with **Show
  all** for the rest.
- **Card spacing** in Settings › Plugins › FirstMate: Comfortable (the default) or Compact, kept with
  the board's other layout settings.
- A failed remote command reports the remote CLI's own error, redacted, instead of a generic
  message. An unreachable host names its last connection attempt's reason.
- Each remote `run` measures the host's clock against this machine's, from the new worker's
  `CreatedAt`. The measurement is kept as the host's `clockSkew`, and every helper answer from a
  host that is three minutes or more off warns on stderr. Remote times are shown as reported.
- The helper refuses a `--cwd` that has lost its backslashes.
- `data/remote-access.md` documents prompt files, errors, permissions and questions, times, and why
  remote files cannot be read yet.
- `remote-watch` reports each finished turn once: status, status line and the final message, cut to
  1,500 characters. Before, it sent the whole recent output tail on every status change. A turn ending
  with the same words is not reported again. A running worker is reported only for a new permission
  request, with its tool and question or command. Reports share a 12,000-character budget, and
  whatever does not fit follows in the next run. An untouched copy in an existing home is replaced,
  and its saved state carries over, so nothing is repeated.

### Fixed

- Web tabs and expansion controls expose explicit ARIA states as well as native accessibility
  states, so the selected List/Board, host and phone tabs and expanded rows are announced on the web.

- Windows: watches no longer start detached, which left them without a console, so each `gh` the
  built-in `pr-watch` ran waited about three seconds for a console of its own. `pr-watch` overran its
  time budget and its tests timed out; a run now takes about a second. `pr-watch` also starts `gh`
  with `windowsHide`, so an untouched copy in a home is updated on the next plugin start.

## [0.4.0] — 2026-10-07

### Added

- Every saved Paseo desktop host is synchronized to a private daemon-side connection registry,
  including relay, TCP and SSH connections. Removing a saved host removes its bridge access.
- A terminal helper lets the first mate discover remote projects, workspaces and providers and
  explicitly dispatch and supervise remote workers, independently of the app's connections.
- Remote workers carry a stable owner label. Their completions and permission requests reach the
  first mate through `remote-watch`, and a Remote hosts card shows host and worker status.
- This private copy enables Paseo desktop's Keep running after quit setting once on first successful
  sync, matching its independent-operation configuration. A later manual change is respected.

### Changed

- Requires stable Paseo 0.11.0; SDK pins match that release. The saved-host and desktop IPC adapters
  use private 0.11 app formats, validate their inputs, and retain the last valid configuration when
  the saved-host format is unsupported. Credentials stay outside the mate's home and repository.
- Remote targets are identity-checked before use. Only read-only connection probes retry alternative
  connections; a command that may change remote state runs once, including after a timeout.

## [0.3.2] — 2026-10-07

### Fixed

- Windows startup no longer reports `The charter could not be read: spawn EINVAL`. Paseo's desktop
  and npm batch launchers resolve to their native runtime and JavaScript entry point, preserving
  argument boundaries without a shell. CLI fallback discovery includes Windows executable names.
- Node watches, including `pr-watch`, run on Windows without Unix executable bits. Timeouts and
  plugin shutdown stop the watch's Windows process tree.
- Tests use portable paths, Node watch fixtures and Windows directory junctions. Unix process-group
  behavior is retained; custom Unix shell watches remain Unix-only.

## [0.3.1] — 2026-10-04

### Added

- **Read a whole suggestion before sending it.** A suggestion too long for its card now has a chevron
  beside the trash. Press it to open the full request below the card, wrapped and ready to select and
  copy; press it again to fold it. Opening a card never sends it, and pressing the card itself sends it
  as before. It works with the keyboard and on a phone.

## [0.3.0] — 2026-10-01

**Requires Paseo 0.11.** This version does not load on Paseo 0.10 or older; stay on 0.2.1 until you
update Paseo.

### Added

- **The FirstMate row in the sidebar counts your crew.** A small number beside it says how many workers
  are working or idle right now, and it goes away when there are none.

### Changed

- **The FirstMate page is titled "FirstMate".** Opened from the Command Center, `/bearings` or `/ahoy`,
  its title read "fleet"; only the sidebar row said FirstMate. Your sidebar order, a hidden FirstMate
  row and saved links to it all carry over.
- Settings › Sidebar now shows a generic plugin icon for FirstMate instead of the ship, and the page's
  title no longer has the ship beside it. Paseo draws both that way for every plugin on its new sidebar.

## [0.2.1] — 2026-09-26

### Removed

- **The chat no longer has an "Open in Paseo" button next to "Ahoy".** The first mate can still be
  opened in Paseo from the button at the top of the panel.

## [0.2.0] — 2026-09-26

### Added

- **The first mate hears about your pull requests within minutes.** When a pull request on its backlog
  is merged or closed on GitHub, gets a review or a comment from someone else, or its checks go red or
  green, the first mate is now told within about five minutes, instead of at its next half-hourly check
  or when you mention it. That covers pull requests to other people's projects too, so a maintainer's
  review reaches the worker without you passing it on. Everything that changed since the last check
  arrives together, as one short list with a link to each pull request. It needs the `gh` command,
  logged in.

  This is the first of FirstMate's **watches**: small scripts in a `watches/` folder in the first mate's
  home that run on a schedule while Paseo is running. Everything a run prints — up to 16,000 characters —
  reaches the first mate as one message, shown in the chat as one line naming the watches, and saying
  nothing costs nothing. What piles up while the first mate is busy arrives together, up to 32,000
  characters; past that the oldest are left out, and the card shows which. You can add your own — a README
  in the folder explains how — or ask the first mate to write one for you — it asks for your approval
  first, and knows how to build and try one. FirstMate adds nothing to what a watch prints, so a watch can
  tell the first mate what to do about what it finds, and since you approved it, the first mate takes that
  as your instruction. A watch that passes on text from someone else, such as a pull request comment,
  marks it as quoted, and the first mate treats that as news, not orders; the pull request watch does this
  itself. A new **Watches** card, after the board's columns (at the bottom of the Crew tab on a phone),
  lists each one with when it last ran and what it last said, and switches any of them off or on. Press a
  watch's name to open its script in the Files view. The card appears only when there are watches.

- **Suggested next steps, one press away.** When the first mate reports something you will probably
  act on — a pull request ready to land, a review to run, a decision to make — it now also offers it as
  a button. On a wide screen the buttons sit in a Suggestions card before the board's columns; on a
  phone they have a tab of their own, right after First mate. Pressing one sends that request to the
  first mate straight away, as if you had typed it and pressed Send, and shows you the chat; whatever
  you were typing is left in the message box. The card and the tab appear only when there is something
  to suggest. The first mate keeps the list in `data/suggestions.md` in its home, which you can edit too.
  A suggestion you do not want goes with the trash button beside it, which takes it off the list without
  sending anything; the rest of the list stays as it was.

- **Images and files can go with a message to the first mate.** The chat has an attach button beside
  the message box, and you can also paste a screenshot or drop files onto the chat. What you attach
  shows above the box, where you can remove it before sending, and it stays there if Paseo loses its
  connection while you are still writing. The first mate sees images as images, and gets other files
  the same way it would from Paseo's own message box. This works in the Mac app and in a browser,
  phone browsers included; in the iPhone and Android apps the button does not appear yet, because
  Paseo does not let plugins open the photo library or the file picker there.
- **Files the first mate mentions are links.** When a reply in the chat names a file in the first
  mate's home — `data/backlog.md`, `AGENTS.md`, a watch script, or the file's full path — it is a link
  that opens the file in the Files view: beside the chat on a wide window, in the Files tab on a phone.
  Only files that are really there are linked; anything outside the home, or not written yet, stays
  plain text.

### Changed

- **Removing the plugin no longer deletes the first mate's files.** Its settings, and its home when you
  have not chosen one, used to sit inside the folder Paseo installs the plugin into, which Paseo deletes
  when you remove the plugin. They now live in `~/.paseo/plugin-data/firstmate/`, and the plugin moves
  them there the first time it starts. A home you picked yourself stays where it is. The old home also
  stays put, and is still used, while a first mate is aboard in it — it moves on the first start after
  you release it — or while it holds projects the first mate cloned for you, because Paseo knows those
  by their location; the plugin's log says which. Once the home has moved, the project Paseo still lists
  for its old location can be removed.

- **The board hides columns with nobody in them.** Only the columns that have workers show, and on a
  wide screen they fill the space: up to three sit side by side, and more than three take two rows, with
  the extra one in the second row. On a phone the list simply skips the empty ones. When there is no crew
  at all, the board says so. The arrows that move a column skip over hidden ones, and a hidden column
  comes back in the place you gave it.
- **A worker that has finished waits in Idle, not Done.** When a worker reports it is done, its card now
  moves to the Idle column until the first mate lands the work and records it as done; only then does it
  reach Done. The card still shows what the worker said and anything waiting on your call. Before, a
  finished worker's card sat in Done beside work that had really landed, even while it was still waiting
  on a review or on you.
- **The first mate's instructions close a few gaps that let work stall or land badly.**
  - A worker no longer stops on "still working": it keeps going until it is done or really waiting on
    something, and one that stops anyway is nudged to carry on.
  - Before merging a pull request — even under a standing order such as merging green dependency
    updates — the first mate checks it again: it will not merge while a required check is still running,
    missing or failing, or when the pull request has changed since it showed it to you — then it shows
    you the new version instead — and it confirms the merge went through. It notes the pull request's
    address on the work, and which version it showed you, so it can tell.
  - Its regular check-in now looks at every pull request it is tracking. One you merge on GitHub is
    cleaned up and the work waiting on it starts; one you close without merging still holds work that
    never landed, so it asks you what to do with it rather than throwing it away. It also notices a worker
    that has stopped making progress in the middle of a task.
  - Each worker starts from the latest version of the project rather than a local copy that may be days
    behind.
  - It picks how hard each worker thinks for its task: less for clear, well-understood work, more for
    investigation or design, and never the maximum unless you ask for it.

  A home whose charter you have not edited picks this up on its own; if you have edited yours, the board
  offers the new one to compare.

### Fixed

- **Saving a file in the Files view keeps its permissions.** A script you could run — a watch, say —
  used to lose that after an edit and save, so the Watches card called it "not executable". It now stays
  as it was; a new file is created as before.
- **Changing a FirstMate setting no longer lets go of the first mate.** Saving one setting — the crew's
  model, say — quietly reset the others, including which agent is the first mate and where its home is,
  so the board could lose track of a first mate that was still running. A save now changes only the
  setting you changed.
- **A message you were typing to the first mate is still there when you come back.** Leaving Paseo for
  another app, putting the phone down, or letting the Mac sleep could clear the box, so a half-written
  message was gone by the time you returned. It now stays until you send it, for as long as Paseo is
  open.
- **Finished workers no longer pile up in Paseo's "Ready to review".** Every worker the first mate ran
  stayed in that part of Paseo's sidebar after it finished, as if you still had to look at it, even
  though the first mate had already read what it said. Once the first mate has read that a worker
  finished, the worker now moves to the Done section of Paseo's sidebar, as it would if you had opened
  it yourself. A worker that needs your permission or has failed still shows up for you as before, and
  your own agents are never touched.

## [0.1.1] — 2026-09-23

### Added

- **Your own first words to the first mate.** What a new first mate is told when you launch or restart
  it is now a file in its home, `data/opening.md`, beside your standing orders — change the wording,
  the language, or what it should do first. It starts as the message FirstMate has always sent, and
  your version is never overwritten.
- **The first mate's charter is yours to edit.** The instructions it works by now come from a file in its
  home, beside your standing orders. Leave it alone and it keeps up with FirstMate's own; change it and
  your version is kept. When FirstMate's charter changes after you have edited yours, the board tells you
  and opens the new one for you to compare, so you can bring over what you want.

### Changed

- **A clearer sign of work under way.** The Working column now shows a hammer, and steps still running in
  the chat and in Watch show a spinner that actually turns — the old sign was a spinner drawn standing
  still, which looked stuck.

### Fixed

- **Task titles on the board stay as you asked for them.** While finished work waited for your go-ahead,
  the first mate wrote its status into the title ("…, ready in branch …, awaiting approval to land"), and
  the card grew with it. The title now stays put, and what the first mate needs from you shows on the
  card as your call.
- **A card you opened closes again when its work moves on.** A worker finishing or starting again used to
  carry its card into the new column still open, with its buttons showing. Now it arrives closed — unless
  you were in the middle of something in it, like a message half-typed to the worker, which is kept.

## [0.1.0] — 2026-09-22

### Added

- **A first mate that runs a crew of agents for you.** Launch it from the new FirstMate panel in the
  sidebar and tell it what you need; it hands each task to a worker agent in its own git worktree,
  supervises it to the end, and brings you pull requests, findings, and only the decisions that are
  yours. Workers are ordinary Paseo agents you can open and read like any other.
- **A board of the crew** beside the conversation: queued, working, blocked, parked, done, failed and
  idle, with each worker's last word and its pull request. Steer a worker, interrupt it, end it, or
  have the first mate relaunch it, from its card.
- **`/fm`, `/bearings` and `/ahoy`** in any composer: talk to the first mate from anywhere, get a
  four-part catch-up on where everything stands, or a recap of what happened with every open decision.
- **See how full the first mate's memory is, and do something about it.** A meter beside the chat
  shows how much of its context window is used, as Paseo's own chat does. Compact it to free room, or
  restart it from scratch with the same settings; its records carry over, and the old conversation stays
  in Paseo's history.
- **Watch a worker without leaving FirstMate.** A worker's card opens beside its live activity — its
  brief, reasoning, every command and file edit with what came back, its plan and its replies — in
  place of the board, with the chat still beside it. Answer its questions and permissions right there.
- **A FirstMate tab** beside a worker's workspace and session, showing its card.
- **Answer the first mate's questions in the panel.** When it asks you to choose, or needs your
  permission or a plan approved, the question appears in the chat and you answer it there, without
  opening the first mate itself.
- **The first mate's files, in the panel.** Browse its home, read any file — its instructions, your
  standing orders, the backlog, each worker's brief and report — and edit and save it there. If the
  first mate changed a file while you were editing it, you choose which version to keep.
- **The first mate's home is easy to spot in Paseo's sidebar**: it is called FirstMate, with a ship
  for its icon, rather than "home" under a folder. A name or icon you give it yourself is kept.
- **Opening the panel marks the first mate as seen**, so its workspace in the sidebar reads as done
  rather than waiting for you, just as if you had opened the first mate itself.
- **Standing orders you write yourself**, in the first mate's home, which it reads every session and
  follows ahead of its own charter.
