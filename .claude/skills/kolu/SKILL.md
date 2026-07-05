---
name: kolu
description: >-
  Drive one AI agent from another through kolu's terminals: spawn a Claude
  Code / Codex / opencode session in a PTY, prompt it, watch the screen for its
  reply, read it, and prompt again — a create→send→snapshot loop run with the
  `kaval-tui` CLI directly (no MCP). `kaval-tui` writes input, reads scrollback,
  and provides a hook-free done-signal (`wait --until idle:<ms>` on raw PTY
  output); `padi-tui` adds a precise agent-state done-signal when you drive
  terminals a kolu owns. Triggers on "drive another agent", "send a prompt to a
  terminal agent", "have one agent prompt another", "agent drives agent",
  "orchestrate agents in terminals", "make Claude drive Codex", "prompt the
  agent running in that terminal", or wiring a loop where one coding agent
  supervises another.
---

# kolu — drive one agent from another through its terminal

You can run a coding agent (Claude Code, Codex, opencode) inside a kolu-owned
PTY and steer it from the outside: type a prompt, submit it, watch the screen
until it's done, read what it said, type the next prompt. The whole toolkit is
**`kaval-tui`** — write input, read the screen, spawn, kill. The driver runs it
directly; there's no server to stand up and no MCP layer.

For a raw `kaval-tui`-spawned terminal, the done-signal is **`kaval-tui wait
--until idle:<ms>`** — it blocks in the daemon on the raw PTY output and returns
the moment the agent stops streaming, with no shell hooks (below). `padi-tui`
adds a *precise agent-state* done-signal (`wait --until <buckets>`), but only for
terminals a **kolu owns** (the last section); for raw terminals, reach for
`kaval-tui wait`.

## The loop

```sh
id=$(kaval-tui create --json -- claude | jq -r .id)            # spawn the inner agent
kaval-tui send  "$id" "refactor the parser to use a lexer" --submit   # 1. type AND submit
kaval-tui wait  "$id" --until idle:800 --timeout 600000        # 2. let its turn finish (below)
kaval-tui snapshot "$id" --viewport                            # 3. read the screen
kaval-tui send  "$id" "now add tests for it" --submit          # loop
```

Leaf commands, all `kaval-tui`: **create** (spawn) · **send --submit** (type +
submit in one command) · **wait** (block until the turn ends) · **snapshot**
(read) · **kill**. `--submit` is what makes prompt delivery one command; raw
`send` (no `--submit`) types without an Enter — the manual-control channel, see
below.

> **Read with `snapshot --viewport`, not `| tail`.** A bare `snapshot` prints the
> **whole scrollback** — thousands of lines on a long-running or compacted agent —
> so `snapshot | tail -8` hands you the bottom of the buffer (often just trailing
> blanks), not the live screen. `--viewport` asks the daemon for just its
> terminal's last screenful — the right "what's on screen now" read, and correct
> regardless of how tall your own shell is (over `--host` the remote terminal is a
> different size). `--tail N` (alias `--lines N`) bounds it to the last N lines
> when you want a fixed slice.

## `kaval-tui send --submit` — type and submit in one command

`kaval-tui send <id> [text...] --submit` writes the prompt AND submits it:

```sh
kaval-tui send "$id" "fix the failing test in parser.ts" --submit
```

`--submit` writes the text (paste rules below unchanged), waits a fixed grace,
**then** sends Enter. The grace is the whole point — an Enter sent in the *same
breath* as the text races Claude Code's bracketed-paste / debounced input
handling and is **silently dropped**, leaving the prompt staged on the `❯` line
while `send` reports success (if a turn never seems to start, this is the #1
cause — `snapshot` and look for the prompt sitting unsent). `--submit` schedules
the Enter *past* that debounce, so it lands after the text settles. Bare
`--submit` waits **250ms**; `--submit=<ms>` tunes it (raise it for a sluggish
agent). It is a blind delay — no screen read, no idle-detection — so the command
returns after the grace regardless of what the agent is doing — bare `--submit`
in well under a second, a tuned `--submit=<ms>` after that many ms; you still `wait` +
`snapshot` afterward to read the reply.

