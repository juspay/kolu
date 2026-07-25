# @kolu/acp

An ACP agent in a tile. Two bins: **`acp-proxy`**, which harnesses a headless
coding agent and serves it over a unix socket, and **`acp-chat`**, a REPL that
talks to one.

## What problem it solves

Driving a coding agent by typing into its TUI means watching a screen and
guessing: has the turn ended, was that a prompt or a paste race, did the tool
finish? The [Agent Client Protocol](https://agentclientprotocol.com) removes the
guessing — `session/prompt` returns when the turn ends, and everything in
between arrives as a typed frame.

`acp-proxy` runs an ACP adapter over stdio and **re-serves the same protocol on
a unix socket**, so a program can drive the agent while a human watches the same
session scroll past in a terminal. ACP is the boundary on both faces, so there
is no invented protocol anywhere on the wire.

```sh
# In a tile (or any shell): harness an agent and serve it.
acp-proxy --id e7f2 -- claude-agent-acp   # prints the socket it listens on

# From anywhere else — any directory: talk to it.
acp-chat /run/user/1000/kolu/acp-e7f2.sock
> why is the e2e suite flaky?
agent ▸ It's a port collision: two workers bind 5173.
```

A program drives it the same way, through the package's own client:

```ts
import { connectToProxy, socketPathFor } from "@kolu/acp";

const agent = await connectToProxy(socketPathFor("e7f2"));
agent.onUpdate((update) => console.log(update.sessionUpdate));
const { stopReason } = await agent.prompt("why is the e2e suite flaky?");
```

`connectToProxy` is where the rules that are *not* obvious from ACP alone
live — the session's directory is the proxy's and is read from the handshake,
the socket's death is raced explicitly (the library would wait forever), turns
are queued because a second concurrent one is refused, and a forwarded
permission request is a contract break rather than something to answer.

The tile shows the session but is never the thing you type into — all input
arrives as ACP calls on the socket:

```
⎯ adapter spawned · claude-agent-acp (pid 2929196)
⎯ adapter ready · claude-agent-acp · protocol v1
⎯ listening · /run/user/1000/kolu/acp-e7f2.sock
▶ session/prompt · "why is the e2e suite flaky?"
◀ agent_message_chunk · It's a port collision: two workers bind 5173.
◀ tool_call · execute — grep -r retry test-results/
◀ session/request_permission · grep … → auto-answered Allow once
◀ tool_call_update · completed
● turn end · stopReason: end_turn
```

## Any stdio ACP agent

**The adapter is argv.** Everything after `--` is the command to run, so nothing
in this package is shaped like one vendor's agent:

```sh
acp-proxy --id a -- claude-agent-acp
acp-proxy --id b -- codex-acp
```

Both adapters are pinned npm dependencies, so neither needs a global install,
and both inherit whatever login the host already has. Any other stdio ACP agent
on `PATH` works the same way.

## What the proxy owns

Everything a harness must, and nothing else.

| Duty | Behaviour |
| --- | --- |
| Session | One per proxy, rooted at the proxy's own working directory — **published** in the `initialize` response (`kolu.acp/cwd`), because a client cannot obey a rule it has no way to read. A client asking for a different `cwd`, or for MCP servers, is refused rather than handed a session that quietly ignores what it asked for. The session id outlives the adapter processes behind it, so a respawn never invalidates an id a client is holding. |
| Respawn | An adapter that dies mid-turn fails that turn loudly and is replaced; the next prompt works. Replacement is paced (exponential backoff) and capped: an adapter that never stays up makes the proxy give up and say so, rather than fork replacements in a hot loop. Every way of dying goes through the same accounting — including a spawn that never starts, which Node reports as `error` and never as `exit`, and a replacement that dies inside its own handshake. The very first handshake is not retried at all: a proxy whose adapter never came up should fail, not spin. |
| Cancel | `session/cancel` is forwarded. If the turn has not ended within `CANCEL_GRACE_MS` (3s), the adapter is killed and replaced and the turn reports `cancelled` — because some agents keep streaming after a cancel, and a cancel that cannot be honoured must still end the turn. |
| Permissions | Auto-answered with the `allow_once` option, found **by `kind`** — never by id or position, which is how a harness accidentally picks `allow_always`. A request offering no `allow_once` fails loudly instead of being widened. |
| Process tree | The adapter is spawned as a group leader and killed as a group, so the tools and MCP servers it spawned are reaped rather than orphaned across respawns. |
| Socket | `$XDG_RUNTIME_DIR/kolu/acp-<id>.sock` on systemd Linux, else the fixed per-user `/tmp/kolu-$UID/acp-<id>.sock` — the same rendezvous shape kaval uses, pinned by a test against `getRuntimeSocketPath`. Directory 0700, socket 0600. |
| Lifetimes | Everything scoped to an adapter process — its pending requests, its frame handlers, its grace timer — dies with it. The ACP library never rejects an in-flight request when its stream ends, so without this a dead adapter is indistinguishable from a slow one, forever. |
| Transcript | Rendered from ACP traffic alone. The proxy never reads an agent's session files. |

Multiple clients may attach at once and all see the same session — which is what
lets a debugging `acp-chat` sit beside a program that is driving the agent.

## Deliberately not here

- **No fs or terminal client services.** The proxy is not an editor; an agent
  that needs to read or run something does it through its own tools.
- **No idle timeout.** A turn that goes quiet during a long tool run is normal,
  and a wrong timeout kills real work. Cancel is explicit, and a dead adapter is
  detected by its exit, not by silence.
- **No `session/load`.** The adapters advertise it; the proxy does not forward
  it yet, so it advertises `loadSession: false` rather than offering something
  it would then refuse. Conversation history does not survive a respawn.

## Caveats worth knowing

- The proxy serves one turn at a time. A second concurrent prompt is refused
  rather than queued.
- The protocol library is **`@agentclientprotocol/sdk`** — the same lineage as
  the adapters this package pins, which is what keeps the frame vocabulary in
  step with what they actually send. It replaced
  `@zed-industries/agent-client-protocol` 0.4.5, whose older schema rejected
  `usage_update` and `session_info_update` outright, so frames both adapters
  send reached no one. They are delivered and rendered now.

## Tests

The end-to-end suite drives the real bins — spawned processes, a real socket,
the official client library on the far end — against scripted fake adapters, and
runs over **three** of them: one fake twice (which proves the command is read)
and a **second fake that is a different agent**, with other capabilities, a
batched reply instead of a stream, the permission request on the far side of the
tool call, and frame kinds the pinned library drops. That is what makes
agent-agnosticism checked rather than claimed — it caught this suite asserting
one vendor's literal wording for its `allow_once` option. Because it forks real
processes it is gated behind `@kolu/daemon-test-gate`:

```sh
just test-unit     # rendering + socket-path rules
just test-daemon   # the end-to-end done-criteria
```

The real adapters are covered by an out-of-band smoke — `acp-chat` against
`claude-agent-acp` and `codex-acp` with a one-line prompt — since that needs
this box's logins and CI has none.
