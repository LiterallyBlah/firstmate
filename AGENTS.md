# AGENTS.md

A Paseo plugin that adds a **FirstMate** screen: a conversation with one "first mate" agent
beside a board of the "crew" of agents it runs, each in its own git worktree. A Paseo-native port of
[kunchenguid/firstmate](https://github.com/kunchenguid/firstmate) — the agent distro — by way of
[ABorakati/paseo-firstmate](https://github.com/ABorakati/paseo-firstmate), which was a dashboard over
that distro's bash scripts and does not install on Paseo 0.9.

The repo root `AGENTS.md` covers what every plugin here shares: the per-folder npm layout, the
typecheck/reload loop, the client/server bundle split, and the constraints nothing catches at
compile time. This file covers only what is specific to `firstmate`.

## Orientation

| File                          | What it owns                                                                              |
| ----------------------------- | ----------------------------------------------------------------------------------------- |
| `index.server.ts`             | Wiring — the RPCs, the display settings document, the steer relay hook.                    |
| `index.client.tsx`            | Wiring — the screen, sidebar item, two panels, settings screen, ⌘K items, `/fm` `/bearings` `/ahoy`. |
| `shared/fleet.ts`             | Every RPC contract, the card/fleet shapes, the daemon config shape, and `CREW_LABELS`.     |
| `shared/settings.ts`          | The host settings document: List/Board, column order and folds, the chat's width, the poll interval, card spacing. |
| `templates/`                  | **Every file the plugin writes into the home**, as Markdown laid out as it lands there, and the parts that go inside them. The first mate's behaviour is `templates/data/charter.md`. |
| `server/templates.ts`         | Finds `templates/` — through `paseo plugin ls`, since the compiled plugin cannot say where it lives — and reads it. |
| `server/charter.ts`           | Renders `AGENTS.md`: the charter's placeholders filled, under its heading note.            |
| `server/charter-file.ts`      | `data/charter.md`, the captain's copy it is rendered from: follows the plugin until edited. |
| `server/home.ts`              | The home directory: writes the charter and records, reads the backlog and project registry. |
| `server/backlog.ts`           | `data/backlog.md` → `BacklogItem[]`. Lenient, because an agent writes the file.            |
| `server/suggestions.ts`       | `data/suggestions.md` → `Suggestion[]`, the board's next-step buttons, and taking one out. Lenient, likewise. |
| `server/crew-report.ts`       | A crewmate's closing status line (`done: PR …`) → state and text.                          |
| `server/fleet.ts`             | The board: first mate, crew by label, backlog, status lines → cards in columns.            |
| `server/remote-cards.ts`      | Remote work as cards: a backlog line's host resolved, joined to its worker, filed by the same rules. Pure. |
| `server/remote-crew.ts`, `shared/remote-crew.ts` | A remote card's Steer, Interrupt, End and Watch, through `RemoteService.request`. |
| `server/remotes.ts`, `shared/remotes.ts` | Saved remote hosts: the daemon-side connections, the minute poll, the helper's request queue. |
| `server/mate.ts`              | Launching, adopting and releasing the first mate; carrying the captain's words to it.      |
| `server/crew.ts`              | Steer, interrupt, end, relaunch one crewmate; the relay that tells the first mate about a steer. |
| `server/crew-seen.ts`         | Clears a crewmate's "finished" flag once a later first-mate turn has completed.            |
| `server/watches.ts`           | The watch runner: the minute timer, runs, the queue, `<firstmate-watch>` notes, `watches.json`. |
| `server/watch-service.ts`     | The runner wired to Paseo: the kept Paseo handle, delivery to the first mate, the on/off switch. |
| `server/watch-files.ts`       | `watches/`: which files are watches, their `schedule:` line, seeding the built-ins.        |
| `server/watch-schedule.ts`    | A crontab line → `Schedule`, and whether a local minute matches it. Pure.                  |
| `server/watch-run.ts`         | One script run: its own process group, a timeout, stdout capped, stderr's tail.           |
| `server/process-launch.ts`    | Windows desktop/npm CLI entry points and native Node watch launches, without a shell.   |
| `server/send.ts`              | Sending to an agent without interrupting its turn where the provider allows (`"steer"`), and each send's receipt. |
| `server/receipts.ts`          | The receipt journal behind `FIRSTMATE_RECEIPT_JOURNAL` (off by default): hash-linked entries, the generation and record ledgers. |
| `server/receipt-observers.ts`, `shared/receipts.ts` | What the journal observes — the first mate's tool calls, uncertain native finishes — and the read-only timeline-page RPC. |
| `server/ship-deck.ts`, `shared/ship-deck.ts` | The ship deck's switch, `FIRSTMATE_SHIP_DECK` (off by default), carried on the fleet load; `firstmate.deck.engine` serving `vendor/pixi.min.js`, `firstmate.deck.art` serving `art/ship-deck/`. |
| `client/ship-deck.tsx`        | The Deck pane: the canvas's view, its status in words, the counts below it.                 |
| `client/deck-scene.ts`        | Cards → sailors on hull C, by column, greyed when their feed is lost; the depth order of everything on deck; whether the screen offers the Deck. Pure. |
| `client/deck-geometry.ts`     | Hull C's walkable deck, its obstacles and named anchors; A* paths; a spot beside a shared anchor. Pure. |
| `client/deck-crew.ts`         | The crew in motion: anchors reserved, the state shown at once and walked to after, the hatch, idle motion, each frame's poses. Pure. |
| `client/deck-ambient.ts`      | The sea, the bob, the masthead's sway, the lanterns, the gulls, as functions of the clock; the motion plan. Pure. |
| `client/deck-loop.ts`         | When the deck draws: 30 fps at most, paused while hidden, still under reduced motion.     |
| `client/deck-mount.ts`        | The canvas put into a react-native-web view; WebGL probed; Pixi's served build evaluated and the atlas decoded; every failure a status. |
| `client/deck-pixi.ts`         | The deck, its depth pieces, props and sailor sprites drawn with Pixi, handed in through a narrow `PixiModule`. |
| `art/ship-deck/`, `docs/ship-deck-art/build-art.py` | The deck's art: one atlas and its manifest, built mechanically from the approved generated PNGs. |
| `shared/attachments.ts`       | What the captain can attach: the message's shape, image-or-file by Paseo's rules, the size cap. |
| `server/uploads.ts`           | An attached file written to `$PASEO_HOME/uploads/`, described as Paseo's `uploaded_file`.     |
| `server/cli.ts`               | `paseo stop` and `paseo project rename`, for what the SDK does not have.                   |
| `server/home-name.ts`         | Names the home's project and workspace "FirstMate" instead of the folder's "home".         |
| `server/daemon-session.ts`    | One raw session request over the plugin's channel: clearing an agent's attention.          |
| `server/config.ts`            | `$PASEO_HOME/plugin-data/firstmate/config.json`, read on every call; the default home.     |
| `server/data-dir.ts`          | `$PASEO_HOME/plugin-data/firstmate/`, and moving the plugin's files out of `plugins/`.     |
| `server/serialize.ts`         | Runs the config update and each home file's save one at a time, per file.                  |
| `server/host-types.ts`        | Paseo types projected out of `@getpaseo/plugin`; see the root AGENTS.md.                    |
| `client/fleet.tsx`            | The screen: header, banners, chat/board split, compact tabs, the shared fleet query.       |
| `client/screen.ts`            | The screen's id, and the count of working, ready and idle crewmates on its sidebar row. Pure. |
| `client/sidebar.tsx`          | The sidebar item: the FirstMate row and its badge.                                         |
| `client/chat.tsx`             | The first mate's conversation, folded to the words, and the composer.                      |
| `client/draft.ts`, `attachments.ts` | The unsent message and what is attached to it, kept on `globalThis` across reloads.  |
| `shared/files.ts`, `server/files.ts` | The home as files: list, read, write — confined to the home, saved against the version opened. |
| `client/files.tsx`            | The Files view: the home's folders, a text editor, a Markdown preview.                     |
| `client/open-file.ts`         | The file open in the Files view, and what a save changes about it. Pure.                   |
| `client/permission-card.tsx`  | What an agent is waiting on — a question, a permission, a plan — answered in the chat or in Watch. |
| `client/questions.ts`         | The question form's rules, ported from Paseo's own card. Pure.                             |
| `client/keyboard.ts`          | How far the on-screen keyboard covers a view, measured in window coordinates.              |
| `client/keys.ts`              | Enter sends, Shift+Enter is a new line — web and wide layouts only, as in Paseo. Pure.     |
| `client/transcript-rows.ts`   | Timeline entries → chat rows. Pure.                                                        |
| `client/board.tsx`, `card.tsx`| Full-height board columns, and the shared card/row details and actions. |
| `client/task-list.tsx`        | The default grouped List: one scroll container, Done collapsed to a count. |
| `client/suggestions.tsx`      | The slim suggestion strip, overflow menu and full-prompt dialogs; send, expand and delete. |
| `client/suggestion-removals.ts` | Which suggestions have a removal on its way, by label and prompt. Pure.                  |
| `client/suggestion-fold.ts`   | Whether a folded suggestion card cuts its text, measured against an invisible twin. Pure. |
| `client/watches.tsx`          | The Watches header button and dialog: schedule, last run and output, and on/off switches. |
| `client/mate-send.ts`         | Sending to the first mate — Send, Bearings, Ahoy, a suggestion — one message at a time.    |
| `client/crewmate.tsx`         | Watch: one crewmate's card beside its live transcript, in the board's place.               |
| `client/remote-worker.tsx`    | Watch for a remote worker: its card beside its recent log, re-read every ten seconds.      |
| `client/host-tabs.ts`, `host-tab-row.tsx` | The board's host tabs: All, this machine, each saved host; what each shows. The rules are pure. |
| `client/remotes.tsx`          | A selected host's compact, expandable health line and the shared remote snapshot query. |
| `client/activity-rows.ts`     | Timeline entries → Watch rows, machinery kept: reasoning, tool detail, the latest plan. Pure. |
| `client/mate-controls.tsx`    | The context meter, Compact and Restart (with its confirmation), at the end of the chat's buttons. |
| `client/context-meter.tsx`    | How full the first mate's context is: Paseo's ring, built from views; the numbers in a tooltip. |
| `client/follow-end.ts`        | A streaming transcript that follows its end, brings a new request into view, jumps back.   |
| `client/launch.tsx`           | What shows before there is a first mate: launch one, or adopt a running agent.             |
| `client/panels.tsx`           | The workspace and agent panels: the crewmate's card beside its own tab.                    |
| `client/settings-screen.tsx`  | Settings › Plugins › FirstMate.                                                            |
| `client/markdown.tsx`         | A trimmed copy of `github-board`'s renderer, for the first mate's replies.                 |
| `client/markdown-parse.ts`    | The renderer's blocks, and the inline text in them — what `file-links.ts` walks. Pure.     |
| `client/file-links.ts`        | A reply's inline tokens, and the home files it names that the daemon (`firstmate.files.find`) says exist. Pure. |
| `client/option-picker.tsx`    | A copy of `herald`'s searchable picker, for the model lists.                               |
| `client/web.ts`, `resize-handle.tsx` | The chat/board split's drag (a copy of `github-board`'s); the chat's file picker, paste and drop. |

## The plugin never dispatches a crewmate

The narrow exception is an opt-in watch **inspector**, implemented in `server/watch-inspections.ts`:
read-only, parentless, with its own explicit workspace outside the home and `watch-inspector` labels.
It cannot inherit the supervisor charter or Paseo supervisory MCP tools. It receives a supplied board
snapshot, returns structured evidence, and is never crew. The current first mate alone acts on findings.
Typed routing contracts live in `shared/watch-routing.ts`; `watch-config.ts` and `watch-requests.ts`
persist definitions and the home tool transport. `docs/watch-routing/README.md` covers lifecycle and tests.

The first mate does, with **Paseo's own MCP tools** — `create_workspace` for the worktree,
`create_agent` for the crewmate, `send_agent_prompt` to steer, `archive_agent` to clean up. The plugin
gives it a home and a charter, starts it, carries the captain's words to it, and draws the result.
That was ABorakati's rule too ("the plugin deliberately does NOT dispatch crewmates itself"), and it
keeps authority in one place: the first mate owns intake, the brief and the backlog.

What that costs:

- **Paseo's agent tools must be on** — `daemon.mcp.injectIntoAgents`, **off by default** in Paseo. The
  board reads it through `paseo.config.get()` and offers a button that patches it on. A session gets
  its tool set when it starts or resumes, so a first mate launched before the switch needs a reload.
- **The charter is a contract with a model, not with code.** A weaker model can misuse the tools — a
  Haiku first mate on the test daemon tried to run `mcp__paseo__list_agents` as a shell command — which
  is why the charter names the tools and says outright that they are never shell commands.

## Supervision is Paseo's, not ours

**Archiving a parent can archive workers too.** Paseo 0.11 cascades to children in the parent's
workspace, recursively. A different `cwd` with `parent` alone still inherits that workspace. Create
an explicit separate workspace and pass its `workspaceId` (the SDK's workspace agent creation does
this) for a worker meant to continue independently. Cross-workspace children are detached on parent
archive and keep running. `server/migration.ts` refuses same-workspace children before preparation
and again before retirement; its unprompted replacement is created without a parent and checked
for independence and survival. Lifecycle fixtures must verify both refusal and preservation, using
only a throwaway daemon.

**A live agent listing is not an archive safety inventory.** Paseo 0.11 omits unloaded persisted
sessions on unregistered providers from `agents.list`, but archive still traverses those sessions
and can stop their running descendants. The shared migration/cancellation guard uses
`server/archive-inventory.ts`: paginated `fetch_agent_history_request` over the existing plugin
session channel, including unavailable persisted providers. It refuses archive on request/schema
failures or incomplete/non-progressing pagination, without falling back to the ordinary listing.

FirstMate's "zero-token supervision" was a bash watcher sleeping on status files. Paseo already has it:
when an agent creates or prompts another through the MCP tools with `notifyOnFinish` (on by default
for agent-scoped calls), the daemon sends the creator a `<paseo-system>` note when the child finishes,
errors, is closed or asks for a permission — with the child's last message, delivered with the same
`activeTurnBehavior: "steer"` described under *Sending without interrupting*. The charter tells the first
mate to keep it on and to read the crewmate's **status line**, the last line of that message.

Two gaps, and what fills them:

- **A turn the captain started from the board** was prompted by nobody Paseo knows to notify.
  `registerSteerRelay` remembers each steer (`CaptainSteers`, in memory, an hour at most) and sends
  the first mate a `<firstmate-board>` note with what was said and answered — on the first
  `agent.turn_ended` whose timeline **contains** the steer as a user message, and never on a cancelled
  one. The first turn to end is not always the answer: the one that was running may end first, and a
  provider that cannot steer cancels it. A steer whose send failed is taken back, so it is never
  relayed as said.
- **Nothing wakes a first mate whose crew went quiet.** The charter has it keep one `create_heartbeat`
  while work is under way.

The notification watches once per prompt. A crewmate prompted by hand in its own tab is not watched
by anyone; the heartbeat is what catches it.

## Sending without interrupting

`PaseoAgentHandle.send` **interrupts a running turn by default.** For the first mate that is wrong — it
may be halfway through a dispatch — so `server/send.ts` sets `activeTurnBehavior: "steer"`, which the
SDK declares since 0.11 (`PaseoAgentSendOptions` is the daemon client's `SendMessageOptions`); 0.9's
handle passed it through undeclared. Everything the plugin sends goes through it.

"Steer" is only as gentle as the provider. The message joins the running turn where the provider
can take one mid-turn; where it cannot, the daemon's `steerOrReplaceActiveTurn` **cancels** the turn
and starts a new one from the message. That is the same path Paseo's own finish notifications take,
so it is no worse than what the first mate already lives with, but it is not a guarantee — and it is
why the steer relay above cannot assume the first `turn_ended` after a steer is the answer to it.

## The crew is found by label

The charter tells the first mate to create every crewmate with the labels in `CREW_LABELS`
(`firstmate.role=crew`, `firstmate.task`, `firstmate.kind`, `firstmate.project`), and the board lists
`agents.list({ filter: { labels: { "firstmate.role": "crew" } } })`. The charter imports the same
object, so the two cannot drift. A crewmate created without them is invisible to the board, which is
the first thing to check when the board is empty and the first mate says otherwise.

A card joins a crewmate to its backlog line by the task label, or by the `(agent: …)` the line records;
whatever is left on either side is a card of its own.

**The first mate itself is found only by `config.mateAgentId`.** It is labelled
`firstmate.role=first-mate` at launch, for `paseo ls --label`, but the label is not consulted: the SDK
cannot take a label off, so falling back to it would bring a released first mate straight back.

**Home identity is checked afresh.** `templates/AGENTS.md` puts `node tools/role.mjs` before the
charter, including a customized one. The generated helper uses the daemon's rendered paths, the
config's actual input schema and the same current/legacy precedence as `dataPath`. Missing,
unreadable or conflicting identity is a guest; environment/labels alone never grant the role.
Canonical paths include Windows case and junction aliases. This is behavioral guidance, not
revocation of a guest's native tools. The board and native agent panel identify other home chats.

**Launch has a durable reservation.** `mateLaunch` saves ID, setup and opening before unprompted
creation. Only after checking the prepared session does config activate its identity and send the
opening. A lost create reply retries the same ID; an uncertain opening is never automatically
resent. Plugin sends/watches wait on the reservation. Release clears it without archiving the guest.
Keep this ordering when changing launch, restart or migration.

**Topic advisers remain unavailable.** The phase-0 evidence is `docs/topic-phase0/README.md`:
Claude plan failed native approval/mode/resume canaries. `server/adviser-profiles.ts` offers no profile.
`server/submissions.ts` is an unwired, content-bound journal library; it separates uncertain/recorded
delivery from intake and action receipts. No topic UI, transport or authenticated ack adapter is wired.

## The receipt journal is observe-only, and off by default

`server/receipts.ts` keeps a forward-only, append-only, hash-linked record of what the plugin sends, which
first mate was at the helm, what it sees the first mate do, and what it writes into the home — so a first
mate's calls can be bound to what it was told and what it changed. It runs only with
`FIRSTMATE_RECEIPT_JOURNAL=1` in the daemon's environment. **Off, nothing changes**: no file, no
`messageId` added, every send and write the call it was before (`receipt-paths.test.ts` holds the off
calls to the old ones exactly, and `receipts.test.ts` a prepared home byte for byte).

- **Shape.** `$PASEO_HOME/plugin-data/firstmate/receipts/NNNNNN/NNNNNNNN.json`, one canonical-JSON entry
  per file published by `submissions.ts`'s exclusive hard link (its `canonical`, `digest` and `publish`),
  each with its sequence and the SHA-256 of the canonical entry before it. Every shard of 1,000 opens
  with a `checkpoint` of the generation ledger, so a start-up reads only the newest shard;
  `verifyReceiptJournal` reads all of it and fails closed with a coded `ReceiptJournalError`.
- **Never in the live path's way.** A receipt is queued beside the operation and written after it hands
  off; a send's attempt is recorded before its result, so an attempt with no result is an uncertain send.
  A receipt that cannot be written becomes an `uncertainty` entry at the next good append; one a broken
  chain refuses goes to `receipt-uncertainties.jsonl` beside it. `observedSend` falls back to the off
  path if the journal throws, and `observedWrite` passes the write's own result and errors on untouched.
- **Sends** go through `sendWithoutInterrupting`/`observedSend` with a `receipt` (channel, actor). Ids the
  plugin already gave (opening, handover, notes, watches, inspections) are kept; a steer, an ask and
  `/compact` get `firstmate-<channel>-<uuid>`, never starting `firstmate-watch-`. A remote steer's id does
  not travel to the host (`carried: false`). A board steer's id rides in `CaptainSteers` to the relay,
  which records `steer-read` and a `note-queued` naming it.
- **Generations** are recorded where the plugin changes the first mate (launch, restart, adopt, release,
  handover) and, where the config changed without it (the role helper can), as `observed` at the next
  receipt. A receipt to a first mate is its generation's; any other the one at the helm when it happened.
- **Records**: `observedWrite` hashes before and after each plugin write into the home — the Files view,
  suggestions, item tags, `prepareHome`, the charter's copies, built-in watches, handoffs — under an
  `actionId` (`newAction`). An unchanged write records nothing. The first mate's own writes are not seen.
- **Observed, not sent**: the first mate's Paseo tool calls in a turn it ends (`mate-actions`, hashed
  detail), and a crewmate of it ending a turn (`native-finish`, always `certainty: "uncertain"` — the
  `<paseo-system>` note is in no timeline a plugin reads). `firstmate.receipts.timeline` pages the first
  mate's, a former first mate's or a crewmate's timeline through the SDK cursor and returns `gap`,
  `staleCursor`, `hasOlder` as Paseo gives them; it is refused while the journal is off and writes nothing.

## The ship deck is a WebGL canvas, behind `FIRSTMATE_SHIP_DECK`

A preview, off by default (`docs/ship-deck-canvas/README.md` and `docs/ship-deck-motion/README.md` have
the evidence). With the switch on, the
fleet load carries `shipDeck: true` (`withShipDeck`). Then the wide layout's Crew/Files switch gains
**Deck**, in a web renderer only (`deckOffered`). Off, the load is the same object with no key: the
browser harness holds the screen's DOM identical to main's. What it found applies to any client code:

- **The client bundle must parse under React Native 0.81's Hermes, so it has no `class` syntax.** A phone
  parses the whole bundle before any of it runs, and the host's `hermesc` refuses `class` with its
  default flags (it needs `-Xes6-class`). Whether the app turns that flag on at run time has not been
  checked on a device, so treat it as a constraint. esbuild lowers `async` for the client (the compiler's
  `supported`), but it cannot lower classes. Main's bundle has none. Pixi has them, so even lazily
  bundled it would risk the plugin on phones with the switch off. `docs/ship-deck-canvas/compile.mjs`
  runs Paseo's compiler and `hermesc` over both bundles. Check any new client dependency the same way.
- **A browser-only library is served, not bundled.** `vendor/pixi.min.js` is Pixi's own prebuilt build,
  shipped in `files` and held byte-identical to the pinned devDependency by `ship-deck.test.ts`; an npm
  dependency would add about 76 MB to every install. `firstmate.deck.engine` sends it as text (refused
  while the switch is off). `evaluatePixi` runs it with `new Function`, which needs the same permission
  as the app's own `(0, globalThis.eval)` of every plugin bundle. It runs once per session, only after a
  host and WebGL have been found.
- **The escape hatch is a childless `View`.** On the web, react-native-web hands a `View`'s ref the DOM
  element, so `mountDeck` appends Pixi's `<canvas>` to it by hand — no DOM JSX, no forbidden host module.
  React owns the element and nothing inside it. On native the ref has no `appendChild`, so the deck says
  where it draws instead.
- **Pixi's types cannot be imported into the project**: `@xmldom/xmldom`, one of its dependencies,
  references `lib="dom"`, which would quietly let all of `client/` use DOM types. `deck-pixi.ts` declares
  the narrow shape it draws with. The test holds that shape to the real build's prototypes, and the
  harness draws with it in Edge.

- **The art is served the same way.** `art/ship-deck/deck.png` (one atlas, about 84 KB) and `deck.json`
  (its manifest, checked against `DeckArtManifestSchema`) go through `firstmate.deck.art`, refused while
  the switch is off. They are fetched and decoded once a session alongside Pixi, never bundled.
  `docs/ship-deck-art/build-art.py` rebuilds them from the generated sources; `art/ship-deck/README.md`
  says where those came from and what still needs a pixel artist.
- **Depth is the deck row.** Scene coordinates are the hull's own pixels, and a sailor's `x, y` is its
  feet. The hull is the backdrop (in slices, so the masthead can sway). Its mast, bollards and near rail
  are cut out again as pieces, each with the row it stands on, and `depthOf` orders props, sailors and
  pieces by row. A new place on deck must keep its feet on the hull's deck and off the near rail:
  `deck-motion.test.ts` reads the atlas to check every anchor, however crowded. `docs/ship-deck-motion/render.mjs` compares the still (reduced-motion)
  WebGL canvas to an independent 2D composite, art pixel by art pixel.

Leaving the Deck destroys the application and its canvas. A mount torn down mid-start destroys whatever
starts.

### The deck moves (`docs/ship-deck-motion/README.md` has the evidence)

- **State and movement are separate.** The scene says what each sailor is doing (`DeckSailor` has no
  position). `applyCrew` sets the new state at once, so the mark under the feet and the legend change on
  the poll; the sprite then walks to the state's anchor at 32 px a second, re-planning from wherever it
  is. A test holds the state ahead of the position.
- **Anchors are named and reserved** (`ANCHORS` in `client/deck-geometry.ts`): stations round the mast
  and the stores, rail spots, helm spots on the quarterdeck, bow spots. A sailor takes the nearest free
  one; when a place is full it stands beside a taken one (`sharedSpot`), never on it and never on the
  stairs. A new anchor must stand on open deck: `deck-motion.test.ts` reads the atlas for every anchor,
  every walkable cell and every path between any two anchors.
- **Walking is A* over a 2 px grid** of three hand-drawn polygons (main deck, stairs, quarterdeck) minus
  obstacle footprints, pulled tight. The only way to the helm is the stairs, which belong to the `near`
  piece, so a climbing sailor passes behind their balustrade.
- **Depth is set every frame.** The deck's layer sorts by `zIndex` from `depthOf(row, rank)`, so a
  walking sailor goes behind the mast while its feet are on or behind the mast's row and in front after.
- **The hatch.** Crew already aboard when the Deck opens are simply there. A crewmate that joins later
  climbs out of the hatch (its sprite cropped to the rows above the grate) and walks to its anchor; one
  whose card leaves the deck walks back and climbs down.
- **Stale never reads idle.** A failing fleet load (`fleet.error`) greys the whole crew, a remote host
  offline greys its workers: the last state stays, the sprite greys, the mark goes hollow, idle motion
  stops, and the pane says the feed is lost.
- **When it draws** (`deckAnimator`): `requestAnimationFrame`, capped at 30 fps; nothing at all while
  `document.hidden` or the pane has no size; no loop under `prefers-reduced-motion: reduce`, where the
  deck is drawn once per change with everyone at their anchor; 12 fps with no sea drift or gulls on a
  software renderer (SwiftShader, llvmpipe, read from the WebGL context). The canvas carries
  `data-firstmate-deck-motion`: `full`, `lite` or `still`.
- **Ambient life has no shaders**: whole-pixel bob and sway, pre-drawn wave rows that scroll, three
  lanterns, a gull now and then, so a software renderer pays only for sprites. The masthead sways because
  the hull is drawn in slices with it cut out (`MASTHEAD`).

## Remote work is on the board

Work on a saved remote host (see README's *Remote hosts*) is filed in the same columns as the local
crew. A backlog line names its host with `(host: …)` — the charter's spelling — or `(on-host: …)`, which
first mates have written too; both parse into `BacklogItem.host`. The value is whatever the first mate
wrote: a serverId, a label, or "Label serverId". `resolveHost` (`server/remote-cards.ts`) tries an exact
serverId, an exact label, a serverId among its words, then a label among its words, each only when one
host matches, so an ambiguous value is never guessed; this machine's own serverId is local work. A line
whose host is not a saved one still gets a card, with `serverId: null`, in its section's column (`backlogPlacement`).

`buildCards` never joins a remote line to a local crewmate, since task ids repeat across hosts.
`buildRemoteCards` joins it to a worker in the remote snapshot (`RemoteService.read()`, in memory, polled
about once a minute) by the agent id the line records (a prefix of seven or more counts, as `paseo`
accepts) or the worker's `firstmate.task`. The column is `crewPlacement`'s, fed the worker's status and
pending permissions and the status line `remoteReport` finds in the log tail the poll keeps — only after
the last `[User]` or `[Thought]` paragraph, so a prompt saying "done:" is not a report. Cards are keyed
`remote:<serverId>:…`, and a remote card has `remote` and never `agent`, so no local action can be
pointed at another daemon's id.

The snapshot's optional fields are used where the poll has them: `lastMessage` — the worker's last
message alone — is read for the status line before the log tail (`workerReport`), and
`pendingPermissions` (id, tool, description) counts toward Blocked and is spelled out on the card. A
`followed` entry is one of the captain's own sessions the first mate follows (`data/remote-follow.json`),
not crew: its card says so, it joins a backlog line only by agent id, the sidebar does not count it, and
End is off on the card and refused by the server. While a permission is pending, the worker's
`recentTools` — its latest tool calls, which show a waiting Bash command — are listed on the open card.
A host's `clockSkew` (host time minus this machine's, measured on each remote `run`) moves
the card's "updated" time onto this machine's clock, and a skew of three minutes or more, the helper's
own warning threshold, gets a line in the host's health.

**The task label takes a lookup.** `paseo ls` and `inspect` print no labels, so the poll asks the
other way round: for each unfinished line on a host whose worker is not known by agent id or an already
learned task (`remoteTaskQueries`, given to `RemoteService` by `index.server.ts`), one
`ls --label firstmate.task=<id>`, ten a poll at most, and the task stays on the worker after. A line that
records its agent id costs nothing.

**Actions** go through `RemoteService.request` with the worker's serverId — its allowed commands, its
target and credential handling, one attempt — and only to a worker the last poll found this first mate
owning on that host (`server/remote-crew.ts`). Steer is `send <id> -- <words>`: after `--`, as the helper sends a prompt,
the request path keeps the words out of its option checks and puts its own flags before them, and the CLI
reads them as text even when they start with a dash. Interrupt `stop`, End `archive`, Watch `logs --filter text`, re-read every
ten seconds while open. The plugin cannot see a remote turn end, so a steer is relayed to the first mate
at once (`templates/messages/remote-steer.md`) rather than with the answer. Relaunch is drawn disabled
with its reason: a new worker there needs a brief only the first mate can write. Steer, Interrupt and
End are off while the host is unreachable, and End always on a followed session. Errors are the request path's own — the remote CLI's
message, redacted — and anything still shaped like a password or pairing link becomes "Remote command failed".

**Host tabs.** With remote hosts saved, a row above the columns — All, This machine, then each host by
label, with an online or unreachable mark and its working and blocked-or-failed counts — filters the board
(`client/host-tabs.ts`). The choice is `hostTab` in the display settings; a saved host that is gone shows
All. A host's tab shows a one-line expandable health summary (reachability, worker count, clock warning),
with connection details on expansion and no duplicate worker list. All uses the tabs alone for health.
No hosts, no row.
The sidebar badge (`activeCrewCount`) counts remote workers like local ones.

## Status lines are read on the daemon, cached by `updatedAt`

`ReportCache` fetches a crewmate's timeline tail only when its `updatedAt` has moved and it is not
mid-turn, so a poll every few seconds costs one agent listing and nothing else while the crew is
quiet. `closingText` joins the assistant messages at the very end — a streamed reply arrives in pieces
that split anywhere, even mid-word — and `parseCrewReport` looks for the status line only in the last
few lines, so "the build is done: …" earlier in a message is not a report.

Columns (`crewPlacement`): a pending permission, an error or a running turn win (blocked, failed,
working); once the turn has ended the status line decides:

- `done:` or `resolved:` is **Ready** — finished, waiting on the first mate. **Done** is for work the
  backlog records as Done, and a crewmate that has reported done is still alive and In flight until the
  first mate lands it and moves the item. Its card keeps the status line and the item's hold, so
  "Done: PR …" still reads on it from Ready.
- `working:` or `paused:` that names a wait on something outside the worker — a gate, a run, a watcher,
  a background job, another worker, "until …" (`waitTarget` in `server/crew-report.ts`) — is
  **Working**, chip "waiting": workers often end their turn while a job they started runs on, and these
  read as Idle before. A wait on the captain is Blocked, on the first mate Ready.
- `working:` with nothing to wait on is a stall: **Idle**, chip "stalled". An ended turn with no status
  line is Idle too, and any other `paused:` is **Parked**.

An in-flight backlog item the board cannot match to a worker (`backlogPlacement`) — a session it does
not list, a host it cannot read — is Working with the chip "no worker seen", since nothing says it has
stopped; with a `(hold: …)` it is Blocked. The chip's word is the card's `note`, set only where the
live status alone would not explain the column. Ready came after the other seven, so a saved
`columnOrder` without it gets it at its end (`orderedColumns`). Remote workers, followed sessions
included, are placed by the same function; a followed session is marked as followed on its card.

**List is the default** (`crewView` in the display settings, defaulted even for an existing document).
`client/task-list.tsx` groups tasks by `listGroup`/`listGroups` in `client/format.ts`: Needs you (Blocked,
Ready, Failed, a captain hold, a permission or an error), Working (including waiting), Queued,
Idle / stalled (Parked too), then Done. Empty groups are hidden. Each row is `CrewCard` with
`presentation="row"`: a state icon, a one-line title at rest, project/host tags, relative time and
the same `cardHeadline`. A full-title web tooltip goes through `webTitle`; React Native Web drops
the `title` prop, so the web boundary sets the attribute on the forwarded DOM ref. Its accessibility
label carries the full title and status. Pressing expands the same details and actions; they are
siblings of the toggle button, so actions never also fold it. Card memory and drafts survive
switching views. One `ScrollView` owns the entire list, including expanded details and Done.
Done starts as a single count with Show, expands all tasks in place, and uses `doneCards`' date order.

The header's List/Board switch saves `crewView`. Board draws only columns with a card in them,
folded or not (`board.tsx`), in one full-height horizontal row on wide screens, with a 300-point
minimum width per open column and horizontal overflow. Headers and counts cannot shrink or wrap.
There is no enclosing column box around the cards. A folded column is a 44-point strip; on phones,
columns stack in one scrolling view. Suggestions and watches are outside both task layouts. The saved
`columnOrder` still holds all eight. A header's arrows reorder the *shown* columns (`moveColumn` with
`shown`): the moved column hops past any hidden neighbour to land beside the next shown one, and the
hidden ones keep their place relative to each other, so a press always moves something on screen and
no column's slot is lost while it is empty.

