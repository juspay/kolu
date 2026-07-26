# osfacts

One static binary that answers **what does the OS say about these processes
and their sockets** — scoped to exactly what you asked, honest about what it
could not read, in about ten milliseconds.

```sh
osfacts snapshot --roots 4242 --procs --ports     # this process subtree: procs + listening ports
osfacts snapshot --pids 991 --mem --start-time    # exactly these pids: RSS + start time
osfacts socket-holders /run/user/1000/padi.sock   # which pids hold this unix socket
osfacts snapshot --json | jq                      # same facts, for humans and scripts
```

## The creed

- **Scoped** — cost tracks the *ask*: `--roots` walks the given pids'
  subtrees, `--pids` takes an exact set, no flag means host-wide. Never a
  host-wide scan filtered after the fact.
- **Attributed** — every snapshot carries the full pid→ppid table, so a
  grandchild listener (`shell → npm → node`) walks back to its root.
- **Honest** — every pid that could not be inspected is **reported, with its
  errno**, in a mandatory `unreadable` section. Blindness is output, not
  absence: "we could not look" must never read as "nothing is listening".
- **Versioned** — the schema version is the first thing on stdout. A consumer
  built against another revision fails loudly instead of parsing a
  half-understood shape into zero rows.
- **Fast** — ~10 ms per snapshot, because interactive callers poll at
  seconds scale. This budget explains every rejection in the table below.

## Output

TSV on the hot path — version line first, then tagged rows (`P` process, `L`
listener, `U` unreadable) — and `--json` for everything else. Two contract
points worth knowing before you parse:

- **Raw address bytes, never a "wildcard" boolean.** You keep exactly one
  address classifier on your side; two predicates that must agree about
  `::ffff:0.0.0.0` is how they come to disagree.
- **Cumulative CPU time per row**, so CPU% is a diff between two snapshots on
  *your* clock — a one-shot sampler never sleeps to compute a rate.

## Who uses it

[kolu](https://github.com/juspay/kolu) — its terminal port sensor, memory
sampler, unix-socket takeover check, and daemon supervisor all collapse onto
this one contract — and [drishti](https://github.com/srid/drishti) for
process inspection. Anything else gets the same facts via `--json`.

## Why not an existing tool

Every candidate was measured, not surveyed; each fails on the contract, not
on packaging:

| tool | disqualifier |
| --- | --- |
| `osquery` | wrong operational model: a resident fleet-telemetry agent with a SQL surface — ~378 ms/query, ~158 MB — built for thousands of machines every few minutes, not one machine every five seconds |
| `procs` | discards the bind address — loopback-only and wildcard collapse into one row |
| `portls` | no PPID, no process table — a listener cannot be walked back to its root |
| `rustnet` | interactive capture TUI, needs packet-capture privilege |
| `portview` | listener rows only, no process table; no scoping (its single-port query is a host-wide scan plus a filter) |
| `sysinfo` + `listeners` | composing them enumerates the process list twice: 23 ms darwin / ~100 ms linux vs 10 ms single-pass |
| `lsof` / `netstat` | `lsof` measured 93 ms; macOS `netstat` is intermittently blind — success and zero rows in one window, 29 rows the next |

## Status

**Design complete, binary not yet built.** osfacts incubates in the kolu
monorepo (this directory is the whole future repo) and extracts once a second
external consumer takes the dependency. The full design — contract, user
stories, internals, phase tree, and the measurements behind every claim above
— is the plan of record:
[os-facts-tool](https://kolu.dev/atlas/os-facts-tool.html).
