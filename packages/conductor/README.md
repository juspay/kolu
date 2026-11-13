# kolu-conductor

The **Conductor**'s server half: one Claude conversation over the [Agent Client
Protocol](https://agentclientprotocol.com) for a whole fleet, as a package kolu
mounts.

Three things make the conversation work and they are all here:

- **the host** (`startConductorHost`) — owns the ACP child, the transcript, the
  attachments on disk and the throttled record; translates the harness's two
  refusals into the two errors a caller branches on;
- **the record** (`./persisted`) — what survives a restart, and the re-validation
  that refuses a transcript with holes in it rather than drawing one;
- **the standing prompt** — what the agent is told, once, on the first turn.
  The words are in [`src/teaching.md`](src/teaching.md), one wrapped paragraph
  per instruction, read when kolu-server starts (a missing or malformed file
  stops the boot); `teaching.ts` sends each paragraph as one `[kolu] ` line.

The `koluSurface` members a browser subscribes to are here too (`./surface`),
because an implementation of "what `conductor.prompt` does" belongs with the
thing that does it.

## The watch, the hold and the wake

The Conductor never sits in a wait. It says what it is watching and ends its
turn; kolu-server watches, and starts a turn when something happens.

- **The list** (`watchTerminal` / `unwatchTerminal` / `watched`) — fleet refs
  (`host/id`), in the order they were added, saved with the conversation. Per
  entry the record keeps what a restart cannot re-derive: the name kolu last
  saw, whether an agent was ever seen in it, and the level the conversation has
  already been TOLD about. Spelled `watchTerminal`, not `watch`, because
  `watch` on this host is the transcript subscription and has been since there
  was a transcript.
- **The decision** (`./watching.ts`, pure) — one reading of one terminal
  becomes a wake level or nothing: working forgets what we were told, a shell
  never rings, a terminal that goes away rings only if an agent was ever seen
  in it (and drops either way), and a level equal to `told` does not ring
  twice. That last rule is what makes a restart quiet.
- **The hold** (`./held.ts`, ported from olai's `deliveries.ts`) — while a turn
  runs, news WAITS: one slot per terminal, newest only, kept in the position
  the first one took, withdrawn when that terminal goes back to working. On
  every turn boundary — however the turn ended, a cancel included — everything
  waiting leaves as ONE `harness.wake(...)`, one row with N events. Held news
  is memory only: a restart re-reads the world instead of replaying a queue
  about one that has moved on.
- **The account** (`./wakeText.ts`, pure) — what the agent is actually handed:
  who speaks, each terminal as `host/id` with its name, host, agent and how it
  stands, and what to do about it — read the screen, answer with `agent_say`,
  then end the turn.

A wake MAY start the agent (that is the feature); reading the list may not
(`watched()` is bookkeeping). The readings themselves come from kolu-server's
`conductor/watcher.ts`, over padi's own `urgency` fold and `terminals`
collection, for refs on CONNECTED hosts only — a host that is not answering
says nothing about its terminals, and `gone` for one of them would be a lie.

## Why a package

The same argument `kolu-mcp` makes one shelf over: **a face kolu mounts is not
kolu-server's inside.** kolu-server is a web server, a host map and a state
ladder; that it also supervises a Claude subprocess is a separate concern on a
separate clock — ACP's — and the wall is what keeps a protocol bump out of the
file that serves the websocket.

## The mount

The dependency arrow points **out** and never back. This package reads
`@kolu/acp-harness`, `@kolu/acp`, `kolu-common`'s schema and `kolu-agents`'
registry, and knows nothing about kolu-server. Everything server-owned is
**pushed in** at the mount — `packages/server/src/conductor/live.ts`:

| pushed in | why it is the server's |
| --- | --- |
| `store` · `storePath` · `stateRoot` | kolu has one state ladder and one state directory, and they are kolu-server's |
| `fleetMcp` · `proveFleetMcp` | the loopback MCP door, and the `initialize` that proves it — the MCP SDK's pin, not ACP's |
| `publish` | the served cell's writer; importing the ctx would be a cycle |
| `home` · `hostName` | facts about the machine kolu-server is running on |
| `spawn` | the composition root is the one place that knows a conversation is a subprocess |

`packages/server/src/seal.test.ts` holds the wall in both directions: arm (g)
fails if a file here imports kolu-server, and fails again if kolu-server reaches
past this package's published doors.

## What deliberately did not move

- **The wire schema** stays in `kolu-common` — the browser reads it too, and a
  browser must not import a package that spawns subprocesses.
- **The migration rung** and the `PersistedStateSchema` key stay in
  `packages/server/src/state.ts`: kolu has one ladder and it has one home. The
  record's own schema is this package's export, which is the half that describes
  the data rather than the file.
- **The UI** is `packages/client/src/conductor/`.
- **No test lane of its own.** The Conductor's suites are composition tests — the
  host against the real fleet MCP door and the real tool registry — so they run
  in `packages/server`'s. Stubbing the door to relocate them is exactly the drift
  one of those tests exists to stop: an imitation answered `400`, the proof
  passed on it, and a door that could serve nobody looked healthy.
