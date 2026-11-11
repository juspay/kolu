# @kolu/acp-harness — the one package that runs the protocol out loud

[`@kolu/acp`](../acp) is the Agent Client Protocol's words and pure projections over them; nothing in it waits, spawns, or knows a subprocess exists. This is where one does.

`@kolu/acp-harness` spawns an ACP adapter, holds one session on it, and turns a stream of protocol frames into the transcript rows kolu's contract declares. It is **the volatility receptacle**: everything hard about talking to an agent over a pipe — a child that dies mid-turn, a frame from a conversation you already left, a question that blocks a turn until a person answers it, a background task that outlives the turn that armed it — is hidden here, and the dependency arrow points out. [`@kolu/padi`](../padi) holds one of these per host (the [Orchestrator](https://kolu.dev/orchestrator)) and never spells `session/prompt`.

## The door

One entry, deliberately. A second subpath would be a second way to reach a subprocess, and there is exactly one subprocess.

```ts
const harness = await startHarness({
  agentName, leg, adapter,      // who, how it reads its wire, what to spawn
  cwd, mcpServers, teaching,    // where it works, what it can reach, what it is told
  log, resume,                  // a session id to `session/load`, or null for a fresh one
  onChange,                     // { kind: "state" } | { kind: "rows", upserts, removes, appends }
});
```

`startHarness` does spawn + `initialize` + (`session/load` when `resume` is a string, else `session/new`) before it resolves. A refusal **stops the child and rejects** — it never resolves into a half-open conversation. Two error classes are the whole of what a caller may branch on: `HarnessUnavailable` (no child, no session) and `HarnessRefused` (`{why, auth}` — the agent said no). Anything else is a defect and propagates unwrapped, because an orchestrator that broke in a way nobody declared should crash loudly rather than arrive as a polite sentence in a chat.

The verbs are `prompt` · `cancel` · `answer` · `signIn` · `signInInput` · `signInCancel` · `setOption` · `newSession` · `stop`, plus `state()` and `rows()`.

## The rules it keeps

Each of these is a bug that happened once. They are what the package is.

- **A prompt is ALWAYS a plain `session/prompt`, busy or idle.** The queue is the AGENT'S: a message sent mid-turn goes out immediately and waits there, marked `queued` until it is picked up. Nothing is held on this side — which is also why `cancel` has nothing to throw away.
- **The stale-frame fence is armed on the `session/new` RESPONSE.** During an open the transcript is already empty and `activeSession` is null, so a leftover chunk from the conversation just left would otherwise appear in one nobody spoke in. `leaving()` names the session being left BEFORE `activeSession` is nulled; nulling first made the fence a no-op.
- **Prologue dedupe at ONE door.** An adapter may publish a startup banner and then repeat it as an ordinary message. The repeat is dropped on the exact text the open's own answer carried — never on a guess at prose — at the single `agent_message_chunk` door, so every downstream counter agrees.
- **A permission request is auto-approved only for a tool positively RECOGNISED** as belonging to an MCP server we handed over, choosing an option whose `kind` starts with `allow` — never "the first option". A tool it cannot name is one a person is asked about.
- **A frame refines, never retracts.** The kolu reading of a tool call is accumulated across frames (`refineKoluCall`), because the adapter puts the call's input on the arming frame and its answer on the settling one, and a card built from either alone is missing the half the other had.
- **An MCP answer is read through the LEG.** `kolu mcp` replies in a text content block, so `rawOutput` arrives as a JSON *string*; which corner of a frame an agent puts its structured answer in is exactly what a `Leg` exists to answer.
- **Sign-in has no API-key box.** ACP's `env_var` method kind is deliberately skipped; a `terminal` method's command is spawned here and its output streamed, and exit 0 is the whole of success.
- **A turn the agent REFUSES is a turn that ended**, not an agent that has gone: the conversation stays ready and the next message goes to the same agent.

## Tests

Against **really spawned** fixture agents (`src/fixtures/`), not mocks — plain `.ts` files run as `process.execPath <file>`, since node strips types natively. A mock would prove only that the reader can read what the test wrote; a spawned agent proves the pipe, the codec, the ordering and the lifecycle.

## What it deliberately does not do

`steer` / `_session/steering` (out of scope — the `Leg.steering` field is left unread), `session/list` and the adopt/model-memory bookkeeping (padi owns persistence and hands `resume`), ACP client-owned terminals (`terminal/*` — the agent has kolu's terminals through MCP), and native child sessions. None of them is a gap this package hides; each is a decision recorded where it was made.
