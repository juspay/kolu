# @kolu/port-scan

**"Which processes in these subtrees hold listening TCP sockets, and on what
addresses?"** — answered by spawning the baked [osfacts](../../osfacts/) binary,
without the caller learning how the OS was asked.

```ts
import { scanSubtreePorts } from "@kolu/port-scan";

// Keyed by the ROOT PID you asked about. Every requested pid is present, with an
// empty array when its subtree serves nothing.
const byRoot = await scanSubtreePorts([4242, 4310]);
// → Map { 4242 => [{ port: 5173, name: "node", scope: "loopback", family: "v4" }], 4310 => [] }
```

Two entry points, because they have different weights:

| import | what you get | safe in a browser bundle |
|---|---|---|
| `@kolu/port-scan` | the reader — `scanSubtreePorts`, `PortScanError`, `portScanSupported` | no (`node:child_process`) |
| `@kolu/port-scan/ports` | the vocabulary — `PortInfo`, `PortScope`, `PortFamily`, `foldPorts`, `samePortList`, `widerScope`, `preferredFamily` | yes (zod, nothing else) |

## The volatility it hides

How a kernel will tell you which processes hold listening sockets. That used to
be two hand-rolled readers (linux `/proc`, darwin a C libproc helper). Both are
gone (OSF2): the single OS touch is **osfacts**, and this package is a versioned
TSV consumer.

The absolute path to the binary is baked as `KOLU_OSFACTS_BIN` (from
`nix/env.nix` → the root flake's `.#osfacts`). **No `PATH` lookup, no env
override** — an absent required value is a crash, not a degraded scan.

## Two rules worth knowing before you call it

**A blind scan must never look like an empty one.** Answering "no ports" when we
could not look is a lie shaped exactly like the truth, so the reader throws
`PortScanError("blind")` instead — and a consumer holds its last good sample rather
than publishing `[]`. `"unsupported-platform"` is the other arm, and it must **not**
be retried.

**Attribution is the live ppid subtree, and nothing more.** Backgrounded jobs,
pipelines and grandchildren are seen. A true daemon (setsid / double-fork) has left
the subtree and is deliberately invisible.

**`U` rows from osfacts map onto the sudo lesson:** an unreadable *requested root*
is fatal (`blind`); an unreadable *descendant* (e.g. `sudo` at its password prompt)
is skipped so one foreign-uid child cannot empty every terminal's Ports section.

## Status

OSF2 is in: the C helper and the TypeScript `/proc` walk are deleted. The browser-
safe `ports.ts` vocabulary stays — both ends of the wire still need it. Further
osfacts facets (`--mem`, `--start-time`, `socket-holders`) are later phases
and do not land through this package.

See also: the [osfacts Atlas note](https://kolu.dev/atlas/os-facts-tool.html) and
the [port-forwarding note](https://kolu.dev/atlas/port-forwarding.html).
