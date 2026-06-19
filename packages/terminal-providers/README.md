# @kolu/terminal-providers

kolu's **per-terminal awareness providers** — the code that turns a terminal's
raw PTY signals into the git / PR / agent / foreground metadata the dock and
right panel render — plus `buildWatcherServer`, which serves the host-side
providers behind a [`@kolu/surface`](../surface) contract so kolu-server can
consume them **over a link**.

It knows nothing about the PTY itself: [`kaval`](../kaval) owns the PTY and emits
the raw taps (cwd · title · command-run · foreground); this package is the
volatile, most-edited layer *above* it that observes those taps and derives
meaning. The two are deliberately separate processes-in-waiting — kaval is a
long-lived survivor, these providers re-run fresh on every kolu-server deploy.

## The split

Awareness is split by **what each provider needs to reach**:

| Provider | Needs | Runs |
| --- | --- | --- |
| foreground / process observer → `m.foreground` | nothing but the foreground + title taps | **in-server** (kolu-server, via `startProcessProvider`) |
| git watcher → `m.git` | the repo's `.git` on disk | **host-side** (the watcher) |
| PR watcher → `m.pr` | `gh` against the repo's remote | **host-side** |
| agent detectors ×3 → `m.agent` | `~/.claude` · `~/.codex` · the title/foreground taps | **host-side** |
| agent-command tracker → `m.lastAgentCommand` | the command-run tap | **host-side** |

The host-side providers read the *host's own filesystem*, so they must run where
the terminal lives. The PTY-tap signals run in-server: kolu-server owns the kaval
taps and **relays** them to the host-side providers — it never asks the watcher
to forward the PTY.

## `buildWatcherServer` — host-side, over a link

`buildWatcherServer` runs the host-side providers (`startWatcherProviders`) and
serves their output as the `watcherSurface`:

- **in** — `terminal.watch` / `terminal.unwatch` lifecycle + `signal.{cwd,title,foreground,commandRun}`, the relayed taps.
- **out** — two per-terminal collections, split along the same persisted-vs-live
  write fence [`metadata.ts`](../server/src/terminalEndpoint/metadata.ts) enforces:
  `persistedAwareness` (`git` · `lastAgentCommand` · `lastActivityAt`) and
  `liveAwareness` (`pr` · `agent`). `cwd` / `foreground` / `location` are absent —
  they stay in-server.

It returns the no-wire `directLink` `client` it owns over an in-process
`implementSurface` fragment — the client kolu-server consumes today. The consumer
is written against `ContractRouterClient<typeof watcherSurface.contract>`, so when
a remote host serves the same surface over `serveOverStdio` later, **local vs
remote is only the link**. This is the **in-process** half of kaval's
`createInProcessPtyHost` (which returns the same `client` over the same fragment).
Its wire-serving half — a top-level contract router wrapping the fragment for
`serveOverStdio` (kaval's `servedRouter`) — is deferred to P4d, since nothing
serves the watcher over the wire until the `stdioLink` swap (and a bare fragment
doesn't route over the wire, so exposing it now would be a misleading no-op).

```
            kolu-server (LocalTerminalEndpoint)
   kaval taps ─► in-server foreground observer ──► m.foreground
        │
        └─ signal.* ─►┐
                      │   directLink (no wire)        buildWatcherServer
                      ├──────────────────────────►  git · PR · agent providers
   m.git/pr/agent ◄───┘   persisted/live awareness
```

Host capabilities the providers need that *aren't* awareness data — reading the
rendered screen for the agent screen-scrape promoter, and the cross-terminal
activity MRUs — are **injected** as `buildWatcherServer` options, since they reach
back into the host (in-process today; a remote watcher reads its own kaval).

## API

- `buildWatcherServer(opts)` → `{ client, dispose }` — the host-side providers as a served surface (`client` is the no-wire `directLink` consumed in-process; the wire-serving `servedRouter` is P4d).
- `watcherSurface` — the contract; `PersistedAwareness` / `LiveAwareness` value types.
- `startProcessProvider(record, id, channels, hooks)` — the in-server foreground/process observer.
- `startWatcherProviders(record, id, channels, hooks)` — the host-side providers (used by `buildWatcherServer`).
- `ProviderRecord` / `ProviderChannels` / `ProviderHooks` — the host-injection seam.

## Status

P4w of [#1398](https://github.com/juspay/kolu/pull/1398): the package extraction +
the local `directLink` consumption. The ssh `stdioLink` swap, the `bin` /
`serveOverStdio` entry point, and the Nix packaging are P4d.
