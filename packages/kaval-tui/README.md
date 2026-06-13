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
kaval-tui snapshot <id>     print a terminal's current scrollback, then exit
kaval-tui attach <id>       take over a terminal from the shell; ~. detaches
```

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
unreachable daemon is a one-line error, never a hang. `spawn` / `kill` —
creating and ending terminals from the shell — are later phases.

The full design lives in the
[kaval atlas note](https://htmlpreview.github.io/?https://github.com/juspay/kolu/blob/master/docs/atlas/dist/pty-daemon.html).
