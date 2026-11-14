# kolu-mcp

kolu's **agent face**, in two projections of ONE expose map
([MCP](https://modelcontextprotocol.io) through
[`@kolu/surface-mcp`](../surface-mcp/README.md)):

- **`kolu mcp` — one host, over stdio.** This host's terminals, as a pure
  `padiSurface` client. Terminal ids are bare. This is what an agent working
  *inside* a kolu terminal drives, and no kolu-server is anywhere in it — the
  package manifest is the graduation fence, so the face provably serves agents
  with padi alone.
- **`serveKoluFleetMcp` — every host, inside kolu-server.** The same terminal
  verbs lifted over kolu-server's host map, where a terminal is `host/id`. This
  is what the one conductor conversation holds, over a loopback
  streamable-HTTP transport kolu-server owns. It reaches the hosts through a
  PORT (`FleetHosts`) and the conductor's watch list through another
  (`FleetWatchList`), never by importing kolu-server, so the fence holds here
  too.

**The dependency fence**: padi/surface packages, `kolu-git`, and
`kolu-agents/vocab` — the browser-safe agent registry, taken for `agent_say`'s
per-agent keystroke recipes (`AgentVocab.say`). No kolu *app* package, so the
arrow still points one way and a `kolu mcp` with no kolu-server behind it still
serves every verb.

**The terminal verbs have one definition** (`KOLU_MCP_TOOL_EXPOSE` in
`src/expose.ts`, spread into both maps): the two faces differ in what a terminal
is *called*, never in what may be done to one. What the FLEET face drops is the
calls that never end — see [the fleet projection](#the-fleet-projection) at the
foot. The rest of this page is the single-host face.

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
  Enter after an observed settle, never text+newline fused) · `agent_say`
  (below) · `watch_open`/`watch_close`.

**`agent_say` — kolu knows the keys, so you don't.** `{ id, text }` says
something to the agent running in that terminal: it reads the terminal's
record, finds the agent and whether it is WORKING, types the words through the
same encoder `lifecycle_sendInput` uses, waits a hard-capped settle (250 ms
quiet, 2 s ceiling — the TUI's paste debounce, nothing more), and presses that
agent's own submit keys. The recipe lives with agent detection, in each agent's
vocab (`AgentVocab.say` in `packages/integrations/<agent>/src/schemas.ts`), and
every one of them was **established by running the agent or from its own docs**
— never guessed. The answer says what happened, including the two things a
caller cannot see. `delivery` is `"submitted"` (it was idle, the words start a
turn), `"steer"` (the words reach the turn that is running — codex, omp, pi,
xyne) or `"queue"` (they wait for the current turn to end — claude-code,
opencode, grok). `took` is whether the words LANDED: for an agent that was
idle, kolu then watches its state for a hard-capped few seconds
(`SAY_TAKE_CAP_MS`) and answers `began-working` or `did-not-begin` — the keys
were sent either way, so a say that did not take is an ANSWER naming the screen
read that settles it, never a refusal that invites typing the prompt a second
time. For an agent that was already working there is no state change to watch,
so `took` is `not-observable` and the delivery is the whole story. Refused as
data, never guessed: `no-agent` (a plain shell), `agent-cannot-be-told` (kolu
detects the agent but has no verified recipe), `agent-cannot-be-told-while-working`,
`agent-starting` (the agent is up but its screen is still being drawn — wait
until it is ready, which `wait_agentState` with `until: ["fresh"]` is for, and
say it then), the asleep refusal, and `text-refused` (empty text). An agent that
is `fresh` — up, settled, never prompted — is said to like any other idle agent,
and its first prompt is seen taking the instant padi forwards the submit: the
agent turns `prompted`, a presence state in the `working` bucket, before it has
written a line of transcript (omp writes its first only when the first reply
completes). Until that transcript lands a second say treats it as working.

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

`serveKoluFleetMcp({ hosts, transport, serverInfo, watchList })` serves the
terminal verbs over
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
(who needs someone, fleet-wide) · `watched` (this conversation's own watch
list, below) · `hosts` — the live roster, and it *changes
under you*: name, reachability (`warming` · `connected` · `failed`), padi's
commit, its surface version and boot time. Those last three are why there is no
fleet `identity`/`status`/`daemonStatus`: they are per-host facts, so they are
columns of `hosts` rather than three fleet-wide readings of a per-host thing.
**One terminal's record is read at the reference as handed out** —
`surface://collections/terminals/remote:gossamer/9ab1…`, nothing escaped. The
adapter addresses a collection item by URI *segment* and a reference carries a
slash, so that URI reads to the generic rule as a sibling's collection and was
refused as an unknown resource; this face therefore answers `resources/read`
itself (`src/fleet/recordRead.ts`), re-addressing the reference to the single
encoded segment the adapter resolves and answering at the address the caller
wrote. A reference that names nothing — and any address this face does not
serve — is refused *here*, in a sentence that says what a record address looks
like. Each row carries its own `host` and its `id` / `parentId` as fleet
references, so a record you read is one you can act on without remembering the
key it arrived under.

`watched` (`surface://cells/watched`) is the Conductor reading the list it is
being woken by — one row per watched reference, carrying the last name and
agent kolu saw in that terminal, how it joined, and the ref's host *as this
fleet stands now* (`host` / `hostName` / `hostState`, all three `null` for a
host that is no longer a member). It is the only resource here whose value
belongs to the conversation rather than to the fleet, and it subscribes: a
watched terminal that goes away — one the human closed, or one that died —
reaches a conductor that is not calling anything. Without it a restarted
Conductor could move the list and never read it — the observed result being an
agent that says it is "not certain" what it is watching and then re-watches
terminals that no longer exist.

**Tools — a SUBSET, deliberately.** Per-terminal tools take a reference;
`lifecycle_create` takes a `host` (create on the machine the repo lives on) and
answers a fleet reference; `git_*` / `fs_*` take a `host` beside their
`repoPath`. The bespoke tools are **lifted, not forked** — the same handlers
`kolu mcp` runs, handed one host's client with bare ids, with the ids
re-qualified in the answer. The whole id grammar is one table
(`src/fleet/lift.ts`), and `KOLU_FLEET_TOOL_NAMES` is the static roll of what
this face serves.

What it does **not** serve is every call that can block forever:
`wait_agentState`, `watch_open`, `watch_next` and `watch_close` are absent, and
`wait_outputSettled` is **hard-capped at `FLEET_SETTLE_CAP_MS` (3 s)** on both
`idleMs` and `timeoutMs` — a schema check, so an over-long value is *refused*
with the bound in the message and the cap is in the tool's advertised
description. A clamp would answer "met" after three seconds to a caller that
believed it had waited ten minutes. The reason is the conductor: its turn is a
conversation a human may be trying to speak into, so it says what it watches
and ENDS its turn, and kolu-server starts the next one when a watched
terminal's agent stops, asks or dies. The two waits that survive are both
`agent_say`'s own and both hard constants: the settle between typing and the
submit keys, and the few seconds it watches afterwards to say whether the words
took.

**The watch list, and who is on it.** `watch_terminal { id }` adds a terminal
(refusing a malformed reference, a host that is not connected, and a terminal
that is not in its host's roster — a watch on something that does not exist is
silence a conductor would read as calm) and answers `{ watching, found }`:
`found` is the state the terminal was in when it joined — the agent and its
bucket, or `no-agent` / `asleep`. That state is also the BASELINE the server
keeps for an `asked` join, so it is said here precisely because it will never
arrive as a wake. `unwatch_terminal { id }` answers `{ watching, removed }`,
consults no roster, and is happy to forget a terminal that has already died.
Both say the WHOLE list back, so the agent that just moved it does not have to
read anything to learn what it now holds.
**A terminal this face CREATES is watched automatically**, at the fleet
reference `lifecycle_create` answered — the agent never has to ask for news
about a worker it just started.

Every entry says HOW it joined (`FleetWatchJoin`): `created` for a bare shell
this face opened, `created-run` when a command was typed at that shell (only
that one can end with the command gone and no agent ever there), and `asked`
for a terminal that was already running when the conductor asked for it. The
list itself belongs to kolu-server (it is persisted with the conversation and
read by the server's watcher); this face reaches it through the
`FleetWatchList` port (`entries` · `subscribe` · `watch` · `unwatch` ·
`said` · `closed`), for the same
reason `FleetHosts` is a port. `agent_say` calls `said` once its keys land: the
conductor has just acted on whatever that terminal was doing, so news held
about it is stale. `lifecycle_kill` calls `closed` once the kill lands: a
terminal the conductor closed leaves the list in silence, with no `gone` wake
about its own action — closing needs no `unwatch_terminal`.

`agent_say` is on BOTH faces, unchanged except for the reference: the conductor
says things to the agents it starts without knowing one keystroke of any of
them.

**A host that is not connected is refused by name**, never answered with an
empty list: the refusal says which host and what state it is in, as prose and as
`structuredContent` (`host-not-connected` · `unknown-host` ·
`cross-host-reference`). An agent that is told "box is warming" retries; an
agent handed an empty list concludes the machine is idle.

**A terminal that is ASLEEP is refused by name too**, never as "not found".
padi's active-terminal gate answers `TerminalNotActive` for a terminal that is
in the roster but has no live PTY, and this face turns it into the refusal an
agent can act on: the sentence names the fix (`Terminal local/3f1c… is asleep —
wake it before reading its screen, or skip it and say it is asleep`) and
`structuredContent` carries `{ kind: "terminal-not-active", tag:
"TerminalNotActive", id, state }`, with `state` the arm the record is in
(`sleeping` · `parked`). The id is the FLEET reference on the fleet face, in
the prose as well as the data, so an agent is never handed an id its own tools
refuse. One mapper (`src/asleep.ts`), taken by every terminal-addressing tool —
`screen_text`, `screen_image`, `lifecycle_create` (a dormant `child-of`
parent), and both waits. Waking a terminal is canvas-owned, so neither face has
a verb for it; the honest moves are to ask the human or to skip it.

**The wait REFUSES a sleeping terminal, it does not wait on it.** A dormant
terminal has no attach feed to open, so every outcome would be a lie: `gone`
says it died, `closed` says "retry" against a subscription that can never open,
and `timeout` charges the caller its whole window. `wait_outputSettled` (and
`wait_agentState`, on the stdio face) therefore answer the refusal above, up
front, before anything subscribes (the check is in the engine —
`@kolu/padi-client/watch` — so argv and MCP answer alike). A terminal slept
MID-wait propagates the same refusal rather than reporting a met with no
screen.

**One watch, every host** — on the **stdio face**. `watch_open` with no `ids`
watches every terminal padi holds; `watch_next` drains it, acknowledged by
`ackAfter`; `watch_close` ends it. The fleet face has none of these (above),
and the fleet-wide merge that used to back them is gone with them: there is one
conductor, it is woken rather than draining, and a merge nobody called was a
second cursor to keep correct.

**The port kolu-server implements** is `FleetHosts` (`keys` · `display` ·
`padi` · `state` · `subscribe`). The face holds no host map of its own: a second
copy of kolu-server's mirror is a copy that can be wrong, so every read is
forwarded to the host that owns the answer and every value is as fresh as the
host that gave it.

**Following that port over time** is `overConnectedHosts`
(`src/fleet/overHosts.ts`), published beside it: a leg per connected host,
interrupted and re-opened as the map moves, so a leg can only ever exist over
the client that is current — the thing a hand-rolled follow gets wrong when a
padi restarts under a mirror that never dropped. Every aggregate member here
folds through it, and so does kolu-server's conductor watch, which is why it is
exported. A leaf, not an electricity: the volatility it looks like it owns is
already encapsulated by the host map behind `FleetHosts`, and nothing outside
this repo plugs in (the module header runs the three tests).

Plan of record: the kolu-cli Atlas note
([kolu.dev/atlas/kolu-cli.html](https://kolu.dev/atlas/kolu-cli.html)).
