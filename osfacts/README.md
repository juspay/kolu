<!--
  Maintainers (human or agent): this README is written per the /pg skill,
  house style "code spans + structure only" — no bold, no italics; headers
  and `code spans` do the scanning. Edit it through that voice.
-->

# osfacts

osfacts answers one question: what does the OS say about these processes and
their sockets. You'd think that question was answered decades ago. It wasn't.
Every tool we tried answers a slightly different question, and we measured our
way through seven of them before concluding we had to write this one.

```sh
osfacts snapshot --roots 4242 --procs --ports     # this subtree: procs + listening ports
osfacts snapshot --pids 991 --mem --start-time    # exactly these pids: RSS + start time
osfacts socket-holders /run/user/1000/padi.sock   # which pids hold this unix socket
osfacts snapshot --json | jq                      # same facts, readable
```

One verb, composable facets, about ten milliseconds. We know it's ten
milliseconds because we spent a week timing everything else.

## Scoping

The whole trick is `--roots`: ask about one process subtree and that subtree
is what you pay for. Every tool we measured scans the whole machine and then
filters — one of them took 26.0 ms host-wide and 25.1 ms "scoped", which
isn't scoping, it's grep. Cost should track the ask, not the host. A terminal
with three processes shouldn't cost you eight hundred.

And the snapshot carries the full pid→ppid table, so a grandchild listener
walks back to its root. A dev server is usually `shell → npm → node`; if your
tool only shows you the `node`, you know a port is open but not whose it is.
That's the question that matters, and it's the one the listener-only tools
can't answer.

## Honesty

When osfacts can't read a pid, it says so — with the errno, in an
`unreadable` section you can't turn off. Blindness is output, not absence.

Why so strict? Because we shipped the other thing. A reader that silently
dropped unreadable pids once emptied a whole panel of facts the moment
someone ran `sudo` — one password prompt, and every terminal on the host
reported "nothing here", successfully. "We couldn't look" and "there is
nothing" are different answers. A tool that conflates them will eventually
lie to you at the worst moment, and you won't know.

The rest of the contract follows the same instinct. The schema version is the
first thing on stdout, so a consumer built against another revision fails
loudly instead of parsing half a shape into zero rows. Addresses come as raw
bytes, never a cooked "wildcard" flag — you keep exactly one classifier on
your side, because two predicates that must agree about `::ffff:0.0.0.0` is
how they come to disagree. And CPU time is cumulative per row, so CPU% is a
diff between two snapshots on your clock. A one-shot sampler should never
sleep; one tool we measured sleeps ~30 ms per call to compute a rate nobody
asked it for.

## Who uses it

[kolu](https://github.com/juspay/kolu) — its terminal port sensor polls this
every few seconds, and its memory sampler, socket-takeover check, and daemon
supervisor all ask the same class of question — and
[drishti](https://github.com/srid/drishti) for process inspection. Anything
else gets the same facts from `--json`.

## Why not an existing tool

We measured, not surveyed. Each candidate fails on the contract, not on
packaging:

| tool | disqualifier |
| --- | --- |
| `osquery` | a resident fleet-telemetry agent with a SQL surface — ~378 ms/query, ~158 MB. Built for thousands of machines every few minutes, not one machine every five seconds |
| `procs` | discards the bind address, so loopback-only and wildcard collapse into one row |
| `portls` | no PPID, no process table — a listener can't be walked back to its root |
| `rustnet` | an interactive capture TUI; needs packet-capture privilege |
| `portview` | listener rows only, no process table, no scoping — its single-port query is a host-wide scan plus a filter |
| `sysinfo` + `listeners` | composing them enumerates the process list twice: 23 ms darwin / ~100 ms linux, vs 10 ms for one pass |
| `lsof` / `netstat` | `lsof` measured 93 ms; macOS `netstat` goes intermittently blind — success and zero rows in one window, 29 rows the next, same boot |

## Testing

Two lanes, split by which question they answer.

The first lane asks "did we break osfacts?" and gates every merge. It's
hermetic: `nix build` compiles the binary and then tests that same binary,
inside the sandbox, on both platforms. Both platforms use the same
strategy — bind port 0 in a parked child (`osfacts-listener`) and assert
osfacts sees *that* process and *that* socket under a scoped snapshot.
Assertions are self-referential ("my fixture appears exactly"), never
"the whole host table is empty", so a noisy dev box and a clean sandbox
exercise the same code path. There is no `unshare` / private-netns trick:
depending on a host kernel knob for user namespaces contradicted the
hermetic claim (and broke ubuntu-latest CI). The two fields no test can
pin — the real pid, the kernel-chosen port — are redacted to stable
placeholders; everything else is byte-exact. The unreadable path is
tested against pid 1, which is always present and always forbidden.
One optional host-wide empty-table pin exists only inside the nix
sandbox (`NIX_BUILD_TOP` set) and runs alone under nextest so sibling
binds cannot race it.

The second lane asks "did the OS break osfacts?" It runs the nix-built binary
on a real, noisy host and diffs its answers against tools that don't share
its code: `ss` on linux, `lsof` and the upstream `listeners` crate on darwin.
This is the only kind of test that could have caught macOS 27's netstat going
intermittently blind while reporting success — inside a sandbox we control,
our fixtures and our reader would just keep agreeing with each other.

It is an explicit CI recipe (`ci::osfacts-live`), not a phase of `nix build`.
The build sandbox is there to shut the real world out: fixed inputs, no host
listeners, no kernel surprise. The live lane's whole job is the real world —
other users' ports, platform oracles, whatever the box happens to be running —
so folding it into the sandbox would delete the thing it is for.

It never gates a merge: branch protection stays on the hermetic lane only. It
does run on every full `/ci` (both platforms, after the hermetic `osfacts` /
`nix` build so the binary is already in the store), and a red fails that run
honestly — no exit-0 shim. A live host can go red without anyone having broken
osfacts (noise, privilege, a service that appeared between samples); that is
why merge stays hermetic while the attended `/ci` run may still go red.

The second lane's scenarios are Gherkin (`cucumber`), the same idiom as
kolu's own e2e: "Given a shell running a loopback server, When I snapshot
its subtree, Then the listener is attributed to that shell" is a sentence
worth keeping readable.

## Status

OSF1 and OSF2 are in: the binary (`snapshot --roots|--pids --procs --ports`
on both platforms, versioned TSV + `--json`, mandatory `unreadable`, scar-
tissue suite) and kolu's port sensor, which spawns the baked store path
(`KOLU_OSFACTS_BIN`). The TypeScript client lives at `client-ts/` as the
package `osfacts-client` (no `@kolu` scope, zero npm runtime deps) — kolu/padi
is the first consumer; drishti is next. The former `@kolu/port-scan` package
is gone: raw protocol in this client, kolu policy in padi, `PortInfo` fold in
`@kolu/terminal-vocab`. Facets beyond that (`--mem`, `--start-time`,
`socket-holders`) and further consumer migrations are later phases. osfacts
incubates in the kolu monorepo (this directory is the whole future repo) and
moves out when a second external consumer pins it (drishti). Every claim and
number above has its measurement in the plan of record:
[os-facts-tool](https://kolu.dev/atlas/os-facts-tool.html).
