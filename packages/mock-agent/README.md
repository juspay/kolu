# kolu-mock-agent

A stand-in coding agent (`claude` / `codex` / `opencode` / `grok`) the e2e harness runs
**inside a kolu terminal** to exercise agent-state detection — the Dock pips, the
tile chrome indicators, context-token and task-progress readouts.

## Why it exists

The old agent-state mocks were a *ventriloquist*: the test process planted
fixture files (`~/.claude/sessions/*.json`, codex/opencode SQLite) from outside
the terminal. That works on one machine, but under a remote padi bind
(`KOLU_PADI_HOST`, W3.1) the padi that senses agent state runs on **another
box**, reading **that box's** `$HOME` — which the test process never wrote to. So
every agent-state scenario silently failed the remote e2e lane (a
"fixture-locality artifact", PR #1675).

Moving the mock into the agent's seat removes the geography entirely: a real
foreground process in the terminal writes its **own** artifacts at the **real**
default paths under whatever `$HOME` that box's PTY host resolved. Wherever the
terminal is, the files land there; the padi on the same box reads there. Local
and remote become the same test, with **zero** remote branches in the harness.
It is also *more* faithful — a foreground process writing its own files at real
paths is exactly what production senses (including the fs-watch layer).

## How it's driven

One `bin/` per kind, so the terminal invocation's head basename is
`claude`/`codex`/`opencode`/`grok` (what the preexec command-name detector keys on); the
kind is baked as the first arg. The harness launches it, then sends the tiny
line grammar over the PTY (the product's own wire):

```
state <name> [k=v ...]   # set lifecycle state + optional opts
quit                     # remove artifacts (session disappears) and exit
```

`<name>` is one of the lifecycle/artifact variants (`thinking`, `tool_use`,
`waiting`, `awaiting_user`, `running_background`, `orphaned_workflow`,
`journalless_workflow`, `background_bash`, `fork`, `interrupted`,
`interrupted_tool_use`, `compact`). `k=v` opts: `input=`/`cached=` (codex/claude
tokens), `context=` (opencode tokens), `todos=<t>/<c>`, `tasks=<t>/<c>`,
`stale-jsonl` (flag). `--shim` at launch presents as an npm-shimmed CLI (the
kernel foreground name stays generic, so detection must ride the command-name
hint alone).

While resident the agent self-nudges its file/DB watcher every 200ms so a
dropped inotify event can't wedge detection — the in-process replacement for the
old test-side `onTick` nudges. Each `state` write also emits a title update after
the artifacts land, so Kolu resolves the session against the fresh files instead
of only against the launch-time empty state.

## Deployment

Built from the same workspace closure as `kolu` (`nix build .#mock-agent`) and
`nix copy`'d onto a leased bind target by the remote-e2e lane — only the tiny
wrapper transfers, since node + tsx + the closure are already present via padi's
provisioning. Not a runtime dependency of kolu or padi.
