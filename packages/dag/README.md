# @kolu/terminal-dag

kolu's per-terminal **provider DAG** + the local fs/git adapter, extracted into
one package so the SAME code runs in two host processes:

- **kolu-server** — for local terminals, wired to the browser surface by
  `LocalTerminalEndpoint`.
- **[kolu-watcher](../kolu-watcher)** — for remote terminals over ssh (P3),
  running the DAG host-side and serving its own `terminalMetadata` collection.

## What's here

- `providers.ts` — `startProviders(record, id, channels, hooks)`: the per-terminal
  DAG (git watcher → PR watcher, foreground/process observer, the three agent
  detectors, the agent-command tracker). It is **transport-agnostic by
  construction**: it reads pty-host taps off `ProviderChannels` (never a sync PTY
  handle) and writes through `ProviderHooks` (the host supplies the metadata sink
  and the logger), so the same body serves both hosts.
- `agentRecency.ts` — the recency-bump policy the DAG consults.
- `fsGit.ts` — `makeFsGit(log)`: the `TerminalEndpointFs`/`TerminalEndpointGit`
  surfaces over the host's real filesystem (kolu-git shell-outs), plus the shared
  `unwrapGit` (`GitResult` → `ORPCError`). One impl, so a local and a remote Code
  tab differ only in *which process* runs it, never the logic.

## Why a package

The DAG deliberately depends on kolu app packages — `anyagent`, `anyforge`, the
agent detectors (`kolu-claude-code`/`-codex`/`-opencode`), `kolu-github`,
`kolu-git`, `kolu-common`. That coupling is exactly why it runs beside kaval's PTY
(in kolu-watcher) rather than *inside* the kolu-agnostic kaval daemon. Making it a
standalone package lets kolu-watcher import it without dragging in the full
kolu-server (DB, publisher, surfaceCtx, browser surface), and lets the watcher's
closure-allow-list test name this as one explicit allowed edge.
