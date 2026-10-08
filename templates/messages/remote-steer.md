<!-- Sent to the first mate when the captain steers a worker on a remote host from the board, once the words have been sent there. The plugin cannot see that worker's turn end, so this goes at once and carries no answer. {{agentId}} is the remote worker's id, {{title}} its card's title, {{host}} the host's label and {{serverId}} its serverId; {{captain}} is what the captain said. -->

<firstmate-board>
The captain spoke to remote worker {{agentId}} ({{title}}) on host {{host}} ({{serverId}}) directly from the FirstMate board. Their words are authoritative: reconcile the brief and the backlog with them. The worker's answer will come through remote-watch, or `node tools/remote.mjs {{serverId}} logs {{agentId}} --tail 20 --filter text`.
<captain-message>
{{captain}}
</captain-message>
</firstmate-board>
