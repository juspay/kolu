---
name: kolu
description: >-
  Drive one AI agent from another through kolu's terminals: spawn a Claude
  Code / Codex / opencode session in a PTY, prompt it, watch the screen for its
  reply, read it, and prompt again. PRIMARY PATH: the kolu MCP server's tools
  (`lifecycle_create`/`lifecycle_sendInput` with named keys, the
  `wait_outputSettled`/`wait_agentState` done-signals, `screen_text`, the
  `terminals` resource) — configured in this repo's .mcp.json as `kolu mcp`.
  FALLBACK when the MCP is unavailable: the `kaval-tui`/`padi-tui` CLIs, same
  verbs, same discipline. Triggers on "drive another agent", "send a prompt to
  a terminal agent", "have one agent prompt another", "agent drives agent",
  "orchestrate agents in terminals", "make Claude drive Codex", "prompt the
  agent running in that terminal", or wiring a loop where one coding agent
  supervises another.
---

# kolu — drive one agent from another through its terminal

You can run a coding agent (Claude Code, Codex, opencode) inside a kolu-owned
PTY and steer it from the outside: type a prompt, submit it, watch the screen
until it's done, read what it said, type the next prompt.

**Reach for the kolu MCP tools first** (`mcp__kolu__*` — served by `kolu mcp`,
wired in this repo's `.mcp.json`; other hosts: `claude mcp add kolu -- kolu
mcp`). They speak padi's live surface directly — structured results, typed
refusals, no shell quoting hazards. **Fall back to the `kaval-tui` / `padi-tui`
CLIs** (the final section) when no kolu MCP is connected — a host without the
server configured, a machine with no padi running, or a RAW standalone-kaval
terminal padi doesn't track. The verbs map one-to-one, and every discipline
below (the three-step submit, the done-signal, the fold hazard) applies to both
faces because they drive the same daemon.

## The loop (MCP)

```
lifecycle_create   { intent: "🔧 parser refactor", cwd: "/abs/repo" }   → { id }
lifecycle_sendInput{ id, text: "refactor the parser to use a lexer" }   # 1. the text (no Enter)
wait_outputSettled { id, idleMs: 300, timeoutMs: 15000 }                # 2. observe the TUI settle
lifecycle_sendInput{ id, key: "Enter" }                                 # 3. submit (its own call)
wait_outputSettled { id, idleMs: 800, timeoutMs: 600000 }               # 4. let its turn finish
screen_text        { id, tail: 40 }                                     # 5. read the screen
```

- **`lifecycle_create`** spawns a canvas tile (a real padi-tracked terminal —
  agent sensors, dock state, the works). `intent` labels the tile so a human
  watching the canvas knows whose it is; `cwd` sets the working directory;
  **`parentId: <your-or-another-terminal-id>` opens it as a SPLIT beside that
  tile** (the sibling-reviewer layout `/codex-debate` uses). It spawns a shell —
  launch the agent by sending its command line (`claude
  --dangerously-skip-permissions` etc.) through the three-step submit below.
- **`lifecycle_sendInput`** writes **text OR one named key, never both** —
  `{ text, key }` in one call is a hard, typed error (see the submit
  discipline). The key vocabulary: `Enter`, `Escape`, `Tab`,
  `Up`/`Down`/`Left`/`Right`, `Home`, `End`, `Backspace`, `Space`,
  `Shift-Tab`, and `C-<char>` / `M-<char>` chords. An unknown key name is a
  loud error, never a silent no-op. Multiline text goes as one bracketed
  paste automatically.
- **`wait_outputSettled`** is the agent-agnostic done-signal (below);
  **`wait_agentState`** the precise one. Both return a uniform result frame —
  `{ result: "met" | "timeout" | "gone" | "closed", elapsedMs, … }` — read
  `result`, never guess from silence.
- **`screen_text { tail: N }`** reads the last N *content* lines (trailing
  blank viewport rows are stripped) — the cheap "what's on screen now" read.
  Omit `tail` for the whole scrollback; `screen_history` pages older
  scrollback above it.
- **`lifecycle_kill { id }`** ends a terminal. Kill exactly the terminals you
  created, when you're done with them.
- The **`terminals` resource** (`surface://collections/terminals`) is the live
  roster — the key set; each id's full record (intent, cwd, git, agent kind +
  state, `parentId`, foreground process) reads at
  `surface://collections/terminals/<id>`. **`surface://cells/urgency`** lists
  the terminals whose agent awaits a human right now.
  *(The `activity` resource's one-shot read is always `[]` by construction — a
  fresh subscription counts bytes only from subscribe time — so it's useful
  via subscription updates, not reads.)*

