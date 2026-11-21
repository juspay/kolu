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

Because olai compiles this directory with its own `tsc`, what it imports is
recorded in `src/sharedVocabulary.json` and held by `src/sharedVocabulary.test.ts`:
adding is free, and removing or renaming a recorded name fails here rather than
in the other repository's build.

## The rules it keeps

Each of these is a bug that happened once, and each is about the PROTOCOL
rather than about a conversation — which is why they are here and not in
[`@kolu/acp-harness`](../acp-harness), whose own list is about turns and rows.

- **A prompt is ALWAYS a plain `session/prompt`, busy or idle.** The queue is the AGENT'S: a message sent mid-turn goes out immediately and waits there until it is picked up. Nothing is held on this side — which is also why a cancel has nothing to throw away.
- **Every frame that becomes a row says which prompt it belongs to, in the order of the wire.** `prompt(blocks, turn)` takes the caller's name for the prompt; the name rides the request's `_meta` and is taken off again before the agent sees it (`src/answering.ts`). The stream the SDK reads stamps each `session/update`, permission request and elicitation with the name of the oldest prompt not yet answered at the point it was read, and `said`, `tool`, `plan` and `asked` carry it as `turn`. A turn's end still arrives as the return of `prompt`, and that return can reach a caller after the next turn's first frame: an agent that answers one prompt and speaks for the next writes both in one breath. `turn` is how a caller files those frames under the right prompt.
- **The permission mode the leg names is asked for after a new session AND after a load**, before the session is entered — a mode belongs to the session, so a restored one that never asked is the one where every write becomes a question somebody answers by hand. A refusal is reported, not a failed bring-up, unless the leg says `bypassModeRequired`; then the visit is withdrawn and its late frames are fenced like any session left behind.
- **The model row is a SETTING as well as the header's reading.** Every `configOptions` row is published in the `settings` event, the model's first and marked `kind: "model"`; a boolean row (no choices, a boolean `currentValue`) is marked `kind: "boolean"` and goes back to the agent as ACP's `{type: "boolean", value}` rather than as the string a caller spelled it with. A row whose choices could not be read is still a row, with no choices. Pulling the model row OUT for the header's name and window — and publishing nothing else — is how a panel came to say "Opus 5.5" over a popover with no way to change the model.
- **The roster moves only on the AGENT'S own word.** Each server the caller handed over starts `handed`, with `where` as the place it was sent — the absolute command for a program, the URL for an HTTP server; a leg's `rawMessages` report moves it to `connected` or to `unattached` carrying the word the agent used. A server the agent names and nobody handed over adds no row, because nothing on this side can vouch for it.
- **The stale-frame fence is armed as the session is LEFT.** A leftover chunk from the conversation just replaced would otherwise appear in one nobody spoke in. `leaving()` names the session being left BEFORE the active session is nulled; nulling first made the fence a no-op.
- **The conversation being left is CLOSED at the agent, not merely dropped.** The next open sends `session/close` for the id it is leaving, and sends it BEFORE it opens the next one. The pinned Claude adapter gives every session its own SDK `query()`, and `query()` spawns a `claude` the moment the session is made — ~276 MB apiece, still generating if the turn it was left in never ended — so a client that opens a second conversation without this leaves the first CLI running for the life of the adapter: **one `session/new`, one `claude`, for ever** (measured: two opens, two live children; a production host was found holding five). Before rather than after the open, because a machine must never carry two agent CLIs for one conversation and because an open that FAILS would otherwise strand the old one with nothing on this side able to reach it. Closing ends the process and not the record — ACP spells forgetting `session/delete` — so a later resume of the id is still a resume. There is no capability to read first, so an agent without the method answers "method not found": that is logged and swallowed, never a refusal of the new conversation somebody asked for.
- **Prologue dedupe at ONE door.** An adapter may publish a startup banner and then repeat it as an ordinary message. The repeat is dropped on the exact text the open's own answer carried — never on a guess at prose — at the single `agent_message_chunk` door, so every downstream counter agrees.
- **A permission request is auto-approved only for a tool positively RECOGNISED** as belonging to an MCP server the caller handed over, choosing an option whose `kind` starts with `allow` — never "the first option". A tool it cannot name is one a person is asked about.
- **An MCP answer is read through the LEG.** An MCP server may reply in a text content block, so `rawOutput` arrives as a JSON *string*; which corner of a frame an agent puts its structured answer in is exactly what a `Leg` exists to answer.
- **Compaction reports are asked for only by a leg that reads them** (`Leg.compaction`, sent as `clientCapabilities.session.compaction`); the pinned Claude adapter, told nothing, reports a compaction as a tool call instead. Each report is one `compaction` event carrying the summary folded so far, chunks and replacements alike, so the status-only duplicate that adapter sends after a terminal report repeats the summary rather than clearing it.
- **A sign-in runs only what this end can run, and there is no API-key box.** ACP's `env_var` kind — and every other typed kind but `terminal` — is skipped rather than drawn as a button that would start nothing; the plain agent method, which carries no type at all, is still offered. A `terminal` method's command is spawned here, as its own process group, and its output streamed; exit 0 is the whole of success, because it means the credential store was written, so a cancel that lost the race to it still answers `signed-in` rather than `cancelled`. A second press attaches to the attempt already running rather than starting a second process writing that same store. When the handshake advertises nothing runnable, the sentence names the adapter, what it calls itself and what was asked for — a dead end described, never a button this end invented.

## What a maintainer must not break

- **No product vocabulary.** The events say what the agent said, never what a product draws. A consumer that needs something not in `AgentEvent` needs a new member, not a look at the wire.
- **No module-level state.** One `make` is one agent process; a product holds as many as it has conversations, and each is started and stopped on its own.
- **The events carry `@kolu/acp/wire`'s shapes.** `Command`, `Setting`, `Server`, `AuthMethod`, `SignIn`, `SignInLink`, `TerminalView`, `Armed`, `Spawned` and `PlanStep` are declared there, once, and a product's state and rows use the same ones. A reported `Armed` or `Spawned` is a refinement: `null` is "this frame says nothing about it", so a consumer keeps what an earlier frame said. The `settings` event is every setting the agent offers, the model row first and marked `model`.

## Tests

`test:daemon`, because the suite spawns real fixture agents and real terminal commands. `nix develop -c pnpm --filter @kolu/acp-client test:daemon`.
