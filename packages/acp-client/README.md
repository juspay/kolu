# @kolu/acp-client — one agent process speaking ACP, typed events out

`@kolu/acp-client` runs one coding agent over the [Agent Client Protocol](https://agentclientprotocol.com): it spawns the adapter, shakes hands, opens, loads, lists and closes sessions, answers the agent's questions and permission requests, runs sign-in, and fences off frames from a conversation it has left. Everything it learns it reports as one closed union of events (`AgentEvent`); a turn's end is the return value of the call that started it.

It knows nothing about rows, panels or browsers. A product builds its conversation on top of it.

The code came from [olai](https://github.com/juspay/olai)'s chat plugin (`packages/plugins/chat/src/`), where it has run five engines. It lives here so that kolu and olai run agents on one copy.

## What it exports

| Entry | What |
|---|---|
| `.` | `make` and the `Agent` it returns; `AgentEvent` and `Stored`; `AgentGone`, `Gone`, `SignedIn`, `Steered` and `StopReason`; `Handed` (one MCP server to hand a session, stdio or http) and `Advertised`; `ContentBlock`, which a prompt is made of; the `Memory`, `MemorySnapshot`, `MemoryFailure`, `Models` and `Conversing` interfaces its options take; `Probe`, `Probed` and `StdioServer`; `AnswerRefused`; `newestFirst` |
| `./testlib` | the fixture legs (`SAYS_NOTHING`, `FORWARDS`, `NAMES_IN_META`, …) and `fixtureAgent(name)`, the absolute path of a fixture agent in `src/fixtures/` |

The client is written in Effect. It logs through Effect's own logger, so the caller supplies the logger layer; nothing here picks a sink.

## Who depends on it

- [`@kolu/acp-harness`](../acp-harness), for every conversation kolu's Conductor holds: it drives `make`, consumes the events, and runs the Effects at its own promise-shaped door.
- olai's chat plugin, for every conversation it holds.
- both products' runner tests, for the fixture agents (`./testlib`). Every fixture agent either runner spawns lives in `src/fixtures/`.

It depends on `@kolu/acp` (the protocol's words), `@kolu/child` (the subprocess), the protocol SDK and `effect`. olai vendors this directory, so its manifest spells literal versions.

## What a maintainer must not break

- **No product vocabulary.** The events say what the agent said, never what a product draws. A consumer that needs something not in `AgentEvent` needs a new member, not a look at the wire.
- **No module-level state.** One `make` is one agent process; a product holds as many as it has conversations, and each is started and stopped on its own.
- **The stale-frame fence.** A frame naming a session this client has left is dropped, even after the next session has opened.
- **One attempt per sign-in.** A second press attaches to the attempt already running rather than starting a second process writing the same credential store.
- **The events carry `@kolu/acp/wire`'s shapes.** `Command`, `Setting`, `Server`, `AuthMethod`, `SignIn`, `SignInLink`, `TerminalView`, `Armed`, `Spawned` and `PlanStep` are declared there, once, and a product's state and rows use the same ones. A reported `Armed` or `Spawned` is a refinement: `null` is "this frame says nothing about it", so a consumer keeps what an earlier frame said. The `settings` event is every setting the agent offers, the model row first and marked `model`.

## Tests

`test:daemon`, because the suite spawns real fixture agents and real terminal commands. `nix develop -c pnpm --filter @kolu/acp-client test:daemon`.
