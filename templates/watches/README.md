# Watches

Scripts the FirstMate plugin runs on a schedule while Paseo is running. A script that prints nothing
costs nothing; whatever a run prints is sent to the first mate, as one `<firstmate-watch>` note, once
it is between turns. The FirstMate board's Watches card lists them, with each one's last run, and
switches any of them off or on.

This file is the plugin's, written once and then yours. It is not a watch, and neither is any other
`.md` file here or a name starting with a dot.

## Writing a watch

A watch is a script in this folder, run as it is, so it needs a `#!` line and to be executable
(`chmod +x`) on Unix. Windows uses the plugin's Node runtime and accepts `#!/usr/bin/env node` or
`#!node`, without Unix executable permissions. The built-in `pr-watch` works on Windows; custom
shell watches need to be rewritten or wrapped in Node, and should pass `windowsHide: true` to the
commands they start. In its first 20 lines it names its schedule
in a comment:

```sh
#!/bin/sh
# schedule: */5 * * * *
```

`//` and `--` comments work too. The schedule is a crontab line — minute, hour, day, month, weekday
(Sunday is 0 or 7) — each field `*`, a number, `a-b`, any of those with `/step`, or a comma list; or
one of `@hourly`, `@daily`, `@weekly`. It is read in the local time of the machine Paseo runs on. A
minute Paseo was not running for is not made up later. A script with no schedule, or one that cannot
be read, is listed on the card as invalid and never run.

It runs in the first mate's home with these in its environment:

| Variable | What it holds |
| --- | --- |
| `FIRSTMATE_HOME` | The first mate's home. |
| `FIRSTMATE_BACKLOG` | The backlog, `data/backlog.md`. |
| `FIRSTMATE_WATCH_NAME` | The script's file name. |
| `FIRSTMATE_WATCH_STATE` | A directory of its own, kept between runs, to remember what it last saw. |

## What it prints

Everything a run prints to stdout reaches the first mate as one note, however many lines it takes: a
header and a list of findings is the usual shape, and runs that come in while the first mate is busy
arrive together. Print nothing at all when nothing is new: an empty run costs nothing. Errors go to
stderr, never stdout.

## Be careful with your output

The plugin wraps what a watch prints in `<firstmate-watch>` tags and adds nothing else, so all of it
reaches the first mate as the script's own words — and the script is yours, so its words carry your
instructions.

- A script that relays text from elsewhere — pull request comments, issue bodies, web pages, logs —
  must mark that text clearly as quoted, written by someone else, and information only, or the first
  mate cannot tell it from you.
- It should also say what the first mate is to do with its findings.

`pr-watch` shows the shape: its changes, the quotes in them marked, and a closing passage saying whose
words those are and what to do.

## Limits

- A run has two minutes; stdout past 16,000 characters is cut.
- Runs that wait while the first mate is busy arrive together in one message of at most 32,000
  characters. When they would not fit, the oldest are dropped whole — never cut in the middle — and the
  message starts with a count of them; the card shows those watches as dropped. The newest always
  arrives.
- A run that exits non-zero or runs out of time is reported to the first mate once, with the end of
  its stderr, and not again until a run succeeds.
- A watch still running when it is due again is not started twice.

## Remembering what it saw, and trying one out

Keep what a watch has seen in `FIRSTMATE_WATCH_STATE`, and let its first run only record that and print
nothing, so it reports what changes rather than everything there is. To try one, run it by hand from
the home with one scratch state directory, twice: the first run should be silent, the second should
print only what changed in between.

```sh
export FIRSTMATE_HOME=$PWD FIRSTMATE_BACKLOG=$PWD/data/backlog.md FIRSTMATE_WATCH_NAME=my-watch
export FIRSTMATE_WATCH_STATE=$(mktemp -d)
./my-watch; ./my-watch
```

## pr-watch

`pr-watch` is FirstMate's own: it reads the backlog for pull request URLs and says when one is merged
or closed, gets a review or comment, or its checks go red or green. Until you edit it, a new version of
the plugin replaces it; once you have, yours is kept, and the card says when the plugin's has changed —
delete the file to take the new one. A deleted built-in comes back, so switch it off on the card
instead.

## remote-watch

`remote-watch` is FirstMate's too, and follows the plugin the same way. Every minute it reads the
remote catalog, `data/remote-hosts.json`, and tells the first mate when a saved host comes or goes,
when a remote worker — or a session of yours that the first mate follows through
`data/remote-follow.json` — finishes a turn, and when one asks for a permission. Each finished turn is
reported once, with its status, status line and final message cut to a readable length; a turn that
ends with the same words as the one before is not reported again, and nothing is reported while a
worker is still running except a new permission request, with its tool and what it asks. When many
workers report at once, their messages are cut shorter and whatever does not fit comes a minute later.
Everything it quotes from the hosts is marked as remote data. `data/remote-access.md` has the details.

## launch-metrics.mjs (opt-in)

This shipped template is **not installed or enabled automatically**. It observes launches every
15 minutes, writes no stdout (even when it finds a launch), and never dispatches or changes agents.
Errors go to stderr and the watch runner's existing failure reporting. Its first successful listing
on each host records a baseline only, excluding existing crew. The first run also saves the initial
backlog snapshot. An offline/new host gets its own baseline when it can first be listed; launches
before that listing are a stated coverage gap. Keep the same state directory for the whole study.

