---
name: kolu
description: >-
  Drive one AI agent from another through kolu's terminals: spawn a Claude
  Code / Codex / opencode session in a PTY, prompt it, watch the screen, read
  the reply, prompt again. PRIMARY PATH: the kolu MCP tools
  (`lifecycle_create`/`lifecycle_sendInput`, `wait_outputSettled`/
  `wait_agentState`, `screen_text`, the `terminals` resource). FALLBACK: the
  `kaval-tui`/`padi-tui` CLIs — same verbs, same discipline. Triggers on "drive
  another agent", "agent drives agent", "make Claude drive Codex", or wiring a
  loop where one coding agent supervises another.
---

# kolu — drive one agent from another through its terminal

Run a coding agent inside a kolu-owned PTY and steer it from outside. **Use the
kolu MCP tools first** (`mcp__kolu__*`, wired in this repo's `.mcp.json`; other
hosts: `claude mcp add kolu -- kolu mcp`) — structured results, typed refusals,
no quoting hazards. Fall back to the `kaval-tui`/`padi-tui` CLIs (last section)
when no MCP is connected. Both faces drive the same daemon, so every discipline
here applies to both.

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

## Provisioning the inner agent

- **Worktree'd agent:** no MCP path in v1 (`git.worktreeCreate` is a named
  denial) — `padi-tui create --repo /abs/repo --worktree my-branch -- claude
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

## Fallback — the `kaval-tui` / `padi-tui` CLIs

Full CLI treatment (three-step submit in CLI form, `--file`, exit codes, daemon
discovery, worktree provisioning, the interim agent-spawn doctrine):
**[TUI.md](TUI.md)**. The verb map:

| MCP | CLI |
| --- | --- |
| `lifecycle_create` | `padi-tui create [--parent <id>] [--repo … --worktree …] -- <agent>` · `kaval-tui create -- <agent>` (raw) |
| `lifecycle_sendInput { text }` | `kaval-tui send "$id" "text"` (`--file <path>` for tricky payloads) |
| `lifecycle_sendInput { key: "Enter" }` | `kaval-tui send "$id" --key Enter` |
| `wait_outputSettled` | `kaval-tui wait "$id" --until idle:<ms> --timeout <ms>` (also `--until match:'<regex>'`) |
| `wait_agentState` | `padi-tui wait "$id" --until working\|awaiting,waiting` |
| `screen_text { tail }` | `kaval-tui snapshot "$id" --viewport` (never bare `snapshot \| tail` — that's the buffer bottom, not the screen) |
| `terminals` resource | `kaval-tui list` · `padi-tui status` |
| `lifecycle_kill` | `kaval-tui kill "$id"` |

## Acceptance

- Submitted with a **separate Enter**, sent after an observed settle.
- The reply is **actually in the screen read** — idle means output stopped, not
  that the answer is right.
- Every wait had a timeout under your harness's per-call cap.
- If the screen settled on a **question**, you read and answered it — not sent
  the next task on top of a blocked prompt.
- Killed exactly the terminals you created, no others.
