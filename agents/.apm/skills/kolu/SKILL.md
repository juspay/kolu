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
kaval-tui send  "$id" "refactor the parser to use a lexer"     # 1. the text (no Enter)
kaval-tui wait  "$id" --until idle:300                         # 2. observe the TUI settle
kaval-tui send  "$id" --key Enter                              # 3. submit (its own command)
kaval-tui wait  "$id" --until idle:800 --timeout 600000        # 4. let its turn finish (below)
kaval-tui snapshot "$id" --viewport                            # 5. read the screen
```

Leaf commands, all `kaval-tui`: **create** (spawn) · **send** (write text, OR a
`--key`) · **wait** (block until output settles) · **snapshot** (read) · **kill**.
Submitting a prompt is its **own** `send --key Enter`, sent *after* you observe
the TUI settle — never folded into the text send. Why: a same-breath Enter races
the TUI's paste debounce and is silently dropped. See the next section.

> **Read with `snapshot --viewport`, not `| tail`.** A bare `snapshot` prints the
> **whole scrollback** — thousands of lines on a long-running or compacted agent —
> so `snapshot | tail -8` hands you the bottom of the buffer (often just trailing
> blanks), not the live screen. `--viewport` asks the daemon for just its
> terminal's last screenful — the right "what's on screen now" read, and correct
> regardless of how tall your own shell is (over `--host` the remote terminal is a
> different size). `--tail N` (alias `--lines N`) bounds it to the last N lines
> when you want a fixed slice.

## `kaval-tui send` — the canonical three-step submit

Submitting a **normal-size** prompt to a TUI agent is **three commands**, because
`send` bakes in no timing magic — it writes exactly what you pass and nothing more:

```sh
kaval-tui send "$id" "fix the failing test in parser.ts"   # 1. the text (no Enter)
kaval-tui wait "$id" --until idle:300                       # 2. OBSERVE the TUI settle — a signal, not a sleep
kaval-tui send "$id" --key Enter                            # 3. submit
```

Why not one command? An Enter sent in the *same breath* as the text races Claude
Code's bracketed-paste / debounced input handling and is **silently dropped**,
leaving the prompt staged on the `❯` line while `send` reports success (if a turn
never seems to start, this is the #1 cause — `snapshot` and look for the prompt
sitting unsent). `kaval` **cannot observe** when the TUI settled, so any fixed
grace baked into `send` is a race you tune until it stops biting on your machine
and starts again on a slower one. The honest fix is step 2: **you**, the caller,
observe the settle with `wait --until idle:<ms>` (no output for `<ms>` — see the
done-signal section), then submit as its own command. `send "$id" "text" --key
Enter` in one call is a **hard error** for exactly this reason — the trap is
unspellable, not merely discouraged.

> **⚠️ LARGE pastes don't submit — a known-open limitation ([#1702](https://github.com/juspay/kolu/issues/1702)).**
> The three-step flow above is verified for **normal-size** prompts. A **large**
> paste (multi-KB — enough that Claude Code folds it into a `[Pasted text +N
> lines]` / "paste again to expand" placeholder) does **NOT** reliably submit:
> even after `wait --until idle` fires (idle proves Claude finished *folding* the
> paste, not that a following Enter submits it), the Enter leaves the paste
> **staged** — and the Enter *write itself* can stall against the placeholder
> state (the bounded write deadline turns that stall into a loud failure instead
> of a >30s hang, but it still doesn't submit). **Workaround for a big brief:**
> write it to a file and send a **short** prompt that points the agent at it —
> `kaval-tui send "$id" "read /tmp/brief.md and carry it out"` then the three-step
> submit above. A short prompt submits cleanly; the agent reads the file itself.

> **Step 2 fires cleanly only when the agent is AT THE PROMPT** (awaiting input —
> the normal case for dispatching a new prompt: `idle:300` fires in a fraction of
> a second). If you're messaging an agent that is **mid-turn and busy** (streaming
> output continuously), `wait --until idle` **never fires** — there's no idle gap —
> so **bound it** with `--timeout` and treat a timeout as *"target busy"*: send the
> Enter anyway (it lands in the agent's input buffer and submits when the turn
> ends), then `snapshot` to confirm.
>
> ```sh
> kaval-tui send "$id" "the follow-up"
> # A timeout (exit 2) is the "target busy" signal — proceed. Any OTHER failure is
> # real (terminal gone = 3, link/usage = 1): surface it, don't send into the void.
> if kaval-tui wait "$id" --until idle:300 --timeout 3000; then :  # settled — proceed
> else rc=$?; [ "$rc" -eq 2 ] || exit "$rc"                        # exit 2 = busy; else real, surface it
> fi
> kaval-tui send "$id" --key Enter                               # submit anyway
> ```

> **`--file <path>` — read the text from a file, without shell mangling.** A prompt
> passed as `"$(cat file)"` gets its backticks / `$(...)` executed by the shell
> before `kaval-tui` ever sees them. `--file` reads the payload straight from the
> file — byte-exact, no shell in the loop. It's mutually exclusive with positional
> text and piped stdin. It does **not** change what goes down the wire (still a
> bracketed paste); it fixes the SHELL hazard **only** — a *large* `--file` payload
> still hits the large-paste limitation above, so it's not a way around it. Reach
> for `--file` for a prompt with shell metacharacters, not as a large-paste path.

Specifics:

- **Multiline text, `--file`, and piped stdin go as one bracketed paste**, so
  they land in the input box as a block instead of submitting line-by-line.
  Automatic (`--paste` / `--no-paste` force it).
- **`--key <name>`** (repeatable) is the control channel: `Escape`, `C-c`,
  `Enter`, `Up`/`Down`/`Left`/`Right`, `Tab`, `Home`, `End`, `Backspace`,
  `M-<char>`. `--key Enter` is how you submit (step 3). A send carries **text OR
  keys, never both** — the mix is rejected.
- **Bounded write.** A `send` whose write can't complete (the target isn't
  draining its input — e.g. a program that stopped reading stdin) **fails loud in
  seconds**, naming the stalled terminal, instead of hanging forever.
- **`--json`** → `{ id, bytes, paste, keys }` to confirm what was written.

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

## Provisioning a worktree'd agent — `padi-tui create`

When the terminal should be a **kolu-owned** workspace — visible on the canvas,
tracked by padi's agent sensors so `padi-tui wait` works against it — provision
it with `padi-tui create` instead of raw `kaval-tui create`:

```sh
git -C /abs/path/to/repo pull --ff-only     # the worktree is cut from the repo's CURRENT checkout
padi-tui create --repo /abs/path/to/repo --worktree my-branch -- <agent> <mode-flags>
# e.g. `-- claude --dangerously-skip-permissions` — prints the new terminal's id; padi owns it
```

- **Never hardcode the agent CLI.** `<agent>` defaults to the same agent *you*
  are running as (a Claude Code orchestrator spawns `claude`, a codex one
  `codex`, …) — unless the human named a different agent in their prompt, which
  wins.
- **Fast-forward the base repo first.** `--worktree` branches from the repo's
  checkout as it stands — a stale default branch silently seeds the agent an old
  tree, and nothing errors.
- **`create` returning ≠ the agent is ready.** Snapshot before dispatching: a
  fresh worktree's first dev-env build can take minutes, and a first-run agent
  may sit on a one-time dialog (MCP server selection, a trust prompt) that needs
  its own `send --key Enter`. Drive every boot step by `snapshot`, never by
  sleeping and hoping.
- **Set the permission mode AT LAUNCH, then verify it from the footer.** An
  agent that will run unattended launches with **bypass permissions**, and the
  mode is a launch flag, not an interactive chore:
  `-- claude --dangerously-skip-permissions` (Claude Code; other agent CLIs
  have their own equivalents). Snapshot the footer and confirm it reads
  `bypass permissions on` before dispatching — auto mode still stops to ask on
  some tool calls, and an unattended agent's question in its own PTY sits
  unanswered. Interactive cycling (`send --key Shift-Tab`, re-snapshot after
  each press) is the fallback for an agent that is already running — never the
  provisioning path.
- **Restarting the agent CLI in place:** text typed at a *running* agent becomes
  a prompt (your relaunch command line gets answered, not executed), and `C-c`
  doesn't reliably quit the TUI — send the agent's quit command (`/exit` in
  Claude Code) as its own three-step submit, wait for the shell prompt to show
  in the snapshot, then launch again.

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
> kaval-tui send "$id" "fix the parser"          # the text
> kaval-tui wait "$id" --until idle:300          # observe the settle
> kaval-tui send "$id" --key Enter               # submit
> padi-tui  wait "$id" --until working           # 1. it picked up the prompt
> padi-tui  wait "$id" --until awaiting,waiting   # 2. its turn ended
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

**`$KAVAL_TERMINAL_ID` names *this* terminal.** Its self-knowledge twin: every
kolu terminal also exports `$KAVAL_TERMINAL_ID` — the id of the terminal the agent
is running in. So an agent can act on **itself** without being told which tile it
is: `kaval-tui snapshot "$KAVAL_TERMINAL_ID" --socket "$KAVAL_SOCKET"` reads its
own screen, `padi-tui wait "$KAVAL_TERMINAL_ID" --until …` blocks on its own state.
Re-owned for nested terminals (a kolu spawned inside a kolu terminal stamps its
*own* id over the inherited one), so it's always *this* terminal, never the outer.
Empty → fall back to `kaval-tui list` for the id: you're either not inside a
kolu-spawned PTY, or in one that predates this var and hasn't been respawned yet
(a fresh terminal — or sleep/wake — stamps it).

> **A terminal id is not stable across a kaval restart.** kaval re-keys every
> terminal when it restarts (crash-restore, a "Restart kaval", a redeploy), so an
> id you were *handed* — a coordinator's terminal from your brief, an id you cached
> turns ago — can go stale mid-run; a `send`/`snapshot` to it then fails with **"no
> terminal matching"**. Don't re-assume the id: run `kaval-tui list` and re-find the
> terminal by its stable **title** (the label survives the re-key), then use its
> current id. For any long-lived reference, remember the title, not the id.

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

- You **submitted with a separate `send --key Enter`**, sent *after* you observed
  the TUI settle (`wait --until idle`) — never `send "text" --key Enter` in one
  call (it's a hard error), whose Enter races the paste debounce. A prompt left
  staged on the `❯` line is the #1 failure here; the observe-then-submit split is
  what removes the race.
- The inner agent's **reply is actually in the `snapshot`** — not an empty box or
  a half-rendered stream. `wait --until idle` means "output stopped", not "the
  answer is right"; verify the content.
- Your wait had a **`--timeout`** (or deadline) so a wedged agent fails loud
  (exit 2) instead of hanging the loop.
- If the screen settled on a **question** (the agent is awaiting you), you **read
  it and answered** — you didn't send the next task on top of a blocked prompt.