After approval, copy `templates/watches/launch-metrics.mjs` from the merged plugin source to
`<FIRSTMATE_HOME>/watches/launch-metrics.mjs`. On Unix, `chmod +x` that copy. No plugin reload is
needed: the runner discovers it on its next tick. It is an ordinary custom watch, so upgrades do not
replace it. It requires the existing `tools/remote.mjs` for remote reads and the daemon's `PASEO_CLI`
and `PASEO_HOME` environment (the latter defaults to `~/.paseo`). Do not run it from the source tree
against a real home as a smoke test: even a baseline writes snapshots and state.

The outputs are:

- `data/metrics/launches.jsonl`: one versioned `firstmate.launch-metrics` record per host/agent,
  including the first observation, `CreatedAt`, task, verified `launchLabel` when discoverable,
  the authoritative `leadId` used, individual checks and the request-to-created duration.
- `recall/backlog/YYYY-MM-DDTHHMM.md`: byte-for-byte backlog history on every hash change, including
  the first baseline; UTC filenames. If two versions occur in one minute, the later file adds its
  SHA-256 hash before `.md`. Nothing is pruned and the source backlog is never edited.
- `$FIRSTMATE_WATCH_STATE/launch-metrics.json`: start time, per-host baselines, seen agents and last
  backlog hash. An appended launch survives a crash before the state save without being duplicated.

The local lead is read from the same config location/precedence as `server/data-dir.ts` and
`tools/role.mjs`: `$PASEO_HOME/plugin-data/firstmate/config.json`, falling back to the legacy
`plugins/firstmate/config.json` only when the current file is absent. Its configured home must match
the observed home. The config is never written. An unavailable identity makes the parent check
`unknown`; a remote parent check is `not-applicable`.

### Reading the baseline and comparison

Keep manual launches for 14 days from the first successful baseline, then use an explicit later
period for the tool comparison (at least 20 launches). The report prints JSON **only when explicitly
invoked with `--report`**. Run from the home, setting `FIRSTMATE_HOME` and either `--from` or the same
`FIRSTMATE_WATCH_STATE` used by the watch. For example in PowerShell:

```powershell
$env:FIRSTMATE_HOME = (Get-Location).Path
node watches/launch-metrics.mjs --report --from 2026-10-20T00:00:00Z --days 14
node watches/launch-metrics.mjs --report --from 2026-11-03T00:00:00Z --to 2026-11-17T00:00:00Z
```

With `FIRSTMATE_WATCH_STATE` set, `--report` alone selects its start plus 14 days. Reports never call
the CLI or write files. Periods include `from` and exclude `to`, using worker `CreatedAt` (observation
time only when absent), and separate local and remote launches. `periodComplete` says whether the
period has elapsed, not whether the daemon ran continuously. Pass rates exclude unknown verdicts;
coverage and per-check unknown counts accompany them. Never treat unknowns as successes.

### Evidence and limits

- Discovery uses `ls -a -g --label firstmate.role=crew`; agents without that role cannot be measured.
  Unregistered/unavailable provider sessions may be missing from the CLI. Archived crew are included
  when the CLI exposes them. This is a polling study, not proof that every launch was observed.
- CLI label filters verify the expected role, task, kind and project; `ls`/`inspect` do not print
  arbitrary labels. Expected values come from the matching backlog line or dispatch request.
  Missing expectations remain unknown. A `firstmate.launch` value is checked from request-file
  candidates, so a label absent from every request cannot be enumerated by this CLI.
- Request files are JSON directly under `data/<task>/` or `data/<task>/launches/`, at most 1 MiB each.
  Accepted shapes are remote `{host,args:["run",...]}` (including `--flag=value`) and structured
  `{id,host?,kind?,project?,agent:{provider,model?,modeId?,thinkingOptionId?}}` or `createAgent` with
  `labels` and `settings`. This supports the planned launch request without changing the metric schema.
  Only a small projection is retained; prompts, raw arguments and arbitrary errors are never logged.
  Ambiguous requests leave settings unknown. The latest request preceding creation is selected when
  clocks can be compared; mtime can be changed by later edits, so retain original request files.
- Paseo 0.11 `workspace ls` exposes directory and `isolation`, **not branch**. Directory/isolation
  evidence is retained, but the `fm/<task>` check is unknown until a read path exposes a branch.
  When present, a branch is compared exactly. No branch is inferred from a folder or requested flag.
- Settings are those observed at polling time; a later captain edit can produce a mismatch.
  Latency is raw request mtime to `CreatedAt`, with the catalog's clock skew alongside it. The report
  excludes negative durations from its median and counts them separately; positive remote values
  may also contain clock skew. This is not lead tool-call count or token usage.
- Remote action receipts conflate workspace and worker dispatches. A success linked to this worker
  proves at least one launch; other actions with its task digest are observations, not proven retry
  attempts. `attemptsBeforeSuccess` and first-attempt success rate stay null. Error causes stay
  `unknown`. Reports deduplicate dispatch request IDs and include separate `receiptTotals` from all
  immutable receipts in the period, including failures with no observed worker. Actions are assigned
  by their started time, or terminal time when the start is unavailable. Future receipt fields for
  operation (`worker-create` versus `workspace-create`), launch/attempt identity and a sanitized cause
  code would permit exact retry and cause statistics. Do not use these unknowns to claim the plan's
  rollout gate has passed.

The runner already prevents overlapping runs. A state-directory PID lock also protects manual runs;
use the same state directory, never two independent watches writing one home. After a forcibly killed
process, confirm it has stopped before removing `launch-metrics.lock`. A torn final JSONL line fails
closed and needs inspection before another append; no history is silently discarded. Read failures
leave launches eligible for a later poll. Each process has a 90-second CLI budget, below the runner's
two-minute limit; backlog snapshots happen before host reads.

The first mate does not add or change watches without your say-so.
