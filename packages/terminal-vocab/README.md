# @kolu/terminal-workspace

**Know what a terminal is working on, and read its workspace.** The host-side
library for a terminal's _workspace_: it derives that terminal's **awareness**
(which git repo and branch, the branch's PR + CI checks, which AI agent is
running and whether it's _working_ or _waiting on you_, the foreground process)
**and** exposes the **fs/git reads** the Code tab needs (the file tree, a file's
contents, git status + diffs, and live change notifications). Its one home is
**[`@kolu/padi`](../padi)** — the per-host terminal daemon that composes each
terminal's record server-side and serves it on `padiSurface` — lifted out of
`kolu-server` so the daemon and the server share **one** copy of this
freshness-critical code rather than a fork each.

## What it does

**Awareness.** `startSensors(id, inputs, emit)` starts one **memoryless
producer** for a terminal and returns a teardown. Each sensor watches a single
source and **emits** a per-field `TerminalEvent` through `emit`:

| Sensor | Watches | Emits |
| --- | --- | --- |
| git | the repo's `.git` — branch, dirtiness, remote | `git` |
| pr | the forge, for the branch's PR + checks | `pr` |
| agent ×3 | Claude Code / Codex / OpenCode session state | `agent` (an `Known<>` — `"unknown"` while still resolving) |
| foreground | the tty's foreground process | `foreground` |
| command | the shell's pre-exec command marks | a `commandRun` mark |

The host feeds a terminal's raw signals in through `SensorSignals` (the cwd ·
title · command-run · foreground taps); the producer derives each field and
**emits** it, and nothing more — it holds no memory and takes no seed. The host
**folds** the observation stream into a stored value with the pure `fold`: the
five snapshot fields are last-write-wins, and kolu's two _remembered_ facts —
`lastActivityAt` (recency, on kolu's clock — stamped on a live agent-identity
change always, and on a same-identity output tick throttled to
`RECENCY_THROTTLE_MS`, so a stable session's recency tracks its output instead of
freezing) and `lastAgentCommand` — are derived by the fold **alone**, never by the
producer (a `TerminalSnapshot` has no field to spell them, so the write-fence _is_
the emit type). The snapshot-only half is
factored out as `foldSnapshot` — the last-write-wins core `fold` builds the two
remembered facts on top of.

**fs/git.** `createTerminalWorkspaceEndpoint(log)` returns the thin wrapper over
[`kolu-git`](../integrations/git) the Code tab reads — `listAll` · `readFile` ·
`statFileMtimeMs` · `getStatus` · `getDiff`, plus the refcounted
`subscribeRepoChange` / `subscribeFileChange` watchers — each unwrapping a
`GitResult` into a value or a thrown `ORPCError` (a git error surfaces, never
collapses to an empty result). It ships as the single impl (`./endpoint`);
**`@kolu/padi`** owns how that impl reaches a browser.

**padi serves the reads.** This package no longer serves a contract of its own.
`@kolu/padi` binds `createTerminalWorkspaceEndpoint` and exposes the fs/git reads
on **`padiSurface`**: the `subscribeRepoChange` / `subscribeFileChange` payload-free
`{seq}` **pulse watcher streams** are wired by padi's `fsGitDeps.ts`, and the
`fs.*` / `git.*` read **procedures** live in padi's `servePadi.ts` (with the
`ENOENT → NOT_FOUND` + worktree semantics the old assemblers never had). A consumer
requeries a read on each pulse rather than streaming full diffs over the wire.

## What it knows nothing about

It is **host-agnostic**. It doesn't own the PTY (that's [`kaval`](../kaval/)),
doesn't decide how a host stores or ships the result (the host folds the emitted
observations and owns the store), doesn't orchestrate terminals (spawn · adopt ·
the registry stay `kolu-server`'s, and the binary-preview / iframe-URL layer over
`fs.readFile` is `kolu-server`'s too), and carries no app concepts: an
`TerminalSnapshot` has no terminal `location`, no theme, no layout — those belong to
whatever app embeds it, built _on top of_ the observation. Its one ambient dependency, a logger, is passed in rather
than imported, so the package names no host package and reaches only for the
vendor-neutral source libraries it builds on (`anyforge` for PRs, `kolu-git` for
git/fs, the per-agent packages for agent state).

**`@kolu/padi`** is where this library's output lives now. The padi plan relocated
the whole kolu-side consumer — the producer host, the `fold`, the
`authored ⋈ snapshot` compose (`composeTerminalMetadata`), the local
`TerminalEndpoint`, and the Code tab's fs/git — into padi, which **folds** each
terminal's observation stream and composes its record **server-side**, then serves
it on `padiSurface`'s `terminals` collection (the browser reads that one composed
record; there is no client-side join). The frozen `terminalWorkspaceSurface` and
its `serveFsGit` / `serveTerminalWorkspace` assemblers (plus the pulam rendezvous
`socket`) were **buried with pulam / pulam-tui at W2.3** — the per-host terminal
surface is `padiSurface`, and padi absorbed the fs/git watcher-stream backings.

## Entry points

The export map is the boundary — node-only code never reaches a browser
consumer:

| Entry | Runtime | What |
| --- | --- | --- |
| `.` | Node | the producer (`startSensors`) + the pure `fold` + `TerminalSnapshot` |
| `./schema` | browser-safe | the `TerminalSnapshot` / `AgentMemory` / `TerminalId` schemas plus the `RepoChangePulse` / `FsFileInput` / `FsReadFileTextOutput` fs/git wire schemas `@kolu/padi/surface` composes |
| `./agentProjection` | browser-safe | the pure agent-status projection |
| `./endpoint` | Node | `createTerminalWorkspaceEndpoint` (the fs/git wrapper) + its interfaces |