> **Manual control — raw `send`, no `--submit`.** Plain `kaval-tui send <id>
> [text...]` writes **exactly** the text (and any `--key`s) with **NO implicit
> Enter** — the raw channel for driving menus, partial input, or control keys.
> To submit by hand, send Enter as its own later step: `kaval-tui send "$id"
> --key Enter` (a standalone follow-up lands after the text settles). `--submit`
> owns the Enter, so it is **mutually exclusive with `--key`** — use one or the
> other.

Specifics:

- **Multiline prompts and piped stdin go as one bracketed paste**, so they land
  in the input box as a block instead of submitting line-by-line. Automatic
  (`--paste` / `--no-paste` force it). For a big prompt, pipe it and submit in
  one go — `cat task.md | kaval-tui send "$id" --submit`.
- **`--key <name>`** (repeatable, sent after the text) is the control channel for
  manual driving: `Escape`, `C-c`, `Enter`, `Up`/`Down`/`Left`/`Right`, `Tab`,
  `Home`, `End`, `Backspace`, `M-<char>`. (`--key Enter` submits by hand; prefer
  `--submit` for prompt delivery.)
- **`--json`** → `{ id, bytes, paste, keys }` (plus `submitted` + `graceMs` under
  `--submit`) to confirm what was written.

**`send` is blind** — it writes whether or not the agent is ready for input.
Always pair it with `snapshot` so you don't fire a prompt into a not-yet-ready
session (e.g. before the TUI has drawn its input box, or over a trust prompt).

**Interrupt a runaway** before redirecting it:

```sh
kaval-tui send "$id" --key Escape          # stop Claude Code mid-stream
kaval-tui send "$id" --key C-c             # SIGINT whatever's running
```

## The done-signal — `kaval-tui wait --until idle:<ms>`

After you submit, you need to know when the turn ends. For a raw
`kaval-tui`-spawned terminal there's no agent-state feed — but the daemon already
sees every output byte, so **`kaval-tui wait`** blocks on that raw stream and
returns the instant the agent goes quiet, with **no shell hooks** and no
busy-word guessing:

```sh
kaval-tui wait "$id" --until idle:800 --timeout 600000   # block until the turn ends
```

- **`--until idle:<ms>`** resolves once no output byte has arrived for `<ms>` —
  the agent-agnostic "turn ended / awaiting input" signal, and the common case.
  `800` is a good default; raise it for an agent that pauses mid-thought, lower
  it for a snappier loop. It works identically for `claude`/`codex`/`grok`/
  `opencode` because it keys on bytes, not on any agent's rendering.
- **`--until match:'<regex>'`** resolves once *new* output matches — use it for a
  completion marker or a returned-prompt sentinel (e.g. `--until match:'\$ $'`).
- **`--timeout <ms>`** caps the wait and **fails loud (exit 2)** so a wedged agent
  can't hang the loop. If the terminal **exits** before the condition fires,
  `wait` exits **3** (the agent you were driving died). Met → exit **0**.
- **`--json`** → one result frame per outcome: `{ id, result, … }`, where
  `result` is `met`/`timeout`/`gone`/`interrupted`/`closed`. A `met` frame adds
  `fired` (`idle`/`match`), `elapsedMs`, and `matchedLine` on a match — so a
  driver reads the structured `result`, never just the exit code.

Quiescence ≠ "the reply is correct": idle fires whether the agent **finished** or
is **blocked asking you something** (both mean "your move"). So after `wait`
returns, **`snapshot --viewport` and read** what's on screen before responding.

