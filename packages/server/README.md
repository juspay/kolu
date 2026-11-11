# kolu-server

The **web shell**. It serves the PWA, holds the browser's one websocket, binds
one [`@kolu/padi`](../padi) per host — local and remote — and hosts the
**orchestrator**: the single ACP conversation that drives terminals on every one
of those hosts.

Everything about a terminal is padi's. kolu-server owns only what is true of the
*fleet*: which hosts there are, how each is reached, and the one agent
conversation whose subject is all of them.

## The host map

A host is a `@kolu/surface-remote` session dialled over ssh, re-serving that
host's `padiSurface` as an entry of one keyed map. The browser reads the map;
so does the orchestrator. Membership is persisted here — a small list of ssh
targets in kolu-server's own config store, distinct from the per-terminal state
each daemon keeps — so the fleet you added survives a restart of this process.

## The orchestrator — kolu-server's one child that is not a daemon

`src/orchestrator/` spawns the ACP adapter, holds its session, keeps its
transcript, and serves the whole of it as `koluSurface` members: the
`orchestrator` cell, the `orchestratorTranscript` stream and the `orchestrator`
procedure namespace. The protocol itself is [`@kolu/acp-harness`](../acp-harness)'s;
nothing here spells `session/prompt`.

**It is hosted here rather than in padi because its subject is the whole
fleet.** padi knows one host, and a conversation held by one padi can only ever
reach that host's terminals — so a fleet of five machines meant five
conversations, each blind to the other four, each needing to be asked
separately. There is one now, and it runs where kolu-server runs. The price is
stated plainly in the docs and worth repeating: a remote host has **no**
orchestrator while this process is down. The supervisor lives where you look.

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
the endpoint is **proved before it is named**: the orchestrator sends the same
`initialize` the adapter's client will send and demands a session back, then
terminates that session behind itself. An endpoint that is not listening, that
rejects the token, or that is listening and will not serve this caller refuses
the conversation with a sentence naming the URL, rather than handing the agent
a server it will mark failed for the life of the session.

**Hosts come and go without a seam.** ACP fixes the MCP server list at
`session/new`, so the conversation is opened against one URL and keeps it
forever. A host arriving is a `hosts` update and its terminals flow into the
fleet watch already open; a host leaving reports its terminals gone and drops
out. Nothing reopens the session.

### Lifetime

`src/orchestrator/live.ts` holds the one live host for this process:
`setFleetMcpEndpoint` is called once by the boot that owns the listener,
`liveServerOrchestrator()` builds the conversation lazily on its first reader —
a kolu nobody has opened the orchestrator in runs no agent — and
`disposeServerOrchestrator()` runs **first** in the teardown. That ordering is
load-bearing: the adapter is spawned detached, so nothing else in the teardown
reaches it, and without the explicit stop every restart would leave an adapter
and its `claude` behind and spawn a second set beside them.

### The record

The transcript, the session id and the model the person chose live in
kolu-server's state store (`src/state.ts`), under its own migration rung;
attachments are files under `<state dir>/orchestrator/attachments/<id>`, and the
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
