# Remote Supervisors, slice 0: the capability probe

Evidence fixture for `fm-remote-supervisors` slice 0 (the report's §4). It checks what the installed
Paseo CLI can do on a saved remote host before any remote `GatewayReceiver` is built. It changes no
product behaviour. It is not shipped (outside `package.json` `files`), and no test runs it.

- `probe.mjs static` reads the CLI the daemon hands its plugins (`PASEO_CLI`). It records the help for
  each command a receiver would use, validation that runs before connecting, and failures against a
  refused endpoint (`127.0.0.1:1`) and a blackhole one (`192.0.2.1:6767`, TEST-NET-1). It creates nothing.
- `probe.mjs live --home <home> --host <serverId> --workspace <id>` goes through the plugin's own
  remote path (`tools/remote.mjs` → `RemoteService.request` → the remote CLI). It creates one labelled
  agent in an existing workspace and asks it to reply `ok`. It then reconciles the agent by label,
  reads its status and final message, provokes one `Write` permission and denies it, so nothing runs,
  and archives the agent. Every mutation names that agent's exact ID.

`evidence/static.json` and `evidence/live.json` are the transcripts from 2026-11-04, with CLI 0.14.0
and local daemon 0.14.0 against ariadne-dev (`srv_sY4CFeHq0_8l`), workspace `wks_029fde57422215dd`
(`/home/ariadne/work`). The test agent was `1472a1d3-6953-4d98-8a5d-85441b0e7748`, label
`firstmate.probe=s0-0421617c`, and it is archived. The findings are in the home's
`data/fm-remote-supervisors-s0/report.md`.

Run the probe again after any Paseo upgrade. Its results pin one CLI version, and S00's rule is
exact-version columns, nothing borrowed.