> **Fallback — screen-settle polling (only for an old daemon).** If you're
> driving a kaval that predates `wait` (it errors "unhandled command"), fall back
> to polling `snapshot --viewport` until the screen holds still across two reads,
> capped by a deadline. It's coarser and laggier (a busy agent that pauses
> mid-thought can read as settled, and the poll lags the real settle), so prefer
> `kaval-tui wait` whenever the daemon has it.
>
> ```sh
> wait_until_settled() {   # fallback only — kaval-tui wait is preferred
>   local id=$1 deadline=$(( $(date +%s) + 600 )) prev="" cur stable=0
>   while [ "$stable" -lt 2 ] && [ "$(date +%s)" -lt "$deadline" ]; do
>     sleep 3
>     cur=$(kaval-tui snapshot "$id" --viewport)   # the live screen, not full scrollback
>     if [ "$cur" = "$prev" ]; then stable=$((stable + 1)); else stable=0; fi
>     prev=$cur
>   done
> }
> ```

## `padi-tui wait` vs `kaval-tui wait` — two done-signals

They are not rivals; they read different things:

- **`kaval-tui wait`** keys on **raw output quiescence/match** — works on **any**
  terminal, **no hooks**. This is the one to reach for when driving a raw
  `kaval-tui create` agent (above). It can't tell "finished" from "blocked asking
  you" — both are quiescence — so read the snapshot after.
- **`padi-tui wait`** keys on **agent-state buckets** (working/awaiting/waiting)
  — more precise (it *distinguishes* awaiting-you from finished), but only for
  terminals a **kolu owns** (padi runs the agent sensors over them). Use it when
  you're driving terminals a kolu-server spawned (below).

### `padi-tui wait` — the precise done-signal (kolu-owned terminals only)

When you *do* have agent-state detection, `padi-tui wait <id> --until <buckets>`
is the exact done-signal — it blocks until the agent reaches a coarse state, then
exits 0:

- **`working`** — busy (`thinking` / `tool_use` / background task).
- **`awaiting`** — `awaiting_user`: it's **asking you** a question.
- **`waiting`** — the **just-finished** post-turn lull.

`awaiting` and `waiting` both mean "your move", so `--until awaiting,waiting`
catches a turn ending; `--timeout <ms>` fails loud (exit 2) so a wedged agent
can't hang the loop; if the terminal **exits** before reaching the state, `wait`
fails loud too (exit 3 — the agent you were driving died); `--json` →
`{ id, agent }`.

> **Mind the stale-state race — wait in two phases.** `wait` matches the agent's
> state **the instant it connects**, replaying whatever it is right now. So right
> after a `send`, the agent may still report the *previous* turn's
> `waiting`/`awaiting` for a beat before it picks up the new prompt — and a lone
> `wait --until awaiting,waiting` would return immediately on that stale state,
> before the turn you asked for has even begun. For a robust loop, wait for the
> pickup first, then the turn-end:
>
> ```sh
> kaval-tui send "$id" "fix the parser" --submit
> padi-tui wait "$id" --until working           # 1. it picked up the prompt
> padi-tui wait "$id" --until awaiting,waiting   # 2. its turn ended
> ```

> **Reach — `padi-tui` dials padi, not kaval.** `padi-tui` reads a running
> **padi** (the per-host workspace daemon a kolu-server owns), so **inside a kolu
> terminal `$PADI_SOCKET` makes it flag-less** (`padi-tui wait "$id" --until …`
> just works — the padi-side twin of `$KAVAL_SOCKET` below). Outside a kolu
> terminal it autodiscovers the running padi; `--socket <path>` / `--state-root
> <dir>` point it elsewhere. Flags go **after** the subcommand.
>
> **Caveat — agent state needs a terminal padi TRACKS.** padi derives agent state
> from the sensors it runs over the terminals it owns. `kaval-tui create` is the
> **raw** multiplexer — a plain `$SHELL` padi never sees — so an agent you spawn
> that way isn't in padi's registry, and `padi-tui wait` will just time out.
> `padi-tui wait` is reliable when you drive terminals a running **kolu-server**
> spawned (find them with `kaval-tui list` autodiscovery — see *Reach* below). For
> a raw `kaval-tui create` loop, use **`kaval-tui wait --until idle:<ms>`** above
> — it needs no daemon-side agent state.

## Reach — which daemon you're driving

