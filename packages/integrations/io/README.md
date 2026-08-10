# kolu-io

Filesystem and I/O primitives for Kolu — a standalone integration package with
no `kolu-*` dependencies beyond `@kolu/log`, so any workspace package can adopt
these without taking a feature-package dependency.

## Modules

| Module                    | Exports                                                            | Purpose                                                                                                    |
| ------------------------- | ------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------- |
| `refcounted-dir-watcher`  | `createDirWatcher`                                                 | Refcounted, non-recursive `fs.watch` on a directory — every direct child, or narrowed to ONE `filename` inside it (survives editors' temp+rename). Cost is independent of the subtree |
| `file-append-watcher`     | `subscribeFileAppends`                                             | Tail a growing file (append-only reads)                                                                    |
| `coalesce-schedule`       | `createCoalesceSchedule`, `COALESCE_DEBOUNCE_MS`                   | Trailing-edge debounce with a hard max-wait — the shared tick coalescer behind the watchers                |

## Conventions

- Loggers are injected (`log?: Logger` from `@kolu/log`); omit in tests.
- Watchers are refcounted singletons per watched path: first subscribe
  installs, last unsubscribe tears down. Test-only reset helpers live on the
  module files, not the package surface.
