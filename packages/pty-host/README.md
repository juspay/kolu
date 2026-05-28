# @kolu/pty-host

The long-lived, multi-client **PTY-owner primitive** behind Kolu's local
terminal daemon. One process holds the `node-pty` children, mirrors each
into an [`@xterm/headless`](https://www.npmjs.com/package/@xterm/headless)
instance for cheap screen-state snapshots, and fans PTY output + OSC
metadata out to any number of subscribers.

It is a *peer* of [`@kolu/surface`](../surface/), not an extension of it
— `pty-host` has **no dependency on `@kolu/surface`**. The Kolu agent
composes both: `@kolu/surface` for the typed wire protocol, `@kolu/pty-host`
for owning the PTYs the protocol exposes. (That's why it's named
`pty-host`, not `surface-…-pty-host`.)

## Why it exists

Before R-4 ([#1010](https://github.com/juspay/kolu/pull/1010)), kolu-server
spawned `node-pty` children in-process, so every terminal died when
kolu-server restarted. `@kolu/pty-host` moves PTY ownership into a
separate, long-lived process (the `kolu --stdio` daemon). kolu-server
becomes a *client* of that process and reconnects to it across its own
restarts — local terminals keep running with intact scrollback. The same
primitive is what a remote SSH agent will use to own PTYs on the far host.

## API

```ts
import { createPtyHost } from "@kolu/pty-host";

const host = createPtyHost({ log });

const { id, pid } = host.spawn({
  shell: "/bin/bash",
  args: shellInit.args,
  env,              // caller layers cleanEnv() + Kolu identity + shell-init
  cwd: "/home/me",
});

// Snapshot-then-delta attach — the cut that makes reattach cheap.
const { snapshot, deltas } = await host.attach(id);
//    ^ serialized screen state (VT escapes) at attach time
feedToXterm(snapshot);
for await (const chunk of deltas) feedToXterm(chunk); // live output

host.write(id, "ls\n");
host.resize(id, 120, 40);
host.kill(id);
```

### `PtyHost`

| Method | Purpose |
| --- | --- |
| `spawn(opts)` | Start a PTY. Returns `{ id, pid }` immediately. `opts.id` lets the caller supply the id (Kolu passes its terminal id so reattach-by-id works). |
| `attach(id, signal?)` | `{ snapshot, deltas }` — the current serialized screen state, then an async-iterable of live output. The **snapshot-then-delta** contract: a late joiner or a reconnecting client picks up exactly where the PTY is, with no raw-scrollback replay. |
| `subscribeCwd / subscribeTitle / subscribeCommandRun(id, signal?)` | Per-PTY OSC metadata streams — OSC 7 (cwd), OSC 0/2 (title), OSC 633;E (preexec command). |
| `exitPromise(id)` | Resolves with the exit code when the child exits (immediately if already exited). |
| `write / resize / kill(id, …)` | Control verbs. |
| `list()` | `{ id, pid, cwd, lastActivity }[]` for every live PTY. |
| `getProcess / getForegroundPid / getCwd(id)` | Synchronous reads of the current foreground process name, foreground pid (`tcgetpgrp`), and cwd — for agent / git detection without a round-trip. |
| `getScreenState(id)` / `getScreenText(id, start?, end?)` | Serialized VT screen state / plain-text buffer extraction. |
| `dispose()` | Kill every PTY and close every channel. |

## Internals

- **`node-pty`** owns the child process; an **`@xterm/headless`** terminal
  parses its output so `getScreenState()` can serialize a ~4 KiB snapshot
  instead of replaying the whole scrollback. The `@xterm` packages ship
  CJS only, so they're loaded through a `createRequire` shim.
- **`Channel<T>`** (`src/channel.ts`) is a tiny internal multi-subscriber
  fan-out — each `subscribe()` gets its own back-pressure-buffered async
  iterable. It's deliberately internal rather than reusing
  `@kolu/surface`'s `inMemoryChannel`, so the package stays surface-free.
- OSC parsing (7 → cwd, 0/2 → title, 633;E → command) mirrors the shapes
  Kolu's metadata providers consume, so the daemon can serve the same
  per-terminal metadata the in-process path served before R-4.

## Scope

`@kolu/pty-host` owns PTY lifecycle and output fan-out — nothing else. It
does **not** prepare the shell environment (`cleanEnv`, the OSC-emitting
rcfile) — that's [`kolu-pty`](../integrations/pty/)'s job; the caller
layers that env and passes it to `spawn`. And it does not speak any wire
protocol — the agent wraps it in `@kolu/surface`'s `agentSurface`.
