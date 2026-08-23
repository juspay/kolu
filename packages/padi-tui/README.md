# padi-tui

<img src="../padi/logo.svg" width="128" align="right" alt="padi — the per-host workspace authority" />

**padi-tui** is the terminal-side client for [`padi`](../padi), the per-host
workspace daemon (registry · fold · lifecycle · fs/git · kaval supervision). It
dials padi's digest-keyed unix socket — through the shared
[`@kolu/padi/dial`](../padi/src/dial.ts) kit — and reads its `padiSurface`: what
each terminal *is in* (record state · repo·branch · PR · agent state ·
foreground) and, crucially, the precise agent-state **done-signal** for driving
an agent that drives another agent.

It is the raw, non-interactive sibling of [`kaval-tui`](../kaval-tui) — verbs,
no canvas (where kaval-tui shows what's *running* in each PTY, padi-tui shows
what each terminal *is in*). It **replaces the retired `pulam-tui`**: its `wait` reads real
agent state off padi (better than kaval-tui's guess-from-silence), and its
`create` spawns terminals, split tiles, and worktree'd agents that appear on the
canvas.

```
padi-tui status [--json]                a one-shot snapshot of every terminal
padi-tui watch [<id>] [--json]          follow live until Ctrl+C (● = live byte activity)
padi-tui wait <id> --until <buckets>    block until that terminal's agent reaches a state, then exit
padi-tui create (--toplevel | --parent <id>) [--worktree <branch>] [--repo <path>] [-- argv]
                                        spawn a terminal / split tile / worktree'd agent, print its id
                                        (placement is REQUIRED — there is no default)
```

## Discovery — usually no flag

padi keys its socket by a **digest of its state-root**, so there's no single
fixed path. You rarely name it:

- **Inside a kolu terminal**, padi stamps `$PADI_SOCKET` (the `$TMUX` /
  `$KAVAL_SOCKET` convention) pointing at the padi that owns the terminal — so a
  flag-less `padi-tui` "just works", and an agent driving its siblings never
  scans or guesses a path. padi also puts `padi-tui` itself on that terminal's
  `$PATH`, from its own build, so this holds on a **remote** host too: nothing is
  installed there, the binary rides the closure kolu provisions.
- **Otherwise** padi-tui autodiscovers the running padi. If several are up it
  lists them and asks you to pick.

Point it elsewhere (dev/e2e), flags going **after** the subcommand:

```sh
padi-tui status --state-root ~/some/state   # derive the digest→socket from a state-root
padi-tui status --socket /path/to/padi.sock # a literal socket path
```

## --host — a remote padi over ssh

`--host <ssh>` reaches a padi on **another machine**, the exact twin of
[`kaval-tui --host`](../kaval-tui). It provisions the daemon's closure with Nix,
runs `ssh <host> padi --stdio`, and speaks the same `padiSurface` over that link
(via [`@kolu/surface-remote`](../surface-remote)'s `dialAgentOnce`) — so every
verb runs unchanged against the remote:

```sh
padi-tui status --host nix@prod              # snapshot the terminals on prod
padi-tui watch --host nix@prod               # …follow them live
padi-tui wait "$id" --host nix@prod --until awaiting,waiting
padi-tui create --toplevel --host nix@prod -- claude   # spawn a REAL terminal on prod
```

padi runs **as the SSH user**, so you reach the padi owned by that user (its
socket dir is `0700`, owner-only); SSH in as the user that runs padi. The remote
terminals **survive the link** — `create` on the host, then a later `status` /
`watch` finds them — because padi's `--stdio` mode fronts the *durable* daemon.
A tui is a **dial**: read verbs are safe and `create` lands a real terminal
(that's the point), but nothing here ever drains, converges, or recycles the
remote padi — that stays the kolu-server binder's job ([#1313](https://github.com/juspay/kolu/issues/1313)).

`--host` is mutually exclusive with `--socket` / `--state-root` (those name a
local daemon). It needs the per-system padi derivation baked into the Nix
wrapper, so run `padi-tui` from `nix run .#padi-tui`, not the raw entrypoint.

## wait — the agent-drives-agent done-signal

`wait` blocks until a terminal's agent enters one of the coarse buckets
`working` · `awaiting` · `waiting` (the shared `agentBucket` fold, so the
vocabulary matches the Dock), then exits. `--until` is a comma list;
`--until awaiting,waiting` means "the agent's turn ended".

```sh
id=$(padi-tui create --toplevel -- claude)   # spawn a Claude Code agent
kaval-tui send "$id" "explain this repo"     # the text
kaval-tui wait "$id" --until idle:300         # observe the TUI settle
kaval-tui send "$id" --key Enter              # submit
padi-tui wait "$id" --until awaiting,waiting  # …block until its turn ends
```

Because the mirror **replays each terminal's current state on connect**, an
agent already in a target bucket matches immediately. That makes the canonical
**two-phase** loop robust against the stale-state race — first wait for the turn
to *start*, then for it to *end*:

```sh
padi-tui wait "$id" --until working           # 1. the agent picked up the prompt
padi-tui wait "$id" --until awaiting,waiting   # 2. …and finished its turn
```

`--timeout <ms>` caps the wait and fails loud. Exit codes let a driver branch:

| exit | meaning |
| --- | --- |
| `0` | met — the agent reached a target bucket (`--json` prints `{ id, agent }`) |
| `2` | timed out (still alive, but stuck) |
| `3` | the terminal exited before reaching the state (the agent died) |
| `130` | interrupted (Ctrl+C) |
| `1` | usage / link error |

## create — a terminal, a split tile, a worktree'd agent

`create` spawns a terminal on the host; padi owns it and it appears on the
canvas. stdout is just the new id (`id=$(padi-tui create --toplevel)`); the rest
is on stderr.

**Placement is required.** Pass exactly one of `--toplevel` (a tile of its own)
or `--parent <id>` (a split inside that terminal) — neither and both are
refusals, and there is no default. A terminal's parent edge is not decoration:
the canvas nests a split inside its parent's tile and the Dock reads the same
edge as *who works for whom*, so a guessed placement silently flattens the
hierarchy. A script that used to say `padi-tui create` means
`padi-tui create --toplevel`.

```sh
padi-tui create --toplevel               # a shell in the current directory
padi-tui create --parent a1b2c3d4        # a SPLIT TILE of another terminal
padi-tui create --toplevel -- claude     # …and launch an agent in it
padi-tui create --toplevel --worktree feat -- claude  # a fresh git worktree + a Claude Code in one command
```

`--worktree <branch>` runs `git.worktreeCreate` on the host (off `--repo`,
default the cwd) and opens the terminal there; anything after `--` is run in the
new terminal. It composes the same `git.worktreeCreate` + create-with-cwd +
`sendInput` the canvas worktree flow uses, so a worktree'd agent created here is
byte-identical to one created from the browser. Over `--host`, a plain `create`
opens in the remote user's home (a local cwd need not exist there), and
`--worktree` requires an explicit `--repo <host path>` — the worktree is cut on
the remote machine, so it can't default to your local directory.

## status / watch

`status` prints one row per terminal (record state · repo·branch · PR · agent ·
foreground) and exits. `watch` follows the collection live, a line per change
until Ctrl+C, with a trailing `●` when a terminal is **moving bytes right now**
— padi's live `activity` stream (the daemon-side twin of the browser's green
dot). `--json` makes both scriptable (`status` an array, `watch` NDJSON).

```sh
padi-tui status
padi-tui watch a1b2c3d4        # follow just one terminal
```
