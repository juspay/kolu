# kolu-pi

**What it is** — the [pi](https://github.com/earendil-works/pi-mono) coding-agent integration: a pure-observer agent adapter that detects a running `pi` TUI and folds its on-disk session transcript into an `AgentInfo` for Kolu's terminal tiles. The fifth agent alongside `kolu-claude-code`, `kolu-codex`, `kolu-opencode`, and `kolu-grok`.

## What it owns

- **Detection & resolution** (`core.ts`) — pi is **directory-keyed** (no pid anchor): a terminal whose foreground is `pi` matches candidates under `sessions/--<cwd with "/"→"-">--/`, newest `.jsonl` first; the orchestrator's ownership arbiter hands each terminal a session no other terminal holds (#2057). The file's `<timestamp>_<uuid>.jsonl` name is itself the id + creation time, verified against a live pi 0.84 tree (leading `/` dropped, then `/` → `-`; docs phrase it loosely).
- **The `AgentAdapter`** (`agent-adapter.ts`) — the `kind: "pi"` contract the padi sensors consume: `resolveSessions`, `createWatcher`, and the `externalChanges` install over `subscribeSessionsTree`.
- **Watchers** — a two-level `fs.watch` over the sessions tree (root + per-cwd dirs; pi writes its file at launch — before any title event can name it — so a filesystem wake is the only signal a session appeared), and a per-session transcript watcher (`session-watcher.ts`) built on `kolu-io`'s append-robust `subscribeFileAppends` + coalesce schedule.
- **The state fold** (`derivePiState` in `core.ts`) — one backward walk over the transcript tail: `assistant stopReason toolUse` → `tool_use`; `stop` / `length` / `error` / `aborted` → `waiting`; a trailing `user`/`toolResult` → `thinking` (pi persists assistant messages only on completion, so a mid-turn tail is honest work-in-flight). `model` from the newest assistant entry (or `model_change`), `contextTokens` from the newest usage's disjoint `input + cacheRead + cacheWrite`, `summary` from the newest `session_info` name.
- **Schemas** (`schemas.ts`) — `PiInfoSchema`, browser-safe, re-exported into the `terminal-vocab` `AgentInfoSchema` union.
- **Paths** (`config.ts`) — env-resolved `~/.pi/agent` layout (`KOLU_PI_DIR` override for tests/e2e fixtures only).

## What it knows nothing about

- **The RPC wire / the server** — it hands back plain `PiInfo` values; padi bridges them.
- **The client / UI** — the π icon and "Pi" label live in `packages/client` (+ the pip glyph in `@kolu/solid-statepip`); this package renders nothing.
- **Mutating `~/.pi`** — a **pure observer**: it never `mkdir`s pi's tree; watchers wait for pi to create paths and re-arm on appearance.
- **SQLite / a pid map** — pi stores plain per-cwd JSONL, so there is no DB subscription and no `active_sessions`-style map to defend against (grok's failure mode simply doesn't exist here).

## Honest absences

- **No `awaiting_user` state** — pi's permission gates and questions are TUI dialogs that never land in the session JSONL, so there is no on-disk signal a fold could read. The state literal is deliberately absent from `PiInfoSchema` rather than declared-and-never-produced.
- **`taskProgress` stays permanently `null`** — pi has no todo-list primitive.
- **`summary` is null for unnamed sessions** — pi falls back to the first message in its own picker; deriving that here would fabricate a title pi itself does not record.

## Transcript HTML export

`loadPiTranscript` reads the same session JSONL into the shared IR (user / assistant / reasoning / tool_call / tool_result; compaction, branching, and interactive `bashExecution` artifacts are skipped); padi's export arm dispatches on `kind: "pi"` the same way it does for the other four.

## Logger injection

Functions accept `log?: Logger` (from `kolu-shared`). Expected absence (`ENOENT` before first run) logs at debug; real I/O or malformed-data faults surface at error — an unreadable store answers `null` from `findSessionsByDirectory`, never `[]` (the arbiter releases sessions on `[]`).
