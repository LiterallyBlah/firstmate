# Assistant message boundaries

The reported boundary is reproducible in the real `MateChat` and `CrewmateView` components:
`…repair needs to reach.Captain, the tooltips…`. The first paragraph ends a captain-triggered turn;
the second starts commentary in a turn triggered by worker completion. Main after PR #10
(`36a4624`) joins them. This fix renders them as separate rows with the existing paragraph spacing.

## Evidence and cause

A read-only SDK `fetchAgentTimeline` of the affected first mate, with `projection: "projected"`,
returned these adjacent entries on Paseo **0.11.0**. `fixtures.ts` preserves their reported paragraphs,
sequence ranges, timestamps, turn ids and collapse flags, with anonymised message ids. The earlier
content of the final message is omitted; there was no trailing whitespace after `reach.`.

| Field | Final reply | Worker-completion commentary |
| --- | --- | --- |
| `provider` | `codex` | `codex` |
| `turnId` | `codex-turn-35` | `codex-turn-36` |
| `item.messageId` suffix in the original | `7a11a` | `0aed6` |
| `seqStart`–`seqEnd` | 1522–1581 | 1582–1589 |
| `sourceSeqRanges` | 1522–1581 | 1582–1589 |
| `collapsed` | `assistant_merge` | `assistant_merge` |
| Timestamp | 20:53:47.493Z | 20:55:43.452Z |

The installed daemon sources were read from the packaged application, without changing them:

- `agent-prompt.js:isSystemInjectedEnvelope` recognises the `<paseo-system>` envelope. Both live
  `agent-manager.js:onStreamTimelineEvent` and history filtering omit it from the timeline.
- Codex's `handleCodexDeltaNotification` emits text deltas with `messageId: parsed.itemId`.
  Managed live events carry a turn id; rebuilt provider history can omit it.
- `timeline-projection.js:mergeAssistantChunks` joins adjacent sequence ranges within one turn,
  preserving distinct provider message ids. Its `assistant_merge` flag describes chunks already
  joined inside **one entry**, not permission to join that entry to the following message.
- The protocol/SDK exposes entry `turnId` and assistant `messageId`; it exposes no assistant
  channel field. No channel inference or timestamp heuristic is needed here.
- `useAgentTimeline` fetches replacement projected pages after stream events, after a short quiet
  interval or a 1.5-second ceiling. It does not append provider deltas itself.
- Both `transcriptRows` and `activityRows` previously concatenated every adjacent visible assistant
  row, ignoring the daemon's identifiers. Chat could also bridge hidden reasoning or a discarded
  plan. `groupRows` then groups tool rows only, and `Markdown` parses the already-concatenated source;
  neither causes this boundary loss.

The worker notification's omission is the **trigger** for adjacent turns. The plugin's unconditional
join is the **cause** of the missing boundary. The smallest counterfactual changes only the second
message id within the same turn: two complete messages still need separate rows. Ordinary captain
messages and visible injected notes already interrupt a join. Conversely, arbitrary chunks with
matching identifiers must concatenate byte for byte, including partial words, bold, lists and fences.

`continuesText` checks the preceding timeline entry, provider, turn id, consecutive sequence ranges
and assistant message id. Separate replies get independent Markdown renders; no text bytes or
streaming separators are inserted. Matching legacy chunks with both ids absent retain their previous
behaviour. If a host omits **both** ids and also removes all intervening entries, it cannot distinguish
two complete messages from chunks; this fix deliberately adds no content/time heuristic for that
ambiguous shape. That limitation does not affect the observed transcript.

## Reproduction and validation

```sh
npm ci
npm ci --prefix docs/board-list
npm run typecheck
npm test
node docs/chat-message-boundaries/render.mjs
```

On Windows, use `npm.cmd` if required by execution policy. The harness uses installed Microsoft Edge
on Windows and Playwright Chromium elsewhere. For Linux, first run
`npx playwright install --with-deps chromium --only-shell` from `docs/board-list`.

The isolated harness bundles the real chat, Watch, Markdown renderer and `useAgentTimeline` hook
through React Native Web. Only host APIs are stubbed, reusing `docs/board-list`'s development tools.
It runs on an ephemeral loopback HTTP server and **never connects to a daemon**. The projected page
fixture comes from the read-only daemon evidence above; this is a UI replay, not a new provider run.
Before bundles replace only the two row modules with `36a4624`, keeping the smallest counterfactual.

Assertions check the actual paragraph text nodes and their visible spacing, not body text (which can
conceal a join across descendants). They cover chat and Watch at 980×720 and 390×844, in dark and light
themes. Four additional sequences per run cover a partial `Cap` update, a completed replacement page,
disconnect/reconnect with the last good snapshot retained, remounting, and uninterrupted Markdown
chunks. Unit regressions also cover history without turn ids, stable keys, tail windows, hidden entries,
sequence gaps and explicit captain/system boundaries. No live daemon install or reload was performed.

| Evidence | Screenshot |
| --- | --- |
| Before: exact concatenation in chat | [Desktop, dark](before-chat-wide-dark.png) |
| After: distinct replies in chat | [Desktop, dark](after-chat-wide-dark.png) |
| After: phone chat | [Phone, light](after-chat-phone-light.png) |
| After: distinct replies in Watch | [Desktop, dark](after-watch-wide-dark.png) |
| Continuous chunks: bold, list, code | [Desktop chat](chunks-chat-wide.png) |

The render produces 16 boundary captures and 4 Markdown captures, with detailed text-node measurements
in ignored `.generated/results.json`. Representative captures are committed above. Other captures stay
in `.generated/screenshots/`. Native device rendering and provider runs are outside this replay.
