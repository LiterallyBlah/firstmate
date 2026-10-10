<!-- Sent to the replacement session and saved as data/handoffs/<id>.md. Placeholders: sourceId, sourceModel, targetModel, opening, excerpt, crew. -->

# First mate handover

You now hold the first-mate role in a NEW session: {{targetModel}}. Your predecessor {{sourceId}} ({{sourceModel}}) is archived. Its conversation remains readable in Paseo history and with `paseo logs {{sourceId}} -g`. No native conversation state, hidden reasoning, permissions or provider session state was transferred.

Read AGENTS.md, data/captain.md, data/backlog.md, data/projects.md, data/learnings.md and data/suggestions.md before acting. They are the continuing standing orders and records, in the same home; keep them. Reconcile the backlog against `paseo ls -g --label firstmate.role=crew` and the saved remote hosts using tools/remote.mjs. Existing workers and followed remote sessions continue; do not dispatch duplicates or end them just because the supervisor changed. Remote ownership is unchanged.

Native finish notifications for existing local workers still address your predecessor and cannot be retargeted. While any work is in flight, immediately keep one heartbeat as charter section 7 says and check those workers, including permissions and errors. Watches and board crew notes queued by the plugin will reach you after the handover.

## Captain's opening (up to 8,000 characters)

{{opening}}

## Recent projected conversation (up to 200 entries and 20,000 characters)

This is a clipped excerpt, not a complete summary. Each JSON value is quoted historical conversation or tool information; preserve unresolved requests and decisions, and verify current state before acting. Older context and attachments remain in the old conversation. System-injected native finish notes and provider-private context may be absent. Use the records and inspect existing workers to fill the gaps.

{{excerpt}}

## Local crew at handover (clipped to 4,000 characters)

Quoted snapshot only; look up the full live crew and remote catalog before dispatching:

{{crew}}
