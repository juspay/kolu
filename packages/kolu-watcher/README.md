# kolu-watcher

kolu's host-resident terminal watcher — the process that lets **kolu-server dial
a remote host's terminals over ssh** (P3 of the [kaval-sessions](../../docs/atlas/src/content/atlas/kaval-sessions.mdx)
plan).

## Why a separate process from kaval

[`kaval`](../kaval) owns **only** the PTY (node-pty children, the screen mirror,
the raw taps) and is deliberately **kolu-agnostic** — it knows nothing of git,
PRs, or agent detection, so its closure stays tiny and stable. The provider DAG
(git/PR/agent/foreground detection) and the fs/git surface are kolu's own
volatile, most-edited code. They cannot live in kaval without dragging kolu into
its closure.

So on a remote host kolu runs **two** processes side by side:

- **kaval** — the durable PTY daemon (survives deploys; a terminal outlives the
  ssh link that made it).
- **kolu-watcher** — re-runs **fresh per build** (always the current code), runs
  kolu's provider DAG + native fs/git host-side, and fronts the host-local kaval.

The `kolu-` prefix is the tell: it runs kolu's coupled logic, so its nix closure
is *allowed* to depend on kolu app packages (`@kolu/terminal-dag`, `kolu-git`,
`kolu-common`) — the inverse of kaval's allow-list. `buildId.closure.test.ts`
guards that it never reaches *into* kolu-server or the client.

## How it serves over one ssh connection

kolu-server runs `ssh <host> kolu-watcher --stdio`. The watcher serves ONE
`watcherSurface` over that stdio link, composing three concerns:

```
                         ┌─────────────── kolu-watcher (this package) ──────────────┐
  kolu-server  ──ssh──▶  │  watcherSurface (serveOverStdio)                          │
  (RemoteTerminal        │   ├─ pty verbs/taps  ── absorbed, FORWARDED ──▶ kaval     │──unix socket──▶ kaval
   Endpoint, mirror)     │   ├─ fs/git          ── kolu-git on the host's files      │   (durable PTY)
                         │   └─ terminalMetadata ── the provider DAG, run host-side  │
                         └──────────────────────────────────────────────────────────┘
```

The key decision: the watcher is a plain `serveOverStdio` **server** — NOT a raw
`frontDaemonOverStdio` relay. It reaches kaval by being an ordinary **client** of
kaval's unix socket and forwarding the pty verbs/taps (`kavalClient.ts`). That is
what lets one stdio pipe carry both the watcher's own fs/git+metadata surface AND
PTY access to a separate, durable kaval — the "serve, don't relay" composition.

kolu-server consumes the surface via `RemoteTerminalEndpoint` (in
`packages/server/src/terminalEndpoint/remote.ts`), mirroring the watcher's
`terminalMetadata` collection back into the browser surface
(`mirrorRemoteCollection`).

## Nix

`kolu-watcher` is a real nix package (`nix build .#kolu-watcher`), provisioned to
a remote host over ssh by kolu-server's `provisionAgent` (`nix copy --derivation`
→ realise → pin) — the same path kaval uses. Its per-system `.drv` map is baked
onto the kolu server wrapper as `KOLU_WATCHER_AGENT_DRVS_JSON`; its build identity
is `KOLU_WATCHER_BUILD_ID`. `KOLU_WATCHER_KAVAL_BIN` points at the kaval it spawns
when none is already serving the host.
