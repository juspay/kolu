# @kolu/port-scan

**"Which processes in these subtrees hold listening TCP sockets, and on what
addresses?"** — answered in one host-wide pass, without the caller learning how the
OS was asked.

```ts
import { scanSubtreePorts } from "@kolu/port-scan";

// Keyed by the ROOT PID you asked about. Every requested pid is present, with an
// empty array when its subtree serves nothing.
const byRoot = await scanSubtreePorts([4242, 4310]);
// → Map { 4242 => [{ port: 5173, name: "node", scope: "loopback" }], 4310 => [] }
```

Two entry points, because they have different weights:

| import | what you get | safe in a browser bundle |
|---|---|---|
| `@kolu/port-scan` | the reader — `scanSubtreePorts`, `PortScanError`, `portScanSupported` | no (`node:fs`, `node:child_process`) |
| `@kolu/port-scan/ports` | the vocabulary — `PortInfo`, `PortScope`, `foldPorts`, `samePortList`, `widerScope` | yes (zod, nothing else) |

## The volatility it hides

How a kernel will tell you which processes hold listening sockets. This repo has
already varied along that axis three times on darwin alone — `netstat`, then
`ps` + `lsof`, now a libproc helper this package builds — and linux answers by an
entirely different mechanism (`/proc` read directly), in an entirely different byte
order. That is the receptacle: consumers plug into `scanSubtreePorts` and never
learn which.

- **linux** — `/proc/net/tcp{,6}` joined to `/proc/<pid>/fd` by socket inode.
- **darwin** — `native/` (a small C libproc reader, built by the Nix derivation
  there). Its path is baked as `KOLU_PORT_SCAN_HELPER`, with **no `PATH` fallback**:
  an absent required value is a crash, not a degraded scan. Build and run its checks
  alone on a Mac with `nix build .#port-scan-helper`.

## Two rules worth knowing before you call it

**A blind scan must never look like an empty one.** Answering "no ports" when we
could not look is a lie shaped exactly like the truth, so the reader throws
`PortScanError("blind")` instead — and a consumer holds its last good sample rather
than publishing `[]`. `"unsupported-platform"` is the other arm, and it must **not**
be retried.

**Attribution is the live ppid subtree, and nothing more.** Backgrounded jobs,
pipelines and grandchildren are seen. A true daemon (setsid / double-fork) has left
the subtree and is deliberately invisible.

## Status: expected to be superseded

This package is **not a permanent home**. It is the first, measured cut of a reader
that the [osfacts Atlas note](https://kolu.dev/atlas/os-facts-tool.html) proposes
replacing outright — one standalone versioned Rust binary answering every OS process
and socket fact, for kolu *and* [drishti](https://github.com/srid/drishti), instead
of the five hand-rolled readers kolu has today.

Concretely, the deprecation path that note sets out:

1. **The darwin C helper goes first** — replaced by `osfacts`' single libproc pass.
   `portview` measured 9.9 ms in Rust against this helper's 10.6 ms on the same box
   by the same method, so the language was never the constraint.
2. **Then the linux TypeScript reader** in `scan.ts`, whose `/proc` walk becomes a
   subtree descent inside the tool.
3. **Then `memorySampler` and `socketHolder`**, which is the point at which this
   package has no distinct reason to exist and should be **removed**, with
   `ports.ts` — the browser-safe vocabulary — surviving as the leaf both ends of the
   wire still need.

No date, deliberately: the note is `status: proposed` and nothing of it shipped in
[#1982](https://github.com/juspay/kolu/pull/1982). What is *not* in question is that
the reader is the replaceable part and the receptacle is not — which is exactly why
it is a package and not a module inside padi.

Two upstream threads the migration waits on:
[listeners#57](https://github.com/GyulyVGC/listeners/pull/57) (the v4-mapped address
fix this repo found and filed) and the scoping work `osfacts` needs, since no
surveyed tool costs what you *ask for* rather than what the host *has*.

See also: the [port-forwarding note](https://kolu.dev/atlas/port-forwarding.html) for
where this sits in kolu's Ports feature, and `native/portScanDarwin.c` for the
syscall-level detail (including the `insi_vflag` dual-stack ordering that three
separate tools, this one included, each got wrong).
