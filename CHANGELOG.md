# Changelog

Notable changes to this private FirstMate copy. Upstream history is retained below.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the version numbers
follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html). Install this copy from its private
Git repository or local directory; it is marked private to prevent accidental npm publication.

## [Unreleased]

### Added

- **The first mate can set Supervisors up itself.** A new `tools/supervise.mjs` lets the current first
  mate run the plan-help handover (backup folder and retention, evidence, prepare/resume, reconcile,
  barrier, commit), Attach a plan Supervisor, and provision or resume a project's Supervisor —
  through the same checked paths as your app buttons, which keep working. Every action records the
  first mate as its actor beside your button's record; if the first mate is replaced mid-setup, its
  successor (or you, from the app) takes the recorded request over, recorded as a takeover.
  Crewmates and Supervisors are refused, and canceling a handover, resolving its holds and the
  always-yours matters stay yours.

- **Converse with a worker in one press.** Every card and list row with a worker has a 💬 that opens its
  conversation in a drawer beside the list or board — over it where the pane is narrow, the whole Crew tab on a
  phone — while the first-mate chat stays on the left. It shows the worker's words first (YOU for your own
  messages, tool calls folded to a line, Activity for everything), answers a waiting question or permission in
  place, and replies from a box at its foot: Enter sends, Shift+Enter is a new line, Esc goes back exactly where
  you were. Reading and replying from List or Board now takes 2 presses instead of 4, and the round trip 3
  instead of 5. Its details and Interrupt, Relaunch and End sit behind ⋯; Open in Paseo is a small ↗ for what
  only Paseo has. It replaces Watch; the deck's focus panel opens it too.

### Changed

- Rewrite the README around this fork's current features, with synthetic screenshots of both Deck
  scenes, Home, List, Board and Chat, plus looping Deck and chat demonstrations replacing the old
  demo; retain prominent upstream credit and the MIT license.

- **The ship's wake trails steeper.** The stern wake behind the deck now falls away at about 16° instead of about
  7°, so it reads as water streaming off a ship under way rather than lying flat behind it. Same timing, same place
  at the stern, and the heavy weather's wake still rolls in over it as the fleet gets busy.

- **The first mate hears about a conversation once, not once a message.** What you say to a worker from the
  board, and what it answers, is relayed in one note per worker once the conversation has been quiet for two
  minutes (ten at most), so a back-and-forth costs the first mate one turn. Remote steers are gathered the same
  way.

- **Your steers are tagged as yours** in the worker's timeline, receipt journal on or off, so the conversation
  can say which messages were yours.

- The plugin installs about 11 MB lighter. The ship deck's art now ships only the frames the deck draws (about
  300 KB); the generation sources, prompts, provenance and review renders that made them stay in the repository's
  `docs/ship-deck-art/`. The deck looks and moves exactly as before.

- A busy fleet sails into a storm. When four or more crewmates are working, the deck's calm scene cross-fades into
  generated heavy weather: the clouds darken into thunderheads, an overcast greys the daytime sky, the sea turns
  rough with whitecaps, a heavier wake churns astern, spray breaks at the bow, and with six working a faint fork of
  distant lightning flickers behind the clouds about twice a minute. It eases in over a few seconds as the crew gets
  busy and back out as it quiets. Three or fewer working looks exactly as before. At night the overcast never
  brightens the sky; the stars simply go behind the thunderheads. Under reduced motion the deck stays calm however
  busy the crew is, and a software renderer shows the storm still, with no spray movement or lightning.

- The ship deck's weather follows the work. The more crewmates are working, the livelier the deck: the sea
  plays its waves and drifts faster, the clouds run before a fresher wind, the sail snaps quicker and stays
  filled longer, the ship rides the swell a little harder, the wake fills out, and with the whole fleet busy
  the sky turns a shade greyer. With nobody working the sea is slow and glassy and the wake faint. The change
  eases in over a few seconds as crewmates start and finish, never with a jump. Waiting crewmates stir it a
  little, blocked and idle ones not at all; six working is as lively as it gets. Under reduced motion the deck
  stays as calm as before, however busy the crew.

- The ship deck's sea moves. Generated water replaces the still sea tile: its four frames play in turn, so
  the waves shimmer gently as they drift past, and a new strip of foam along the waterline breathes with them.
  The scattered dashes of the old wake are gone; a generated stern wake, a churned V of white water opening
  aft, trails the ship instead. Under reduced motion, and on a software renderer, the water holds its calm
  first frame.

