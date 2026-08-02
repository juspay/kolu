# kaval

<img src="./logo.svg" width="128" align="right" alt="Kaval terminal daemon logo: a guarded prompt with three PTY session dots" />

**kaval** (Tamil காவல், _kāval_ — "watch, guard"; pronounced **_KAH_-val**, the
first _a_ long, as in _father_) is the **multi-client PTY-owner primitive** (and
the standalone `kaval` daemon built on it). One `PtyHost` owns any number of
PTYs; each PTY is a `node-pty` child paired with an `@xterm/headless` screen
mirror and a set of VT-derived event taps, fanned out to any number of
consumers through a bounded broadcast `Channel`.

It owns **only** the PTY. It knows nothing about git, pull requests, agent
detection, the file tree, or any wire protocol — those live above it. It also
knows nothing about shell-environment preparation: callers hand it a ready
`shell` / `args` / `env` (kolu builds those in [`kolu-pty`](../integrations/pty)).

```
                       ┌──────────────────────── PtyHost ───────────────────────┐
   spawn(shell,env) ──►│  node-pty child ──► @xterm/headless mirror              │
                       │        │                     │                          │
                       │     onData              OSC 7 / 0,2 / 633               │
                       │        ▼                     ▼                          │
                       │   data Channel    cwd / title / commandRun Channels     │
                       └──────────┬───────────────────┬─────────────────────────┘
                        attach()  │      subscribe*()  │   exitPromise / foregroundPid
                                  ▼                    ▼
                          late-join clients     metadata consumers
```

## What it taps

| Tap            | Source                          | API                       |
| -------------- | ------------------------------- | ------------------------- |
| screen output  | `node-pty` `onData`             | `attach` (bounded snapshot+deltas) · `getHistory` (older chunks) |
| meaningful output (activity edge) | `onData`, **resize-repaint excluded** | host-global `activity` stream (`{ id }` edges; contract 5.3+) |
| cwd            | OSC 7 `file://` reports         | `subscribeCwd` / `getCwd` |
| title          | OSC 0/2 title changes           | `subscribeTitle` / `getTitle` |
| command-run    | OSC 633 ; E ; `<cmd>` preexec   | `subscribeCommandRun` / `getLastCommand` |
| exit           | child exit code                 | `exitPromise`             |
| foreground pid | `tcgetpgrp(3)` at the tty       | `getForegroundPid`        |

## Three load-bearing properties

**The snapshot is serialized at the consumer's grid — and `attach()` is a
write.** A serialized screen is bytes laid out *for a specific cols×rows* —
cursor moves and wraps only mean anything at the width they were written for. So
`attach()` takes `resizeTo`, the grid the consumer will render into, **resizes
the PTY to it**, and serializes as **one act**. The name is deliberate: this is
the same `resize()` every other caller uses, so a genuine change `SIGWINCH`es the
child, reflows the shared mirror, invalidates the snapshot memo, and (on a width
change) bumps the reflow epoch that stales every *other* attached client's
backfill cursor. Attaching mutates state the whole PTY can see; the policy is
last-attach-wins. Because a re-attach is now a resize, two differently-sized
viewers move the PTY on any stream *re-subscribe*, not only when a human resizes.

What the fusion buys is that the size travels *with* the request instead of
racing it through a separate `resize()` — so "a snapshot for a size the consumer
isn't" can no longer be produced by two calls landing out of order. It used to be
a discipline each caller had to remember (resize first, then attach), and a
caller that got it wrong had no way back: a same-dimensions `resize()` is
correctly a no-op, so no `SIGWINCH` reaches the process and nothing ever
repaints. The bad state is still *expressible* by omitting `resizeTo` — which
only a caller with no grid of its own (a CLI dumping the screen) may do, and
which reads the PTY at its current size.

**Race-free attach.** `attach()` calls `subscribe()` then `serialize()` as two
back-to-back *synchronous* statements. Because the PTY publishes data only from
the headless write *callback* (a later task, after the byte is parsed into the
mirror), nothing can interleave between the two — every byte lands in exactly
one of `snapshot` / `deltas`, with no gap and no overlap. This is what lets a
late-joining client reconstruct the screen and then stream live output without
losing or double-painting a single chunk.

The attach snapshot is **bounded** — the recent screenful (`SNAPSHOT_SCROLLBACK`),
not the whole `DEFAULT_MIRROR_SCROLLBACK`-deep mirror — so a cold or cross-host
attach paints instantly instead of replaying 10k lines. It carries a `topLine`
seed (the absolute mirror-line index of its top row); older history streams in on
demand through **`getHistory(before, max)`**, which serves the chunk of rows just
*above* an absolute cursor. Absolute addressing is what makes the seam where
backfilled history meets existing content race-free: new output always appends at
the mirror bottom, never shifting a line the client already holds, so a served
chunk can neither duplicate nor skip a row regardless of in-flight output. The
eviction origin the cursor rides on is tracked off the mirror's `onTrim`.

**Cheap under a reconnect storm.** A client that drops and reconnects
re-`attach()`es every terminal at once, aborting the in-flight attaches and
re-issuing them. Two defenses keep that burst from serializing the mirror N times
over: an attach whose `signal` is already aborted returns an empty snapshot and
does **no** `serialize()` (its subscriber is already gone), and the serialized
snapshot is **memoized per publish-epoch** — a burst of attaches to one PTY
between two output bytes shares a single `serialize()`, the memo cleared the
instant new data parses into the mirror.

