# kolu-server

The **web shell**. It serves the PWA, holds the browser's one websocket, binds
one [`@kolu/padi`](../padi) per host — local and remote — and hosts the
**conductor**: the single ACP conversation that drives terminals on every one
of those hosts.

Everything about a terminal is padi's. kolu-server owns only what is true of the
*fleet*: which hosts there are, how each is reached, and the one agent
conversation whose subject is all of them.

## The host map

A host is a `@kolu/surface-remote` session dialled over ssh, re-serving that
host's `padiSurface` as an entry of one keyed map. The browser reads the map;
so does the conductor. Membership is persisted here — a small list of ssh
targets in kolu-server's own config store, distinct from the per-terminal state
each daemon keeps — so the fleet you added survives a restart of this process.

## The conductor — kolu-server's one child that is not a daemon

`src/conductor/` spawns the ACP adapter, holds its session, keeps its
transcript, and serves the whole of it as `koluSurface` members: the
`conductor` cell, the `conductorTranscript` stream and the `conductor`
procedure namespace. The protocol itself is [`@kolu/acp-harness`](../acp-harness)'s;
nothing here spells `session/prompt`.

**It is hosted here rather than in padi because its subject is the whole
fleet.** padi knows one host, and a conversation held by one padi can only ever
reach that host's terminals — so a fleet of five machines meant five
conversations, each blind to the other four, each needing to be asked
separately. There is one now, and it runs where kolu-server runs. The price is
stated plainly in the docs and worth repeating: a remote host has **no**
conductor while this process is down. The supervisor lives where you look.

**Its hands are kolu's own MCP face, lifted over the host map.** The tool list
is [`@kolu/kolu-mcp`](../kolu-mcp)'s — the same list `kolu mcp` serves an agent
inside a terminal, declared once and projected twice. The fleet projection names
a terminal `<host>/<id>`, adds the host to the repo-scoped tools, and answers a
live `hosts` resource; `serveKoluFleetMcp` takes a `FleetHosts` port this
package implements over the map above. A call naming a host that is not
connected is refused by name, never answered with an empty list.

**The adapter reaches it over a dedicated loopback listener.** `127.0.0.1`, an
ephemeral port, no TLS, serving exactly one MCP endpoint over
`StreamableHTTPServerTransport` — stateful, because the resource `updated`
notifications ride the standalone GET SSE stream. It is deliberately *not* a
route on the app listener: that one is TLS-able, bound wherever the user asked,
and origin-gated for browsers, and entangling the two would make the browser's
origin gate the thing standing between two local processes.

**One transport and one face per session**, which is what being stateful costs.
A stateful transport answers exactly one `initialize` and refuses every later
one, so a door holding a single transport would serve the first MCP client it
ever saw and nobody else — an adapter that crashes and respawns would get a
conversation with no hands for the life of the server. The door routes on
`Mcp-Session-Id`, mints a transport and a face for each `initialize`, and drops
both when the session closes. Each face gets its own watch registry, which is
what two clients should have: two fleets.

**The gate is a bearer token**, minted per process and compared with
`timingSafeEqual`; the adapter is handed it in its session's MCP server entry.
Loopback alone is not a gate — every other process on the box can reach it. And
the endpoint is **proved before it is named**: the conductor sends the same
`initialize` the adapter's client will send and demands a session back, then
terminates that session behind itself. An endpoint that is not listening, that
rejects the token, or that is listening and will not serve this caller refuses
the conversation with a sentence naming the URL, rather than handing the agent
a server it will mark failed for the life of the session.

**Hosts come and go without a seam.** ACP fixes the MCP server list at
`session/new`, so the conversation is opened against one URL and keeps it
forever. A host arriving is a `hosts` update, and the conductor's own watch
re-scopes onto it (`src/conductor/watcher.ts`): the terminals on it that the
Conductor is watching get a leg. A host leaving drops that leg and says
nothing more about its terminals — disconnected is not gone. Nothing reopens
the session.

### Lifetime