- The ship deck's crow's nest sits snug over the sail. A trimmed generated mast, 32 px shorter, brings the
  nest down to 23 rows above the yard instead of 55, so the long bare stretch of pole between them is gone.
  The sail, the mast's foot and every crewmate stay where they were, and the nest still sways. The deck's fit
  needs 32 fewer rows above the hull, so in a wide, short pane the ship is drawn a little larger again.

- Answer a crewmate from the ship deck. When one of the first mate's suggestions is about a crewmate's
  work — it names its task id, its pull request (`web#42` or the URL) or its agent id — that sailor wears a
  small white speech bubble with three dots over its state badge, bobbing gently, and the legend counts them.
  Point at it and a speech bubble opens over its head instead of its label: the card's line ("Captain's
  call: …") and each reply as a chip. A chip sends exactly what the same suggestion's button above the board
  sends; the marker and bubble clear at once, and come back if the send fails. Focus the sailor and the same
  replies are in its panel too, reachable from the keyboard. On a crowded deck a marker never covers another
  sailor: it moves beside the badge, or edges the badge in white where there is no room. Still under reduced
  motion.

- The ship deck's mast is twice as tall. A generated tall mast stands in place of the old short one, its
  crow's nest high in the sky above the crew and swaying as before, and a generated sail three times as
  tall hangs from its yard and still billows; crew walking behind its foot are still hidden by it. The deck fits the taller mast and the
  plank's shark into the pane at every size, so in a wide, short pane the ship is drawn smaller. The old
  stays went with the short mast. The plank is now a generated board in place of the one drawn in code.

- Crewmates leaving the ship deck walk the plank. A plank now sticks out over the gunwale amidships, and a
  crewmate whose card leaves the deck — done, failed, closed or archived — walks to it, out along it, teeters
  at the end, jumps, and splashes into the sea, where a shark's fin closes in, the shark surfaces, and with
  one chomp it is gone. Several leaving at once wait their turn by the plank, one on it and one shark in the
  water at a time. A sailor on its way out has no badge and cannot be clicked; one that was focused lets go of
  the camera first. Under reduced motion there is no walk and no shark: the sailor fades out where it stood.
  A lost feed still greys the crew where they stand rather than sending anyone overboard.

- Work from the ship deck. Clicking a sailor zooms the camera in on it and dims the rest of the deck, and a
  small panel beside it shows that crewmate's card — its state, project and host, status line, anything
  waiting on you — with the card's own Watch, Steer, Interrupt, Relaunch and End, which behave exactly as on
  the board (End still asks first). Esc, the panel's ✕, or a click anywhere else on the deck zooms back out.
  From the keyboard, Tab to the deck and press an arrow key or Enter; Tab stays in the panel until Esc. Under
  reduced motion the camera snaps instead of zooming, and a narrow pane docks the panel under the sailor.

- Idle crew go off watch on the ship deck. An idle or parked crewmate walks off the working deck to a rest
  area — the foredeck by the hatch, and past six sleepers the foot of the quarterdeck stairs — and dozes there
  with its z, instead of standing at the near rail in front of the crew at work. Given work, it walks back
  to a station. The rest spots fill in a set order so a crowd stays tidy, every sleeper's badge stays in
  sight and under the pointer, and none stands over a working, waiting or blocked sailor. A sleeper's hover
  label hangs below the deck's rail instead of over its head, so it covers neither the other sleepers nor
  the crew at work; on a canvas too short for that it goes where any label goes. The legend reads "resting
  off watch".

- The ship deck is a standard part of FirstMate, no longer a preview behind `FIRSTMATE_SHIP_DECK`. In the
  desktop app's wide layout the header's Crew/Files switch always has **Deck**; a phone or a narrow window is
  not offered it, and a display without WebGL is told in words why it cannot draw. The switch is gone and
  the daemon ignores it, so there is nothing to set or restart. Its caption drops "Preview". The receipt
  journal's `FIRSTMATE_RECEIPT_JOURNAL` switch is unchanged.

