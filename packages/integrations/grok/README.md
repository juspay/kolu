# kolu-grok

**What it is** — the xAI Grok Build CLI integration: a pure-observer agent adapter that detects a running Grok TUI and folds its on-disk session files into an `AgentInfo` for Kolu's terminal tiles. The fourth agent alongside `kolu-claude-code`, `kolu-codex`, and `kolu-opencode`.

## What it owns

- **Detection & resolution** (`core.ts`) — reads `~/.grok/active_sessions.json` to match a foreground pid to a session, and folds `sessions/<enc-cwd>/<uuid>/events.jsonl` + `summary.json` into `GrokInfo` (state, model, title, startedAt).
- **The `AgentAdapter`** (`agent-adapter.ts`) — the `kind: "grok"` contract the padi sensors consume: `resolveSession`, `createWatcher`, and the `externalChanges` (active_sessions) install.
- **Watchers** — a process-wide `active_sessions.json` subscription (`active-sessions-watcher.ts`, over `kolu-io`'s `createDirFilenameWatcher`) and a per-session `events.jsonl` + `summary.json` watcher (`session-watcher.ts`).
- **Schemas** (`schemas.ts`) — `GrokInfoSchema` and friends, browser-safe, re-exported into the `terminal-vocab` `AgentInfoSchema` union.
- **Paths** (`config.ts`) — env-resolved `~/.grok` layout (`KOLU_GROK_DIR` override for tests/e2e fixtures only).

## What it knows nothing about

- **oRPC / the server** — it hands back plain `GrokInfo` values; the padi endpoint bridges them.
- **The client / UI** — icons and labels live in `packages/client`; this package renders nothing.
- **Mutating `~/.grok`** — it is a **pure observer**. It never `mkdir`s Grok's tree; watchers wait for Grok to create its own paths and re-arm on appearance.
- **SQLite / a WAL** — unlike Codex, Grok stores plain JSON/JSONL, so there is no DB subscription; watchers are `fs.watch` over the JSON files.
- **Transcript HTML export** — `loadGrokTranscript` reads `chat_history.jsonl` into the shared IR (unwraps Grok's `<user_query>` harness tags so the export shows the human prompt, not the wire envelope); padi's export arm dispatches on `kind: "grok"` the same way it does for Claude/Codex/OpenCode.

## Honest nulls

`taskProgress` stays permanently `null` until Grok's plan checklist is a stable first-class count in `updates.jsonl`. `contextTokens` comes from `signals.json` (`contextTokensUsed`) and is null only when that file/field is absent.

## Logger injection

Functions accept `log?: Logger` (from `kolu-shared`). Pass a pino child logger in production; omit in tests. Expected absence (`ENOENT` before first run) logs at debug; real I/O or malformed-data faults surface at error.