**A card at rest is a glance.** The captain found the board too dense, so a card shows its title (two
lines at most), its state chip — the card's `note` ("waiting", "stalled", "no worker seen") in
the column's colour where there is one, else the agent's status — its project and host as quiet tags
(`Tag` in `ui.tsx`), when it last moved, and **one** line from `cardHeadline` (`client/format.ts`): a remote permission waiting, else
an error, else the captain's call (`hold`), else the status line, else what an in-flight item without a
worker or a queued one waiting on another says. So a crewmate held for the captain reads "Captain's
call: …" at rest and its "Done: PR …" only when open. Everything else — kind, task id, blocked-by,
mode, since, model, the agent id, every one of those lines in full, the pull request, the report path —
is in the open card, above its actions; the Watch view and the workspace panels open it already.
Pressing the card is still the only way in, and its accessibility label carries the title, status,
project, host and that one line, since the clipped text is not read out.

Board cards keep their border, including in a light theme; open columns have no enclosing box.
Board's **Done** shows `DONE_SHOWN` cards, newest first by
the date in the backlog line's outcome or since (`doneCards`), then the agent's `updatedAt`, with
undated ones last in file order — the backlog's own order says nothing about recency — and a **Show
all** that is kept in module scope like the rest of the surface. **Card spacing** (`density` in the
display settings, Settings › Plugins › FirstMate) is Comfortable or Compact and changes padding, gaps
and the title's size only, never what a card shows.