- The ship deck preview (still behind `FIRSTMATE_SHIP_DECK=1`, off by default) is under sail, with a wake
  and a crew that no longer all look alike. A low square sail hangs on the mast, billowing gently, behind
  the crew. Foam churns astern and the bow and stern waves trail away across the water, scrolling with the
  sea. Each crewmate wears one of eight looks — the original sailor's two outfits, a bosun, an old salt, a
  navigator, a carpenter, a rigger and a deckhand — chosen by its agent, so the same crewmate always looks the same. Idle
  crew stand at ease in profile at the rail and breathe, instead of reaching an arm forward. The sail and
  looks are served by the new `firstmate.deck.extras`, refused while the switch is off; anything in it that
  cannot load is left out. Under reduced motion the sail rests and the wake holds still. With the switch
  off, the screen and every RPC answer are as they were.

- The ship deck preview (still behind `FIRSTMATE_SHIP_DECK=1`, off by default) sails the generated sea
  under a sky that follows your local time of day: dawn from 05:30, morning, midday, afternoon, dusk at
  18:30 and a starry night from 21:00, each fading into the next over an hour and a half. The water scrolls,
  foam laps at the waterline, and a generated gull flaps across the sky by day. Under reduced motion the sea
  holds still and no gull flies, but the sky still keeps the hour. The art is served by the new
  `firstmate.deck.environment`, refused while the switch is off; if it cannot load, the deck draws on a
  plain sea. With the switch off, the screen and every RPC answer are as they were.

- The ship deck preview (still behind `FIRSTMATE_SHIP_DECK=1`, off by default) says who each sailor is.
  Pointing at one shows a label with the crewmate's title, its state in the board's words, its project
  and host, and its card's line at rest. Every sailor wears a small badge for its state (▶ working,
  hourglass waiting, ! blocked, Z idle), and the legend below the deck keys each badge to where that state
  stands. Idle sailors doze, a z rising now and then. With the switch off, the screen is as it was.

- The ship deck preview (still behind `FIRSTMATE_SHIP_DECK=1`, off by default) moves. A crewmate whose
  state changes shows its new state at once and then walks to that state's place, along the deck and up
  the stairs to the helm, passing behind the mast and the rail. New crew climb out of the hatch; crew
  that leave climb back down. Sailors sway, haul and fret where they stand. The ship bobs on a drifting
  sea, the masthead sways, three lanterns flicker and a gull crosses now and then. A lost feed greys the
  crew where it stood. The deck draws at most 30 frames a second, nothing while the window is hidden,
  12 on a software renderer, and holds still under reduced motion. With the switch off, the screen is as
  it was.

- The ship deck preview (still behind `FIRSTMATE_SHIP_DECK=1`, off by default) draws the approved
  generated art in place of placeholder shapes: hull C's deck, and a sailor sprite per live crewmate,
  posed by state (hauling, arms folded by the helm, standing in the bow, leaning at the rail), in one of
  two outfits. A barrel, a crate and a coil of rope stand on deck. Sailors are depth-layered against the
  mast, the bollards and the near rail. The art is one 84 KB atlas the daemon serves through the new
  `firstmate.deck.art`, refused while the switch is off, so the client bundle carries none of it. With
  the switch off, the screen and every RPC answer are as they were.

### Fixed

