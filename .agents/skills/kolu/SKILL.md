---
name: kolu
description: >-
  Drive one AI agent from another through kolu's terminals: spawn a Claude
  Code / Codex / opencode session in a PTY, prompt it, watch the screen, read
  the reply, prompt again. PRIMARY PATH: the kolu MCP tools
  (`lifecycle_create`/`lifecycle_sendInput`, `wait_outputSettled`/
  `wait_agentState`, `screen_text`, the `terminals` resource). FALLBACK: the
  `kolu` CLI — same verbs, same discipline. Triggers on "drive
  another agent", "agent drives agent", "make Claude drive Codex", or wiring a
  loop where one coding agent supervises another.
---

# kolu — drive one agent from another through its terminal

Run a coding agent inside a kolu-owned PTY and steer it from outside. **Use the
kolu MCP tools first** (`mcp__kolu__*`, wired in this repo's `.mcp.json`; other
hosts: `claude mcp add kolu -- kolu mcp`) — structured results, typed refusals,
no quoting hazards. Fall back to the `kolu` CLI's verbs (last section) when no
MCP is connected. Both faces are pure padi clients driving the same daemon, so
every discipline here applies to both.

## The loop

```
lifecycle_create   { intent: "🔧 parser refactor", cwd: "/abs/repo" }   → { id }
lifecycle_sendInput{ id, text: "refactor the parser to use a lexer" }   # 1. the text (no Enter)
wait_outputSettled { id, idleMs: 300, timeoutMs: 15000 }                # 2. observe the TUI settle
lifecycle_sendInput{ id, key: "Enter" }                                 # 3. submit (its own call)
wait_outputSettled { id, idleMs: 800, timeoutMs: 600000 }               # 4. let its turn finish
screen_text        { id, tail: 40 }                                     # 5. read the screen
```

- `lifecycle_create` spawns a padi-tracked canvas tile: `intent` labels it,
  `cwd` sets the directory, `parentId: <id>` opens it as a **split** beside
  that tile. It spawns a shell — launch the agent by sending its command line
  through the three-step submit.
- `lifecycle_sendInput` writes **text OR one named key, never both** —
  `{ text, key }` together is a typed hard error. Keys: `Enter`, `Escape`,
  `Tab`, arrows, `Home`/`End`, `Backspace`, `Space`, `Shift-Tab`,
  `C-<char>`/`M-<char>`. Unknown key names error loudly. Multiline text goes
  as one bracketed paste.
- `wait_outputSettled` / `wait_agentState` return a uniform frame —
  `{ result: "met", met: {…} }` or `{ result: "timeout" | "gone" | "closed" }`.
  Read `result`; never guess from silence.
- `screen_text { tail: N }` reads the last N content lines; omit `tail` for the
  whole scrollback; `screen_history` pages older output.
- `lifecycle_kill { id }` — kill exactly the terminals you created.
- The `terminals` resource (`surface://collections/terminals`) is the live
  roster; each id's record carries intent, cwd, agent kind + state, `parentId`.
  `surface://cells/urgency` lists terminals whose agent awaits a human.
- Interrupt a runaway before redirecting: `{ key: "Escape" }` (stop Claude Code
  mid-stream), `{ key: "C-c" }` (SIGINT).

## The three-step submit — text · settle · Enter

An Enter sent in the same breath as the text races the TUI's bracketed-paste
handling and is **silently dropped** — the prompt sits staged on the `❯` line
while the send reports success (the #1 cause of "the turn never started";
`screen_text` will show it). The daemon can't observe the TUI settle, so *you*
do: send text, wait for settle, send Enter as its own call.

> **Multi-line pastes don't submit** ([#1702](https://github.com/juspay/kolu/issues/1702)):
> past a handful of lines, Claude Code folds the paste into a `[Pasted text]`
> placeholder that Enter does not reliably submit. For any message beyond a
> couple of lines, write it to a file and send a short pointer prompt instead
> (`read /tmp/brief.md and carry it out`).

> Step 2's idle fires only when the agent is **at the prompt**. Against a busy,
> mid-turn agent the wait times out — treat that `timeout` as "target busy":
> send the Enter anyway (it buffers and submits when the turn ends), then
> `screen_text` to confirm. `result: "gone"` is real — the terminal died;
> surface it.

## Done-signals

- `wait_outputSettled { idleMs, timeoutMs }` — raw output quiescence,
  agent-agnostic. `800` is a good default. It can't tell "finished" from
  "blocked asking you" — `screen_text` and read before responding.
- `wait_agentState { until: […], timeoutMs }` — padi's detected state:
  `working`, `awaiting` (asking you), `waiting` (post-turn lull). It matches
  the state **the instant it connects**, so right after a submit it can return
  on the *previous* turn's `waiting` — wait in two phases:
  `until: ["working"]`, then `until: ["awaiting","waiting"]`.

Always pass `timeoutMs`, and keep it **under your own harness's per-call cap**
(most MCP hosts kill a tool call at ~1–2 min) — for a long turn, poll in
bounded slices, treating each `timeout` as "still busy".

