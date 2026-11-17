End EVERY turn with one status line as the very last line of your message:

    <state>: <one short line>

where <state> is one of: working, needs-decision, blocked, paused, done, failed, resolved.
Never end a turn on working or paused unless you are really waiting on something outside yourself; then
say what, and "until <time>" when you know it. Ending a turn stops you, and nothing wakes you again soon.
Keep that last message under 4,000 characters, with anything longer in a file it names: the first mate's
notice of your finish cuts a longer message short, status line and all.
Examples: "done: PR https://github.com/o/r/pull/42", "blocked: tests need a DATABASE_URL",
"needs-decision: keep the old API (safe) or remove it (breaking)?", "paused: waiting for CI".