The publish-epoch is the *only* grain that coalesces the storm: its attaches
arrive across many event-loop turns (one per re-issued wire message), so a
shorter release (a microtask/turn/timer) would fire mid-storm and undo the
sharing — whereas an idle terminal emits no data, so its epoch spans the whole
burst. The cost of that grain is that the memo pins one serialized snapshot per
terminal until its next mutation (an idle terminal's lingers; `getScreenState`
populates the same slot). It's bounded — strictly smaller than the live mirror
it shadows, freed on the next data/resize or on teardown — so it adds a fraction
to the mirror's existing per-terminal footprint, not a new unbounded retention.

**Drop-slow-subscriber.** Each subscriber buffers independently up to
`maxQueue` (default 10,000) items. A consumer that stops draining — a wedged
browser tab on the chatty `data` stream — is **dropped** rather than pinning
server memory without bound. The drop emits a typed `overflow` control frame as
the attach stream's last frame (contract 4.0), distinct from a PTY exit, so the
client re-attaches for a fresh snapshot instead of mistaking the drop for a dead
terminal and freezing its scrollback.

## Usage

```ts
import { createPtyHost } from "kaval";

const host = createPtyHost({ log });

const { id, pid } = host.spawn({
  shell: "/bin/bash",
  args: ["--rcfile", wrapperRcPath],
  env, // fully prepared by the caller
  cwd: "/home/me/project",
  scrollback: 10_000,
  onDispose: () => cleanupRcFiles(),
});

// Late-join client: snapshot first, then live deltas. `resizeTo` RESIZES the
// shared PTY (SIGWINCH + mirror reflow) and the snapshot comes back laid out
// for it — omit it if you have no grid of your own.
const { snapshot, deltas } = host.attach(id, signal, {
  resizeTo: { cols: 120, rows: 40 },
});
if (snapshot) send(snapshot);
for await (const chunk of deltas) send(chunk);

// Metadata taps.
for await (const cwd of host.subscribeCwd(id, signal)) onCwd(cwd);

host.write(id, "ls\n");
host.resize(id, 120, 40);
host.kill(id); // exitPromise(id) still resolves
```

## Scope

This package began as a pure primitive extracted from kolu's in-process PTY
code (`#951` R-4, slice R4a), consumed **in-process** by `kolu-server`. It now
also ships the standalone `kaval` daemon: the same `PtyHost` served over a unix
socket via `@kolu/surface-daemon`'s `gate → serve → teardown` skeleton, reached
by the `kaval-tui` CLI. The primitive itself stays pure — it knows nothing about
the socket, the gate, or the wire; those compose on top. The daemon adds the
frozen `control.core.hello` identity channel beside the historic flat pty-host
surface; `system.version` remains byte-for-byte available to existing clients.
Kaval cannot drain without destroying live PTYs, so its frozen `drain(): void`
verb refuses by throwing. The frozen fragment declares no error schema, so that
refusal crosses as a defect rather than as something a supervisor could narrow on
and "handle"; its not-drainable supervisor policy makes normal invocation
structurally impossible anyway.

The pty-host wire is now contract **7.0** — the Effect-4 protocol epoch. No
payload shape moved (every member encodes byte-for-byte as it did under zod,
pinned by literal-JSON fixtures in `ptyHostSurface.test.ts`); the FRAMING did,
from oRPC's base64+newline peer protocol to Effect RPC ndjson. That is a declared
flag day: a 6.x peer cannot be asked its version at all, because its first frame
is undecodable, so cross-epoch peers are observed as an *unspeakable protocol* at
the transport rather than as a version skew. The constant still bumps because it
remains the **in-epoch** skew mechanism — see its note in `ptyHostSurface.ts`.

### Compose the daemon wire

`serveKavalDaemonSurface` is the supported composition boundary for embedding the
complete daemon wire. It takes an already-created pty-host runtime plus the
daemon home, and returns `{ group, handlers }` with the shared `{ done, close }`
lifetime. Composition is a disjoint union of two flat tag maps — the pty-host
surface at its historic `surface/…` tags, the frozen control fragment as a
`control` sibling at `surface/control/core/…` — asserted for collisions, never
spliced. Clients type the pty half from `ptyHostSurface` and the control half
from `kavalControlSurface`; a client that needs both dials one link over
`kavalDaemonGroup`. The pty-host captures one boot record; both the historic
version route and the frozen identity channel project from it.

```ts
import {
  createInProcessPtyHost,
  kavalDaemonGroup,
  serveKavalDaemonSurface,
} from "kaval";

const ptyHost = createInProcessPtyHost({ log, rcDir, lifetime });
const daemon = serveKavalDaemonSurface({
  ptyHost,
  stateRoot: daemonHome.dir,
});

serveOverUnixSocket({
  socketPath,
  group: daemon.group,
  handlers: daemon.handlers,
});
// Observe daemon.done; await daemon.close() during teardown.
```

### Talk to a pty-host

`ptyHostClientOver(dispatch)` builds the one typed face — over a wire link's
dispatch (`unixSocketLink`, `stdioLink`) or the in-process `directDispatch`.
`createInProcessPtyHost(...).client` is that same face over the no-wire leg.

```ts
import { unixSocketLink } from "@kolu/surface/links/unix-socket";
import { ptyHostClientOver, ptyHostSurface } from "kaval";

const link = await unixSocketLink({ group: ptyHostSurface.group, socketPath });
const client = ptyHostClientOver(link.dispatch);

await client.surface.terminal.list({}); // Promise<{ entries }>
client.surface.terminalAttach.get({ id }); // Stream<PtyHostDataMsg> — lazy
await link.dispose(); // releases the link's protocol fibers
```

A procedure still returns a `Promise`; a streaming member returns a lazy
`Stream`, synchronously. Cancellation is fiber interruption — there is no
`AbortSignal` to thread. A pull-shaped consumer runs it with
`Stream.toAsyncIterable` and unsubscribes with `iterator.return()`.