- **A busy journal no longer pins a core re-checking its whole history every few minutes.** The
  routine recovery check, about once a minute, skipped its full audit only while the journal was
  completely unchanged, and the plugin's own routine observations change it every few seconds; so
  on the owner's 17,000-event journal it replayed everything (about 150 s of the main thread) almost
  back to back, and the board and Needs you timed out between. That check now verifies only what
  was written since it last looked, chained to what it had already verified, and pins everything
  older by its files' identities, names and coordinator records; the full replay stays at startup,
  after any doubt, and hourly. A tampered, missing, added or reordered journal file still holds the
  journal at the next check, except an edit in place inside an older full page, which the hourly
  full check catches. Also, a repeated observation
  that changes nothing is no longer written, and a worker list that is merely slow is no longer
  recorded as a failed read (only one stalled for 5 minutes is), which had rewritten every
  worker's record twice a minute. Each journal write is also about five times cheaper: sizing the
  projection against its limit re-serialised all of it (37 MB on the owner's journal) several times
  per write, and now sums sizes it has already measured.
- **The held journal recovers even while the anchor-migration backup is kept.** A home still inside
  the one-time anchor migration's 7-day rollback window refused to finish an interrupted final
  publication ("Anchor migration is incomplete"), so the journal stayed held and every write and
  scoped read stayed degraded. The checked recovery now runs; any other journal problem still holds.
  A refused recovery for the same held head now waits 5 minutes, then doubles up to 6 hours, rather
  than paying two full journal audits every 5 minutes.
- **Idle CPU from plan reads.** The one-second workflow clock read every plan by statting every file
  (16,000 on a large home), keeping about a core and a half busy at idle. An unchanged plan is now
  recognized from its directory listings and newest files; every file is still rechecked every 5 minutes.

- **A plan run cancelled before it ever launched can run again.** When a start was recorded
  `cancelled` with no claim, launch record, worker or workspace (for example, to re-pin its model after
  you changed the crew model), `workflow.mjs start`, a relaunch and a gate-preserving revision all
  refused, so the plan could never continue. `replace --kind relaunch` now accepts such a run: the
  cancelled attempt stays in its history and its budget stays spent, the run returns to planned so a
  revision can re-pin its agent, and its gates are untouched. A claimed attempt still needs inspection.

- **Needs you no longer reads a slow plan read as hidden decisions.** While plans are still loading
  the count shows what is known ("Needs you · 3 · checking plans"), not "3+ · some plans unavailable",
  and recovers on the next poll. A plan that genuinely cannot be read still shows its lower bound. The
  board's fleet load now waits for plans at most the same budget as the decisions read, instead of
  running past the host's RPC limit on a cold start.

- **A handover arms its delivery gate before it checks evidence.** The deliveries checked are now
  exactly those frozen; a pending message no longer changes from queued to unknown in between.

- **Plans graph:** long edges arriving at one level keep separate heights (now covered by a test), and
  another plan's removed step can no longer hide a live step with the same id.

- Idle recovery no longer replays the supervision journal every minute or rewrites unchanged
  worker observations. Heartbeats audit on change and hourly, and share one audit across a
  recovery pass. Failed timeline reads back off, and closed workers are not repeatedly reopened.

- **A plan handover's checked evidence no longer goes stale by itself.** Its inventory fingerprint
  included how full the shared supervision journal was, which every other plan, timer and check moves,
  so a first mate's prepare was refused with "Handover evidence changed" seconds after reading it, with
  nothing about the plan changed. The fingerprint now covers only what the handover depends on —
  pending deliveries, work starts, dependent steps and the plan's own capacity needs — and the journal's
  room is checked live when the handover is prepared. A real change to any of those still refuses.

- **A plan Supervisor no longer sits idle after a worker finishes.** When enough facts piled up for
  one page, the page plus the Supervisor's own context came to more than the 24 KiB a wake may carry,
  and every wake from then on — restarts included — was refused, so the Supervisor waited until
  someone nudged it. Pages now leave room for the wake's wording, and a page that still does not fit
  is delivered without the optional context instead of not at all. A Supervisor's state read now
  shows its workers' launch effects, so a launch that reconcile settled as failed is visible, and a
  wait for someone to settle a launch that has already ended is refused rather than recorded.
- **A Supervisor's question for you now shows in Needs you.** Home's List and Board counted a plan
  Supervisor's decisions and paused plans in "Needs you · N" but never drew them, so the count was one
  higher than the list and the question could only be found under the decision drawer's All. They are
  now drawn with their own answer controls, right after the plan decisions, and the drawer's "1 of N"
  and ‹ › reach them too; answering the last backlog decision moves on to them instead of closing.
- **Decisions load promptly after a restart.** Every plan read re-checked the whole Supervisor journal
  from scratch, about three seconds each time on a large home; at startup several ran at once and the
  decisions read gave up with "Plans are still loading". Plan reads now share the plugin's already
  checked copy and read it alongside the plans. Measured on a copy of a large home: the startup
  decisions read answers in about 6 seconds instead of timing out at 10, and a later read takes half
  a second instead of three.
- **A restart no longer replays the whole Supervisor journal before Needs you can answer.** The
  last fully validated projection is kept in a derived `projection-cache.json`, bound to the
  checkpoint that witnessed it; a cold read recomputes the projection (vector included)
  and the ownership digest from the cached frames themselves and witnesses every cached
  index entry against its hash-verified anchor, and the retained ownership set must
  equal the anchors' recorded ownership digests exactly (a forged
  or edited cache is rejected at load, never served), re-binds it to the on-disk checkpoint
  and anchor chain, validates the tail, and serves frame-derived reads, while a background
  audit re-verifies every event and anchor up to the served prefix off the read path and
  compares the frames, transaction index and ownership actually served against the
  replayed journal. History pages, request-replay and receipt lookups and every write wait for that
  audit (before the store lock, so reads are never frozen behind it), so nothing commits
  on top of unverified cache contents, and a divergence holds the journal loudly for the
  durable beyond the checkpoint (a crashed partial publication) still forces the ordinary full
  scan. Measured on a copy of the large home at 4,584 transactions: the first decisions snapshot
  answers in about 6.6 s after a restart (journal part about 1.3 s from cache, against 13.5 s for
  a full check and 33 s before the anchor migration below), so "still loading" no longer outlives
  the 15 s budget. The one-time anchor migration is also safer to interrupt: the audit runs
  unlocked while the old form keeps serving, replacement proceeds in bounded chunks with the
  /1 originals kept under `anchor-backup/`, a failure — thrown or reported held — releases
  the coordinator claim without registering the writer so the next writer retries, and
  `rollbackAnchors` restores the pre-/2 form an older plugin can read: backed-up anchors
  over the migrated prefix, and the post-migration tail converted in place (events and
  anchors rewritten /1, whole ownership re-derived from replay; converted transaction
  hashes change, so receipts already issued for them stop matching — reported in the
  result). The rollback itself is crash-safe: replacements are staged and a conversion
  receipt published before any swap, the new checkpoint written before anything is
  deleted and the conversion receipt deleted last, so an interrupted rollback — even
  one interrupted during cleanup, after the migration receipt is gone — resumes and finishes
  instead of stranding a half-converted journal. New records are always /2; nothing is
  pinned to the old format. The backup (about a journal's worth of /1 originals) expires
  automatically a week after migration on the next verified writer, or earlier by
  deliberate discard. The migration also writes the restart cache over the new checkpoint,
  so the first restart after it is a cache restart,
  not another full check. On that journal the migration took about 132 s including backups
  of the 568 MB of originals; at 5,355 transactions (747 MB in /1 form) it took about
  161 s, the migrated journal is 23 MB, a restart from the cache reads in about 2 s
  including the load-time recomputation, and an uncontended cold full check takes about 16 s.
  At 5,757 transactions (827 MB in /1 form) the migration took about 182 s, the migrated
  journal is 24 MB, the first restart after it reads in about 2.2 s with the load-time
  witness checks, and an uncontended cold full check takes about 20 s.
- **The Supervisor journal's anchors stop growing with its history.** Each transaction's tip and
  publication used to embed the whole retained ownership — 89 KB apiece at 3,349 transactions,
  duplicated in both files: 365 MB of anchors over 7 MB of events, so the journal's bytes and its
  restart check grew faster than its transaction count, and a restart still showed "still loading"
  past the decisions budget. New anchors (`/2`) carry only the ownership contributions their own
  transaction changed, the full ownership digest, and an incremental projection-set hash that is
  verified at every transaction instead of every 64th; new events record that set hash as their
  projection hash, so a self-consistent rewrite between the old spot-check points is caught at the
  transaction it rewrites. Existing journals are upgraded in place by the first writer after
  install: a full audit first (every old projection hash included), a published
  `anchor-migration.json` receipt binding old and new anchor hashes to the unchanged event head,
  atomic per-file replacement (an interruption leaves a readable mixed journal the next writer
  resumes from the receipt), then the derived checkpoint rebuilt over the new prefix. Events and
  transaction receipts never change. Whole-projection replay validation also stops re-parsing and
  re-hashing unchanged rows on every transaction (identity-keyed caches). Measured on a copy of
  the large home at 3,349 transactions: the journal shrinks from 355 MB to 15 MB, one cold check
  takes about 6.5 s instead of 17.3 s (23.0 s on a cold disk cache), and the first cold decisions
  snapshot answers in about 10.4 s, inside its 15 s budget, instead of giving up. At twice the
  journal the bytes grow linearly (about 29 MB, against well over a gigabyte extrapolated for the
  old anchors); the remaining cold-check time is replay's whole-projection semantic validation,
  which still grows with the frame count.
- **Needs you stops reporting "some plans unavailable" long after a restart, and in the middle of
  ordinary plan work.** Checking the Supervisor journal from scratch had become the slow part of a
  decisions read: replay copied and re-serialized the whole projection once per transaction, the plugin
  paid that full check several times at startup (its status reader, its writer, and again after the
  writer claimed its coordinator), and every legacy plan write paid it once more inside the writer's
  lock. On a large home each check took tens of seconds on the one thread, so Needs you answered with
  an incomplete count, Supervisor questions showed "Some work couldn't be checked", and
  `firstmate.scope.needs` could take 25 s or time out on a warm process while plan writes were under
  way. Replay now replaces rows instead of copying them and reuses each unchanged row's canonical
  bytes, anchors verified in a scan are not re-read by the same scan, the runtime's writer adopts its
  reader's completed check (and absorbs its own coordinator claim), plan writes and read-only views
  share warm readers, legacy plans read a few at a time, and the decisions read's plan budget is 15 s
  of the host's 30 s. Replay hash work is now linear in the bytes it reads: the whole-projection hash is checked at the head and every 64th transaction (the value the checkpoint binds) instead of re-hashing the whole projection per transaction, ownership hashes reuse each row's cached bytes, capsules are collected during the chain walk with a fallback pass only on failure, publications are pinned to their checked tip without a second schema walk, every read-only view shares the runtime's one current store, directory signatures use durable names instead of Windows-flappy write times, and the combined decisions read has one end-to-end deadline. Measured on a copy of the large home at 2,271 journal transactions: one
  full journal check takes about 8.6 s (about 200 MB peak heap for the check) instead of 50–58 s and about a gigabyte on the previous code, and runs once per start instead of three
  times; a warm plan write takes about half a second instead of paying a full check; the first
  decisions read still answers honestly as "still loading" only while that one check runs.
- **Plan Supervisors are answered straight after a plugin restart or install.** A freshly started
  plugin used to leave an attached Supervisor's scope requests — even a read — unanswered until some
  unrelated agent event arrived, unless `FIRSTMATE_PLAN_BOOTSTRAP_URL` was configured. The scoped
  clock now answers every request that needs only the plugin's records at once, and holds only those
  that start, recover or stop a worker until Paseo hands it a connection; none is refused or sent twice.
- **Plan help no longer asks you to refresh Needs you.** It checks your decisions itself and waits a
  few seconds for the backlog to settle. The first mate recording workers, start dates, tags and notes
  in the backlog no longer keeps it from settling; adding, moving or changing a task still restarts the
  short wait. A damaged or missing row holds the handover only when it belongs to that plan (current or
  removed steps) or has no readable task id, and the message quotes the row's own problem and line.
- **The shark keeps you on deck.** Clicking its body or speech bubble, or choosing its keyboard Focus action,
  zooms to the selected worker and opens the crew focus panel in place.

- **The deck ladder sits against the mast, behind the sail.** Its climb follows the mast's vertical axis;
  the below-deck sleeping crew and the rest of the ship's art stay unchanged.

- **An image you send the first mate now shows in the chat.** A screenshot attached, pasted or dropped
  used to vanish from the conversation once sent — the first mate got it, but your message showed its
  words alone, or "(attachments)". It now shows under your words, sized to its shape, as in Paseo's own
  view. Like Paseo's, the copy is kept on the device that sent it until the app restarts.

- The ship deck preview no longer shrinks by a third when its pane is dragged a little narrower: it
  scales smoothly and fills the same share of the pane at any width.

- FirstMate chat and Watch keep separate assistant messages apart, including a worker-triggered
  turn whose system prompt Paseo omits. Continuous streaming chunks still join without added
  whitespace, preserving Markdown through snapshot refreshes and reconnects.

### Added

- A preview of the ship deck, behind `FIRSTMATE_SHIP_DECK=1` and off by default: a **Deck** beside Crew
  and Files on the desktop app's wide layout, with one sailor per live crewmate on a plain deck, drawn by
  PixiJS 8 on a WebGL canvas and placed by its card's column, from the cards the board already loads.
  The daemon serves Pixi's browser build (`vendor/pixi.min.js`) through `firstmate.deck.engine`, so the
  client bundle carries no Pixi, and a phone's Hermes never parses it. A phone, a narrow window or a
  display without WebGL gets a plain sentence instead. With the switch off, the screen and every RPC
  answer are as they were.

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
