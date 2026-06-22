# arivu

**arivu** (Tamil அறிவு, _aṟivu_ — "the faculty of knowing"; a sibling to
[`kaval`](../kaval), _watch/guard_, and `odu`, _run_) is the standalone
**terminal-awareness daemon**. It dials a running `kaval`, runs the awareness
sensors — git branch · PR + checks · AI-agent state · foreground process — for
every PTY kaval owns, and serves the
[`@kolu/terminal-workspace/surface`](../terminal-workspace) surface: the
`awareness` collection + `version` cell + live `activity` stream, plus (added in
R6) the Code tab's `fs.*` / `git.*` read procedures and their
`subscribeRepoChange` / `subscribeFileChange` change-pulse watcher streams.
[`arivu-tui`](../arivu-tui) today consumes only the awareness/activity side; the
fs/git surface is what a remote kolu-server mirrors in R8.

Where kaval owns the PTYs, arivu derives _meaning_ over them — and adds **zero**
awareness/git/gh logic to kaval, dialing it as a plain `ptyHostSurface` client
exactly like kaval-tui.

```
arivu                      dial the discovered kaval, serve on arivu's socket
arivu --kaval PATH         dial a kaval at an explicit socket
arivu --socket PATH        serve the workspace surface on an explicit socket
arivu --stdio [--kaval P]  serve over stdin/stdout (what an ssh dial speaks to)
```

By default arivu **discovers** the running kaval — a standalone one, or a
kolu-server (which namespaces its daemon by listen port) — so it finds your
kolu's terminals with no flag; pass `--kaval` only to pin one when several kavals
are running. This is the same discovery `kaval-tui` does, so an `arivu-tui
--host` dial lands on a remote kolu's terminals out of the box.

## Ephemeral by design

Unlike a PTY, awareness never has to survive a restart — it is re-derivable from
live taps + the current host fs. So arivu sheds _all_ of kaval's durability
machinery: no single-instance gate, no PTY ownership, no persisted list, no
adoption. Every (re)start just re-runs the sensors and recomputes from now. It
borrows kaval's inventory (a polled `terminal.list`) and starts/stops a sensor
set per terminal as they come and go.

## One sensor library, two homes

The sensor set lives in [`@kolu/terminal-workspace`](../terminal-workspace) and
is **shared, not forked**: kolu-server runs it _in-process_ for local terminals
(writing `terminalMetadata` directly); arivu runs the _same_ code as a separate
process and publishes each terminal's `AwarenessValue` into the served
collection. The only per-consumer code is the thin `AwarenessSink` — mutate the
record, then publish — plus the `bridgeKavalTaps` adapter that feeds the sensors
from a dialed kaval's taps. So there is one copy of the freshness-critical
sensor computation, and proving it runs correctly as a separate, kaval-dialing
process is exactly what this daemon retires.

## Running it

```sh
nix run github:juspay/kolu#kaval                  # the PTY daemon
nix run github:juspay/kolu#arivu                  # awareness over it
nix run github:juspay/kolu#arivu-tui              # the dashboard
```

The runtime is just `node · git · gh` — no kolu-server, no browser. For _remote_
awareness, [`arivu-tui --host <ssh>`](../arivu-tui) Nix-provisions this daemon on
another machine and dials it over `--stdio` (it discovers the remote kaval, a
kolu-server included). The kolu-server **mirror + fold** — a long-lived dial that
folds remote awareness into kolu's own `terminalMetadata` — is the separate
[remote-terminals R-2](https://kolu.dev/atlas/remote-terminals.html) phase.

The full design lives in the
[arivu atlas note](https://kolu.dev/atlas/arivu.html).
