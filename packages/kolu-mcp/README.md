# kolu-mcp

`kolu mcp` — the kolu binary's **agent face**: this host's terminals served to
a coding agent over [MCP](https://modelcontextprotocol.io) (stdio), as a pure
`padiSurface` client re-exposed through
[`@kolu/surface-mcp`](../surface-mcp/README.md). No kolu-server anywhere — the
package manifest is the graduation fence (padi/surface deps only), so the face
provably serves agents with padi alone.

What an agent gets is the **ratified v1 expose map** (`src/expose.ts`),
default-deny with named, tested denials:

- **resources** (subscribable): `terminals` (the roster), `urgency` (who needs
  a human now), and the status story (`status` · `daemonStatus` · `identity` —
  kaval health + padi's own generation, so a daemon restart is *data*, not an
  anomaly);
- **read-only tools**: `screen_text` (tail-mode snapshot) · `screen_history` ·
  `git_getStatus`/`git_getDiff` · `fs_listAll`/`fs_readFile`, the two composite
  done-signals `wait_outputSettled` / `wait_agentState` (the /orchestrator·/kolu
  dispatch loop's load-bearing verbs), and `watch_next` (below);
- **mutating tools**: `lifecycle_create` · `lifecycle_kill` ·
  `lifecycle_sendInput` (text XOR one named key — `Enter`, `Escape`, `C-c`
  chords — because submit is its OWN Enter after an observed settle, never
  text+newline fused) · `watch_open`/`watch_close`.

**Supervising several terminals: subscribe, don't re-arm.** The `wait_*` tools
watch ONE terminal for ONE condition, and only while the call is open — so a
supervisor of several workers had to hand-roll a watcher layer on top, and
anything happening between two waits was unobservable. `watch_open` +
`watch_next` is the shape without that hole: events accumulate in **padi**, which
outlives both this process and kaval, so the time between two calls is not a
blind spot. Subscriptions are keyed by a name you choose, so re-opening the same
name reattaches to its queue rather than starting an empty one.

The honest scope of "survives": the queue is padi's process memory, so it comes
through **this MCP server restarting** and a **kaval recycle** — but a restart of
**padi itself** (an upgrade) clears every subscription. A `watch_next` against a
name padi no longer holds FAILS naming it, rather than reporting the quiet that
an empty queue would look like; re-`watch_open` and carry on. A queue holds the
most recent `WATCH_BUFFER_LIMIT` (512) events per subscription, and a batch that
overflowed reports how many it dropped.

A drain is **acknowledged, not destructive**: pass each result's `ackAfter` back
as the next call's `after`. Until you do, those events stay queued and come again —
so a reply lost in flight (a host's call timeout, an interrupted turn) costs a
repeat rather than a report. Every event carries a `seq` to dedupe on.

Each event names a terminal and why — `asking` (its agent is blocked on input),
`finished` (its turn ended *and* its output went quiet), or `gone` (it no longer
exists, so stop waiting on it). Read the terminal's screen yourself with
`screen_text`; the event carries no transcript, so you always act on current
output rather than a copy that aged in a queue.

If your supervisor is itself a kolu terminal, you may need none of this: padi
delivers a worker's settle into its parent terminal's input by construction (see
[`packages/padi`](../padi/README.md)), so an agent that spawned a worker with
`parentId` is told without subscribing to anything.

kolu-cli (the composition root) owns the connect layer and injects the
connected client; `serveKoluMcp` here owns zero transport code. The e2e pin
(`kolu-cli/src/mcp.e2e.test.ts`) drives a real padi over both transports —
the unix socket and the ssh-shaped stdio pipe — plus the restart legs.

**A padi restart costs the agent nothing.** The injected connection carries
padi's close announcement, so the adapter discards a dead connection the moment
padi says the socket closed rather than by spending a request on it
([#2082](https://github.com/juspay/kolu/issues/2082) — the full story lives on
`OwnedSurfaceConnection.onClose`). Local socket arm only: `kolu mcp --host`
(ssh) does not carry the announcement yet, so a remote restart keeps the older
behaviour.

Plan of record: the kolu-cli Atlas note
([kolu.dev/atlas/kolu-cli.html](https://kolu.dev/atlas/kolu-cli.html)).
