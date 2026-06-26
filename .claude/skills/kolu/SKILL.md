---
name: kolu
description: >-
  Drive one AI agent from another through kolu's terminals: spawn a Claude
  Code / Codex / opencode session in a PTY, prompt it, block until its turn
  ends, read its reply, and prompt again — a create→send→wait→snapshot loop run
  with the `kaval-tui` and `pulam-tui` CLIs directly (no MCP). `kaval-tui`
  writes input and reads scrollback; `pulam-tui` watches agent state for the
  done-signal. Triggers on "drive another agent", "send a prompt to a terminal
  agent", "have one agent prompt another", "agent drives agent", "orchestrate
  agents in terminals", "make Claude drive Codex", "prompt the agent running in
  that terminal", or wiring a loop where one coding agent supervises another.
---

# kolu — drive one agent from another through its terminal

You can run a coding agent (Claude Code, Codex, opencode) inside a kolu-owned
PTY and steer it from the outside: type a prompt, wait for it to finish, read
what it said, type the next prompt. Two thin CLIs are the whole toolkit —
`kaval-tui` (write input / read screen / spawn / kill) and `pulam-tui` (watch
agent state). The driver runs them directly; there is no server to stand up and
no MCP layer.

## Why two CLIs (don't fight it)

Two daemons, on purpose. **`kaval`** owns the PTYs — it knows what bytes are
*running*, nothing about agents. **`pulam`** computes *awareness* — repo, PR,
and the agent's state (working / awaiting / waiting). Agent status lives **only**
on pulam's surface, never on kaval's raw pty contract. So `send`/`snapshot` are
`kaval-tui` and the done-signal `wait` is `pulam-tui`: the loop spans both tools
**by design**, not by leak. Don't look for a `kaval-tui wait` — it can't exist.

## The loop

```sh
id=$(kaval-tui create -- claude --json | jq -r .id)            # spawn the inner agent
kaval-tui send  "$id" "refactor the parser to use a lexer"     # prompt it (submitted)
pulam-tui  wait "$id" --until working  --timeout 30000         # it picked the prompt up…
pulam-tui  wait "$id" --until awaiting,waiting --timeout 600000 # …and finished its turn
kaval-tui snapshot "$id" | tail -40                            # read the reply
kaval-tui send  "$id" "now add tests for it"                   # follow up — loop
```

Four leaf commands: **create** (spawn) · **send** (prompt) · **wait**
(done-signal) · **snapshot** (read). `create`/`send`/`snapshot`/`kill` are
`kaval-tui`; `wait`/`status`/`watch` are `pulam-tui`.

## `kaval-tui send` — prompt the agent

`kaval-tui send <id> [text...]` writes input to the terminal. It **submits with
Enter by default** — a prompt isn't sent until Enter, and that's the headline
case. Specifics:

- **Don't append `\n` yourself** to submit — the default Enter does it. Use
  `--no-enter` when you want to stage text on the line without sending (e.g. to
  add a `--key` afterward).
- **Multiline prompts and piped stdin go as one bracketed paste**, so they land
  in the input box as a block instead of submitting line-by-line; a single submit
  Enter follows. This is automatic (`--paste` / `--no-paste` force it). For a big
  prompt, pipe it — `cat task.md | kaval-tui send "$id"` — and skip shell-quoting
  hell.
- **`--key <name>`** (repeatable, sent after the text) for control keys:
  `Escape`, `C-c`, `Enter`, `Up`/`Down`/`Left`/`Right`, `Tab`, `Home`, `End`,
  `Backspace`, `M-<char>`.
- **`--json`** → `{ id, bytes, enter, paste }` to confirm what was written.

**`send` is blind** — it writes whether or not the agent is ready for input.
Always pair it with `wait` or `snapshot` so you don't fire a prompt into a
not-yet-ready session.

**Interrupt a runaway** before redirecting it:

```sh
kaval-tui send "$id" --key Escape          # stop Claude Code mid-stream
kaval-tui send "$id" --key C-c             # SIGINT whatever's running
```

## `pulam-tui wait` — the done-signal

`pulam-tui wait <id> --until <buckets>` blocks until the terminal's agent reaches
one of the comma-listed buckets, then exits 0. The buckets are kolu's coarse
agent states:

- **`working`** — the agent is busy (`thinking` / `tool_use` / running a
  background task).
- **`awaiting`** — `awaiting_user`: it's **asking you** a question, genuinely
  blocked on your answer.
- **`waiting`** — the **just-finished** post-turn lull: it's done and idle.

**`awaiting` and `waiting` both mean "your move"** (order≠colour: one is a
question, one is a finished turn). To catch *a turn ending*, wait for **both**:
`--until awaiting,waiting`. Then `snapshot` to see *which* it is and respond
accordingly — answer the question, or hand it the next task.

**`--timeout <ms>` is mandatory in automation.** Without it `wait` blocks forever;
a wedged inner agent then hangs your whole loop. With it, a stuck agent fails the
step **loudly (exit code 2)** so the loop can recover. `--json` → `{ id, agent }`
so you read the new state without a second call.

## The stale-state race — wait for `working` first

Right after you `send`, the inner agent often still reports the **previous**
turn's `waiting`/`awaiting` for a moment before flipping to `working`. So a bare
`wait --until awaiting,waiting` can return **instantly on the stale state**,
before the agent has even started — and you'll `snapshot` an empty reply.

- **Tight timing (the safe default):** two-phase. First
  `wait --until working` (confirm it picked the prompt up), **then**
  `wait --until awaiting,waiting` (its turn ended). The loop above does this.
- **Relaxed timing:** if you don't mind the small risk, a single
  `wait --until awaiting,waiting` is fine for long turns where the stale window
  is negligible. When in doubt, two-phase it.

## Reach — which daemon you're driving

Bare `kaval-tui` / `pulam-tui` **autodiscover** a running daemon on this machine.
The canonical setup runs a standalone `kaval` (owns the PTYs) with a `pulam`
pointed at it (pulam discovers the running kaval — a standalone one *or* a
kolu-server, each namespaced by listen port). Then every command below just
works with no flags.

- **`--socket <path>`** targets a specific local daemon — e.g. a running
  **kolu-server's** kaval, to drive the terminals you have open in kolu.
- **`--host <ssh>`** reaches a daemon on another machine (provisioned with Nix);
  a remote PTY survives the link.

**`wait` needs a `pulam` running against the same kaval** whose terminals you're
driving — `send`/`snapshot` only need the kaval. If `pulam-tui status` errors,
start a `pulam` (it needs a running kaval) before relying on `wait`; until then
you can still `send` and poll `snapshot` by hand.

## Acceptance

Before calling a driven turn done:

- The inner agent's **reply is actually in the `snapshot`** — not an empty box
  (the stale-state race) or a half-rendered stream.
- **Every `wait` carried a `--timeout`** so a wedged agent fails loudly instead
  of hanging the loop.
- When timing was tight, you **confirmed `working`** before waiting for the turn
  to end.
- After an `awaiting`, you **read the question** and answered it — you didn't
  send the next task on top of a blocked prompt.
