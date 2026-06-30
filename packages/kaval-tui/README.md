# kaval-tui

<img src="../kaval/logo.svg" width="128" align="right" alt="kaval — a watch over your terminals: three PTYs owned by one daemon, above காவல்" />

**kaval-tui** is the terminal-side client for [`kaval`](../kaval) (Tamil காவல்,
_kāval_ — "watch, guard"; pronounced **_KAH_-val**, the first _a_ long, as in
_father_), the standalone PTY daemon. It dials kaval's unix socket and speaks
the `ptyHostSurface` contract directly — the _raw_ client, where the browser is
the _rich_ one over kolu's full contract.

The daemon owns the PTYs and outlives the clients; kaval-tui comes and goes.

```
kaval-tui list [--json]     list your live terminals (id · pid · idle · cmd · cwd)
kaval-tui create [-- cmd]   spawn a new terminal ($SHELL or cmd), print its id
kaval-tui snapshot <id>     print a terminal's screen (--viewport / --tail N to bound it), then exit
kaval-tui send <id> [text]  write input to a terminal (a prompt to an agent), then exit
kaval-tui wait <id> --until block until the terminal's output goes idle (or matches), then exit
kaval-tui attach <id>       take over a terminal from the shell; ~. detaches
kaval-tui kill <id>         end a terminal the daemon owns (by id or prefix)
```

## Creating a terminal

