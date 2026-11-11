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
  resumedSeq, model,            // the highest `seq` already persisted; the model a person chose
  onChange,                     // { kind: "state" } | { kind: "rows", upserts, removes, appends }
});
```

`startHarness` does spawn + `initialize` + (`session/load` when `resume` is a string, else `session/new`) + the leg's permission mode + the remembered `model`, all before it resolves — one `try` over the whole sequence, so a refusal or a deadline **stops the child** rather than leaving an adapter (and a `claude` under it) running for every retry. It never resolves into a half-open conversation, with **one** exception: an `auth` refusal KEEPS the child and resolves with `phase: "offline"` and `state.signIn = {why, methods, attempt: null}`, because the process that refused is the process a sign-in has to run against. Every refusal is PUBLISHED through `onChange` before it is thrown, so the panel says why instead of looking idle.

Two error classes are the whole of what a caller may branch on: `HarnessUnavailable` (no child, no session) and `HarnessRefused` (`{why, auth}` — a refusal, the agent's or this end's). Anything else is a defect and propagates unwrapped, because an orchestrator that broke in a way nobody declared should crash loudly rather than arrive as a polite sentence in a chat.

The verbs are `prompt` · `cancel` · `answer` · `signIn` · `signInInput` · `signInCancel` · `setOption` · `newSession` · `stop`, plus `state()`, `rows()` and `alive()` — the last for a caller deciding whether to replace a harness, since an `auth`-refused one is offline AND alive.

## The rules it keeps

Each of these is a bug that happened once. They are what the package is.

- **A prompt is ALWAYS a plain `session/prompt`, busy or idle.** The queue is the AGENT'S: a message sent mid-turn goes out immediately and waits there, marked `queued` until it is picked up. Nothing is held on this side — which is also why `cancel` has nothing to throw away.
- **The permission mode the leg names is asked for after a new session AND after a load**, before the conversation is entered — a mode belongs to the session, so a restored one that never asked is the one where every write becomes a question somebody answers by hand. A refusal is a row, not a failed bring-up, unless the leg says `bypassModeRequired`.
- **A resumed conversation's replay is DROPPED.** `session/load` re-emits the whole history before it answers; the caller's persisted rows are kept instead, because they carry kolu's own readings (tool cards, notices, the fleet) that no agent's transcript holds. `resumedSeq` is the highest `seq` the caller holds, and every id and `seq` minted here starts after it.
- **A new session KEEPS the transcript.** One conversation ends and another begins in one scroll, with a divider between them — and a `clear` would be a lie to a caller whose copy holds rows this process never minted.
- **The roster moves only on the AGENT'S own word.** Each server kolu handed over starts `handed`, with `where` as the absolute command; a leg's `rawMessages` report moves it to `connected` or to `unattached` carrying the word the agent used. A server the agent names and nobody handed over adds no row.
- **Nothing is published after `stop()`.** A turn still on the wire ends a moment later; its rows would be rows the caller persists for a conversation it has already let go. The one frame a shutdown owes a reader is sent by hand.
- **The stale-frame fence is armed as the session is LEFT.** A leftover chunk from the conversation just replaced would otherwise appear in one nobody spoke in. `leaving()` names the session being left BEFORE `activeSession` is nulled; nulling first made the fence a no-op.
- **Prologue dedupe at ONE door.** An adapter may publish a startup banner and then repeat it as an ordinary message. The repeat is dropped on the exact text the open's own answer carried — never on a guess at prose — at the single `agent_message_chunk` door, so every downstream counter agrees.
- **A permission request is auto-approved only for a tool positively RECOGNISED** as belonging to an MCP server we handed over, choosing an option whose `kind` starts with `allow` — never "the first option". A tool it cannot name is one a person is asked about.
- **A frame refines, never retracts.** The kolu reading of a tool call is accumulated across frames (`refineKoluCall`), because the adapter puts the call's input on the arming frame and its answer on the settling one, and a card built from either alone is missing the half the other had.
- **An MCP answer is read through the LEG.** `kolu mcp` replies in a text content block, so `rawOutput` arrives as a JSON *string*; which corner of a frame an agent puts its structured answer in is exactly what a `Leg` exists to answer.
- **Sign-in has no API-key box.** ACP's `env_var` method kind is deliberately skipped; a `terminal` method's command is spawned here and its output streamed, and exit 0 is the whole of success — after which the harness opens the conversation the refusal cost, rather than asking the caller to start again.
- **A turn the agent REFUSES is a turn that ended**, not an agent that has gone: the conversation stays ready and the next message goes to the same agent.

## Tests

Against **really spawned** fixture agents (`src/fixtures/`), not mocks — plain `.ts` files run as `process.execPath <file>`, since node strips types natively. A mock would prove only that the reader can read what the test wrote; a spawned agent proves the pipe, the codec, the ordering and the lifecycle. The lane is **`test:daemon`**, not `test:unit`: every case forks a detached process group, so it runs serially with the other daemon-forking packages, and one `afterEach` stops every harness a case started.

## What it deliberately does not do

`session/list` and the adopt/model-memory bookkeeping (padi owns persistence and hands `resume`, `resumedSeq` and `model`), ACP client-owned terminals (`terminal/*` — the agent has kolu's terminals through MCP, so the extension is not advertised and nothing reads one), and native child sessions. None of them is a gap this package hides; each is a decision recorded where it was made.
