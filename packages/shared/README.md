# kolu-shared

Domain-agnostic utilities for reading state another process writes to disk: a
growing text file, a live SQLite database, a persisted JSON store. Nothing here
knows about agents, terminals or the web shell. The agent-specific contracts
live in `anyagent`.

Depends only on `@kolu/log` (for the `Logger` type) and `kolu-io`, plus
`node:fs`.

## Entries

| Entry | What it holds |
| --- | --- |
| `kolu-shared` | `readTailLines` for a bounded trailing window of a line file, `createAppendedLineReader` for every line as it lands, and the `Logger` type re-exported from `@kolu/log`. |
| `kolu-shared/sqlite` | `withDb` / `readDb` / `readDbList` for connection lifetime, `createWalSubscription` for a refcounted watch on a database's WAL file, and `createDebounceWatcher` under it. |
| `kolu-shared/state-backup` | `openStateBackupRing`: timestamped, rotated snapshots of a conf-backed state file, taken before the store is first written. |

## Who uses it

`packages/server`, `packages/padi`, and the agent integrations under
`packages/integrations` (claude-code, codex, git, github, grok, omp, opencode,
pi, xyne).

## What a maintainer must not break

- **A partial line is never handed over.** `createAppendedLineReader` holds back
  the bytes after the last newline, and holds back a multi-byte character split
  across two reads. `readTailLines` drops its possibly-partial first line.
- **A rewritten file restarts from byte 0.** A new inode, or a file shorter than
  the offset already read, fires `onRestart` and replays every line. Continuing
  from the old offset would start mid-line in different content.
- **Reads are bounded.** The follower works in fixed-size chunks; the tail read
  takes the size from the caller rather than restatting.
- **Descriptors close on a failed read.** The fd handling is wrapped in
  `try`/`finally`, and a non-`ENOENT` error reaches the caller's `onError`
  rather than looking like an empty file.
- **The backup ring is fail-soft only when taking a snapshot**, so an unwritable
  backup directory never blocks a boot. `restore` is the opposite: it throws on
  every anomaly, including a failed pre-restore snapshot.
- **The ring's filesystem calls stay synchronous.** Both callers persist
  synchronously, and the restore path depends on no interleaving.

The sqlite helpers never import a SQLite driver; they work against any handle
with a `close()`. Tests: `src/appended-lines.test.ts`,
`src/stateBackup.test.ts`, `src/sqlite/wal-subscription.test.ts`.
