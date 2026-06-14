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
kaval-tui snapshot <id>     print a terminal's current scrollback, then exit
kaval-tui attach <id>       take over a terminal from the shell; ~. detaches
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

Auto-discovery scans the per-user runtime dir — a standalone `kaval` and every
kolu. One daemon running → it's picked automatically. More than one → kaval-tui
lists them and asks you to choose with `--socket <path>` (which goes **after**
the subcommand: `kaval-tui list --socket …`).

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
unreachable daemon is a one-line error, never a hang. `create` (above) makes a
terminal; `kill` — ending one from the shell — is a later phase.

The full design lives in the
[kaval atlas note](https://htmlpreview.github.io/?https://github.com/juspay/kolu/blob/master/docs/atlas/dist/pty-daemon.html).
