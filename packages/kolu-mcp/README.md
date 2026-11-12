# kolu-mcp

kolu's **agent face**, in two projections of ONE expose map
([MCP](https://modelcontextprotocol.io) through
[`@kolu/surface-mcp`](../surface-mcp/README.md)):

- **`kolu mcp` — one host, over stdio.** This host's terminals, as a pure
  `padiSurface` client. Terminal ids are bare. This is what an agent working
  *inside* a kolu terminal drives, and no kolu-server is anywhere in it — the
  package manifest is the graduation fence (padi/surface deps only), so the
  face provably serves agents with padi alone.
- **`serveKoluFleetMcp` — every host, inside kolu-server.** The same tool list
  lifted over kolu-server's host map, where a terminal is `host/id`. This is
  what the one conductor conversation holds, over a loopback
  streamable-HTTP transport kolu-server owns. It reaches the hosts through a
  PORT (`FleetHosts`), never by importing kolu-server, so the fence holds here
  too.

**The tool list has one definition** (`KOLU_MCP_TOOL_EXPOSE` in `src/expose.ts`,
spread into both maps): the two faces differ in what a terminal is *called*,
never in what may be done to one. The rest of this page is the single-host face;
[the fleet projection](#the-fleet-projection) is at the foot.

What an agent gets is the **ratified v1 expose map** (`src/expose.ts`),
default-deny with named, tested denials:

- **resources** (subscribable): `terminals` (the roster), `urgency` (who needs
  a human now), and the status story (`status` · `daemonStatus` · `identity` —
  kaval health + padi's own generation, so a daemon restart is *data*, not an
  anomaly);
- **read-only tools**: `screen_text` (tail-mode snapshot; padi cuts the tail, so
  only the asked-for lines leave the daemon) · `screen_image` (the
  same screen as a themed PNG, returned as an MCP image block — reach for it
  when the answer is *visual*: a TUI's layout, a coloured diff, a pass/fail run
  a text dump flattens into indistinguishable characters. `screen_text` stays
  the default read, because characters cost a fraction of the context and
  answer "did it finish?" on their own) · `screen_history` ·
  `git_getStatus`/`git_getDiff` · `fs_listAll`/`fs_readFile`, the two composite
  done-signals `wait_outputSettled` / `wait_agentState` (the /orchestrator·/kolu
  dispatch loop's load-bearing verbs), and `watch_next` (below);
- **mutating tools**: `lifecycle_create` (bespoke: `kolu create` parity in one
  call — `placement` is REQUIRED and has no default, either
  `{"kind":"toplevel"}` or `{"kind":"child-of","parentId":"…"}`, because an agent
  is exactly the caller that never notices a placement it did not choose;
  `repo` + `worktree` cut a fresh git worktree at
  `<repo>/.worktrees/<name>` and open the terminal in it, `run` types a first
  command at the shell prompt; still NO `command`/`env` spawn parameter, ever —
  the #1872 protection) · `lifecycle_kill` · `lifecycle_sendInput` (text XOR
  one named key — `Enter`, `Escape`, `C-c` chords — because submit is its OWN
  Enter after an observed settle, never text+newline fused) ·
  `watch_open`/`watch_close`.

**A refusal is data, not a sentence to parse.** `lifecycle_sendInput` refuses
four things on purpose, and a driver recovers from each differently — so each
one names itself in the result's `structuredContent`: `text-and-key` (re-send as
two calls), `key-refused` (carrying the spelling that was rejected),
`text-refused` (the shared encoder refused this face's text — today, because it
was empty, precisely what a 0-byte "sent" used to hide) and `no-input` (neither
field was passed). The kinds name the BRANCH rather than
`@kolu/terminal-protocol`'s internal reason, which the unchanged sentence beside
them still carries — so a kind is *not* 1:1 with a reason, and the sentence is
where a driver reads which rule fired. `lifecycle_create` does the same for its
DIRECTORY gates (`cwd-and-worktree`, `worktree-needs-repo`,
`repo-without-worktree`, `blank-field`) — its CANVAS placement is refused a
layer earlier, by the shared wire schema, so it never reaches this channel —
and for a composition that stopped
partway (`stopped-partway`, whose `landed` names the worktree and/or terminal
that already exist — nothing is rolled back). They ride
[`@kolu/surface-mcp`](../surface-mcp/README.md)'s `ToolFailure`, the one failure
the adapter carries detail through.

Both waits take the two kolu#2139 modifiers, because the races they close are
races **between calls** and an agent driving over MCP makes exactly the same
three-call loop a CLI one does: `settledMs` is a CONJUNCT (the met needs the
condition to hold *and* the output to have been quiet that long — bytes still
moving keep the wait open), and `screenTail: N` puts the last N screen lines on
the met, read inside the same wait rather than by a follow-up `screen_text` the
terminal can move under — with the same padi-side cut `screen_text { tail }`
gets. `wait_agentState` with `until: ["awaiting","waiting"],
settledMs: 15000, screenTail: 40` is the `kolu debrief` protocol — named in that
tool's description rather than shipped as a third composed tool, since over MCP
it is three JSON keys and a tool costs its whole description in every request.

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

kolu-cli (the composition root) owns the connect layer and injects the
connected client; `serveKoluMcp` here owns zero transport code. The e2e pin
(`kolu-cli/src/mcp.e2e.test.ts`) drives a real padi over both transports —
the unix socket and the ssh-shaped stdio pipe — plus the restart legs.

**Open fails when padi is unreachable.** `kolu mcp` probes the dialled padi
before the MCP handshake; if nothing answers, it writes to stderr and exits
non-zero. Spawn-and-check-exit is therefore a valid "is kolu usable here?"
probe — a consumer does not reimplement socket discovery, and never receives a
full tool list whose every call will fail
([#2148](https://github.com/juspay/kolu/issues/2148)). Mid-session, a padi
restart still heals without killing the MCP process (see below).

**A padi restart costs the agent nothing.** The injected connection carries
padi's close announcement, so the adapter discards a dead connection the moment
padi says the socket closed rather than by spending a request on it
([#2082](https://github.com/juspay/kolu/issues/2082) — the full story lives on
`OwnedSurfaceConnection.onClose`). Local socket arm only: `kolu mcp --host`
(ssh) does not carry the announcement yet, so a remote restart keeps the older
behaviour.

## The fleet projection

`serveKoluFleetMcp({ hosts, transport, serverInfo })` serves the same verbs over
**every** host kolu-server knows, in kolu-server's own process. It is what the
one conductor conversation holds; nothing spawns a `kolu mcp` per host, and
the session's MCP server list never changes as machines come and go.

**A terminal is `host/id`.** The host key is kolu-server's (`local`, or
`remote:<target>`); the separator is the **last** `/`, because a remote target
may contain one and a terminal id never does. One splitter, exported once —
`splitFleetTerminalRef` / `fleetTerminalRef`, from `kolu-mcp/fleetRef` (a leaf
with no imports, so a consumer that must not take the MCP SDK can still split a
reference). Nothing in the tree splits a fleet reference by hand.

**Resources.** `terminals` (every host's roster, host-qualified) · `urgency`
(who needs someone, fleet-wide) · `hosts` — the live roster, and it *changes
under you*: name, reachability (`warming` · `connected` · `failed`), padi's
commit, its surface version and boot time. Those last three are why there is no
fleet `identity`/`status`/`daemonStatus`: they are per-host facts, so they are
columns of `hosts` rather than three fleet-wide readings of a per-host thing.
Addressing one terminal percent-encodes the reference —
`surface://collections/terminals/local%2F3f1c…` — since the adapter addresses a
collection item by URI segment. Each row carries its own `host` and its `id` /
`parentId` as fleet references, so a record you read is one you can act on
without remembering the key it arrived under.

**Tools.** The same fifteen names, with the host in the arguments:
`lifecycle_create` takes a `host` (create on the machine the repo lives on) and
answers a fleet reference; `git_*` / `fs_*` take a `host` beside their
`repoPath`; everything per-terminal takes a reference. The bespoke tools are
**lifted, not forked** — the same handlers `kolu mcp` runs, handed one host's
client with bare ids, with the ids re-qualified in the answer. The whole id
grammar is one table (`src/fleet/lift.ts`).

**A host that is not connected is refused by name**, never answered with an
empty list: the refusal says which host and what state it is in, as prose and as
`structuredContent` (`host-not-connected` · `unknown-host` ·
`cross-host-reference`). An agent that is told "box is warming" retries; an
agent handed an empty list concludes the machine is idle.

**One watch, every host.** `watch_open` with no `ids` watches the whole fleet —
including hosts that connect later; with `ids` it groups them by host and legs
each one under the same name. `watch_next` merges every host's queue into one
ordered batch under a **fleet-assigned** `seq`, so `after` is that number and
never a host's own. A host that ARRIVES while the watch is open joins it without
anything being reopened; a host that LEAVES the fleet reports each terminal it
was carrying as `gone` and then drops out. `watch_close` closes every leg.
`ignoreSelf` is not offered here: the fleet face runs in kolu-server, whose
caller is in no terminal, so there is no self to mute — use `ignoreIds`.

**Disconnecting is not leaving.** An ssh blip, a padi restart, a host still
warming: that host is still a member and its terminals are still there, so its
leg is *parked* rather than mourned — re-opened, and drained of what padi
buffered, the moment it answers again. It is named in the answer's `gaps`
instead, beside any host that is connected but keeps refusing the subscription:
that one is skipped for the round and retried on the next, so one sick machine
cannot fail a drain over the healthy ones. A host you NAMED in `ids` is the
opposite case and fails the call — you asked about that lane, so a watch that
cannot cover it is not the watch you opened.

**The port kolu-server implements** is `FleetHosts` (`keys` · `display` ·
`padi` · `state` · `subscribe`). The face holds no host map of its own: a second
copy of kolu-server's mirror is a copy that can be wrong, so every read is
forwarded to the host that owns the answer and every value is as fresh as the
host that gave it.

Plan of record: the kolu-cli Atlas note
([kolu.dev/atlas/kolu-cli.html](https://kolu.dev/atlas/kolu-cli.html)).
