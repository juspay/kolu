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
lifecycle_create   { placement: {kind: "toplevel"},                     → { id, briefed }
                     intent: "🔧 parser refactor", cwd: "/abs/repo",
                     run: "claude", message: "refactor the parser" }    # spawn AND brief
wait_agentState    { id, until: ["awaiting","waiting"],                 # let its turn finish
                     settledMs: 15000, screenTail: 40,                  #   AND read the screen
                     timeoutMs: 600000 }
lifecycle_sendInput{ id, text: "now add tests", submit: true }          # every next dispatch
```

Two calls to put a worker to work, one per dispatch after that. Both halves used
to be several: `run` + `message` replaces create-then-wait-for-boot-then-type,
and `submit: true` replaces text → settle → Enter. `screenTail` is why there is
no separate read: the screen comes back **on the met**, inside the wait. A
follow-up `screen_text` is a second call the terminal can move under — that gap
is a race, not a formality.

- `lifecycle_create` spawns a padi-tracked canvas tile. **`placement` is
  REQUIRED and has no default** — `{kind: "toplevel"}` for a tile of its own, or
  `{kind: "child-of", parentId: <id>}` to open it as a **split INSIDE** that
  tile; a call that omits it is refused, naming both spellings. Decide it per
  spawn: the canvas and the Dock read that edge as who-works-for-whom, so a
  worker you supervise belongs under you rather than beside you by accident.
  `intent` labels it, `cwd` sets the directory. `repo` + `worktree` cut a fresh git worktree at
  `<repo>/.worktrees/<name>` and open the terminal IN it, `run` types a
  command line at the first shell prompt (submitted with Enter), and
  **`message` delivers a first prompt once that command reaches its own
  prompt** — so `run` + `message` spawns and briefs a worker in ONE call, with
  no boot wait and no follow-up send.
- `lifecycle_sendInput` — **pass `submit: true` with your `text`.** padi waits
  for the target's prompt to be idle, types, waits for the TUI to take it, and
  presses Enter, answering `{submitted: true, readyAfterMs, settledAfterMs}`.
  This is the default way to prompt an agent. Without `submit` it is the raw
  write: **text OR one named key, never both** — `{ text, key }` together is a
  typed hard error. Keys: `Enter`, `Escape`, `Tab`, arrows, `Home`/`End`,
  `Backspace`, `Space`, `Shift-Tab`, `C-<char>`/`M-<char>`. Unknown key names
  error loudly. Multiline text goes as one bracketed paste either way.
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

## Submitting — `submit: true`, and the trio it replaced

An Enter sent in the same breath as the text races the TUI's bracketed-paste
handling and is **silently dropped** — the prompt sits staged on the `❯` line
while the send reports success. That is still true, and it is why `{ text, key }`
in one call is a hard error. What changed is **who watches the gap**: padi sees
kaval's output edge for every PTY and folds each terminal's agent state, so
`submit: true` hands it the whole delivery — idle prompt → type → settle → Enter
— and answers with what happened.

```jsonc
lifecycle_sendInput { id, text: "review this PR", submit: true }
// → { sent: {textBytes}, submitted: true, readyAfterMs, settledAfterMs }
// settleMs tunes the quiet window (default 1500) for a chattier TUI.
```

**A busy target is REFUSED, not queued.** This is the part to internalise,
because it inverts the old advice. Several TUIs — grok among them — **clear a
typed-but-unsubmitted input box when their turn ends**, so "type now, Enter
later" does not buffer, it *destroys the message* while the send reports
success. So a submit into a running turn comes back as an error, and the
`structuredContent` says which:

| `phase` | what landed | what you do |
| --- | --- | --- |
| `ready` | **nothing** | the target is mid-turn — wait for it (`wait_agentState`) and dispatch again. Retrying is free. |
| `settle` | the text, **unsubmitted** | send `key: "Enter"` once it is calm, or `Escape` and re-send. **Never blindly re-send** — that delivers the message twice. |

The manual trio is still there, and is now the **escape hatch**: reach for it
only when something must happen *between* the text and the Enter.

```
lifecycle_sendInput{ id, text: "…" }                     # 1. the text (no Enter)
wait_outputSettled { id, idleMs: 300, timeoutMs: 15000 } # 2. observe the TUI settle
lifecycle_sendInput{ id, key: "Enter" }                  # 3. submit (its own call)
```

> **Multi-line pastes don't submit** ([#1702](https://github.com/juspay/kolu/issues/1702)):
> past a handful of lines, Claude Code folds the paste into a `[Pasted text]`
> placeholder that Enter does not reliably submit. For any message beyond a
> couple of lines, write it to a file and send a short pointer prompt instead
> (`read /tmp/brief.md and carry it out`) — as the `text` of a `submit: true`
> call like any other.

## Done-signals

- `wait_outputSettled { idleMs, timeoutMs }` — raw output quiescence,
  agent-agnostic. `800` is a good default. It can't tell "finished" from
  "blocked asking you" — read the screen before responding.
- `wait_agentState { until: […], timeoutMs }` — padi's detected state:
  `working`, `awaiting` (asking you), `waiting` (post-turn lull). It matches
  the state **the instant it connects**, so right after a submit it can return
  on the *previous* turn's `waiting` — wait in two phases:
  `until: ["working"]`, then `until: ["awaiting","waiting"]`.

Both take two modifiers, and both exist because the thing they close is a race
**between calls** that no caller can close from outside:

- `settledMs` — a **conjunct**, not a second wait. The met needs the condition
  to hold AND no output byte for that long; bytes still moving keep the wait
  open, and a bucket that drops back to `working` re-enters it. This is the fix
  for the failure that reads as a finished agent: a main loop that ends its turn
  while an async subagent is three minutes into a deliberate plan is `waiting`
  within milliseconds. **15000** is the field-calibrated value.
- `screenTail: N` — the met carries the last N screen lines, read inside the
  same wait, so nothing can move between the signal and the read.

**The debrief call.** `wait_agentState { until: ["awaiting","waiting"],
settledMs: 15000, screenTail: 40 }` is "is this worker's turn really over, and
what did it say?" in one race-free call — the same protocol `kolu debrief`
spells on the CLI. Prefer it to the three-call version whenever you are driving
an agent rather than a bare shell.

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

- **Worktree'd agent, spawned and briefed in one call:**
  `lifecycle_create { placement, repo, worktree, run: "claude
  --dangerously-skip-permissions", message: "<the brief>" }`. padi cuts the
  worktree, opens the terminal in it, types the launch line, waits for the agent
  to reach its prompt — a booting agent is *silent* for a second or three, and
  the first message's quiet window is widened to out-wait that — then delivers
  the brief and submits it.
- **Never hardcode the agent CLI** — default to the agent *you* run as, unless
  the human named one.
- **`create` returning ≠ ready:** a first-run agent may sit on a one-time
  dialog needing its own Enter. `message` cannot get past that (it waits for a
  prompt that never comes and refuses, naming the live terminal). For a *first*
  run of an agent CLI, drive the boot by reading the screen.
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
| `lifecycle_create` (`placement` REQUIRED) | `kolu create (--toplevel \| --parent <id>) [--intent …] [--repo … --worktree …] [--message "<brief>"] -- <agent>` |
| `lifecycle_sendInput { text, submit: true }` | `kolu send "$id" --submit "text"` (`--settle-ms <ms>` tunes the quiet window) |
| `lifecycle_sendInput { text }` | `kolu send "$id" "text"` (`--file <path>` for tricky payloads) |
| `lifecycle_sendInput { key: "Enter" }` | `kolu send "$id" --key Enter` |
| `wait_outputSettled` | `kolu wait "$id" --until idle:<ms> --timeout <ms>` (also `--until match:'<regex>'`) |
| `wait_agentState` | `kolu wait "$id" --until working` · `--until awaiting,waiting` |
| `{ settledMs, screenTail }` on either wait | `--settled <ms>` · `--snapshot <N>` on `kolu wait` |
| `wait_agentState { until: ["awaiting","waiting"], settledMs: 15000, screenTail: 40 }` | **`kolu debrief "$id"`** — the same protocol either way, and what you should reach for when driving an agent: turn over **AND** output quiet, then the screen, in one call. |
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

- Dispatched with `submit: true` (or, when you needed the gap, a **separate
  Enter** after an observed settle) — never a same-breath text+Enter.
- A `submit-refused` was **acted on, not retried blindly**: `phase: "ready"`
  means wait and dispatch again; `phase: "settle"` means the text is already in
  the box, so finish it with an Enter.
- The reply is **actually in the screen read** — idle means output stopped, not
  that the answer is right.
- Every wait had a timeout under your harness's per-call cap.
- If the screen settled on a **question**, you read and answered it — not sent
  the next task on top of a blocked prompt.
- Killed exactly the terminals you created, no others.
