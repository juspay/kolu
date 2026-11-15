# kolu-opencode

The OpenCode integration: a pure observer that matches a running `opencode` TUI to one of its sessions, derives live state from its SQLite database, and loads a session transcript for export. It contributes one `AgentPlugin` for the `kolu-agents` registry to fold.

## Entries

| Entry | Holds |
| --- | --- |
| `.` | `opencodePlugin`, `opencodeAdapter`, the `core.ts` lookups and derivations, `createOpenCodeWatcher`, `subscribeOpenCodeDb`, `loadOpenCodeTranscript`, `eventsFromMessageParts`, and the database paths. |
| `./schemas` | `OpenCodeInfoSchema`, `opencodeVocab` and the task-progress re-exports. Browser-safe, so `kolu-common` and the client can import them. |

## How it observes

The TUI owns `~/.local/share/opencode/opencode.db` and serves no HTTP by default, so reading that database is the only way to see its sessions. WAL mode makes a concurrent read safe, and this package opens read-only. State comes from the latest conversational message: a user row means thinking, an assistant row with running tool parts means tool use, and `question` alone means awaiting user.

`createOpenCodeWatcher` refreshes on each WAL event, behind the shared debounce, and dispatch is gated on `agentInfoEqual`.

## Do not break

- **OpenCode 2.x schema only.** Conversations live in `session_v2` and `session_message`. The 1.x tables survive in an upgraded database but stop being written, so reading them would show frozen history. A database without `session_v2` makes every query throw, and that failure is logged at error.
- **`index.ts` is a pure barrel.** Peers import from their leaves, which is what keeps the index, session-watcher and adapter out of a cycle.
- **`./schemas` stays free of `node:*`** and of filesystem access, because the package root pulls `node:sqlite`.
- **`externalChanges` is omitted on purpose.** The TUI owns its session for its whole life, and a title event already fires by the time the session appears, so re-resolving on title covers appearance.
- **Subagent sessions are inlined.** The transcript loader walks `parent_id` to the root, then splices each child session between `subtask_start` and `subtask_end`. Exporting a parent alone would drop every subagent's work.
- The package never writes to the database.

## Dependencies

Depends on `anyagent`, `kolu-shared`, `kolu-transcript-core`, `effect` and `ts-pattern`. Depended on by `kolu-agents` alone, which is how the rest of the system reaches it.

`KOLU_OPENCODE_DB` points detection at a fixture database for tests and e2e; the plugin forwards that key to padi.