**Lead with `kaval-tui list`.** With no `--socket`, it autodiscovers every
running daemon on this machine and prints each with a human label — `kolu-server
on port 7692`, `standalone kaval` — so you pick the right one without knowing any
path. This is the cross-platform, self-labeling answer to "which daemon am I
driving", and the reliable path on macOS (where `$XDG_RUNTIME_DIR` is unset). If
exactly one daemon is up, every command autodiscovers it — no flag needed.

**Inside a kolu terminal, `$KAVAL_SOCKET` already names your daemon.** Every
terminal a kolu-server (or `kaval-tui create`) spawns exports `$KAVAL_SOCKET` —
the socket of the kaval that owns *this* terminal (the `$TMUX` convention). So an
agent driving its **sibling** terminals can skip discovery and point straight at
it: `kaval-tui list --socket "$KAVAL_SOCKET"`, `kaval-tui snapshot <id> --socket
"$KAVAL_SOCKET"`. It's the one unambiguous answer when several daemons are up
(autodiscovery would return "many"). Absent → you're not inside a kolu PTY, so
fall back to `kaval-tui list`.

> **Flags go AFTER the subcommand.** It's `kaval-tui list --socket <path>` and
> `kaval-tui snapshot <id> --socket <path>` — **not** `kaval-tui --socket <path>
> list`. A flag before the subcommand fails with "no command"; the CLI error says
> so, but write them in the right order to begin with.

Two ways to point at a specific daemon instead of autodiscovering:

- **`--socket <path>`** targets one local daemon — e.g. a running **kolu-server's**
  kaval, to drive the terminals you have open in kolu (these are tracked by that
  kolu's **padi**, so `padi-tui wait` works against them). Prefer
  `kaval-tui list` to find the path; kolu-server namespaces its kaval **by listen
  port** (`kaval-<port>/`), so there's no single fixed path — which is exactly why
  `list` is the way in. The layout, per platform:

  | daemon | Linux (`$XDG_RUNTIME_DIR` set) | macOS / `$XDG_RUNTIME_DIR` unset |
  | --- | --- | --- |
  | kolu-server on `<port>` | `$XDG_RUNTIME_DIR/kaval-<port>/pty-host.sock` | `/tmp/kaval-<port>-<uid>/pty-host.sock` |
  | standalone kaval | `$XDG_RUNTIME_DIR/kaval/pty-host.sock` | `/tmp/kaval-<uid>/pty-host.sock` |

  On macOS `$XDG_RUNTIME_DIR` is unset, so the path is the `/tmp/kaval-<port>-<uid>/`
  form — e.g. `/tmp/kaval-7692-501/pty-host.sock` for kolu-server on port 7692. (The
  old `$XDG_RUNTIME_DIR/kolu/…` was wrong on every platform — kolu-server never
  serves under `kolu/` — and on macOS it collapses to a broken `/kolu/…`.)

  > **Socket paths must stay under 108 bytes (the `AF_UNIX` limit).** If you spin
  > up your *own* standalone kaval to verify (no kolu running), keep `--socket`
  > short — `/tmp/kv.$$/pty.sock`, **not** a socket under your agent scratchpad.
  > The scratchpad prefix alone already sits at the 108-byte cap, so a socket
  > there overflows and the daemon fails to bind. The autodiscovered paths above
  > are short by construction; this only bites a hand-rolled `--socket`.
- **`--host <ssh>`** reaches a daemon on another machine (provisioned with Nix);
  a remote PTY survives the link.

## Acceptance

Before calling a driven turn done:

- You **submitted with `send … --submit`** (or, when driving by hand, a separate
  follow-up `send --key Enter`) — never `send "text" --key Enter` in one call,
  whose Enter races the paste debounce. A prompt left staged on the `❯` line is
  the #1 failure here; `--submit` is what removes the race.
- The inner agent's **reply is actually in the `snapshot`** — not an empty box or
  a half-rendered stream. `wait --until idle` means "output stopped", not "the
  answer is right"; verify the content.
- Your wait had a **`--timeout`** (or deadline) so a wedged agent fails loud
  (exit 2) instead of hanging the loop.
- If the screen settled on a **question** (the agent is awaiting you), you **read
  it and answered** — you didn't send the next task on top of a blocked prompt.