## The first mate is told it lives in Paseo

Charter §0 says what the first mate cannot work out for itself: that it runs inside Paseo, and that
Paseo — not its memory or its records — is where the captain's projects, workspaces, agents,
providers and schedules are. It names both ways in: the MCP tools for acting on the crew, and the
`paseo` CLI for looking things up, with the exact commands. Without it a first mate asked "which
projects do you know?" answered from `data/projects.md` alone. So the registry now holds only each
project's delivery mode; which projects exist is `paseo project ls`.

The crew is listed with `paseo ls -g --label firstmate.role=crew`, not the MCP `list_agents`:
that tool defaults to the last 48 hours and 50 agents, and a crewmate older than that would silently
drop out of the first mate's view. Agents get `PASEO_CLI`, `PASEO_HOME` and their own
`PASEO_AGENT_ID` in their environment (seen on 0.9.1), which is what the charter points at.

## The templates

**No text the plugin writes into the home, or says to the first mate, lives in code.** `templates/`
holds, in three places:

- **The home's files**, laid out as they land there — `AGENTS.md`, `icon.svg`, `data/captain.md` and the
  other records, `data/charter.md` with its note, `data/charter.new.md`, and `watches/` with the built-in
  watches and the folder's README.
- **`parts/`** — the sentences that fill `{{crewProviderRule}}` and `{{crewModeRule}}` in the charter, one
  for a setting left open and one for a setting chosen.
