# kolu-codex

The OpenAI Codex CLI integration: a pure observer that matches a running `codex` process to one of its sessions, derives live state from that session, and loads its transcript for export. It contributes one `AgentPlugin` for the `kolu-agents` registry to fold.

## Entries

| Entry | Holds |
| --- | --- |
| `.` | `codexPlugin`, `codexAdapter`, the `core.ts` lookups, `createCodexWatcher`, `subscribeCodexDb`, `loadCodexTranscript`, `parseCodexRollout`, and the `~/.codex` paths. |
| `./schemas` | `CodexInfoSchema`, `codexVocab` and the task-progress re-exports. Browser-safe, so `kolu-common` and the client can import them. |

## Two sources, one answer

Codex splits its state across two files, and neither is enough alone.

- **SQLite** (`state_<N>.sqlite`) carries thread metadata: id, rollout path, cwd, title, model, token total. It answers discovery, through `findSessionsByDirectory`. The `<N>` suffix is enumerated at startup, not hard-coded, so a Codex upgrade past the current schema version does not silently end detection.
- **JSONL** (`sessions/YYYY/MM/DD/rollout-*.jsonl`) is the append-only event log. It answers state (thinking, tool use, awaiting user) and the per-turn context-token count, because the thread row has no state column and its `tokens_used` is a lifetime total.

`createCodexWatcher` merges the two on each WAL event: re-read the row, tail the rollout, assemble `CodexInfo`. The tail is skipped when the file size has not moved, and dispatch is gated on `agentInfoEqual`.

## Do not break

- **`index.ts` is a pure barrel.** Peers import from their leaves (`core`, `wal-watcher`, `schemas`, `config`). Reaching back through the index restores the import cycle it was split to break.
- **`./schemas` stays free of `node:*`** and of filesystem access. The package root imports `node:sqlite`, so the client can only take the schema module.
- **`externalChanges` is implemented on purpose.** A live `codex` TUI has no thread row until its first exchange finishes, so the adapter rewakes on every WAL write and lets `resolveSessions` re-check. `isPresent` gates the install on the binary being foregrounded or `~/.codex` existing, so a machine that has never run Codex installs nothing.
- **The transcript loader reads conversation only.** Lifecycle and turn-context lines are state signals and stay skipped.
- The database is opened read-only; this package never writes into `~/.codex`.

## Dependencies

Depends on `anyagent`, `kolu-shared`, `kolu-transcript-core`, `effect` and `ts-pattern`. Depended on by `kolu-agents` alone, which is how the rest of the system reaches it.

Env keys `KOLU_CODEX_DIR` and `KOLU_CODEX_DB` point detection at fixtures for tests and e2e; the plugin forwards them to padi.
