# @kolu/terminal-providers

The per-terminal **awareness provider DAG**, pulled out of kolu-server into a host-agnostic, composable unit. Given a terminal's PTY-tap streams, it derives the live awareness a tile renders — git branch/dirty state, PR status, the foreground process, and which coding agent (Claude Code / Codex / OpenCode) is running and in what state — and folds each signal onto metadata through an injected hook seam. It is the **`watcherDeps` impl** of the [remote-terminals design](../../docs/atlas/dist/remote-terminals-from-scratch.html) (slice **P4w**).

It exists because *local vs remote is only the transport*: the same provider code must run unchanged whether the PTY lives in the local kaval daemon or on a remote ssh host. The DAG is therefore parameterized over the **host** and has zero synchronous dependency on the PTY — it reads taps, not a handle — so it composes in-process into kolu-server today (no client, no mirror, no wire) and serves over ssh tomorrow with the identical contract.

## The seam, in one picture

```
   PTY taps (cwd · title · command-run · foreground)        injected by the host
            │                                                       │
            ▼                                                       ▼
   ProviderChannels  ──►  startProviders(record, id, channels, hooks, log)
                                  │  git → PR · process · agent-command · 3× agent detector
                                  │  (+ idle-gated screen-scrape poll)
                                  ▼
                         ProviderHooks.update{Server,ServerLive}Metadata   ← the host's FOLD
                                  │
                                  ▼
                kolu-server: metadata.ts → terminalMetadata + terminals:dirty fence
```

The host (kolu-server's local endpoint) builds the `ProviderChannels` from the pty-host's tap streams, supplies the `ProviderHooks` (which project onto the `terminalMetadata` surface collection and enforce the persisted-vs-live `terminals:dirty` autosave fence), and calls `startProviders`. The DAG never touches the surface, the registry, or the autosave directly — only the channels in and the hooks out.

## Public API

| Export | Role |
| --- | --- |
| `startProviders(record, terminalId, channels, hooks, log)` | Start every per-terminal provider; returns one idempotent teardown. |
| `ProviderRecord` | The minimal terminal record the DAG touches — `pid`, `meta` (the canonical `TerminalServerMetadata`), `currentAgent`. |
| `ProviderChannels` | The per-terminal tap channels the providers subscribe to — `cwd`, `title`, `commandRun`, `foreground`, `git`. |
| `ProviderHooks` | The host's injection seam — `updateServerMetadata` (persisted, fires `terminals:dirty`) / `updateServerLiveMetadata` (live, does not), the optional `trackRecentRepo`/`trackRecentAgent` activity-feed signals, and the optional `readScreenText` screen-scrape source. The mutator params are narrowed to the two halves of the persisted-vs-live partition, so a provider cannot reintroduce the autosave firehose. |
| `shouldBumpRecencyForAgentChange(prev, next, lastActivityAt)` | The pure recency-bump decision, including the restored-terminal guard (a `null → detected` re-observation on a survivor with a saved `lastActivityAt` does **not** bump). |

The `Logger` is injected (a [pino](https://getpino.io)-shaped logger) rather than imported, so the package carries no dependency on kolu-server's logger singleton — the host passes its own, keeping log lines tagged with the server's identity.

## What stays in the host

The **fold** — the projection of these provider writes onto the `terminalMetadata` surface collection, and the persisted-vs-live `terminals:dirty` fence that decides which writes arm the debounced session autosave — lives in kolu-server (`terminalEndpoint/metadata.ts`), reached through `ProviderHooks`. This package owns the *computation* of awareness; the host owns *where that computation becomes visible*. The seed-from-restored-record adoption (so an adopted survivor's `lastActivityAt`/`lastAgentCommand` are not clobbered) likewise stays host-side, paired with this package's `shouldBumpRecencyForAgentChange` guard.