Only `result: "gone"` means the terminal died. **`closed` is a dropped
subscription over a live terminal** — retry it; never report a worker dead off a
`closed`, and never bolt on a verify-with-`screen_text` rule to compensate.

## Supervising more than one terminal — subscribe, don't re-arm

The waits above are **edge-triggered on a live call**: they observe only while
open, so anything between two waits is unobservable. Driving several workers off
them means one wait per worker, kept armed by hand — and every gap is a hole a
report falls through. Do not hand-roll that layer (background watcher agents
looping waits and reporting back); it drops reports at four seams and it is what
`watch_*` exists to retire.

```jsonc
watch_open { name: "campaign" }                                  // once — omit `ids` to watch every terminal
watch_next { name: "campaign", timeoutMs: 60000 }                // first call
watch_next { name: "campaign", after: <ackAfter>, timeoutMs: … } // then ACK the last batch each time
watch_close { name: "campaign" }                                 // when the campaign ends
```

- Events that land while you are **not** calling `watch_next` are buffered in
  padi, so the gap between calls is not a blind spot.
- **Acknowledge by passing each result's `ackAfter` back as the next `after`.**
  Unacknowledged events are handed over again, so a reply you never received is
  never lost — dedupe on each event's `seq` if you see one twice.
- The queue outlives your MCP process **and** kaval. Re-`watch_open` the SAME
  name after either to reattach; a new name starts empty. A **padi** restart
  (upgrade) clears subscriptions — `watch_next` then FAILS naming the
  subscription rather than reporting quiet, so re-`watch_open` and continue.
- Each event is `{ id, kind, at, parentId?, intent? }` with `kind` one of
  `asking` (blocked on input) · `finished` (turn ended AND output settled) ·
  `gone` (the terminal no longer exists — stop waiting on it).
- `timeout` and `closed` both lose nothing — the queue is still there next call.
  Neither means a terminal died. A nonzero `dropped` means you were away long
  enough to overflow the 512-event queue; re-read the `terminals` resource to
  reconcile rather than trusting the delta.
- Prefer the default (all terminals) over an `ids` list: a kaval recycle retires
  every active terminal id, so a frozen id list ages out where "all" does not.

## Provisioning the inner agent

- **Worktree'd agent:** no MCP path in v1 (`git.worktreeCreate` is a named
  denial) — `kolu create --repo /abs/repo --worktree my-branch -- claude
  --dangerously-skip-permissions`, then drive the returned id over MCP.
- **Never hardcode the agent CLI** — default to the agent *you* run as, unless
  the human named one.
- **`create` returning ≠ ready:** a first-run agent may sit on a one-time
  dialog needing its own Enter. Drive every boot step by reading the screen.
- Launch unattended agents with bypass permissions
  (`claude --dangerously-skip-permissions`) and confirm from the footer via
  `screen_text` before dispatching.
- Restarting the CLI in place: send its quit command (`/exit`) as a three-step
  submit, confirm the shell prompt, relaunch.
- **Terminal ids are not stable across a kaval restart** — a cached id can go
  stale mid-run. Re-find the terminal via the `terminals` resource by its
  stable `intent` label (set it at create for exactly this).

## Fallback — the `kolu` CLI

`kolu` is the ONE terminal CLI: the same verbs, spelled for a shell. Full
treatment (three-step submit in CLI form, `--file`, exit codes, endpoint flags,
worktree provisioning, the interim agent-spawn doctrine): **[TUI.md](TUI.md)**.
The verb map:

| MCP | CLI |
| --- | --- |
| `lifecycle_create` | `kolu create [--parent <id>] [--intent …] [--repo … --worktree …] -- <agent>` |
| `lifecycle_sendInput { text }` | `kolu send "$id" "text"` (`--file <path>` for tricky payloads) |
| `lifecycle_sendInput { key: "Enter" }` | `kolu send "$id" --key Enter` |
| `wait_outputSettled` | `kolu wait "$id" --until idle:<ms> --timeout <ms>` (also `--until match:'<regex>'`) |
| `wait_agentState` | `kolu wait "$id" --until working` · `--until awaiting,waiting` |
| `screen_text { tail }` | `kolu snapshot "$id" [--tail N]` (never bare `snapshot \| tail` — that's the buffer bottom incl. trailing blanks; `--tail` drops them) |
| `screen_history` | `kolu history "$id" [--lines N]` |
| `terminals` resource | `kolu ls [--json]` · `kolu watch [id]` for the live feed |
| `lifecycle_kill` | `kolu kill "$id"` |

Every verb takes the same **endpoint flags** — `--socket <path>` ·
`--state-root <dir>` · `--host <ssh>`, mutually exclusive, and accepted on
**either side of the verb** (`kolu --host box create` ≡ `kolu create --host
box`). Inside a kolu terminal `$PADI_SOCKET` is already stamped, so you pass
none. Ids accept **any unique prefix**.

## Acceptance

- Submitted with a **separate Enter**, sent after an observed settle.
- The reply is **actually in the screen read** — idle means output stopped, not
  that the answer is right.
- Every wait had a timeout under your harness's per-call cap.
- If the screen settled on a **question**, you read and answered it — not sent
  the next task on top of a blocked prompt.
- Killed exactly the terminals you created, no others.