- **`messages/`** — everything the plugin sends the first mate: the note a restart adds after the opening,
  the Relaunch request, the note relaying a Steer (with the words for an answer that was too long or
  never came), the note for a Steer to a remote worker, and Bearings and Ahoy, each with a second form for words typed after `/bearings` or
  `/ahoy`. A template cannot branch, so a message that reads differently when something is missing is
  two files. Bearings and Ahoy are worded on the daemon — the app cannot read the plugin's files — so
  the buttons, ⌘K and the slash commands send `firstmate.mate.command` with the command's name and what
  followed it, and `commandText` picks the template. A watch message has no wrapper: it is `watch-output.md`
  and `watch-failed.md` blocks one after another, led by `watch-dropped.md`'s self-closing
  `<firstmate-watch-dropped count="N"/>` when a full queue dropped some.

`TEMPLATES` in `server/templates.ts` names every one, and `templates.test.ts` fails if the folder and that
list disagree, or if `package.json` stops shipping the folder (`files` names it; a top-level directory it
does not name is silently left out of the npm package).

HTML comments in a template are notes for whoever edits it. Where a template becomes a message or a part
of another file, `withoutNotes` leaves them out, so each part and message starts with a note saying where
it goes and what its placeholders are;
where a template is copied into the home as a file, its notes go with it and speak to the captain.
Placeholders are `{{name}}` throughout, filled by `fill` in a single pass, which leaves any name it was
not given alone and never reads a filled-in value for placeholders — a crewmate's answer relayed through
a Steer can say `{{title}}` and arrives as written.