`src/conductor/live.ts` holds the one live host for this process:
`setFleetMcpEndpoint` is called once by the boot that owns the listener,
`liveServerConductor()` builds the conversation lazily on its first reader —
a kolu nobody has opened the conductor in runs no agent — and
`disposeServerConductor()` runs **first** in the teardown. That ordering is
load-bearing: the adapter is spawned detached, so nothing else in the teardown
reaches it, and without the explicit stop every restart would leave an adapter
and its `claude` behind and spawn a second set beside them.

### The watch — kolu-server starts turns of its own

`src/conductor/watcher.ts` is why the conversation never has to sit in a wait,
and it is WIRING only. For each host holding a terminal the Conductor watches,
it subscribes that host's padi `urgency` fold, its `terminals` keys and each
watched terminal's LINEAGE — its own record and then, recursively, the record
of whatever its `child-of` edge points at — and hands the frames to
`kolu-conductor`'s `readings.ts`, which says what they mean. The readings go to
the conversation (`observe`), which decides what is news, holds it while a turn
runs, and sends everything waiting as ONE wake when the turn ends.

Following the hosts themselves is not written here either: `kolu-mcp`'s
`overConnectedHosts` is the one implementation of "a leg per connected host,
re-opened as the map moves", shared with the fleet face's own folds. A leg
whose stream ends on its own is re-opened after a few seconds, alone — its
siblings never notice.

**What a reading carries** is how the terminal stands — working, asking,
stopped, a shell, asleep, gone — plus the agent in it and whether padi's
foreground is the terminal's own shell, and the top-level terminal its parent
edges end at (its PIECE OF WORK: a planner and the implementor it split off
are one thing going on, and the Conductor tab badges how many there are). The
walk happens on the host's own records because this is the one place that holds
every watched terminal's host — a browser has the edges only of the host it has
open, and a host that is away has none to walk, so the grouping is derived once
and remembered on the watch list's entries. The watch reports; it never
concludes. Whether a stop is a `ready` (an agent that has come up and has not
been spoken to), whether a shell is an `ended` (a terminal kolu opened with a
command, whose command ran and gave the prompt back with no agent ever in it),
and whether anything rings at all is `kolu-conductor`'s `watching.ts`. A slept
or boot-parked terminal reads as `asleep` rather than as a shell: its agent
was released with it, which is news exactly once, and the entry stays watched
because waking the terminal brings it back.

It is started **after** `implementKoluSurface` — reading the watch list reads
the remembered record, which publishes, and a publish before the cell writer
exists is the boot-order crash `live.ts` states — and disposed **before** the
conversation, so nothing can start a turn into a host that is shutting down. A
host that is not answering is parked, never mourned: disconnected is not gone.
A reading may WAKE the conversation; reading the list never starts the agent.

**A wake that cannot be delivered** — the agent refused it, or would not come
up — writes one `notice` row naming the terminals still waiting and why, puts
the news back, and is retried on the next edge that could carry it: the
conversation going idle, the agent coming up, or the next reading from this
watcher. One notice per failure episode, and no timer anywhere.

### The record

The transcript, the session id and the model the person chose live in
kolu-server's state store (`src/state.ts`), under its own migration rung;
attachments are files under `<state dir>/conductor/attachments/<id>`, and the
bytes never ride a prompt frame. A restart resumes the session by its id and
re-applies the model. What is not restored is anything that was a fact about a
subprocess that no longer exists — a turn in flight, a half-finished sign-in —
because a restored one would be a lie with a timestamp on it.

## What kolu-server knows nothing about

- **padi's internals.** The arrow points one way: this package consumes
  `padiSurface` through its client, exactly as every other consumer does. The
  few facts padi needs about the server are injected at padi's boot, never
  imported.
- **Terminal bytes.** An attach stream is proxied, not parsed. The headless
  mirror is kaval's.
- **The tool table.** It is declared in `@kolu/kolu-mcp` and served from here;
  widening it is a change in that package, reviewed there, so the two faces of
  it cannot drift apart.
