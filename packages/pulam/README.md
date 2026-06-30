# pulam

**pulam** (Tamil புலம், _pulam_ — "field · domain", from the same root as _pulan_, "a sense"; a sibling to
[`kaval`](../kaval), _watch/guard_, and `odu`, _run_) is the standalone
**terminal-workspace daemon**. It dials a running `kaval`, runs the awareness
sensors — git branch · PR + checks · AI-agent state · foreground process — for
every PTY kaval owns, and serves the
[`@kolu/terminal-workspace/surface`](../terminal-workspace) surface: the
`awareness` collection + `version` cell + live `activity` stream, plus (added in
R6) the Code tab's `fs.*` / `git.*` read procedures and their
`subscribeRepoChange` / `subscribeFileChange` change-pulse watcher streams.
[`pulam-tui`](../pulam-tui) — the thin `status`/`watch`/`wait` CLI — consumes the
awareness/activity side; [`pulam-web`](../pulam-web) and a remote kolu-server
mirror the fs/git `git.getStatus` + `subscribeRepoChange` arm (R8).

Where kaval owns the PTYs, pulam derives _meaning_ over them — and adds **zero**
awareness/git/gh logic to kaval, dialing it as a plain `ptyHostSurface` client
exactly like kaval-tui.

```
pulam                      dial the discovered kaval, serve on pulam's socket
pulam --kaval PATH         dial a kaval at an explicit socket
pulam --socket PATH        serve the workspace surface on an explicit socket
pulam --stdio [--kaval P]  serve over stdin/stdout (what an ssh dial speaks to)
```

By default pulam **discovers** the running kaval — a standalone one, or a
kolu-server (which namespaces its daemon by listen port) — so it finds your
kolu's terminals with no flag; pass `--kaval` only to pin one when several kavals
are running. This is the same discovery `kaval-tui` does, so an `pulam-tui
--host` dial lands on a remote kolu's terminals out of the box.

## Ephemeral by design

Unlike a PTY, awareness never has to survive a restart — it is re-derivable from
live taps + the current host fs. So pulam sheds _all_ of kaval's durability
machinery: no single-instance gate, no PTY ownership, no persisted list, no
adoption. Every (re)start just re-runs the sensors and recomputes from now. It
borrows kaval's inventory (a polled `terminal.list`) and starts/stops a sensor
set per terminal as they come and go.

## One sensor library, two homes

The **memoryless producer** lives in
[`@kolu/terminal-workspace`](../terminal-workspace) and is **shared, not
forked**: kolu-server runs it _in-process_ for local terminals (folding its
observation stream into kolu's stored value); pulam runs the _same_ producer
as a separate process and publishes each terminal's `Observation` into the served
collection. The only per-consumer code is a thin accumulator — pulam is a
dashboard that remembers nothing, so it folds **only the observed half**
(`foldObserved`: the same last-write-wins kolu's `fold` uses, minus the recency
and resume-target memory) — plus the `bridgeKavalTaps` adapter that feeds the
producer from a dialed kaval's taps. So there is one copy of the
freshness-critical computation, and proving it runs correctly as a separate,
kaval-dialing process is exactly what this daemon retires.

## Running it

```sh
nix run github:juspay/kolu#kaval                  # the PTY daemon
nix run github:juspay/kolu#pulam                  # awareness over it
nix run github:juspay/kolu#pulam-tui -- status    # snapshot the awareness
nix run github:juspay/kolu#pulam-tui -- watch     # follow it live
nix run github:juspay/kolu#pulam-tui -- wait "$id" --until awaiting,waiting  # block until an agent's turn ends
```

The runtime is just `node · git · gh` — no kolu-server, no browser. For _remote_
awareness, [`pulam-tui --host <ssh>`](../pulam-tui) Nix-provisions this daemon on
another machine and dials it over `--stdio` (it discovers the remote kaval, a
kolu-server included). The kolu-server **mirror** — a long-lived dial where kolu
_reads_ a remote host's `Observation` stream and **folds** it locally (the host
produces, kolu remembers) — is the separate
[remote-terminals R8–R9](https://kolu.dev/atlas/remote-terminals.html) phase.

The full design lives in the
[pulam atlas note](https://kolu.dev/atlas/pulam.html).
