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
acp-proxy --id e7f2 -- claude-agent-acp

# From anywhere else: talk to it.
acp-chat "$XDG_RUNTIME_DIR/kolu/acp-e7f2.sock"
> why is the e2e suite flaky?
agent ▸ It's a port collision: two workers bind 5173.
```

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
| Session | One per proxy. Its id outlives the adapter processes behind it, so a respawn never invalidates an id a client is holding. |
| Respawn | An adapter that dies mid-turn fails that turn loudly and is replaced; the next prompt works. A *handshake* that fails is terminal — a proxy that cannot bring up an adapter exits rather than looping. |
| Cancel | `session/cancel` is forwarded. If the turn has not ended within `CANCEL_GRACE_MS` (3s), the adapter is killed and replaced and the turn reports `cancelled` — because some agents keep streaming after a cancel, and a cancel that cannot be honoured must still end the turn. |
| Permissions | Auto-answered with the `allow_once` option, found **by `kind`** — never by id or position, which is how a harness accidentally picks `allow_always`. A request offering no `allow_once` fails loudly instead of being widened. |
| Process tree | The adapter is spawned as a group leader and killed as a group, so the tools and MCP servers it spawned are reaped rather than orphaned across respawns. |
| Socket | `$XDG_RUNTIME_DIR/kolu/acp-<id>.sock`, mode 0600. An absent `XDG_RUNTIME_DIR` is an error, not a fallback to `/tmp`. |
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

- The pinned `@zed-industries/agent-client-protocol` (0.4.5) validates
  `session/update` against the v1 schema and **drops kinds it does not know** —
  today `usage_update` and `session_info_update`, which both shipped adapters
  send. The library logs those to stderr; the transcript on stdout is unaffected,
  but the frames do not reach clients.
- The proxy serves one turn at a time. A second concurrent prompt is refused
  rather than queued.

## Tests

The end-to-end suite drives the real bins — spawned processes, a real socket,
the official client library on the far end — against a scripted fake adapter
(`src/fakeAdapter.fixture.ts`), and runs over two adapter argvs so
agent-agnosticism is checked rather than claimed. Because it forks real
processes it is gated behind `@kolu/daemon-test-gate`:

```sh
just test-unit     # rendering + socket-path rules
just test-daemon   # the end-to-end done-criteria
```

The real adapters are covered by an out-of-band smoke — `acp-chat` against
`claude-agent-acp` and `codex-acp` with a one-line prompt — since that needs
this box's logins and CI has none.
