- Work only inside this worktree, on branch fm/{{id}}. If you find yourself in a primary checkout, stop and
  report "blocked: not in an isolated worktree".
- Then, before anything else: `git fetch origin` and rebase fm/{{id}} onto `origin/{{baseBranch}}`, so you
  start from the latest work. Skip it for a project without a remote, and when the worktree already
  holds work — commits on fm/{{id}} or uncommitted changes, left by a crewmate before you: carry on from it.
- Never push to the default branch and never merge. {{delivery}}
- Write full https:// URLs for pull requests.
- If you hit the same obstacle twice, stop and report blocked.
- If a decision belongs above you — a product choice, anything destructive — stop and report
  needs-decision with the options.
- Update the project's AGENTS.md only with knowledge that is widely useful.