> **Interrupt a runaway** before redirecting it:
> `lifecycle_sendInput { id, key: "Escape" }` (stop Claude Code mid-stream),
> `{ key: "C-c" }` (SIGINT whatever's running).

## The three-step submit — text · settle · Enter

Submitting a prompt to a TUI agent is **three calls**, because `sendInput`
bakes in no timing magic — it writes exactly what you pass:

```
lifecycle_sendInput{ id, text: "fix the failing test in parser.ts" }
wait_outputSettled { id, idleMs: 300, timeoutMs: 15000 }
lifecycle_sendInput{ id, key: "Enter" }
```

Why not one call? An Enter sent in the *same breath* as the text races Claude
Code's bracketed-paste / debounced input handling and is **silently dropped**,
leaving the prompt staged on the `❯` line while the send reports success (if a
turn never seems to start, this is the #1 cause — `screen_text` and look for
the prompt sitting unsent). The daemon **cannot observe** when the TUI
settled, so any fixed grace baked into the send is a race. The honest fix is
step 2: **you** observe the settle, then submit as its own call. `{ text,
key }` in one call is a **typed hard error** for exactly this reason — the
trap is unspellable, not merely discouraged.

> **⚠️ MULTI-LINE pastes don't submit — a known-open limitation ([#1702](https://github.com/juspay/kolu/issues/1702)).**
> The three-step flow is verified for a **short** prompt (a line or two). Claude
> Code folds a paste into a `[Pasted text +N lines]` placeholder once it spans
> more than a handful of lines (observed at ~a dozen lines, well under 1 KB), and
> a folded paste does **NOT** reliably submit — idle firing proves the fold
> finished, not that Enter submits it. **Workaround for any multi-line message**
> (a brief, a report, a ruling): write it to a file and send a **short** prompt
> pointing the agent at it — `{ text: "read /tmp/brief.md and carry it out" }` —
> then the three-step submit. Reach for the file-pointer the moment a message
> runs past a couple of lines.

> **Step 2 fires cleanly only when the agent is AT THE PROMPT** (the normal
> case: `idleMs: 300` fires in under a second). Messaging an agent that is
> **mid-turn and busy** (streaming continuously), the idle window never
> opens — so the `timeoutMs` fires instead. Treat `result: "timeout"` there as
> *"target busy"*: send the Enter anyway (it lands in the input buffer and
> submits when the turn ends), then `screen_text` to confirm. A
> `result: "gone"` is real (the terminal exited — the agent you were driving
> died); surface it, don't send into the void.

## The done-signals

After you submit, you need to know when the turn ends. Two tools, reading
different things:

- **`wait_outputSettled { id, idleMs, timeoutMs }`** keys on **raw output
  quiescence** — resolves `met` once no output byte has arrived for `idleMs`.
  Agent-agnostic (bytes, not rendering): works identically for
  `claude`/`codex`/`grok`/`opencode`. `800` is a good default; raise it for an
  agent that pauses mid-thought. It can't tell "finished" from "blocked asking
  you" — both are quiescence — so **`screen_text` and read** before responding.
- **`wait_agentState { id, until: [...], timeoutMs }`** keys on padi's
  **detected agent state** — precise buckets: `working` (thinking/tool_use),
  `awaiting` (asking **you** a question), `waiting` (the just-finished
  post-turn lull). `awaiting`/`waiting` both mean "your move". It needs a
  terminal padi tracks (every `lifecycle_create` terminal is); a bare shell
  with no agent running never enters a bucket — bound it with `timeoutMs`.

Always pass **`timeoutMs`** so a wedged agent fails loud (`result: "timeout"`)
instead of hanging the loop — and keep it **under your own harness's per-call
timeout** (most MCP hosts cap a tool call at ~1–2 minutes by default; a longer
wait gets *your* call killed while the driven agent is fine). For a long turn,
poll in bounded slices: repeat `wait_outputSettled { idleMs: 800, timeoutMs:
60000 }` and treat each `timeout` as "still busy, wait again".

> **Mind the stale-state race — wait in two phases.** `wait_agentState`
> matches the state **the instant it connects**, replaying whatever it is right
> now. Right after a submit, the agent may still report the *previous* turn's
> `waiting` for a beat — a lone `until: ["awaiting","waiting"]` returns
> immediately on that stale state. For a robust loop: first
> `until: ["working"]` (it picked up the prompt), then
> `until: ["awaiting","waiting"]` (its turn ended).

## Provisioning the inner agent

- **A split tile beside a terminal**: `lifecycle_create { parentId: <id> }` —
  the record carries `parentId` and the canvas renders it as a sibling split.
- **A worktree'd agent** (fresh git worktree as the terminal's cwd) has **no
  MCP path in v1** — `git.worktreeCreate` is a named denial. Provision with
  the CLI: `padi-tui create --repo /abs/repo --worktree my-branch -- claude
  --dangerously-skip-permissions` (fast-forward the base repo first — the
  worktree is cut from the checkout as it stands), then drive the returned id
  over MCP as usual.
- **Never hardcode the agent CLI.** The inner agent defaults to the same agent
  *you* are running as (a Claude Code orchestrator spawns `claude`, a codex
  one `codex`) — unless the human named a different agent, which wins.
