# @kolu/terminal-awareness

**Watch a terminal, know what it's working on.** Given one terminal's live
signals — its working directory, title, foreground process, and the commands run
in it — this package derives that terminal's _awareness_: which git repo and
branch it's on (and whether the tree is dirty), the pull request for that branch
and its CI checks, which AI coding agent is running and whether it's _working_ or
_waiting on you_, and the foreground process. It also defines `AwarenessValue` —
the shape of that derived state.

## What it does

`startProviders(record, id, channels, hooks, log)` starts one set of watchers
for a terminal and returns a teardown. Each watcher owns a single source:

| Watcher | Watches | Derives |
| --- | --- | --- |
| git | the repo's `.git` — branch, dirtiness, remote | `git` |
| pr | the forge, for the branch's PR + checks | `pr` |
| agent ×3 | Claude Code / Codex / OpenCode session state | `agent` |
| foreground | the tty's foreground process | `foreground` |
| command tracker | the shell's pre-exec command marks | `lastAgentCommand` |

The host feeds a terminal's raw signals in through `ProviderChannels` (the cwd ·
title · command-run · foreground taps) and tells the watchers how to store and
publish each result through `ProviderHooks`. The watchers do the deriving; the
host owns everything else.

## What it knows nothing about

It is **host-agnostic**. It doesn't own the PTY (that's [`kaval`](../kaval/)),
doesn't decide how a host stores or ships the result (that's `ProviderHooks`),
and carries no app concepts: `AwarenessValue` has no terminal `location`, no
theme, no layout — those belong to whatever app embeds it, built _on top of_ the
awareness value. Its one ambient dependency, a logger, is passed in rather than
imported, so the package names no host package and reaches only for the
vendor-neutral source libraries it derives from (`anyforge` for PRs, `kolu-git`
for git, the per-agent packages for agent state).

`kolu-server` embeds it: it runs the watchers in-process for each local terminal
and folds each result into the terminal metadata it serves to the browser.

Two entry points keep the boundary clean: the default import pulls the watchers
(they run on Node, alongside `kaval`); `@kolu/terminal-awareness/schema` is the
`AwarenessValue` schema alone — pure `zod`, safe to import from a browser bundle.
