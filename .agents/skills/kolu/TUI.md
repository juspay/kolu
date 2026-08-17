
# kolu/TUI — the CLI fallback (the `kolu` verbs)

**This is the FALLBACK path** — reach for it only when the kolu MCP tools
(SKILL.md's primary path) are unavailable: no `kolu mcp` configured on this
host, an older kolu without the MCP face, or a non-MCP agent runtime. The
discipline is identical to the MCP path (`--submit` for a whole dispatch,
observe-then-act, timeouts on every wait) — only the spelling changes.

**`kolu` is the ONE terminal CLI.** One command carries the whole toolkit —
**ls** (the roster) · **create** (spawn) · **send** (write text, OR a `--key`) ·
**wait** (block on a done-signal) · **debrief** (the composed done-signal: turn
over AND quiet, then the screen — what you should type when driving an agent) ·
**snapshot** (read the rendered text — `--tail N` for what's on screen) ·
**history** (read the scrollback) · **kill** · **watch** (the live feed). Every verb is a
pure **padi** client, so there is no second CLI to learn and no second daemon to
choose between: you name a padi (or, inside a kolu terminal, name nothing) and
drive its terminals. (The older `padi-tui` / `kaval-tui` binaries still ship and
still work — they are retired in a later PR — but new driving code is written
against `kolu`.)

## The loop

```sh
id=$(kolu create --toplevel --intent "parser refactor" \
       --message "refactor the parser to use a lexer" -- claude)   # spawn AND brief
kolu debrief "$id" --timeout 600000                       # turn over AND quiet → its screen
kolu send "$id" --submit "now add tests"                  # every dispatch after that
```

Both of those used to be several commands. `--message` waits for the agent to
reach its first prompt and delivers the brief there, so there is no boot wait and
no follow-up send; `--submit` does the same for every prompt after it. And
`debrief` is **one** call on purpose — it used to be three (wait for the turn,
wait for quiet, read the screen) and each gap between them is a race the CLI
cannot close from out here. `kolu debrief` is exactly
`kolu wait "$id" --until awaiting,waiting --settled 15000 --snapshot 40`; the
done-signal section below is when to reach for something else.

A same-breath Enter still races the TUI's paste debounce and is silently
dropped — `--submit` is safe because padi, not the caller, watches the gap. See
the next section.

**stdout is data, stderr is prose.** `create` prints the new id on stdout and
its human trailer on stderr, so `id=$(kolu create … )` captures exactly the id
and nothing else. `--json` (on `ls`/`create`/`send`/`wait`/`debrief`/`watch`) makes the
data machine-readable.

**Ids accept any unique prefix.** `kolu send 3f9c "…"` is the whole id's
equal as long as one terminal starts with it; an ambiguous prefix fails loudly
rather than picking one.

> **Read with `snapshot --tail N`, not `| tail`.** A bare `kolu snapshot` prints
> the terminal's whole rendered text — screen *plus* scrollback, thousands of
> lines on a long-running or compacted agent — and its buffer ends in a run of
> blank rows below the cursor, so `snapshot | tail -8` hands you eight empty
> lines. `--tail N` asks for the last N lines with those trailing blanks
> dropped: the right "what's on screen now" read, and correct regardless of how
> tall your own shell is (over `--host` the remote terminal is a different
> size). It is the exact shape of the MCP `screen_text { tail }` tool — there is
> deliberately **no `--viewport` flag**, because padi's wire cannot express a
> viewport extent. Older output than the screen is `kolu history "$id"
> [--lines N]`.

## `kolu send --submit` — the whole dispatch in one command

```sh
kolu send "$id" --submit "fix the failing test in parser.ts"
# — sent 34 bytes to a1b2c3d4 · submitted (waited 12ms for the prompt, 1504ms for the settle)
```

`--submit` hands the whole delivery to padi: wait for the target's prompt to be
idle, type the text, wait for the terminal to take it, press Enter.
`--settle-ms <ms>` tunes the quiet window (default 1500) for a chattier TUI.

It is **not** a baked-in sleep — that is the thing this file used to say would
never ship, and rightly. An Enter sent in the *same breath* as the text races
Claude Code's bracketed-paste / debounced input handling and is **silently
dropped**, leaving the prompt staged on the `❯` line while `send` reports
success. No fixed grace fixes that: you tune it until it stops biting on your
machine and starts again on a slower one. What changed is **who watches**. padi
holds kaval's meaningful-output edge for every PTY and folds each terminal's
detected agent state, so it can wait on a *signal* rather than a clock — from
inside, where a caller cannot look. `send "$id" "text" --key Enter` in one call
is still a **hard error**: the same-breath trap stays unspellable, and `--submit`
is the safe way to fuse the two.

**A busy target is REFUSED, and that is the point.** `--submit` into a mid-turn
agent exits non-zero having typed **nothing**. It does not queue the text,
because queueing it is how you lose it: several TUIs — grok among them — clear a
typed-but-unsubmitted input box when the turn ends, so the text is destroyed and
the send reported success. The diagnostic says which of the two refusals you got:

- *"never reached an idle prompt … NOTHING was typed"* — the target is mid-turn.
  Wait for it (`kolu wait "$id" --until awaiting,waiting`) and dispatch again.
  Retrying is free.
- *"the text is sitting in the input box UNSUBMITTED"* — finish it with
  `kolu send "$id" --key Enter`, or `--key Escape` and re-send. **Do not simply
  re-send**: that delivers the message twice.

### The three-step form — the escape hatch

Still correct, still supported, and what you reach for when something must happen
*between* the text and the Enter:

```sh
kolu send "$id" "fix the failing test in parser.ts"   # 1. the text (no Enter)
kolu wait "$id" --until idle:300 --timeout 15000      # 2. OBSERVE the TUI settle — a signal, not a sleep
kolu send "$id" --key Enter                           # 3. submit
```

> **⚠️ MULTI-LINE pastes don't submit — a known-open limitation ([#1702](https://github.com/juspay/kolu/issues/1702)).**
> The three-step flow above is verified for a **short** prompt (a line or two). The fold
> that breaks submission is triggered by **line count, not byte size**: Claude Code folds a
> paste into a `[Pasted text +N lines]` / "paste again to expand" placeholder once it spans
> more than a handful of lines — which happens **well under 1 KB** (observed folding at
> ~900 bytes / ~a dozen lines, so "multi-KB" badly understates it). Treat *any* multi-line
> message — a status report, a ruling, a review verdict — as fold-prone, not just a big
> brief. A folded paste does **NOT** reliably submit:
> even after `wait --until idle` fires (idle proves Claude finished *folding* the
> paste, not that a following Enter submits it), the Enter leaves the paste
> **staged** — and the Enter *write itself* can stall against the placeholder
> state (the bounded write deadline turns that stall into a loud failure instead
> of a >30s hang, but it still doesn't submit). **Workaround for any multi-line message
> (a brief, a report, a ruling):** write it to a file and send a **short** prompt that
> points the agent at it — `kolu send "$id" "read /tmp/brief.md and carry it out"`
> then the three-step submit above. A short prompt submits cleanly; the agent reads the
> file itself. Reach for the file-pointer by default the moment a message runs past a
> couple of lines — don't wait to get bitten by a fold-and-resend cycle first.

> **Step 2 fires cleanly only when the agent is AT THE PROMPT** (awaiting input —
> the normal case for dispatching a new prompt: `idle:300` fires in a fraction of
> a second). Against an agent that is **mid-turn and busy** (streaming output
> continuously) `wait --until idle` never fires, because there is no idle gap.
>
> **Do not "send the Enter anyway".** This file used to advise exactly that, on
> the theory that the text buffers and submits when the turn ends. It does not
> always: a TUI that clears its input box at turn end throws the text away, and
> the send that delivered it reported success. Wait for the agent to finish and
> dispatch then — which is what `--submit` does for you, refusing rather than
> gambling:
>
> ```sh
> kolu wait "$id" --until awaiting,waiting --settled 15000 --timeout 600000
> kolu send "$id" --submit "the follow-up"
> ```

> **`--file <path>` — read the text from a file, without shell mangling.** A prompt
> passed as `"$(cat file)"` gets its backticks / `$(...)` executed by the shell
> before `kolu` ever sees them. `--file` reads the payload straight from the
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
  `M-<char>`. `--key Enter` is how you submit in the three-step form. A send
  carries **text OR keys, never both** — the mix is rejected, and `--submit`
  with `--key` is rejected too (a key press has nothing to submit).
- **`--settle-ms <ms>`** is `--submit`'s quiet window and is refused without it,
  rather than silently ignored.
- **Bounded write.** A `send` whose write can't complete (the target isn't
  draining its input — e.g. a program that stopped reading stdin) **fails loud in
  seconds**, naming the stalled terminal, instead of hanging forever. A
  `--submit` is bounded by its own readiness timeout on the daemon side instead.
- **`--json`** → `{ id, bytes, paste, keys }`, plus
  `submitted: { readyAfterMs, settledAfterMs }` on a `--submit`.

**`send` is blind** — it writes whether or not the agent is ready for input.
Always pair it with `snapshot` so you don't fire a prompt into a not-yet-ready
session (e.g. before the TUI has drawn its input box, or over a trust prompt).

**Interrupt a runaway** before redirecting it:

```sh
kolu send "$id" --key Escape          # stop Claude Code mid-stream
kolu send "$id" --key C-c             # SIGINT whatever's running
```

## The done-signal — `kolu wait --until <cond>`

After you submit, you need to know when the turn ends. **One verb, three
condition forms** — and which one you reach for is the only real choice here:

```sh
kolu wait "$id" --until idle:800 --timeout 600000       # bytes went quiet
kolu wait "$id" --until match:'\$ $' --timeout 600000   # new output matched
kolu wait "$id" --until awaiting,waiting --timeout 600000  # the agent's turn ended
```

- **`--until idle:<ms>`** resolves once no output byte has arrived for `<ms>` —
  the agent-agnostic "turn ended / awaiting input" signal, and the common case.
  `800` is a good default; raise it for an agent that pauses mid-thought, lower
  it for a snappier loop. It works identically for `claude`/`codex`/`grok`/
  `opencode` because it keys on bytes, not on any agent's rendering.
- **`--until match:'<regex>'`** resolves once *new* output matches — use it for a
  completion marker or a returned-prompt sentinel (e.g. `--until match:'\$ $'`).
- **`--until <buckets>`** — a comma list of padi's detected **agent states**:
  `working` (busy: thinking / tool_use / background task), `awaiting`
  (`awaiting_user`: it's **asking you** a question), `waiting` (the
  just-finished post-turn lull). Comma means any-of, so
  `--until awaiting,waiting` catches a turn ending.
- **`--timeout <ms>`** caps the wait and **fails loud (exit 2)** so a wedged agent
  can't hang the loop. If the terminal **exits** before the condition fires,
  `wait` exits **3** (the agent you were driving died). Met → exit **0**.
  > **A foreground `wait` also runs inside YOUR OWN harness's tool timeout.** A
  > held `kolu wait "$id" --timeout <big-ms>` (e.g. a long `--until match:` on
  > another agent's verdict) blocks *your* Bash call, and most agent harnesses cap a
  > single tool call at ~2 minutes by default — so a `--timeout 1200000` wait is
  > **SIGKILLed at ~2 min (exit 143)** while the agent you're watching is perfectly
  > fine. Two ways out: **prefer ending your turn** and being woken by the other
  > side's ping (the event-driven loop — see `/agent-debate`) instead of holding a
  > wait; or, if you *must* hold it, **raise the Bash call's own timeout to exceed
  > the `--timeout`** so the harness doesn't kill it first.
- **`--json`** → one result frame per outcome: `{ id, result, … }`, where
  `result` is `met`/`timeout`/`gone`/`interrupted`/`closed`. A `met` frame adds
  what fired — so a driver reads the structured `result`, never just the exit
  code.

Quiescence ≠ "the reply is correct": idle fires whether the agent **finished** or
is **blocked asking you something** (both mean "your move"). So after `wait`
returns, **read what's on screen** before responding — which is what the two
modifiers below fold into the wait itself.

### The two modifiers — `--settled` and `--snapshot`

```sh
kolu wait "$id" --until awaiting,waiting --settled 15000 --snapshot 40 --timeout 600000
```

- **`--settled <ms>`** is a **conjunct on `--until`**: met means the condition
  holds **and** no output byte has arrived for `<ms>`. It composes with all three
  forms. Reach for it whenever you are driving an **agent**, because a bucket is
  not a done-signal on its own: a `claude` main loop that ends its turn while an
  async `Agent`/`Task` subagent is still running reads as `waiting` within
  milliseconds, and the subagent keeps printing for as long as it runs. The
  recorded incident: `--until awaiting,waiting` fired, the orchestrator
  instructed the worker — whose screen showed a subagent three minutes into a
  run and a deliberate "wait for it, then push once" plan — and the nudge
  preempted competent in-flight work. Bytes moving keep the wait open; a bucket
  dropping back to `working` re-enters it.
- **`--snapshot <N>`** makes the met carry the screen: in plain mode the `<N>`
  lines are stdout (pipeable) with the trailer on stderr, under `--json` they are
  the frame's `screen` key. Read on the same subscription the condition settled
  on — so it is not "the screen a moment later", which is all a separate `kolu
  snapshot` can ever be. **Paired with `--settled`** (what `debrief` does) the
  screen is one taken inside that same quiet stretch, and one the terminal moved
  under is discarded and retaken; **on its own** it is simply the screen as of
  the condition landing, with no quiet claimed.

Together they are `kolu debrief`, which is what you should actually type:

```sh
kolu debrief "$id"                       # ≡ the wait above, with --quiet 15000 --tail 40
kolu debrief "$id" --quiet 30000 --timeout 900000   # a subagent-heavy worker
```

Each flag forgotten re-opens a live failure mode — drop `--settled` and you nudge
an agent whose subagent is still running; drop `--snapshot` and you act without
reading what the worker believes happened — so the composed verb is the default
and the raw flags are for the cases it does not cover (a `match:` sentinel that
also needs quiet, a snapshot on any turn boundary with no settle).

### Byte-idle vs agent buckets — which `--until` to reach for

They are not rivals; they read different things, and the merge into one verb
didn't merge the distinction:

- **`--until idle:<ms>` / `match:`** keys on **raw output quiescence/match** —
  it works on **any** terminal, with **no hooks** and nothing to detect. It
  can't tell "finished" from "blocked asking you" — both are quiescence — so
  read the snapshot after.
- **`--until <buckets>`** keys on **agent-state buckets** — more precise (it
  *distinguishes* awaiting-you from finished), but it only resolves for a
  terminal whose agent padi actually **detects**. A terminal running something
  padi has no agent sensor for has no bucket to enter, and the wait just times
  out. Reach for the buckets when you're driving a real agent CLI; fall back to
  byte-idle for anything else.

> **Mind the stale-state race — wait in two phases.** The bucket form matches the
> agent's state **the instant it connects**, replaying whatever it is right now.
> So right after a `send`, the agent may still report the *previous* turn's
> `waiting`/`awaiting` for a beat before it picks up the new prompt — and a lone
> `wait --until awaiting,waiting` would return immediately on that stale state,
> before the turn you asked for has even begun. For a robust loop, wait for the
> pickup first, then the turn-end:
>
> ```sh
> kolu send "$id" "fix the parser"                            # the text
> kolu wait "$id" --until idle:300 --timeout 15000            # observe the settle
> kolu send "$id" --key Enter                                 # submit
> kolu wait "$id" --until working --timeout 15000             # 1. it picked up the prompt
> kolu debrief "$id" --timeout 600000                         # 2. its turn ended, quiet, screen
> ```
>
> (Every wait is bounded — the Acceptance rule. A timeout on the phase-1
> `--until working` is a "target already moved past pickup" signal; on the
> phase-2 wait it's a wedged-agent guard.)

## Exit codes — the contract a driving loop branches on

Every verb shares one exit contract, and it is a **contract**: branch on it.

| code | meaning |
| --- | --- |
| `0` | the verb did what it was asked |
| `1` | usage error, or the padi link dropped |
| `2` | `wait` ran out of time — the condition never landed |
| `3` | `wait`'s terminal exited before reaching the condition |
| `130` | interrupted (Ctrl+C / SIGTERM / SIGHUP) |

`2` and `3` are deliberately distinct: "still alive but stuck" is a retry, "the
agent I was driving died" is not.

## Provisioning an agent — `kolu create`

> **Interim doctrine — agent-spawn-first-class (#1872).** *This note is deleted
> the day its tagged PR lands — do not carry it past it.*
>
> A command-rooted agent (`kolu create --toplevel -- <agent>`, the agent as argv[0] with no
> shell) is **Dock-visible and state-tracked**: kaval seeds `lastCommand`/title
> from the argv, and the sensors read its root-in-foreground as busy — so
> `--until <buckets>` works against it, and a shim CLI (comm ≠ its name) is
> recognized by the command it was launched with. It still lacks a shell's
> richer affordances (rc hooks, in-place `cd`), so spawn a shell (`kolu create`
> with a placement but no `--`) when you need them.
>
> - **A fresh `kolu create` terminal is clean — but your OWN shell is not.**
>   Every terminal padi spawns gets a clean canonical base env, so typing
>   `claude` into a create'd shell is safe with no scrub. The residual trap is
>   launching an agent in a shell that *already* carries the orchestrator's
>   identity — your own session's shell, or one reached over `ssh` / `sudo -E`:
>   `CLAUDE_CODE_CHILD_SESSION` rides in and the `claude` you launch classifies
>   itself as a nested child that never saves its conversation (real data loss).
>   `unset CLAUDE_CODE_CHILD_SESSION CLAUDECODE CLAUDE_CODE_SESSION_ID` before
>   launching an agent in such a shell. *This is the upstream env-suppression
>   fragility the note filed upstream; delete when upstream stops reading
>   inherited identity vars.*

Every terminal `kolu create` makes is **kolu-owned** — visible on the canvas,
tracked by padi's agent sensors, so the bucket done-signal works against it. It
prints the new id on **stdout** (the trailer goes to stderr), so capture it
directly:

```sh
git -C /abs/path/to/repo pull --ff-only     # the worktree is cut from the repo's CURRENT checkout
id=$(kolu create --toplevel --repo /abs/path/to/repo --worktree my-branch \
       --message "$(cat brief.md)" -- <agent> <mode-flags>)
# e.g. `-- claude --dangerously-skip-permissions`
```

**`--message <text>` brief the agent in the same command.** It is delivered
through the same machinery as `send --submit`, once the thing `-- <argv>` started
reaches its own prompt — with a wider quiet window, because a booting agent is
*silent* between exec and first paint and a narrow one would read that silence as
an idle prompt. If the terminal never settles, `create` exits non-zero and names
the live terminal: the agent is up and only the brief is missing, so the recovery
is `kolu send <id> --submit …`, **not** another `create`.

**`create` makes you say WHERE the terminal goes — exactly one of `--toplevel`
or `--parent <id>`, no default.** Neither, or both, is a refusal naming the
rule. This is not ceremony: a `--parent` terminal is drawn *inside* that
parent's tile and the Dock reads the edge as who-works-for-whom, so a create
that never mentions placement is not asking for top level — it just never
thought about it, which is exactly how a fleet of agents that should have been
splits ends up as a row of unrelated tiles with nothing failing to tell you.
Decide it per spawn: a worker you are supervising is a `--parent` split beside
you; an independent agent on its own branch is `--toplevel`.

Its other flags: **`--cwd <dir>`** (where the terminal opens), **`--intent
<text>`** (the freeform label shown on the canvas — set it, see the id-restart
note below), **`--json`** (a record of what `create` just did, instead of the
bare id).

`--json` is **not** the terminal's full record — for that, `kolu ls --json`.
It is exactly what this create did: `{"id": "<full id>"}`, plus
`"worktree": {"path", "branch"}` when `--worktree` cut one, `"ran": "<the
command line typed>"` when you passed `-- <argv>`, and `"briefed": "<the
message>"` when `--message` was actually SUBMITTED. Absent keys are omitted, so
the leanest `kolu create --toplevel --json` is a one-field object — and a
missing `briefed` means the brief did not land, never "probably did".

> **A split tile BESIDE you — `--parent "$KAVAL_TERMINAL_ID"`.** When you want the
> new terminal to open as a **split beside your own** (a sibling tile on the same
> canvas — e.g. driving a selected Claude/Codex/Grok peer per `/agent-debate`), pass
> **`--parent <your-terminal-id>`**, using your self-knowledge var
> `$KAVAL_TERMINAL_ID` (see *Reach*): `kolu create --parent "$KAVAL_TERMINAL_ID"
> -- <selected-agent> <unrestricted-flags> …`. Add `--worktree`/`--repo` too if the
> split should also get its own worktree; omit them (or pass `--cwd`) and the split
> opens where you point it. Say `--toplevel` instead and the terminal is a
> **standalone** tile, not a sibling beside you — so whenever the intent is "a
> split next to me", pass `--parent`. You must say one of the two; there is no
> flag-less spelling that quietly picks standalone for you.

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

**Interactive attach is the browser**, not this CLI: `kolu` has no `attach` verb
(it lands in a follow-up PR). Open the tile in kolu's web UI when a human needs
to take the keyboard; `kaval-tui attach` remains the terminal-side fallback
until then.

## Reach — which padi you're driving

**One command, one daemon question.** Every verb takes the same three
**endpoint flags**, and they are **mutually exclusive** (naming two is a
contradiction, refused, not a preference resolved):

- **(nothing)** — autodiscover the running padi. Inside a kolu terminal
  `$PADI_SOCKET` is already stamped into the environment (the `$TMUX`
  convention), so an agent driving its **siblings** passes no flag at all. This
  is the normal case; reach for a flag only when it isn't.
- **`--socket <path>`** — dial one exact padi socket. **Don't hand-construct the
  path**: the rendezvous is digest-keyed off the state-root, an internal detail
  that moves. Take it from `$PADI_SOCKET`, or use `--state-root` instead.
- **`--state-root <dir>`** — dial the padi keyed to that state-root directory
  (how you reach a dev/e2e padi without knowing its digest).
- **`--host <user@host>`** — reach a padi on another machine over ssh
  (provisioned with Nix); a remote PTY survives the link.

> **These three parse in ANY position.** `kolu --host box create` and `kolu
> create --host box` are the *same parse* — they are the root command's shared
> flags, so there is no flag-order rule to remember for them. (This is the
> positional straitjacket the older `padi-tui`/`kaval-tui` "flags go AFTER the
> subcommand" rule existed to work around; it is gone.)
>
> A **verb's own** flags (`--json`, `--tail`, `--until`, `--key`, …) still
> follow the verb name — `kolu ls --json`, not `kolu --json ls`. Misplacing one
> is refused by name (`Unrecognized flag: --json in command kolu`), never
> silently ignored, so this costs you an error message rather than a wrong run.

**`$KAVAL_TERMINAL_ID` names *this* terminal.** Every kolu terminal exports the
id of the terminal the agent is running in, so an agent can act on **itself**
without being told which tile it is: `kolu snapshot "$KAVAL_TERMINAL_ID"` reads
its own screen, `kolu wait "$KAVAL_TERMINAL_ID" --until …` blocks on its own
state, and `kolu create --parent "$KAVAL_TERMINAL_ID"` splits beside it.
Re-owned for nested terminals (a kolu spawned inside a kolu terminal stamps its
*own* id over the inherited one), so it's always *this* terminal, never the
outer. Empty → fall back to `kolu ls` for the id: you're either not inside a
kolu-spawned PTY, or in one that predates this var and hasn't been respawned yet
(a fresh terminal — or sleep/wake — stamps it).

**`kolu ls` is the roster** — one row per terminal (`ID · STATE · REPO·BRANCH ·
PR · AGENT · FOREGROUND`), `--json` for the full records. `kolu watch [id]`
streams changes and live output activity until you interrupt it.

> **A terminal id is not stable across a daemon restart.** kaval re-keys every
> terminal when it restarts (crash-restore, a "Restart kaval", a redeploy), so an
> id you were *handed* — a coordinator's terminal from your brief, an id you cached
> turns ago — can go stale mid-run; a `send`/`snapshot` to it then fails with **"no
> terminal matching"**. Don't re-assume the id: run `kolu ls --json` and re-find
> the terminal by its stable **`intent` label** (which is exactly what you set it
> at create for), then use its current id. For any long-lived reference, remember
> the intent, not the id.

> **Socket paths must stay under 108 bytes (the `AF_UNIX` limit).** If you spin
> up your *own* padi at a private state-root to verify, keep the path short —
> **not** a state-root under your agent scratchpad. The scratchpad prefix alone
> already sits at the 108-byte cap, so the socket beneath it overflows and the
> daemon fails to bind. The autodiscovered paths are short by construction; this
> only bites a hand-rolled root.

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