A freshly-started daemon owns no terminals, so `create` is what `attach` needs
first. It spawns a plain `$SHELL` (no rcfiles, no kolu policy — the _raw_
multiplexer's spawn), prints the new id, and exits without attaching:

```sh
kaval-tui create                 # spawned a1b2c3d4 · bash · ~/code/kolu (pid 12843)
kaval-tui attach a1b2c3d4        # …then take it over
```

Pass a command to run instead of a shell — prefix it with `--` when it carries
its own flags, so they reach the program rather than kaval-tui:

```sh
kaval-tui create -- htop -d 5    # run htop, not a shell
```

`--json` prints `{ id, pid, cwd }` (the full id) for scripts; the `attach with
…` next-step hint always goes to stderr, so stdout stays just the spawn line:

```sh
id=$(kaval-tui create --json | jq -r .id)
```

## Sending input

`send` writes input to a terminal without attaching — the raw _write_ half of
driving a program in a PTY. Its headline use is handing a prompt to an agent
(Claude Code, Codex, opencode) running in a terminal, so one agent can drive
another: `create` it, `send` it a task, `snapshot` its reply, `send` the next.

```sh
kaval-tui send a1b2 "refactor the parser to use a lexer"   # type the prompt…
kaval-tui send a1b2 --key Enter                            # …then submit it
```

`send` writes **exactly what you pass — the literal text and any `--key`s, with
no implicit Enter**. A prompt is submitted only when you say so, as its own step:
`send <id> --key Enter`. Keeping submit explicit is deliberate — an implicit Enter
is invisible magic the caller can't time, and against Claude Code's
bracketed-paste / debounced input it _raced the paste and was silently dropped_,
leaving the prompt staged while `send` reported success. A separate
`send --key Enter` lands after the text has settled, so it always submits.

**Multiline text is sent as one bracketed paste**, so it lands in the agent's
input box as a block instead of submitting line-by-line (each `\n` would
otherwise fire a half-written prompt). Paste is automatic for multiline or piped
text; `--no-paste` forces literal, `--paste` forces a wrap. Text comes from the
positional words or, when you give none, from **stdin** — so large prompts skip
shell quoting:

```sh
cat prompt.md | kaval-tui send a1b2        # big prompt → one bracketed paste
kaval-tui send a1b2 --key Enter            # submit it
```

`--key` sends named or control keys **after** the text, in order — both the submit
channel (`--key Enter`) and the channel for interrupting or steering an agent
rather than typing at it:

```sh
kaval-tui send a1b2 --key Escape           # interrupt the agent mid-stream
kaval-tui send a1b2 --key C-c              # SIGINT to whatever's running
kaval-tui send a1b2 --key Enter            # submit the staged prompt
```

Names: `Enter`, `Escape`, `Tab`, `Up`/`Down`/`Left`/`Right`, `Home`, `End`,
`Backspace`, `Space`; chords: `C-<char>` (control), `M-<char>` (meta/alt).

`send` is **blind** — it writes whether or not the program is ready for input —
so pair it with `snapshot` to look before (or after) you write. `--json` prints
`{ id, bytes, paste, keys }` for scripts; the human one-line confirmation goes
to stderr, so stdout stays empty unless you ask for JSON.

## Waiting for a turn to end

When you drive an agent, you need to know when its turn is over before you read
the reply and send the next prompt. `wait` blocks until the terminal's **raw
output** meets a condition, then exits — no shell hooks, no busy-word guessing.
It reads the same byte stream the daemon serves to `attach`/`snapshot`, so "the
agent went quiet" is exact and works the same for `claude` / `codex` / `grok` /
`opencode`:

```sh
kaval-tui send a1b2 "refactor the parser"; kaval-tui send a1b2 --key Enter
kaval-tui wait a1b2 --until idle:800 --timeout 600000   # block until the turn ends
kaval-tui snapshot a1b2 --viewport                      # read the reply
```

- **`--until idle:<ms>`** resolves once no output byte has arrived for `<ms>` —
  the agent-agnostic "turn ended / awaiting input" signal, and the common case.
  `800` is a sensible default; raise it for an agent that pauses mid-thought.
- **`--until match:'<regex>'`** resolves once **new** output matches — for a
  completion marker or a returned-prompt sentinel (e.g. `--until match:'\$ $'`).
- **`--timeout <ms>`** caps the wait and **fails loud (exit 2)** so a wedged
  agent can't hang the loop. Default: wait indefinitely until the condition, a
  terminal exit, a link drop, or Ctrl+C.

Exit codes mirror a blocking read: **0** the condition was met · **2** the
timeout elapsed · **3** the terminal **exited** before the condition (the agent
you were driving died) · **130** interrupted (Ctrl+C). `--json` prints **one
result frame per outcome** — `{ id, result, … }`, where `result` is `met` /
`timeout` / `gone` / `interrupted` / `closed` (a `met` frame adds `fired` —
`idle` / `match` —, `elapsedMs`, and `matchedLine` on a match). Every outcome
emits a frame, so a `--json` driver never falls back to parsing the exit code
alone. Like every subcommand, `wait` takes `--socket` / `--host` to target a
running kolu or a remote daemon — a remote PTY's quiescence is observed at the
remote daemon.

> Idle means "output stopped", not "the answer is right": the turn may have
> **finished** or be **blocked asking you something** — both are quiescence. So
> read the `snapshot` after `wait` returns. (For terminals a kolu-server spawned
> — which carry shell hooks — `pulam-tui wait --until <state>` is a more precise,
> agent-state done-signal; `kaval-tui wait` is the hook-free one for any
> terminal.)

## Reading the screen

`snapshot` prints a terminal's **rendered** screen — plain text, not the VT
escape stream — so you can `grep` it or read it back when driving an agent.

By default it prints the **whole scrollback**, which on a long-running (or
compacted) agent session is thousands of lines — so `snapshot <id> | tail -8`
hands you the bottom of the buffer (often just trailing blanks), not the current
screen. Two flags bound it instead:

```sh
kaval-tui snapshot a1b2 --viewport      # just the visible screen (the daemon's last screenful)
kaval-tui snapshot a1b2 --tail 40       # the last 40 rendered lines (--lines 40 is a synonym)
```

`--viewport` is the right read for "what's on screen now" when driving an agent —
it asks the daemon for the terminal's own last screenful, so it's correct
regardless of how tall _your_ shell is (your stdout is usually a pipe, and over
`--host` the remote terminal is a different size entirely). `--viewport`,
`--tail`, and `--lines` are mutually exclusive; pass at most one. A trailer line
(`— a1b2 · N lines`) goes to stderr, so stdout stays clean, scriptable text.

## Short ids

Terminal ids are uuids, so `list` prints just the first 8 characters — enough to
tell your handful of terminals apart, short enough to type:

```
ID        PID    IDLE  CMD                CWD
a1b2c3d4  12843  5s    claude: implement  ~/code/kolu
7f3e0a91  12044  2m    vim                ~/code/kolu
```

`snapshot` and `attach` take that short id, **or any unique prefix of it** —
type only as many characters as you need to disambiguate (`kaval-tui attach
a1`). An ambiguous prefix lists the matches so you can add a character; a full
uuid pasted from `list --json` (which keeps the full id) or from kolu's
Inspector still works, since an id is a prefix of itself. Resolution happens in
kaval-tui against the live inventory — the daemon only ever sees a full id.

## Running it

Start the daemon, then drive it from any other shell — kaval-tui finds the
running daemon on its own:

```sh
nix run github:juspay/kolu#kaval              # the daemon stands watch
nix run github:juspay/kolu#kaval-tui -- list  # any other shell
```

## Reaching a running kolu

kolu spawns a kaval daemon of its own (namespaced per server by listen port:
`$XDG_RUNTIME_DIR/kaval-<port>/pty-host.sock`) and is just another client of it.
So flag-less `kaval-tui` reaches the terminals you have open in kolu, too:

```sh
kaval-tui list                       # the terminals open in your kolu
kaval-tui snapshot <id> | grep BUILD-
```

The reach is **two-way**: a terminal you `kaval-tui create` against that daemon
shows up in kolu as a tile **live** — the moment it's created, not just at kolu's
next restart. kolu subscribes to the daemon's inventory feed and adopts any PTY
it doesn't already own, so the one set of PTYs the daemon owns is what every
client sees. (A bare `create` carries none of kolu's shell hooks, so its tile has
no agent/title detection until you run something in it.)

Auto-discovery scans the per-user runtime dir — a standalone `kaval` and every
kolu. One daemon running → it's picked automatically. More than one → kaval-tui
lists them and asks you to choose with `--socket <path>` (which goes **after**
the subcommand: `kaval-tui list --socket …`).

## Reaching a remote kaval — `--host`

`--host <ssh>` drives a kaval on **another machine** over ssh. There's nothing
to install first: kaval-tui **provisions** the daemon with Nix (`nix copy
--derivation` ships the right-arch closure, the remote realises it), runs
`kaval --stdio`, and dials it — the same `ptyHostSurface` client, just over ssh
stdio instead of a local socket. Every subcommand works unchanged:

```sh
kaval-tui create --host nix@prod              # spawn a shell ON prod
kaval-tui list   --host nix@prod              # …and a separate invocation
kaval-tui attach --host nix@prod <id>         #    finds it: the PTY survived
```

The remote daemon is **durable**: `--stdio` adopts a kaval already running on
the host (else starts one), so a terminal you `create` outlives the ssh link —
detach on the train, `attach` again at the café and your build is still
running. One kaval per host, shared across dials.

A remote terminal runs in the **host's** environment, not yours. A remote
`create` composes its spawn from the daemon's `system.info`: `$SHELL`, `$HOME`,
and `$PATH` are the **remote** machine's (so the shell finds the remote's own
commands — a shell with no `$PATH` would exit `127` on the first one), and only
your terminal's _presentation_ vars (`TERM`, `COLORTERM`, `LANG`/`LC_*`) are
carried across. Your local environment — and any secrets in it — never crosses
the wire. (A _local_ `create` ships your own env, since the daemon is on your
machine; the remote path deliberately does not.)

