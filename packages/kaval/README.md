# @kolu/pty-host

The **multi-client PTY-owner primitive**. One `PtyHost` owns any number of
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
| screen output  | `node-pty` `onData`             | `attach` (snapshot+deltas)|
| cwd            | OSC 7 `file://` reports         | `subscribeCwd` / `getCwd` |
| title          | OSC 0/2 title changes           | `subscribeTitle` / `getTitle` |
| command-run    | OSC 633 ; E ; `<cmd>` preexec   | `subscribeCommandRun`     |
| exit           | child exit code                 | `exitPromise`             |
| foreground pid | `tcgetpgrp(3)` at the tty       | `getForegroundPid`        |

## Two load-bearing properties

**Race-free attach.** `attach()` calls `subscribe()` then `serialize()` as two
back-to-back *synchronous* statements. Because the PTY publishes data only from
the headless write *callback* (a later task, after the byte is parsed into the
mirror), nothing can interleave between the two — every byte lands in exactly
one of `snapshot` / `deltas`, with no gap and no overlap. This is what lets a
late-joining client reconstruct the screen and then stream live output without
losing or double-painting a single chunk.

**Drop-slow-subscriber.** Each subscriber buffers independently up to
`maxQueue` (default 10,000) items. A consumer that stops draining — a wedged
browser tab on the chatty `data` stream — is **dropped** (its iterator ends)
rather than pinning server memory without bound. The client's transparent
re-subscribe then delivers a fresh snapshot.

## Usage

```ts
import { createPtyHost } from "@kolu/pty-host";

const host = createPtyHost({ log });

const { id, pid } = host.spawn({
  shell: "/bin/bash",
  args: ["--rcfile", wrapperRcPath],
  env, // fully prepared by the caller
  cwd: "/home/me/project",
  scrollback: 10_000,
  onDispose: () => cleanupRcFiles(),
});

// Late-join client: snapshot first, then live deltas.
const { snapshot, deltas } = host.attach(id, signal);
if (snapshot) send(snapshot);
for await (const chunk of deltas) send(chunk);

// Metadata taps.
for await (const cwd of host.subscribeCwd(id, signal)) onCwd(cwd);

host.write(id, "ls\n");
host.resize(id, 120, 40);
host.kill(id); // exitPromise(id) still resolves
```

## Scope

This package is a pure primitive extracted from kolu's in-process PTY code
(`#951` R-4, slice R4a). It is consumed **in-process** by `kolu-server` today.
The standalone-agent / daemon split (a `--stdio` supervisor, the agent surface
contract, reattach) is later work (R4b–R4c) and is deliberately **not** here.
