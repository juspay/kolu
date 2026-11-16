# kolu-io

Filesystem and process primitives the watchers across kolu share: directory watching that survives temp+rename, file subscriptions with a poll floor under the edge, a coalescing scheduler, a stat-stamped read cache, a process argv/env snapshot, and a meter of every child process the process starts.

No `kolu-*` dependency except `@kolu/log` and the baked `osfacts-client`, so any package can adopt a primitive without taking a feature dependency.

## Entries

| Entry | Holds |
| --- | --- |
| `.` | `createDirFilenameWatcher` and `listDirWatcherRows`, `subscribeFileAppends`, `createCoalesceSchedule`, `watchDirWhenReady`, `readProcessSnapshot`, `stampedCache`, the child meter (`installChildMeter`, `runInChildScope`, `meterSyncChild`, `readChildren`, `childKind`), the `Measured` / `TimingSummary` shapes, and their constants. |
| `./types` | `ProcessSnapshot` alone, free of `node:` imports, so a consumer that only names the shape takes no node-typed graph. `anyagent` imports this. |
| `./suppress-fs-watch.testlib` | `suppressFsWatchEdges`, a test helper that makes `fs.watch` deliver nothing so the poll floor is exercised alone. |

## What each piece guarantees

- **`createDirFilenameWatcher`** watches the parent directory, not the file, because temp+rename destroys a file-pointed handle. One refcounted watcher per resolved directory: the first subscribe installs, the last tears down. Unsubscribe is idempotent and clears the debounce timer. Every subscribe names who asked (a `WatchAsker`: a label, or a function returning the current labels), and `listDirWatcherRows()` reports one row per live entry across every factory: label, directory, file, askers and install time.
- **The child meter** wraps Node's `ChildProcess.prototype.spawn`, the one seam every async child passes through, whichever library starts it. It records each child's kind (`childKind`: program basename, plus a fixed number of subcommand words for `git`, `gh` and `osfacts`), the time inside the start call and the run time, for the last minute. `runInChildScope` carries a cause and a tally to every child started inside it, across `simple-git`'s queue. A synchronous child is metered at its call site with `meterSyncChild`. Installing throws if the seam is missing; reading without the meter installed throws.
- **`subscribeFileAppends`** treats `fs.watch` as a fast edge and polls `statSync` as the level-triggered floor beneath it, so a dropped or coalesced edge self-heals within one interval. The floor is hand-rolled; `fs.watchFile` was tried and rejected for its unobservable async baseline.
- **`createCoalesceSchedule`** debounces on the trailing edge with a hard `maxWaitMs` cap, so a hot source still publishes. `COALESCE_MAX_WAIT_MS` must stay at or below `DEFAULT_APPEND_POLL_MS`.
- **`watchDirWhenReady`** attaches to the nearest existing ancestor and descends as levels appear, then fires once on attach. A non-ENOENT attach failure is logged once and final; there is deliberately no retry.
- **`readProcessSnapshot`** reads `/proc/<pid>` on Linux and the baked `osfacts` binary on darwin for exact argv tokens. Darwin env comes back `null`, meaning unreadable, which is a different fact from an empty map. An unbaked `KOLU_OSFACTS_BIN` throws at module load so the daemon dies at boot.
- **`stampedCache`** keys a read on `(mtimeMs, size)`. Absence is never cached: the reader is still called with no stat, so it decides what a missing file means.

## Do not break

The module constants here are not caller knobs: `DIR_FILENAME_POLL_MS`, `COALESCE_DEBOUNCE_MS`, `COALESCE_MAX_WAIT_MS` and `DEFAULT_APPEND_POLL_MS` are one bound for every watch site. `./types` must stay node-free, and absence must stay uncached.

A watch's asker is required, with no default: a watcher row that cannot name who asked is the gap diagnostics exist to close. The child meter is installed once per process and its unit test starts a real child, so a Node release that moves the spawn seam fails the build. A new `execFileSync` / `spawnSync` site must go through `meterSyncChild`, since the seam does not see it.

## Dependencies

Depends on `@kolu/log` and `osfacts-client`. Depended on by `anyagent`, `kolu-shared`, `padi`, `kolu-git`, and the `claude-code`, `grok`, `omp`, `pi` and `xyne` integrations.

Tests run under the daemon gate (`test:daemon`), one file per primitive.