- **`create` returning ≠ the agent is ready.** `screen_text` before
  dispatching: a first-run agent may sit on a one-time dialog (a trust prompt,
  MCP selection) that needs its own `{ key: "Enter" }`. Drive every boot step
  by reading the screen, never by sleeping and hoping.
- **Set the permission mode AT LAUNCH, then verify it from the footer.** An
  unattended agent launches with bypass permissions (`claude
  --dangerously-skip-permissions`); read the footer via `screen_text` and
  confirm before dispatching.
- **Restarting the agent CLI in place**: text typed at a *running* agent
  becomes a prompt — send its quit command (`/exit` in Claude Code) as its own
  three-step submit, confirm the shell prompt in `screen_text`, then launch
  again.

> **A terminal id is not stable across a kaval restart.** kaval re-keys every
> terminal when it restarts, so a cached id can go stale mid-run (a send to it
> fails "not found"). Re-find the terminal through the `terminals` resource —
> read each id's record and match on the stable **`intent`** label (set it at
> create for exactly this) — then use its current id.

## Fallback — the `kaval-tui` / `padi-tui` CLIs (no MCP connected)

When no kolu MCP server is available — the host has none configured, or you're
driving a **raw standalone kaval** terminal padi doesn't track — the same loop
runs on the CLIs. The discipline is identical; only the spelling changes:

| MCP | CLI |
| --- | --- |
| `lifecycle_create` | `padi-tui create [--parent <id>] [--repo … --worktree …] -- <agent>` (canvas tile) · `kaval-tui create -- <agent>` (raw, padi-blind) |
| `lifecycle_sendInput { text }` | `kaval-tui send "$id" "text"` (`--file <path>` for shell-metacharacter payloads) |
| `lifecycle_sendInput { key: "Enter" }` | `kaval-tui send "$id" --key Enter` |
| `wait_outputSettled` | `kaval-tui wait "$id" --until idle:<ms> --timeout <ms>` (also `--until match:'<regex>'`, CLI-only) |
| `wait_agentState` | `padi-tui wait "$id" --until working\|awaiting,waiting` |
| `screen_text { tail }` | `kaval-tui snapshot "$id" --viewport` (never a bare `snapshot \| tail` — that's the buffer bottom, not the screen) |
| `terminals` resource | `kaval-tui list` (autodiscovers every daemon, self-labeling) · `padi-tui status` |
| `lifecycle_kill` | `kaval-tui kill "$id"` |

```sh
id=$(kaval-tui create --json -- claude | jq -r .id)          # spawn (raw kaval)
kaval-tui send  "$id" "refactor the parser to use a lexer"   # 1. the text
kaval-tui wait  "$id" --until idle:300                       # 2. observe the settle
kaval-tui send  "$id" --key Enter                            # 3. submit
kaval-tui wait  "$id" --until idle:800 --timeout 600000      # 4. the turn ends
kaval-tui snapshot "$id" --viewport                          # 5. read
```

CLI-specific notes (they don't apply to the MCP face):

- **Flags go AFTER the subcommand** (`kaval-tui list --socket <path>`, never
  `kaval-tui --socket <path> list`).
- **Inside a kolu terminal, `$KAVAL_SOCKET` names your daemon and
  `$KAVAL_TERMINAL_ID` names *this* terminal** (`$PADI_SOCKET` is padi-tui's
  twin) — an agent can drive its siblings or itself with zero discovery.
  Absent → `kaval-tui list`.
- **Exit codes are the wire**: met → 0, timeout → 2 ("target busy" when
  bounded-waiting on a busy agent), terminal gone → 3, link/usage → 1.
  `--json` gives the structured `{ id, result, … }` frame instead.
- **A held foreground `wait` runs inside YOUR harness's tool timeout** (~2 min
  default in most agent harnesses): either end your turn and let the other
  side ping you (the event-driven loop — see `/codex-debate`), or raise the
  Bash call's own timeout above the `--timeout`.
- **Socket paths must stay under 108 bytes** (`AF_UNIX`): a hand-rolled
  standalone kaval needs a short `--socket` (`/tmp/kv.$$/pty.sock`), never one
  under a deep scratchpad path.
- **Old daemon without `wait`**: fall back to polling `snapshot --viewport`
  until the screen holds still across two reads, capped by a deadline.

## Acceptance

Before calling a driven turn done:

- You **submitted with a separate Enter send**, sent *after* you observed the
  settle — never text+Enter fused (a typed hard error on both faces). A prompt
  left staged on the `❯` line is the #1 failure here.
- The inner agent's **reply is actually in the screen read** — not an empty box
  or a half-rendered stream. Idle means "output stopped", not "the answer is
  right"; verify the content.
- Every wait had a **timeout** so a wedged agent fails loud instead of hanging
  the loop — and the timeout sat under your own harness's per-call cap.
- If the screen settled on a **question** (the agent is awaiting you), you
  **read it and answered** — you didn't send the next task on top of a blocked
  prompt.
- You **killed exactly the terminals you created** (`lifecycle_kill` /
  `kaval-tui kill`), and no others.
