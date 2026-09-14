# kolu-omp

**What it is** — the [oh-my-pi](https://github.com/can1357/oh-my-pi) coding-agent
integration: a pure-observer agent adapter that detects a running `omp` TUI and
folds its on-disk session transcript into an `AgentInfo` for Kolu's terminal
tiles. The seventh agent alongside `kolu-claude-code`, `kolu-codex`,
`kolu-opencode`, `kolu-grok`, `kolu-pi`, and `kolu-xyne`.

## What it owns

- **Detection & resolution** (`breadcrumb.ts`, `agent-adapter.ts`) — omp is
  **tty-anchored**, the only agent kolu can pin without an arbiter: a live `omp`
  writes `<agent dir>/terminal-sessions/<tty id>` naming the session file it is
  writing, so the terminal's own stdin tty (Linux `/proc/<pid>/fd/0`, Darwin
  `ps -o tty=`) resolves THE session — a single candidate, no directory scan, no
  ownership arbiter (#2057). The breadcrumb is never deleted when omp exits, so
  it counts only while the foreground process is `omp`, and — mirroring omp's
  own reader — only when its target is live (the file exists, or the crumb is
  marked `fresh`). A crumb omp itself would refuse is not omp's session.
- **Agent-directory resolution** (`agent-dir.ts`) — omp's state moves per
  invocation (`--profile`/`OMP_PROFILE`/`PI_PROFILE`, `PI_CODING_AGENT_DIR`,
  `PI_CONFIG_DIR`, the XDG state dir), and those overrides live in the omp
  process's argv/env, so the adapter reads the foreground process each reconcile.
  No fallback: an unresolvable directory answers `null` ("keep what was
  published") rather than a substituted path.
- **The `AgentAdapter`** (`agent-adapter.ts`) — the `kind: "omp"` contract the
  padi sensors consume: `resolveSessions`, `createWatcher`, the
  `externalChanges` install over one flat breadcrumb-directory watcher per known
  agent dir (omp rewrites its crumb when a session is created or switched, which
  can land after the preexec hint named `omp`), and a `screenScrape` promotion.
- **Watchers** — a per-session transcript watcher (`session-watcher.ts`) built on
  `kolu-io`'s append-robust `subscribeFileAppends` + coalesce schedule. That
  primitive's absent→present floor is what lights the tile for a `fresh` session
  whose JSONL has not materialized yet.
- **The state fold** (`deriveOmpState` in `core.ts`) — one backward walk over the
  transcript tail: `assistant stopReason toolUse` → `tool_use`; `stop` /
  `length` / `error` / `aborted` → `waiting`; a trailing `user`/`toolResult` →
  `thinking` (omp persists assistant messages only on completion, so a mid-turn
  tail is honest work-in-flight). `model` comes from the newest of a
  `model_change` entry's `model` (omp spells that field `model`; pi's fork says
  `modelId`) and the newest assistant entry's own model; `contextTokens` from the
  newest usage object's disjoint `input + cacheRead + cacheWrite`.
  `deriveOmpInfo` (`core.ts`) is the IO wrapper the watcher uses: it stats the
  session file, reads the tail, folds it with `deriveOmpState`, and adds the
  title slot below — `deriveOmpState` is the piece that is pure.
- **The title** (`readTitleSlot`) — omp's line 1 is a fixed 256-byte **title
  slot**, rewritten in place, holding the user's name or the auto-generated one.
  Read as one 256-byte read per fold; an empty title publishes nothing rather
  than fabricating one from the first message.
- **Awaiting-user** (`screen-scrape.ts`) — omp's tool-approval dialog
  (`Allow tool: …`) and its `ask` question are painted on the terminal while the
  transcript stays on the in-flight tool call, so the detector recognizes both on
  the rendered screen and the promote-only policy lifts `tool_use`/`thinking` →
  `awaiting_user`.
- **Transcript export** (`transcript.ts`) — renders the ACTIVE branch of omp's
  entry tree (the `parentId` chain from the file's last entry, in file order).
  The path comes from the breadcrumb kolu recorded: `resolveSessions` files it
  under the session id, and `knownOmpSessionPath` reads it back for the export
  path, which knows only an id — `null` until this padi has observed that
  session live, which the exporter renders as "transcript not available".
  `normalizeOmpToolInput` and `parseOmpTranscript` are exported for tests
  alongside the loader, mirroring `kolu-pi`'s package shape.
- **Schemas** (`schemas.ts`) — `OmpInfoSchema`, browser-safe, re-exported into
  the `terminal-vocab` `AgentInfoSchema` union.
- **Paths** (`config.ts`) — the default `~/.omp/agent` layout only;
  `KOLU_OMP_DIR` overrides the default-profile agent dir for tests/e2e fixtures
  (deliberately not consulted as a stand-in for an `omp` process's own
  `OMP_*`/`PI_*` overrides).

## What it knows nothing about

- **The RPC wire / the server** — it hands back plain `OmpInfo` values; padi
  bridges them.
- **The client / UI** — the mark (`OMP_MARK`) and the display name are declared
  **here**, in `schemas.ts`/`ompVocab`, and reach every surface through the
  agent registry; `packages/client` only *renders* them (plus the generic pip
  glyph in `@kolu/solid-statepip`, which draws the registry's mark). This
  package renders nothing.
- **Mutating the omp agent dir** — a **pure observer**: it never `mkdir`s omp's
  tree; watchers wait for omp to create paths and re-arm on appearance.
- **The omp binary itself** — kolu neither packages, pins, nor vendors `omp`; it
  recognizes whatever `omp` is on the PTY's `PATH`, like every other agent.

## Honest absences

- **Plan approval** — omp's plan-review overlay has no stable on-screen marker
  yet, so it is not promoted to awaiting-you (Claude Code's `ExitPlanMode` has
  the same gap).
- **`taskProgress` stays `null`** — omp's `todo` tool writes a list, but kolu
  does not fold it yet.
- **Titles are omp's own** — a `--no-title` session shows none, and kolu never
  derives one from the first message.
- **What an env-var redirect did, on macOS only** — `ps` has redacted even
  same-user process environments since macOS 10.13, so an `OMP_PROFILE` /
  `PI_PROFILE` / `PI_CODING_AGENT_DIR` set on the `omp` process is invisible
  there and the default directory is read instead (the blind spot pi documents
  for the same reason). `--profile` flags still resolve (argv is readable), and
  `--session-dir` never mattered here: the crumb carries the session's absolute
  path whatever store it landed in.

## Transcript HTML export

`loadOmpTranscript` reads the session JSONL recorded by the breadcrumb into the
shared IR (user / assistant / reasoning / tool_call / tool_result; the title
slot, header, `custom` markers, and branching artifacts are skipped); padi's
export arm dispatches on `kind: "omp"` the same way it does for the other five.

## Logger injection

Functions accept `log?: Logger` (from `kolu-shared`). Expected absence
(`ENOENT` before a session materializes) is silent by design; real I/O or
malformed-data faults surface at error — an unreadable breadcrumb answers
`unusable`, never a silent "no session".
