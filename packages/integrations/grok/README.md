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
- **Transcript HTML export** — deferred to a follow-up; the export arm refuses with an explicit `NOT_SUPPORTED` and `grok` is intentionally absent from `transcript-core`'s `AGENT_KINDS` until a loader ships.

## Honest nulls (v1)

`taskProgress` and `contextTokens` are permanently `null` — Grok exposes no stable on-disk counters yet, and these are surfaced as honest nulls rather than invented from `num_messages`.

## Logger injection

Functions accept `log?: Logger` (from `kolu-shared`). Pass a pino child logger in production; omit in tests. Expected absence (`ENOENT` before first run) logs at debug; real I/O or malformed-data faults surface at error.