**Finding the folder is the one hard part.** Paseo compiles the server half into one CommonJS script and
evaluates it from memory: `import.meta` is an empty object in it (esbuild's CommonJS output), the process
runs in the daemon's directory, and nothing in the plugin API names the plugin's. The daemon knows, and
`paseo plugin ls --json` says — the folder of a directory install, and for an npm install the package
itself, inside the daemon's `node_modules` — so `templatesDirectory` asks it, once per process, through the
same CLI lookup as `paseo stop`. In the tests, where the code runs from its own files, `import.meta.url` is
real and the folder beside it is used. A failed lookup is not kept; the next call tries again.

Templates are read once per process, so a changed template reaches a home in use on the next reload, and
only as far as the home takes it: the charter is re-rendered, an untouched `data/charter.md` follows, and a
record the home already has is never rewritten.

Checked on a throwaway 0.9.1 daemon from the packed tarball, unpacked and installed as a directory: a home
got every file, `AGENTS.md` with no placeholder left; and on the real daemon a reload rendered the same
`AGENTS.md`, byte for byte, as the charter held in code before the move. An npm install of 0.1.0 lists its
`path` as the package folder in the daemon's `node_modules`, where `templates/` ships from 0.1.1.

## The home

`server/home.ts` writes `AGENTS.md` (the charter, **rendered from `data/charter.md` on every launch,
every settings save, every plugin start and every save of that file in the panel** — it names the crew's
model, and a charter change should reach a home in use without a relaunch; a running first mate still
has to be asked to re-read it) and creates `data/captain.md`, `projects.md`, `backlog.md`,
`suggestions.md`, `learnings.md` and `opening.md` only when missing, so a relaunch never loses a record. `data/captain.md` is the
captain's to edit and outranks the charter below its hard rules; that is where customisation that
should survive an upgrade goes.

**The default home is `$PASEO_HOME/plugin-data/firstmate/home`**, and it used to be
`$PASEO_HOME/plugins/firstmate/home` — Paseo's install root, deleted by `paseo plugin remove` (see the root
AGENTS.md). `migrateLegacyFiles` (`server/config.ts`) moves the config on start, and the old default home
only when nothing knows it by path: not while a first mate is aboard in it, since the agent keeps working
in the directory it was launched in, and not while `projects/` holds clones, which are Paseo projects and
registry entries by absolute path (and the roots of their crewmates' worktrees). Nor when the settings
name that very directory as the home. A home that has to stay is used where it is — `defaultHome()`
prefers it while `plugin-data/` has none — and the reason is logged on every start. A home the config
names elsewhere is never touched. The config and the home are each used from wherever `dataPath` finds
them, so one that failed to move keeps working where it is and moves on a later start. Once the old home has moved, the Paseo project
still registered at its old path is left for the captain to remove.

There is **no `CLAUDE.md`**. Claude Code and Codex both read `AGENTS.md`, and a `CLAUDE.md` importing
it risks the charter twice in every turn. The opening asks the agent to read the file if it is not
already in its instructions, for a harness that reads neither.

**The opening is the captain's.** A new first mate's first message — what it is told at launch and at
restart, before the captain has said anything — is `data/opening.md`, written once with the plugin's own
wording (`templates/data/opening.md`) and read at every launch by `readOpening`. It is a file
in the home rather than a setting because it sits with the captain's other records, is edited in the Files
view, and survives an upgrade. HTML comments are notes to the captain and are left out, which is where the
file explains itself; a file with nothing else in it — emptied, or deleted and not yet rewritten — gives
the template's wording, so a first mate is never started with nothing to act on. A restart appends its
note (`templates/messages/restart-note.md`) after it: the heartbeat that note asks for is not optional, so it does not depend on
what the captain wrote. The charter's records table marks the file as the captain's, so the first mate
leaves it alone. An existing home gets the file on the next plugin start, like any missing record.

**The charter is the captain's to edit, too.** `AGENTS.md` is rendered, so an edit there is lost at the
next reload; it is rendered from `data/charter.md`, which starts as `templates/data/charter.md` — the
plugin's charter under a note — and is the file to edit. The note lists the placeholders and records a fingerprint of the
plugin charter the copy was taken from, and that fingerprint is how `syncCharter` (`server/charter-file.ts`)
tells the two cases apart when a new plugin version changes the charter:

- **Untouched** — the copy still matches its fingerprint, so the captain never edited it. It is replaced
  with the new charter: a home nobody customised keeps getting the plugin's improvements.
- **Edited** — the captain's text is kept and rendered. If the plugin's charter has changed since the
  version the edit started from, the new one is written beside it as `data/charter.new.md` and the board
  shows a notice with **Compare**, which opens that file in the Files view (`firstmate.charter.compare`
  writes it first, so it is there even for a copy the sync has not seen yet), and **Done**, which moves the
  fingerprint on and removes the file (`firstmate.charter.acknowledge`). Done restores the note if the
  captain deleted it; a copy without one counts as edited from nothing, so every plugin charter is news
  to it.

An emptied or deleted copy goes back to the plugin's charter. HTML comments are notes, left out of both
`AGENTS.md` and the comparison, so the fingerprint is of the words alone and a note of the captain's own
does not count as an edit. The board reads the state on every poll (`readCharterState`, one small file);
only a sync or the two calls write. The charter's records table tells the first mate that both files are
the captain's.

The backlog format is the contract between an agent and `server/backlog.ts`. Changing one means
changing both, and the parser stays lenient: unknown groups are ignored, a line it cannot read is
skipped, and `(since …)` is accepted without the colon because that is how the charter spells it.

**A title never changes** (charter §2). In the demo dry run a first mate waiting for the word to land
two local branches wrote "…, ready in branch fm/…, awaiting captain's approval to land" into both titles,
and the cards grew with them. The charter now says where status lives — the section, the crewmate's
status line, and `(hold: …)` for anything waiting on the captain, which the card already shows as
"Captain's call".

## Watches run on the plugin's own clock

A watch is an executable script in the home's `watches/` folder that declares a crontab schedule in a
comment near its top (`server/watch-files.ts` says exactly which files count, and `templates/watches/README.md`
is the captain's documentation, env vars included). `WatchRunner` (`server/watches.ts`) ticks on every
minute's boundary and runs whatever is due, enabled and valid. Paseo's own schedules are no use here: each
fire prompts an agent, and a watch's usual run should cost nothing. The schedule is read in the daemon's
local time, and a minute the daemon missed is not made up.

**Output goes to the first mate only between turns.** Non-empty stdout is queued; a flush sends the whole
queue as one message, from `templates/messages/watch-*.md`, through `sendWithoutInterrupting`. It waits
while the first mate is `running` or `initializing`, or absent, and asks Paseo afresh before every send —
never assumes, since a note sent into a newer turn can replace that turn where the provider cannot steer.
The first mate's own `agent.turn_ended` tries the queue 1, 5 and 15 seconds later (`flushAfterTurn`: its
snapshot can still say running for a moment, and a crewmate's finish note may start a turn at once), and
every tick tries again. The queue holds `MAX_QUEUED` and counts what it drops, and one message holds at
most `MAX_MESSAGE_CHARS` (32,000), tags included: `fitWatchNote` keeps the newest blocks that fit and drops
the oldest whole, counting them in the same `<firstmate-watch-dropped>` tag and marking their watches
`dropped` on the card. The newest block always goes — two blocks at the 16,000 cap come to a little over
32,000 with their tags and marker, so only one is certain. **A run is one block**,
everything it printed, never a turn per line, and **a message carries nothing of the plugin's** — just
`<firstmate-watch name=… ran=…>` blocks one after another, oldest first, with the plugin's own facts
(a `failed=` block, a leading `<firstmate-watch-dropped count="N"/>`). How output is to be
read is the script's to say: charter §7 has the first mate take a script's own instructions as the
captain's, since the captain approved the script, and what it marks as quoted from others as information
only, so a script that relays outside text has to mark it (`pr-watch` prints its own line saying the
text it takes from GitHub — titles, check names, reviews, comments — is other people's, and prints every
piece of it JSON-quoted, so a hostile title cannot pass for a line of the script's own).

Two defences keep a watch message honest, and both are needed:

- **What a script prints cannot write a tag.** `quoted` (`server/watches.ts`) turns the `<` of anything
  tag-shaped into `&lt;`, stdout and stderr alike — not only the watch's own tags but `<firstmate-board>`,
  `<paseo-system>` and whatever envelope comes next, since the charter tells the first mate to trust
  those.
- **The chat folds only what the plugin sent.** A watch message goes out with a `messageId` starting
  `firstmate-watch-` (`WATCH_MESSAGE_ID_PREFIX`), which the daemon records as the timeline item's
  `clientMessageId` (`agent-prompt.ts` in Paseo). `watchSummary` (`client/transcript-rows.ts`) folds a
  message into one line naming the watches only when it carries that id and is watch-shaped; the captain's
  words, even a pasted watch block, stay as they are. A timeline rebuilt without the id shows a watch
  message in full rather than hiding anything. `<paseo-system>` and `<firstmate-board>` notes are still
  recognised by their text alone.

**The timer has no Paseo handle of its own.** The plugin API passes `paseo` only to RPC handlers and hooks —
but it is one object per plugin process (`plugin-process.ts` in Paseo creates it once), so
`server/watch-service.ts` keeps the first it sees from `firstmate.fleet.load`, the toggle RPC, or any
agent's `turn_started`/`turn_ended`. Until then, after a plugin start, watches run and their output waits.

What the card shows and the queue itself are in `$PASEO_HOME/plugin-data/firstmate/watches.json`, so a
reload neither loses an output the script has already moved past (the PR watch's baseline has advanced)
nor reports a failure twice. A failure — non-zero exit, timeout, a script that will not start — is queued
once, with stderr's tail, and marks the watch `failing` until a run succeeds; its stdout is not sent. A
run on Unix is its own process group (`detached`), so a timeout's SIGTERM, and SIGKILL two seconds later, reach its
`gh` — the SIGKILL fires even when the script itself has exited, since a child that ignores SIGTERM and has
closed its pipes outlives it. On Windows, Node shebang watches run through the plugin's own runtime
without executable permission bits; unsupported interpreters are marked invalid. They are **not**
`detached` there: a detached Windows process has no console, so every console program it starts — `gh`,
`git` — opens one of its own, about three seconds each, which ran `pr-watch` past its budget and its tests
past their timeouts (`watches.test.ts` times four child launches to keep it out). `pr-watch` also passes
`windowsHide` to `gh`, for a runner that has no console to share. A watch gets the daemon's whole
environment; a test that narrows it must keep `SystemRoot` on Windows, or Node's crypto can fail at
startup (`ncrypto::CSPRNG`). A timeout or abort
uses `taskkill /PID <watch-pid> /T /F` while the root process still exists, to stop its descendants too.
The desktop Paseo `.cmd` launcher is resolved to Paseo.exe and its runner; npm shims use their JavaScript
entry point. Keep all arguments as an array and do not introduce shell interpolation.
A plugin stop aborts running scripts the same way, and starts nothing after,
even from a tick already under way (`runWatchScript` checks an already-aborted signal before spawning). A watch still running when it is due again is
skipped, not queued.

**On and off is the daemon's config** (`disabledWatches`), not a settings document: the runner acts on it,
and a toggle from the card is `firstmate.watch.toggle`, read and written under `serialized` so two quick
presses cannot undo each other. The script is never touched.

**Built-in watches follow the plugin until edited**, like `data/charter.md`: each carries a
`firstmate-watch <fingerprint>` comment, and `seedWatches` (on `prepareHome` and every tick) rewrites an
untouched copy of an older version and keeps an edited one — the card says when the plugin's has moved on,
and deleting the file takes it. A deleted built-in is written again, which is why the card's switch is the
way to silence one. `pr-watch` is Node, with only dynamic `import()`s, so it runs whether Node treats the
extensionless file as CommonJS or ESM; its test (`server/pr-watch.test.ts`) seeds it into a temporary home
and runs it against a stand-in `gh` on a `PATH` of its own. It skips the backlog's `## Done` section,
subsections included, and comments by the account `gh` is logged in as — the crew's and the captain's own.
It has to finish inside the runner's two minutes, so it looks up four pull requests at a time, starts none
after a 70-second budget, and takes the least recently checked first, saving what it checked: a long or
slow backlog is covered over a few runs instead of timing out on every one.

`remote-watch`, the other built-in, reads only `data/remote-hosts.json`, the public catalog
`server/remotes.ts` writes about once a minute. That catalog lists the first mate's remote crew (by
`firstmate.role=crew` and its `firstmate.owner` label) and any agents `data/remote-follow.json` names
(`"followed": true`). It reaches those agents only through read-only `inspect`, `logs` and `permit ls`,
never labelling or sending to them, since they are the captain's own sessions. For each worker it adds
`lastMessage`, from `logs --tail 1 --filter assistant_message` (Paseo's `logs` matches an unknown filter
against the timeline item's type), and `pendingPermissions`, each request's tool and the description
`permit ls` gives. A waiting worker also gets `recentTools`, from the same `logs --filter tools --tail 3`
the helper's `permit ls` adds, because a pending Bash command is in the tool call and not the request. The watch reports a finished turn once, keyed by a hash of status and final
message, so a new `updatedAt` with the same words is not news. Running workers report only new
permission request ids. Reports share a 12,000-character budget, and a worker that does not fit
keeps its old state, so the next run reports it. A previous version's state (one signature string per
worker) is read as already reported, so an upgrade repeats nothing. Its test
(`server/remote-watch.test.ts`) runs the seeded copy against catalogs written by hand, and checks that
an untouched copy of the 0.4.0 version is replaced.

Watches open from `WatchButton` in the panel header, on every layout. `watchAttention` adds a count
and colour only for failing, invalid or off watches; quiet watches have only the muted icon. The host
Modal contains the existing `WatchList`, including schedules, switches and output. A watch's
name opens its script (`watchPath`, the same `watches/` the server reads) through the surface's `openFile`,
the charter Compare's way into the Files view: the Files tab on a phone, the right-hand pane otherwise.

## Suggestions are the first mate's, and a press sends one

`data/suggestions.md` is what the captain might do next — `- <label> :: <prompt>`, one per line — and
the first mate rewrites it whenever that changes (charter §2 and §9). The board reads it with the fleet
on every poll (`parseSuggestions`): notes are left out, a line without a label and a prompt either side
of the first `::` is skipped, and at most `MAX_SUGGESTIONS` are kept. Nothing in code writes a
suggestion; an empty or missing file hides the slim suggestion strip.

The one thing code does to the file is take a suggestion out, for a card's trash button
(`firstmate.suggestion.remove`, `removeSuggestion` in `server/home.ts`). It is found by the label and
prompt the board showed, not by position, because the first mate may have rewritten the list since the
board loaded it. Parsing and removal share one scanner (`scan` in `server/suggestions.ts`) that takes
notes out of the whole text, as the board always has, while remembering each visible character's
offset in the file: a note that splits a suggestion across lines is read the way the board reads it,
and removal deletes only that suggestion's own characters and its line break, never a note's bytes —
deleting the whole physical line could take a `<!--` with it and bring what the note hid onto the board.
A suggestion the file no longer has writes nothing. The write is `replaceTextIfUnchanged` in
`server/files.ts`: confined to the home, staged and renamed, and refused with `FileChangedError` unless
the file still reads exactly as it did — by content, since two writes in one millisecond share an
mtime — checked before staging and again just before the rename. A refusal is the first mate writing
at the same moment, and the removal starts over from its version, `REMOVE_ATTEMPTS` times at most. A
write landing between that last check and the rename is still lost: a rename cannot compare and swap.
The Files view's own saves get the same second check, by modification time as before. The RPC answers
with the list left, which the board puts in the fleet query at once.

On the card, the trash is a sibling of the send `Pressable` rather than inside it, so pressing it can
never press the card. A removal on its way shuts that card by label and prompt, not position
(`client/suggestion-removals.ts`), since a poll can move it; identical twins wait together, and the gate
is checked synchronously, so two presses before a redraw start one removal. The gate is in module scope,
like the send gate, because the list unmounts on a phone's tab switch and on the wide layout's board/Files
switch while a request can still be out.

A button sends its prompt to the first mate at once, and brings the chat into view to show it go out:
the First mate tab on a phone, the chat unfolded on a wide layout. The draft is not touched. The send is
the chat's own: `useMateSender` (`client/mate-send.ts`) is what Send, Bearings and Ahoy go through too,
so a suggestion is the same `firstmate.mate.ask` with the same failure toast, the transcript echoes it
like a typed message, and a first mate mid-turn gets it the way `server/send.ts` delivers any message.
The sender's gate — one message on its way at a time — is per first mate in module scope, not in the
chat's state, because the surface's buttons and the chat both read it, and a phone switching tabs
unmounts the chat mid-send; the buttons are disabled while it is shut, and a double press that gets in
before the re-render is refused by it. Phones keep First mate, Crew and Files tabs; suggestions sit
above the Crew tab's List or Board, with the same send path back to First mate.

`SuggestionStrip` measures its width, keeps a single line of compact buttons, and puts overflow
behind More in a host Modal. Each visible button has separate send, expand and delete controls;
expanding opens the full prompt in a Modal with Send and Remove. More uses `SuggestionList`, whose
cards show the start of each prompt and compare their folded and full heights
(`client/suggestion-fold.ts`) to decide whether to offer expansion. Only the main button sends;
expand and delete are always siblings, so neither sends accidentally.

## The home is called FirstMate in the sidebar, with a ship for its icon

Paseo names a project and its workspace after their directory, and the default home is
`…/plugin-data/firstmate/home`, so the sidebar said "home" twice under a generic folder icon. `nameHome`
(`server/home-name.ts`) calls both "FirstMate" — the workspace through the SDK's `setTitle`, the project
through `paseo project rename`, since the SDK has no call for it. It runs on every launch and restart,
and — for a first mate launched before this existed — once per plugin process from the board's first
`firstmate.fleet.load`, only when the first mate works in its home (an adopted agent's workspace
elsewhere is not the plugin's to name).
A title or project name the captain set is kept, and the project is renamed only when its root is the
home itself: a home chosen inside another project keeps that project's name. A failure is logged and
never fails the launch or the board.

**The icon is a file, not a call.** Paseo looks for an icon in every project's own folder — `favicon.svg`,
`favicon.png`, `icon.svg`, `icon.png` and more, in `public/`, `assets/` and the like first and then the
root, square and 32 KB at most, an SVG taken as square (`project-icon.ts` in Paseo) — and shows it unless
an icon was uploaded in the project's settings. So `prepareHome` writes `icon.svg` into the home when it is
missing: the plugin's own sidebar ship, white on blue, 640 bytes (`templates/icon.svg`). The captain can
replace it, in the Files view or on disk, or upload one in Paseo, which wins. An earlier build set the icon
with the daemon's internal `project.icon.set.request` instead; a project it reached keeps that upload until
it is reset to automatic in the project's settings.

Checked on a throwaway 0.9.1 daemon: a launch made both "FirstMate", Paseo served the home's `icon.svg` as
the project's icon with no custom icon set, and with the project reset to its directory name, a plugin
reload and one board load named it again.

## Interrupting needs the CLI

The handle has no cancel. `server/cli.ts` runs `paseo stop <id> --home $PASEO_HOME`, preferring
`PASEO_CLI` — the daemon hands its plugins the path of the CLI it shipped with (seen on 0.9.1) — and
falling back to `PATH` and the usual install directories.

## Questions and permissions are answered in the chat

When the first mate asks the captain something (Claude's `AskUserQuestion`) or needs a permission, it
stops on a pending permission request. The chat draws each one at the end of the conversation and
answers it with `respondToPermission` from the client — the same call and payload the agent's own tab
sends, so nothing server-side is involved:

- **A question** (`kind: "question"`) is a form: one tab per question, options as radio buttons or
  checkboxes, a free-text box where the daemon added `allowOther`, and Dismiss / Next / Submit.
  `client/questions.ts` is a port of Paseo's `question-form-card-core.ts`, and the payload must stay
  identical to it: `allow` with `{ ...request.input, answers }` keyed by each question's **header**
  (the daemon re-keys them by question text for Claude), or `deny` with "Dismissed by user".
- **Anything else** is a card with the request's own `actions` as buttons, or Allow and Deny.

The request reaches the chat through the timeline: every timeline page carries the agent's snapshot,
pending requests included, and the request is itself a stream event, so it shows up with the next
re-read. The board's poll of the first mate (`updatedAt` and the pending count) is a second trigger for
a re-read, for a request the stream did not announce. The "waiting for your answer" banner now shows
only when the chat is out of sight — folded, or behind the Crew tab — with a button that brings it back.

Checked on a throwaway 0.9.1 daemon: a Claude agent's AskUserQuestion arrived in the timeline page's
snapshot with `allowOther` set, and answering it with `buildAnswers` got "I picked Blue." back.

## The screen and its sidebar row

Paseo 0.11 replaced the static sidebar row and the bare surface with `addScreen` and
`addSidebarHeaderItem`, and both keep the old id, `fleet` (`FLEET_SCREEN_ID`): the sidebar item's id is
the key Settings › Sidebar keeps its order and hidden state under, and a saved
`/plugin/firstmate/sidebar/fleet` link resolves to a screen of that id. The screen is titled
"FirstMate" — the old surface's header read "fleet" — and every way in — the sidebar, "Open FirstMate",
"FirstMate: bearings", `/bearings`, `/ahoy` — is `openScreen`. Two things Paseo draws differently for a
non-legacy item, and nothing here can change: the screen header has no ship, and Settings › Sidebar
shows a generic plugin icon.

The item (`client/sidebar.tsx`) is the one FirstMate row, with a badge in `trailing`: how many crewmates
Paseo still runs have their card in the Working, Ready or Idle column (`activeCrewCount`), and no badge at
zero. It reads **the board's own fleet query** (`useFleet`) rather than an agent observation of its own:
the screen, the panels and the item share one cache and one poll, and the count agrees with the
board's columns. The cost is that the poll now runs whenever the app shows this host — before, only
while the screen or a panel was open.

A row per crewmate was tried and dropped after the captain used it: a backlog title is a sentence with
notes, and Paseo's row draws its label with no line limit, so the rows were paragraphs; one count says
what the sidebar needs to.

## Watching a crewmate

A card's **Watch** shows that crewmate in the board's place — the right-hand pane, or the Crew tab on a
phone — so the chat with the first mate stays beside it: its card, with the board's actions, and its
live transcript. Pressing *Crew* again, or the view's own back button, returns to the board; the
crewmate being watched is kept in module scope like the open tab. *Open in Paseo* is in the view's
bar, not on the card — the card's first action is the caller's (`CardOpener`), so the board says
Watch and the workspace panels, already beside the agent, say Open.

The transcript is `useAgentTimeline` on the crewmate, the tail of 200 projected entries, turned into
rows by `activityRows`. Where the chat folds the first mate's machinery away, this keeps it: reasoning,
every tool call with an expandable detail (a shell command's output from its end, an edit's diff, a
file's content from its start, all clipped to 40 lines), and only the **latest** plan, because each
update restates the whole list. Claude's task tools reach the timeline as that plan
(`claude/task-state.ts` in Paseo); Codex, OpenCode and ACP providers send it directly. `hasOlder` on
the page says when the tail is not the whole story, and the view points at Paseo for the rest.

Rows — here and in the chat — are keyed by their entry's `seqStart` (`rowKey`). The entry's end grows
while a tool call runs or a reply streams, and its position in the page shifts by one with every new
entry once the tail is full; a key built from either remounts the row, which closes an open tool
detail just as its output arrives.

**Text rows preserve the projected timeline's message boundaries.** `continuesText` in
`client/transcript-rows.ts`, shared with Watch, joins only adjacent text entries with consecutive
sequence ranges and matching provider, turn id and (for assistant text) message id. It checks the
previous timeline entry, not the previous visible row, so hidden reasoning and removed plans do not
join unrelated replies. The daemon already merges continuous streaming chunks; no separator is added
inside those chunks. Separate messages are separate Markdown renders, using the existing row spacing.
Paseo omits `<paseo-system>` prompts, so a final reply and the next worker-triggered commentary can be
adjacent without a user row; their turn/message ids still distinguish them. Rebuilt provider history
can omit turn ids, making message ids necessary too. The isolated regression harness and exact
reported boundary are documented in `docs/chat-message-boundaries/README.md`.

A crewmate's pending questions and permissions are answered here exactly as the first mate's are in
the chat — `usePendingRequests` and `PermissionCard`, shared — and the transcript follows its end the
same way (`useFollowEnd`, also shared).

"At the end" (`isAtEnd`) is judged against the **shorter** of the live content height and the one
`onContentSizeChange` last reported. On the web that report waits for a ResizeObserver and a
`setTimeout`, while react-native-web's scroll-end event, 100 ms after a scroll settles, reads the live
height — so an event landing in between saw a reply that had grown but not yet been followed, decided
the captain had scrolled up, and the chat stopped following until they scrolled down by hand. Jumps
are instant for the same reason: mid-animation, every scroll event reads as away from the end. A round
button over the transcript's foot, as in Paseo's own agent view, goes back to the end while the reader
is away from it.

Checked on a throwaway 0.9.1 daemon: a Sonnet agent's projected timeline came through as prompt, shell
calls with their output, and replies, and the compiled client bundle carried the view.

## The home's files, in the panel

A Files view — beside the crew board on a wide layout, a third tab on a phone — lists the home folder by
folder and opens any text file in an editor, with a Markdown preview for `.md`. Three calls in
`shared/files.ts`, handled in `server/files.ts`, and a fourth for the chat:

- **Confined to the home, twice over.** A path is normalized and refused if it is absolute or climbs
  above the home; then it is resolved through symlinks and refused if it lands outside the home's real
  path — for a file about to be created, through its nearest existing ancestor. A clone under
  `projects/` can contain links to anywhere, and the panel must not follow them out.
- **Saved against the version opened.** The first mate writes these same files, so a save carries the
  modification time the editor opened the file at and is refused if the file has changed since; the
  editor then offers *Overwrite*, which sends `force`. A file that changes on disk while open and
  unedited is reloaded quietly, off the list's ten-second poll. A save is a temporary file renamed over
  the old one, so the first mate never reads half of it.
- **Text only, up to a megabyte.** A NUL byte in the first 8 KB marks a file binary; either kind is
  listed but not opened.
- **The chat links only what the daemon vouches for.** `client/file-links.ts` picks anything
  path-shaped out of the first mate's replies — plain text, inline code, a Markdown link's target,
  never a fenced code block; a `/` or an extension, a trailing `:line` dropped, at most 1024
  characters — and `firstmate.files.find` answers which are files, through the same confinement,
  absolute paths included when they sit under the home. One query for the whole conversation, the
  500 most recently mentioned paths, re-asked every 30 s so a file named before it was written
  becomes a link. Opening one unhides a hidden right pane. Captain's messages are plain `Text`, not the Markdown renderer, so they are not linked.

`AGENTS.md` opens with a note that the plugin rewrites it on every start, pointing at
`data/captain.md` for anything that should last. The open folder, the open file and its unsaved text
are kept in module scope, like the chat's draft, so a remount does not lose an edit in progress.

Errors from any RPC reach the app wrapped as `Request failed: … requestType=… code=…`;
`errorText` (`client/format.ts`) strips that, so the panel shows the handler's own sentence.

## Context, Compact and Restart

The chat's button row ends with how full the first mate's context window is, the way Paseo's composer
shows it: `lastUsage.contextWindowUsedTokens` over `contextWindowMaxTokens`, read from the agent snapshot
every timeline page carries (so it moves with the stream, and the board's poll re-reads it too), coloured
at Paseo's thresholds — a warning from 70%, danger past 90%. Paseo draws its ring in SVG, and
`react-native-svg` is not a module a plugin may import, so `ProgressRing` builds the same ring from views:
each half of the circle is an `overflow: hidden` clip holding a ring whose border is coloured on two
adjacent sides only — a rounded border splits its sides at the diagonals, so that is exactly half a ring —
rotated so the coloured half slides into view clockwise from the top. At 0% the fill is not drawn at all,
since its edge showed as a hairline on the seam. Rendered through react-native-web in Chromium at 0–100%
and at 14 points to check the angles; iOS and Android draw per-side border colours on a rounded view the
same way, but have not been looked at. No usage yet — before the first turn ends — draws nothing, as
Paseo's does.

The ring is all the row shows, as in Paseo; the numbers — the share, the tokens — are in a tooltip above
it. It opens on hover (`Pressable`'s `onHoverIn`/`onHoverOut`, the web renderer's) and toggles on a tap
where there is no pointer, a phone; a tap under a hovering pointer is ignored, or clicking the ring would
hide the tooltip being pointed at. The box has a fixed width because an absolutely positioned view is
measured against its parent, the 28-point ring, and would wrap to it. Checked in Chromium through
react-native-web, hover, click and leave.

- **Compact** (`firstmate.mate.compact`) sends `/compact`, the command Paseo's own composer sends; Claude
  Code (a root-only command there, and the first mate is a root agent), Codex and OpenCode each compact on
  it. It is a plain send and refused while a turn runs — the button is disabled then, and the daemon
  refuses too: a slash command must be a turn of its own, where a send would interrupt the running turn
  and a steer would bury the command inside it. The compaction's
  two timeline entries — started, finished — fold into one line (`pushCompaction`).
- **Restart** (`firstmate.mate.restart`) archives the first mate and launches a new one in the home with
  the live agent's model, mode and thinking — not the config's, since they can be changed in its tab and
  an adopted first mate has none there — and the opening followed by the restart note, which tells it it is
  taking over. Archived
  *first*, under the same lock as a launch, so two first mates never hold the helm at once; a launch that
  then fails leaves none, and says so. Archiving retires its heartbeat, because Paseo completes a schedule
  whose agent is archived; the conversation stays readable in Paseo's history. Refused mid-turn, like
  Compact, button and daemon both: a turn cut off halfway through a dispatch can leave a crewmate the
  records never heard of.

What a restart costs: **crewmates the old first mate started no longer wake anyone.** Paseo's finish
notification goes to the agent that created or prompted the crewmate and is dropped when that agent is
archived (`setupFinishNotification` in Paseo returns early for an archived caller), and archiving a first
mate also takes the parent label off its cross-workspace children — which is why Herald 0.5 announces
them from then on. The restart note and charter §7 tell the new first mate to keep a heartbeat while any
are in flight, which is how it finds out.

Checked on a throwaway 0.9.1 daemon with a Haiku first mate: 33,969 of 200,000 tokens after launch,
4,949 after Compact, and Restart archived it and brought up the same model and mode, with the config
pointing at the new one.

## Opening the panel marks the first mate seen

While the surface is mounted, a first mate flagged "finished" or "error" is cleared the way opening
it in Paseo clears it, so its workspace reads as done in the sidebar (`deriveAgentStateBucket`: an
idle agent without `requiresAttention` is `done`). The effect is keyed by the agent's `updatedAt`, so
a turn that ends while the panel is open is cleared too, and a failed clear is not retried until
something changes. A first mate waiting on a permission keeps its flag — Paseo's own "mark as read"
(`workspace.clear_attention`) skips those too, because the flag is the prompt to answer it.

The SDK has no call for it, so `server/daemon-session.ts` writes a `clear_agent_attention` session
message on the plugin's own IPC channel — the frame envelope the plugin's `DaemonClient` already
uses — and waits for the response carrying its own `requestId`. That is the protocol, not an
interface: a daemon that changes the message answers with a timeout, which is logged and costs
nothing. Only complete, valid session messages go this way; a malformed frame is a protocol
violation, and the daemon closes the socket every other call from the plugin rides on.

## A crewmate the first mate has read about leaves "Ready to review"

Paseo's sidebar puts a workspace in "Ready to review" while one of its agents has `requiresAttention`
set, which the daemon does on every running → idle transition (`attentionReason: "finished"`), and
leaves it there until someone looks at the agent. Nobody looks at a crewmate in Paseo — the first mate
reads about it in the `<paseo-system>` finish note — so without help every crewmate the first mate
ever ran piled up there.

**The note is not in any timeline a plugin can read.** The daemon drops every user message that is a
whole `<paseo-system>` envelope (`isSystemInjectedEnvelope` in Paseo's agent manager) before recording
it, so neither `turn_ended`'s `timeline` nor `paseo logs` ever shows one, even though the provider's
own session holds every note. The first version parsed the notes out of the hook's timeline and so
never cleared anything. Checked on the live 0.9.1 daemon: the first mate's Claude session held 23 notes,
its Paseo timeline none.

So `server/crew-seen.ts` goes by time. It hooks **the first mate's** `agent.turn_started` and
`agent.turn_ended`: when a first-mate turn *completes*, every crewmate the first mate created
(`firstmate.role=crew` and Paseo's own `paseo.parent-agent-id` set to the first mate — the note goes to
the creator) whose `attentionTimestamp` is no later than that turn's start is cleared, the same way
`markMateSeen` clears the first mate. The daemon sets the flag before it sends the note, and the note
either starts a turn or is steered into a running one, so a finish from before a turn started has
reached the first mate by the time that turn completes. A finish during a turn waits for the next one.
The first-mate hooks rather than the crewmate's own `turn_ended`, because that fires from the
crewmate's stream and can run before the daemon sets the flag. A cancelled or failed turn leaves the
work for the next completed one, and a turn whose start the plugin did not see — one running across a
reload — is skipped. Each clear logs `cleared N crewmates` to `paseo plugin logs firstmate`.

Only a crewmate of this first mate whose flag is still `"finished"`, with no pending permission, not
running and not in error, is cleared. A permission or an error still reaches the captain, and Paseo
ranks both above the flag regardless. The first mate itself does nothing, so the charter is unchanged.

**This relies on Paseo's internal message format, like `markMateSeen`**: `clear_agent_attention` over
`server/daemon-session.ts`, because neither `PaseoApi`, the MCP tools nor the CLI can clear attention
in 0.9. A daemon that changes the message answers with a timeout, which is logged, and crewmates go
back to waiting in "Ready to review". The follow-up is an upstream API — an `agents.clearAttention`
(or `workspaces.clearAttention`) on `PaseoApi` — and moving both callers onto it.

## Phones: the home indicator and the keyboard

The host pads a surface's top, under its header, and nothing else: not the home indicator, and not
the keyboard — Paseo moves its own composer with `react-native-keyboard-controller` and
`react-native-safe-area-context`, and neither is a module a plugin may import. So the chat does both
itself, with what `react-native` offers:

- **The home indicator.** The composer is wrapped in `SafeAreaView` (deprecated in React Native
  0.81, still present). It replaces the padding in its own style, which is why the composer's padding
  is on the view inside it. It does nothing on Android.
- **The keyboard.** `useKeyboardOverlap` (`client/keyboard.ts`) measures the chat pane with
  `measureInWindow` — the space the keyboard's frame is reported in — and the pane pads its bottom
  by the overlap. `KeyboardAvoidingView` is not used because it measures against its parent, which
  inside the host's screen needs an offset nobody here knows. Lifted above the keyboard, the composer
  no longer overlaps the home indicator, so its safe-area padding drops to zero instead of stacking.
- **The lists with text boxes in them** — the compact board, the panels, the launch screen,
  settings — use `automaticallyAdjustKeyboardInsets`, iOS-only, which insets a `ScrollView` and
  scrolls the focused box into view.

All of it was written against a screenshot and has to be checked on a device.

## Attachments go the way Paseo's composer sends them

Paseo 0.9 gives a plugin no composer to embed: composer pills and attachment sources contribute *to*
Paseo's own composer, and `@getpaseo/plugin/client/*` exports no input, picker or chip. So the chat
has its own, and sends what Paseo's composer sends (read in the 0.9.0 app and daemon):

- **An image** goes in the send's `images`, base64 with its type — raster types only, by Paseo's list;
  an SVG is a file.
- **Any other file** is written to `$PASEO_HOME/uploads/upload_<uuid>/<safe name>` and goes in
  `attachments` as `{ type: "uploaded_file", id, fileName, mimeType, size, path }`; the provider tells
  the agent the path. Paseo's app uploads over a binary channel a plugin cannot reach, so the bytes
  ride the `firstmate.mate.ask` RPC as base64 and `server/uploads.ts` writes them in Paseo's layout —
  only once the first mate is known to exist. Paseo caps one file at 50 MB and nothing else, since each
  upload is its own stream; here one RPC carries the whole message in one WebSocket frame, and the
  daemon's socket takes `ws`'s default 100 MiB. So the contract holds images and files alike to 50 MB
  each, 20 per message and 64 MB together (about 85 MiB as base64), and the client checks the same
  before it reads a byte.

Picking, pasting and dropping are all `client/web.ts`, and **all of it is web-only**. Paseo's native
app picks with Expo's image and document pickers and pastes through a third-party text input; none
of those is a host module, so on iOS and Android the attach button is not drawn and the chat takes
words only. A phone *browser* gets the button, and its picker offers the photo library and camera.
Paste takes images only, as Paseo's does, so pasting text or a copied file still pastes text.

The pending attachments live beside the draft on `globalThis` (`client/attachments.ts`), bytes and
all, so a lost connection keeps them; a failed send puts them back unless something new was attached.

## The remote helper

`tools/remote.mjs` (from `templates/tools/remote.mjs`) is how the first mate drives saved remote hosts:
it queues a request, and `RemoteService` (`server/remotes.ts`) runs it as one remote `paseo` CLI call.
The first mate's guide is `templates/data/remote-access.md`; keep it in step with the helper.

- **Errors are the CLI's own.** `remoteError` takes the JSON error's message and details, else the
  text, from stderr and then stdout, capped, through `redact`: the host's password and relay details,
  pairing links, relay URLs and bearer credentials never come back. Text that mentions a password or
  authentication still becomes "Remote authentication failed", and the queue's own guard still drops a
  message with a pairing link or `relay://` in it.
- **A prompt from a file goes after `--`.** The helper's `--prompt-file` reads a file inside the home
  and passes its text as the last argument after `--`, so a brief starting with a dash stays text;
  `commandArguments` checks options only before `--` and puts its own flags there. The CLI's own
  `--prompt-file` is refused, because it would read any file the daemon can. 28,000 characters at most,
  for a Windows command line.
- **Nothing here reads remote files.** The remote daemon has a read-only, cwd-confined file read
  (`file_explorer_request`, `workspace.read`), but the 0.11 CLI does not expose it, and the plugin
  cannot import Paseo's client or its transports (relay, SSH). A `paseo` command for it, or a plugin API
  that reaches a saved host, is what it would take; until then the guide has workers put reports in their
  final reply or push them.
- **Permission requests lose their input in the CLI.** `permit ls` and `inspect` keep only the tool name
  and description: a Claude question's text and a Bash command stay on the daemon. The helper adds each
  agent's last three tool calls (`logs --filter tools`), whose summary carries a Bash command.
  `permit allow --input '{"answers":{…}}'` answers a Claude question: the daemon merges the original
  questions back in and matches answers by question text or header. For any other tool, `--input`
  replaces the tool's input, so the guide offers it for questions only.
- **Remote times are the host's clock, and it can be wrong.** A first mate saw a host run about an hour
  behind. Times are passed on as reported, never converted. After a successful `run`, `measureClock`
  inspects the new agent (read-only). Its `CreatedAt` should fall between sending the run and the answer
  on our clock, and whatever lies outside that window is the host's skew. It is stored as the host's
  optional `clockSkew` (`shared/remotes.ts`), kept across polls, and published in `remote-hosts.json`.
  While it is 180 seconds or more, every queue answer for that host carries a `warning`, which the helper
  prints on stderr; so does `hosts`. `paseo status` reports no server time for a remote endpoint, and
  `run --json` returns no creation time, which is why it takes the extra `inspect`.

## What was left out

From FirstMate the distro: the session backends (tmux, Herdr, cmux, Zellij, Orca), treehouse, the
watcher and its wake queue, secondmates, Relay, `/afk`, calm mode and self-update — each is either
plumbing Paseo replaces or a feature for another day. `no-mistakes` is an external tool; its place is
taken by a `reviewed-PR` mode the crewmate carries out itself.

From ABorakati's plugin: changing the first mate's model, thinking or mode from the board (0.9's SDK
cannot; ABorakati's plugin sent raw daemon frames over the plugin's IPC channel, which is not an
interface — Paseo's own agent view does it), and dragging columns (arrows instead). Attachments came
later, web-only — see *Attachments go the way Paseo's composer sends them*.

## Checking it

Vitest loads `test/setup.ts` before every test file: it forces `FIRSTMATE_RECEIPT_JOURNAL=0`
and gives the file a fresh temporary `PASEO_HOME`, removed after the file finishes. This applies to
`npm test` and direct Vitest runs, regardless of the shell's environment. Receipt tests may opt in
only against temporary homes and must drain pending receipts before cleanup. Never restore a live
home in a test. `test/journal-isolation.test.ts` launches a child test run with journaling enabled and
an existing stand-in journal, checks it stays untouched, and exercises explicit opt-in in the isolated
home. CI also starts the suite with the flag enabled to keep this boundary covered.

`npm test` covers the parsers, the column rules, the card join, the charter's placeholders, the home's
write-once records, the relay text, the transcript rows, the column order, and the watches — schedules,
the runner's queue and guardrails, seeding, and `pr-watch` against a stand-in `gh`. What it cannot cover,
check against a **throwaway daemon** (see the root AGENTS.md — never the real one, whose agents are
the user's):

1. `paseo plugin install "$PWD" --home /tmp/paseo-check`, then `paseo plugin ls --home /tmp/paseo-check`:
   `running`. The daemon sets `PASEO_HOME` for its plugins, so the plugin's files land under the
   throwaway home even when the shell's `PASEO_HOME` names the real one.
2. A throwaway `*.tmp.test.ts` can drive every RPC the way the app does:
   `new DaemonClient({ url: "ws://127.0.0.1:6799/ws", clientType: "cli", … })` from
   `@getpaseo/client/internal/daemon-client`, then `client.invokePluginRpc("firstmate", "<wire name>",
   input)`. Delete it afterwards.
3. The loop worth watching once per charter change: launch a first mate with a capable model, register
   a scratch `local-only` repository in `data/projects.md`, ask for a one-line change, and watch a
   crewmate appear on the board in its own worktree, report `done: ready in branch fm/<id>`, and the
   first mate relay it.
4. Then look at the screen and the sidebar row's badge, wide and compact, in two themes. The local
   render harness in `docs/board-list/` mounts the real `FleetSurface`, chat, cards and task layouts
   through react-native-web with only host APIs stubbed. It captures the before revision and both new
   views at 2866×1694 (45% chat) and 390×844, using 45 tasks, and checks scrolling, keyboard expansion,
   local/remote steer routing, Done, suggestion dialogs, Watches and host filtering. See its README.
   Native phone behavior still needs a device check; the harness covers the phone browser layout.
