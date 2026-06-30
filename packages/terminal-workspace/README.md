# @kolu/terminal-workspace

**Know what a terminal is working on, and read its workspace.** The host-side
library for a terminal's _workspace_: it derives that terminal's **awareness**
(which git repo and branch, the branch's PR + CI checks, which AI agent is
running and whether it's _working_ or _waiting on you_, the foreground process)
**and** serves the **fs/git reads** the Code tab needs (the file tree, a file's
contents, git status + diffs, and live change notifications). It runs in two
homes off one codebase: **in-process** in `kolu-server` (local terminals) and
**hosted by `pulam`** over ssh (remote ones) — the same two homes the sensors
already proved.

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
`lastActivityAt` (recency, on kolu's clock) and `lastAgentCommand` — are derived
by the fold **alone**, never by the producer (a `TerminalSnapshot` has no field to
spell them, so the write-fence _is_ the emit type). `pulam`, a dashboard that
remembers nothing, folds only the snapshot half with `foldSnapshot`.

**fs/git.** `createTerminalWorkspaceEndpoint(log)` returns the thin wrapper over
[`kolu-git`](../integrations/git) the Code tab reads — `listAll` · `readFile` ·
`statFileMtimeMs` · `getStatus` · `getDiff`, plus the refcounted
`subscribeRepoChange` / `subscribeFileChange` watchers — each unwrapping a
`GitResult` into a value or a thrown `ORPCError` (a git error surfaces, never
collapses to an empty result). It was lifted out of `kolu-server` so there is
**one** impl, not one per home.

**One fs/git impl, one surface, two homes.** R6 ships **one** fs/git impl
(`createTerminalWorkspaceEndpoint`); since R9.5 both homes serve it through the
**same** contract shape — `terminalWorkspaceSurface`'s `fs.*` / `git.*` read
**procedures** plus the `subscribeRepoChange` / `subscribeFileChange` payload-free
`{seq}` **pulse watcher streams** a consumer re-queries on. `fsGitSurfaceDeps`
(`./serveFsGit`) wires the endpoint onto it; `serveTerminalWorkspace` assembles the
whole surface. The surface also carries the `snapshots` collection + `version` cell
+ `activity` stream (the live "green dot" liveness), and — added in R9.5 — three
host-scoped byte primitives: `fs.previewRead` (range-capable preview bytes),
`scratch.write` (paste/upload), and `transcript.read`.

- **kolu-server** (in-process) and **pulam** (remote) BOTH serve this surface.
  kolu's own Code tab reads it through `createPolledQuery` — the client dual of
  `pollOnEvent` (call the procedure once, re-query on each pulse) — so a remote
  tile reads its host's mirror behind the same client. (Until R9.5, kolu-server
  served the Code tab's fs/git reads as `koluSurface`'s **value-bearing streams**
  instead — that home is gone; the Code tab moved onto the shared procedure +
  pulse, and the binary-preview/iframe-URL orchestration moved client-side.)

The single shared **surface** contract both homes serve arrives in **R8** (the
awareness half) and **R9.5** (the fs/git half — kolu mirrors the workspace surface
whole via R7's total mirror).

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

`kolu-server` embeds it (the producer in-process; fs/git bound to its local
`TerminalEndpoint`, the reads served as `terminalWorkspaceSurface`'s procedures +
pulse — the Code tab consumes them via `createPolledQuery`, R9.5)
AND — since **R8** — serves `terminalWorkspaceSurface` itself, in-process: kolu
**folds** each terminal's observation stream and publishes the snapshot half (an
`TerminalSnapshot`) onto its `awareness` collection, while the fold's two remembered
facts ride kolu's **authored** record on its own `koluSurface.authored`
collection, and the browser **joins the two halves at read time**
(`composeTerminalMetadata`) — there is no server-side re-fusion. `pulam` serves
the same surface remotely. The **awareness** half of
"one surface, both homes" closed in R8; the **fs/git** half closed in R9.5 — the
Code tab moved off `koluSurface`'s value-bearing streams onto this surface's
procedure + pulse.

## Entry points

The export map is the boundary — node-only code never reaches a browser
consumer:

| Entry | Runtime | What |
| --- | --- | --- |
| `.` | Node | the producer (`startSensors`) + the pure `fold` + `TerminalSnapshot` |
| `./schema` | browser-safe | the `TerminalSnapshot` / `AgentMemory` zod schemas alone |
| `./surface` | browser-safe | `terminalWorkspaceSurface` — served by `pulam` (remote) and, since R8, by `kolu-server` in-process; kolu mirrors a remote host's in R9 |
| `./endpoint` | Node | `createTerminalWorkspaceEndpoint` (the fs/git wrapper) + its interfaces |
| `./serveFsGit` | Node | `fsGitSurfaceDeps` — wires the endpoint onto the surface |
| `./socket` | Node | the well-known socket path the daemon serves and the viewer dials |