`--host` is mutually exclusive with `--socket` (a remote ssh target vs a local
path). It needs passwordless ssh and the remote's nix-daemon trusting your user
(`trusted-users`) to accept the copied closure. Run kaval-tui from its Nix
wrapper (`nix run …#kaval-tui`) — the per-arch derivations are baked in there.

## Attach — the ssh model

While attached, nothing is intercepted except a `~` typed at the **start of a
line** (right after Enter). Mid-line tildes, every Ctrl chord, and pasted text
pass straight through.

| Escape | What it does                                                         |
| ------ | -------------------------------------------------------------------- |
| `~.`   | detach — kaval-tui exits, the daemon keeps the terminal; re-attach    |
| `~~`   | send one literal `~` to the shell                                    |
| `~?`   | show the escape help                                                 |

`~` clashing (nested ssh?) → rebind it: `kaval-tui attach <id> --escape %`.

When the program inside exits, kaval-tui exits with the same code. An
unreachable daemon is a one-line error, never a hang.

## Killing a terminal

`create` makes a terminal; `kill` ends one. The daemon tears the PTY down, so it
drops out of `list` and any client still attached watches the shell exit:

```sh
kaval-tui kill a1b2c3d4        # end it; `list` no longer shows it
```

`<id>` is the short id or any unique prefix — the same form `snapshot` and
`attach` take. `kill` prints a one-line confirmation to stderr and exits 0; an id
that matches no live terminal fails loud (it never silently no-ops). This is the
inverse of `create`, and like every subcommand it takes `--socket` / `--host` to
target a running kolu or a remote daemon.

The full design lives in the
[kaval atlas note](https://kolu.dev/atlas/pty-daemon.html).
