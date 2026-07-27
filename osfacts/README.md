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
osfacts snapshot --pids 991 --mem --start-time --cpu-time # exact pids: RSS + start + cumulative CPU µs
osfacts snapshot --uid --cwd --status --argv      # every pid: identity + launch details
osfacts host --load --mem --cpu --net --disk      # machine gauges, metadata + cumulative counters
osfacts snapshot --procs --json | jq              # same facts, readable
```

One verb, composable facets. On a Linux host with about 450 processes, the
one-process `--procs --ports` shape takes 6.5 ms; every process facet host-wide
takes 24.3 ms. The flags matter. We know because we time the shapes users run,
not a toy command that happens to make the number look good.

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

## Performance

One timing for a composable command is usually a lie. `--ports` walks file
descriptors; `--argv` reads command lines; `--roots` can turn 450 processes
into one. So these are the useful numbers: 31 interleaved warm runs on
`naiveintent`, with 450–466 live Linux processes and stdout captured as a real
client captures it.

| shape | before the Linux pass | current |
| --- | ---: | ---: |
| host-wide `--procs` | 10.93 ms | 9.43 ms |
| host-wide `--procs --ports` | 27.59 ms | 17.80 ms |
| host-wide, every process facet | 52.56 ms | 24.33 ms |
| `host --load --mem --cpu --net --disk` | 2.61 ms | 2.61 ms |
| drishti's two calls, serial | 55.41 ms | 26.48 ms |
| one-process `--roots`, `--procs --ports` | 7.58 ms | 6.49 ms |
| 83-process subtree, `--procs --ports` | 19.85 ms | 17.27 ms |

The large win came from mundane waste: the same `stat` file was opened four
times per pid, output was written a row at a time, and a host-wide fd walk ran
in one long line. The Linux reader now opens shared proc files once, reads
virtual files into a page-sized buffer, reuses `stat`'s RSS field in combined
snapshots, buffers stdout, and splits only large fd walks into ordered workers.
Small scopes stay on the simple path.

The live lane also times 11 warm all-facet snapshots and requires a median
below 40 ms. The pinned old binary fails that smoke at 47.37 ms across 450
processes. The current one passes. The bound is loose enough for a noisy CI
host and tight enough to catch the old class of bug.

## Honesty

When osfacts can't read a pid, it says so — with the errno, in an
`unreadable` section you can't turn off. Blindness is output, not absence.
The listener table is independent of attribution: a socket whose owning fd
cannot be read still appears as `unclaimed` (with its uid on linux). Under a
narrow scope that word matters — the owner may simply be outside the ask.

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

`--cpu-time` emits `C <pid> <cpu_time_us>`: user plus system CPU time since
process start, normalized to microseconds on both platforms. An unreadable pid
emits `U <pid> cpu_time <errno>` instead. The tool never computes CPU%; a
consumer differences two `cpu_time_us` values over its own wall-clock interval.

The other process details stay independent too. `--uid` emits the real uid
(name lookup belongs to the consumer); `--cwd` emits the current directory;
`--status` emits the one-character state, nice value, and a nullable thread
count; `--argv` emits the full argument vector, distinct from the short process
name. Cwd and argv are JSON-encoded inside their final TSV field, so tabs,
newlines, and NULs cannot change row boundaries. Each failed read is its own
`U <pid> <facet> <errno>` row — asking for cwd cannot turn an unreadable cwd
into an empty path or erase a readable uid.

Host CPU rows carry a nonempty model plus nullable MHz. Apple Silicon does not
publish the frequency sysctl, so absence is `null` / `-`, never a fabricated
zero. Disk rows keep both meanings the kernel exposes: free bytes from `bfree`
and unprivileged-available bytes from `bavail`, alongside total bytes.

## Known limitations

Darwin draws its privilege line through a process, not around it. `kern.proc`
gives an ordinary caller the pid, ppid, real uid, state, nice value, start time,
and short command name for every process. `proc_pidpath` gives the executable
path too, so osfacts uses its basename when it is longer than `kern.proc`'s
16-byte command field. Those facts must not come back as `U` rows merely because
the process belongs to another uid.

But foreign-process RSS and cumulative CPU time are different. The task APIs
that supply them return `EPERM` without privilege, so `--mem` and `--cpu-time`
still emit honest `U` rows for those pids. The same can happen for cwd, argv,
and fd/socket attribution.

`ps` looks like a counterexample: an ordinary shell can run it and see foreign
RSS and CPU time. The file tells the other half of the story. On macOS it is
setuid root, and Apple signs it with the private
`com.apple.system-task-ports.read` entitlement. Apple's own source then calls
`task_read_for_pid` to fetch the task data ([reader](https://github.com/apple-oss-distributions/adv_cmds/blob/main/ps/tasks.c),
[entitlement](https://github.com/apple-oss-distributions/adv_cmds/blob/main/ps/entitlements.plist)).
osfacts deliberately has neither. A privileged helper would make the numbers
less blind by making the program more privileged, which is a different product.

macOS 27 draws the same kind of line around the host-wide TCP table. On zest,
Apple's platform-signed `/usr/sbin/sysctl` received 54,872 bytes from
`net.inet.tcp.pcblist_n` while a paired `/usr/sbin/netstat` read counted 29
listeners. An ad-hoc-signed osfacts binary received 48 bytes from the same
sysctl: just the opening and closing records, with no sockets between them.
The full capture decodes to all 29 listeners with osfacts' existing decoder, so
this is a caller-signing gate, not a new record layout. `netstat` carries the
private `com.apple.private.network.statistics` entitlement; `sysctl` is an
Apple platform binary. osfacts is neither.

The 48-byte shape is indistinguishable from a genuinely empty host-wide table,
so osfacts keeps reporting `E darwin_tcp_pcblist BLIND_OR_EMPTY`. It does not
throw away facts it got elsewhere: the same-uid fd walk still emits its claimed
listeners. What macOS 27 gates is the independent table that would also reveal
listeners no readable pid claimed.

Source blindness is an `E` row, not an instruction to discard facts that did
arrive. A partial snapshot exits successfully and leaves reject-versus-render
policy to the consumer; an `E`-only result remains a total failure and exits
nonzero, as do usage and output failures. This distinction keeps a blind port
source from erasing valid process rows while making a completely blind probe
fail loudly.

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
| `sysinfo` + `listeners` | composing them enumerates the process list twice: 23 ms darwin / ~100 ms linux; osfacts' current Linux host-wide process+listener pass is 17.8 ms |
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
hermetic claim (and broke ubuntu-latest CI). The three fields no test can
pin — the real pid, owning uid, and kernel-chosen port — are redacted to stable
placeholders; everything else is byte-exact. The unreadable path is
tested against pid 1, which is always present and always forbidden.

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

And it gates, same as everything else. Both lanes are in branch protection:
a red — either lane — blocks the merge. We considered the industry's
convention here (live oracles as advisory, never blocking) and rejected it:
a red nobody has to obey is a red everybody learns to skip. When the live
lane goes red without anyone having broken osfacts, that usually means the
OS drifted under the tool — which is exactly when merging should stop, not
continue. The costs are accepted with eyes open: host noise can block an
unrelated merge until a rerun clears it, and the darwin live box is now on
the merge-critical path. Small prices for a red that always means "look".

The second lane's scenarios are Gherkin (`cucumber`), the same idiom as
kolu's own e2e: "Given a shell running a loopback server, When I snapshot
its subtree, Then the listener is attributed to that shell" is a sentence
worth keeping readable.

## Status

OSF1, OSF2, OSF3, OSF6, and OSF7 are in: the binary's process, listener,
RSS, start-time, cumulative CPU-time, uid, cwd, status, full argv, and complete
host-telemetry facts on both platforms, plus kolu's port and memory sensors and
start-qualified daemon ownership. The TypeScript client exposes exact-pid,
subtree, and true host-wide process snapshots. The contract is
versioned TSV + `--json`, with mandatory `unreadable` and source-error rows,
and kolu spawns the baked store path
(`KOLU_OSFACTS_BIN`). The TypeScript client lives at `client-ts/` as the
package `osfacts-client` (no `@kolu` scope, zero npm runtime deps) — kolu/padi
is the first consumer; drishti is next. The former `@kolu/port-scan` package
is gone: raw protocol in this client, kolu policy in padi, `PortInfo` fold in
`@kolu/terminal-vocab`. Socket-holder lookup and further consumer migrations
are later phases. osfacts
incubates in the kolu monorepo (this directory is the whole future repo) and
moves out when a second external consumer pins it (drishti). Every claim and
number above has its measurement in the plan of record:
[os-facts-tool](https://kolu.dev/atlas/os-facts-tool.html).
