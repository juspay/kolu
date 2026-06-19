# arivu

**arivu** (Tamil அறிவு, _aṟivu_ — "the faculty of knowing"; a sibling to
[`kaval`](../kaval), _watch/guard_, and `odu`, _run_) is the standalone
**terminal-awareness daemon**. It dials a running `kaval`, runs the awareness
sensors — git branch · PR + checks · AI-agent state · foreground process — for
every PTY kaval owns, and serves the result as one `awareness` collection: the
[`@kolu/arivu-contract`](../arivu-contract) surface that
[`arivu-tui`](../arivu-tui) reads.

Where kaval owns the PTYs, arivu derives _meaning_ over them — and adds **zero**
awareness/git/gh logic to kaval, dialing it as a plain `ptyHostSurface` client
exactly like kaval-tui.

```
arivu                      dial the local kaval, serve on arivu's socket
arivu --kaval PATH         dial a kaval at an explicit socket
arivu --socket PATH        serve the awareness surface on an explicit socket
arivu --stdio [--kaval P]  serve over stdin/stdout (what an ssh dial speaks to)
```

## Ephemeral by design

Unlike a PTY, awareness never has to survive a restart — it is re-derivable from
live taps + the current host fs. So arivu sheds _all_ of kaval's durability
machinery: no single-instance gate, no PTY ownership, no persisted list, no
adoption. Every (re)start just re-runs the sensors and recomputes from now. It
borrows kaval's inventory (a polled `terminal.list`) and starts/stops a sensor
set per terminal as they come and go.

## One sensor library, two homes

The sensor set lives in [`@kolu/terminal-awareness`](../terminal-awareness) and
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
nix run github:juspay/kolu#arivu-tui -- list      # the dashboard
```

The runtime is just `node · git · gh` — no kolu-server, no browser. (Provisioning
arivu over ssh for _remote_ awareness, which kolu-server mirrors and folds into
its own `terminalMetadata`, is a later phase; today it serves a local socket
and, with `--stdio`, the transport that ssh dial will speak to.)

The full design lives in the
[arivu atlas note](https://kolu.dev/atlas/arivu.html).
