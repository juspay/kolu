<!--
  House style: 90s OSS README — short lines, lists, tables, code.
  No essay prose. Headers + `code spans` for scanning; sparingly bold.
-->

```
  ___  ___  __            _
 / _ \/ __|/ _| __ _  ___| |_ ___
| | | \__ \ |_ / _` |/ __| __/ __|
| |_| |__/ /  _| (_| | (__| |_\__ \
 \___/|___/|_|  \__,_|\___|\__|___/

  Scoped. Honest. Fast enough to poll.
  Process + socket facts from the OS, nothing more.
```

# osfacts

**One question:** what does the OS say about these processes and their sockets?

Every tool we measured answered a *different* question. We wrote this one.

```sh
osfacts snapshot --roots 4242 --procs --ports      # subtree: procs + listeners
osfacts snapshot --pids 991 --mem --start-time --cpu-time
osfacts snapshot --uid --cwd --status --argv       # host-wide identity facets
osfacts socket-holders /run/user/1000/kaval.sock --procs   # who holds this socket
osfacts host --load --mem --cpu --net --disk       # machine gauges + counters
osfacts snapshot --procs --json | jq               # same facts, readable
```

Composable facets. You pay for the ask, not the host. Three verbs, because
three questions: a **pid set** (`snapshot`), a **socket path**
(`socket-holders`), the **machine** (`host`).

| shape (Linux ~450 procs) | cost |
| --- | ---: |
| one-process `--procs --ports` | 6.5 ms |
| host-wide, every process facet | 24.3 ms |

---

## Why another tool

We measured seven candidates. Contract failures, not packaging:

| tool | disqualifier |
| --- | --- |
| `osquery` | fleet agent + SQL · ~378 ms/query · ~158 MB |
| `procs` | drops bind address (loopback ≡ wildcard) |
| `portls` | no PPID · no process table · no root walk |
| `rustnet` | interactive TUI · needs packet-capture privs |
| `portview` | listeners only · "scoped" = full scan + filter |
| `sysinfo` + `listeners` | double process enum · slower than us |
| `lsof` / `netstat` | 93 ms (`lsof`) · macOS `netstat` lies about empty |

---

## Scoping (`--roots`)

The whole trick.

```
  cost(ask)  ∝  size(subtree)
  cost(host) ∝  size(host)     ← everyone else does this always
```

- Other tools: full scan, then grep. "Scoped" 25.1 ms vs host-wide 26.0 ms = not scoping.
- Snapshot carries full pid→ppid. Grandchild listener walks home.
- Typical stack: `shell → npm → node`. Listener-only tools show you `node` and shrug about whose port it is.

---

## Performance

Numbers from 31 interleaved warm runs on a Lenovo Linux box (AMD Ryzen 7 PRO
8840HS, 8c/16t, 64 GB RAM; 450–466 live procs). Stdout captured as a real
client would.

| shape | before Linux pass | now |
| --- | ---: | ---: |
| host-wide `--procs` | 10.93 ms | 9.43 ms |
| host-wide `--procs --ports` | 27.59 ms | 17.80 ms |
| host-wide, every process facet | 52.56 ms | 24.33 ms |
| `host --load --mem --cpu --net --disk` | 2.61 ms | 2.61 ms |
| drishti two calls, serial | 55.41 ms | 26.48 ms |
| one-process `--roots` + `--procs --ports` | 7.58 ms | 6.49 ms |
| 83-proc subtree `--procs --ports` | 19.85 ms | 17.27 ms |

**Wins were boring:** open shared proc files once, page-sized reads, reuse `stat` RSS, buffer stdout, parallel only large fd walks. Small scopes stay simple.

### Live CPU budget (smoke, not wall-clock)

Two drivers → two terms:

| term | budget | measured (idle ~407 procs / 2725 fds) |
| --- | ---: | ---: |
| per process (7 facets) | 75 µs | ~15 µs |
| per readable fd (`--ports`) | 20 µs | ~6.0 µs |

~3× headroom each — enough for a contended CI box.

A single process-scaled budget **failed every CI host** it met: containers run few processes + thousands of fds. Calibrate against reality, not your laptop.

---

## Honesty

Blindness is **output**, not absence.

```
U <pid> <facet> <errno>     # per-pid unreadable
E <source> <facet> <code>   # source-level blindness
L ... unclaimed ...         # socket seen; owner out of scope / unreadable
H unclaimed -               # unix socket bound; holder out of scope / unreadable
```

- `unreadable` section cannot be disabled.
- Schema version is the **first** thing on stdout. Mismatch → loud fail, not zero rows.
- Addresses = raw bytes. No cooked "wildcard" flag. One classifier, your side.
- `--cpu-time` emits cumulative user+system µs. **Never** CPU%. Diff two snaps on *your* clock. We don't sleep 30 ms to invent a rate you didn't ask for.

### Process facets

| flag | emits | notes |
| --- | --- | --- |
| `--uid` | real uid | name lookup is your problem |
| `--cwd` | cwd | JSON-encoded field |
| `--status` | state, nice, threads? | darwin threads may `U … status_threads` alone |
| `--argv` | full argv | ≠ short name; JSON-encoded |
| `--mem` / `--start-time` / `--cpu-time` | as named | unreadable → `U`, not empty |

Failed facet ≠ erase sibling facets. Unreadable cwd never nukes a good uid.

### Socket holders

`socket-holders PATH [--procs]` — who holds one unix socket. A **path**, not a
pid set, so it is its own verb. `--procs` is the one facet: it costs holder
*names*, never the holder set.

```
H claimed 991               # this pid holds it
H unclaimed -               # bound; no readable pid claims it
P 991 1 kaval               # --procs
```

Three answers, kept apart — a reader that spells all three `[]` is the defect
this verb exists to delete:

| answer | rows | exit |
| --- | --- | ---: |
| nobody holds it | none | 0 |
| held, unnameable | `H unclaimed -` | 0 |
| could not look | `E … socket_holders …` | 1 |

Linux proves absence (`/proc/net/unix` lists every bound unix socket).
**Darwin cannot** — no such table, and Apple gates another user's descriptors —
so a walk that named nobody says `E darwin_proc_fds socket_holders
BLIND_OR_EMPTY` rather than claiming linux's proof.

Path match is **exact bytes**. No canonicalization, no symlink resolution: the
kernel bound what `bind(2)` was handed, and a path may contain spaces.

### Host facets

- CPU model nonempty; MHz nullable (Apple Silicon: `null` / `-`, never fake 0).
- Disk: total, `bfree`, `bavail` — both free meanings the kernel exposes.
- Failed uptime → `E … uptime`, omit `HUP`. Never fabricate boot-age 0.

### Partial success

| result | exit |
| --- | --- |
| some facts + some `E`/`U` | 0 (policy is the consumer's) |
| no facts, no `E` (an honest empty answer) | 0 |
| `E`-only / I/O fail | 1 |
| usage — unknown verb, bad flag, missing arg | 2 |

The version line is written on the **usage** path too, so exit status is what
separates a refusal from an answer: **only exit 1 carries a document.** A
consumer that parsed an exit-2 document would read *"this binary has no such
verb"* as *"nothing found"* — which is what an older binary on a caller's PATH
produces every time.

`facet` vocabulary lives once: `Facet` in `src/schema.rs` + `facets.json` → TS client. Both sides pinned by tests.

`BLIND_OR_EMPTY` = gated **or** genuinely empty; platform cannot tell them apart. Same code both OSes.

---

## Known limitations (OS policy, not bugs)

Same binary. Same questions. Kernel draws different lines.

| | Linux | Darwin |
| --- | --- | --- |
| always visible | name, real uid, RSS, CPU time, start (`/proc`) | pid/ppid/uid/state/nice/start/cmd (`kern.proc`); path via `proc_pidpath` |
| needs same-uid or root | cwd, fd targets (port + socket-holder attribution) | full view: RSS, CPU, cwd, argv, fd attribution |
| bound unix sockets | `/proc/net/unix`, world-readable → absence is proof | no table at all → `BLIND_OR_EMPTY`, never a claim of absence |
| listeners if owner hidden | TCP table world-readable → unclaimed `L` | same-uid fd walk still claims; macOS 27+ gates host-wide PCB list without Apple platform signing |

**Darwin extras we refuse to paper over:**

- `ps` is setuid + Apple-signed + `com.apple.system-task-ports.read`. We are none of those. ([reader](https://github.com/apple-oss-distributions/adv_cmds/blob/main/ps/tasks.c), [entitlement](https://github.com/apple-oss-distributions/adv_cmds/blob/main/ps/entitlements.plist))
- macOS 27: ad-hoc binary gets 48-byte empty PCB list; platform-signed `netstat` sees 29 listeners. We report `E darwin_tcp_pcblist ports_unclaimed BLIND_OR_EMPTY`, keep same-uid claimed listeners, union both sources.
- Layout drift → `E … EINVAL` (loud), not a silently short healthy table.
- No socket-owning uid on either Darwin source → always `E darwin_listeners ports_uid ENOTSUP`; uid column `-`.

One source can cost several facets; it says so **once per facet** (e.g. dead `kern.proc.all` → separate `E` for uid and status). Host-global constants that fail (`CLK_TCK`, page size, mach timebase) cost one `E`, never N per-pid `U`s.

---

## Who uses it

| consumer | shipped use |
| --- | --- |
| [kolu](https://github.com/juspay/kolu) | terminal-subtree port sensor, padi/kaval memory sampler, start-qualified daemon identity, daemon socket-holder lookup |
| [drishti](https://github.com/srid/drishti) | host process inspection + host telemetry (its own native readers retired) |
| you | `--json` or the TS client |

What remains is stated as remaining, not as present-tense: this directory has
not yet graduated to its own repo.

TS client: `client-ts/` → package `osfacts-client` (no `@kolu` scope, zero npm runtime deps). Path in: `KOLU_OSFACTS_BIN` (kolu store).

Former `@kolu/port-scan` is dead: protocol here, policy in padi, `PortInfo` fold in `@kolu/terminal-vocab`.

---

## Testing

Two lanes. Two questions. Both block merge.

### Lane 1 — did *we* break osfacts?

- Hermetic `nix build` + tests, both platforms, sandbox.
- Park a child (`osfacts-listener`) on port 0; assert *that* pid + *that* socket under scoped snap.
- Self-referential fixtures only. No "host table is empty".
- No `unshare`/netns dependency (broke ubuntu-latest; contradicted hermetic claim).
- Redact pid/uid/port → placeholders; rest byte-exact.
- Unreadable path: pid 1 (always there, always forbidden).

### Lane 2 — did the *OS* break osfacts?

- Real noisy host · nix-built binary · oracles: `ss` (Linux); `lsof` +
  `listeners` crate plus a `ps` process snapshot (Darwin). Darwin takes a
  second `ps` snapshot after the probe and accepts a missing PID only when
  that process retired or was reused, confirmed by `proc` returning `ESRCH`.
- CI recipe `ci::osfacts-live` — **not** a phase of `nix build`. Sandbox shuts the world out; this lane *is* the world.
- Gherkin scenarios (`cucumber`), same idiom as kolu e2e.
- Live reds block merge on purpose. Advisory reds train people to skip them. OS drift under the tool is exactly when you stop shipping.

---

## Status

| in | out (later) |
| --- | --- |
| OSF1–4, OSF6–8: procs, listeners, socket holders, RSS, start, CPU µs, uid, cwd, status, argv, host telemetry | extraction to its own repo (OSF5's remaining half) |
| every kolu consumer: port sensor, memory sampler, start-qualified daemon identity, socket-holder lookup | |
| drishti adoption: process inspection + host telemetry | |
| TSV + `--json`; mandatory `U`/`E` rows | |
| incubates in kolu monorepo (this dir = future repo root) | |

Plan of record (every claim + number measured):  
[os-facts-tool](https://kolu.dev/atlas/os-facts-tool.html)

---

```
License: MIT OR Apache-2.0
Bug reports: don't lie to us and we won't lie to you.
```
