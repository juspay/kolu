# pulam-tui

**pulam-tui** is the terminal-side viewer for [`pulam`](../pulam), the standalone
terminal-workspace daemon. It dials pulam's unix socket and reads the
`awareness` collection: what each terminal _is in_ — repo branch, the open PR and
its checks, which AI agent and whether it's working / awaiting you / waiting, and
the foreground process — plus a live `git status` view off the same surface (see
`fleet` below).

Where [`kaval-tui`](../kaval-tui) shows what's _running_ in each PTY, pulam-tui
shows what each terminal _is in_ — a "what is every agent doing, across every
repo, across every machine" dashboard, with **zero kolu-server and no browser**.

```
pulam-tui                an OpenTUI dashboard of ONE endpoint (Ctrl-C to quit)
pulam-tui --json         a one-shot machine-readable dump (a top-level array)
pulam-tui fleet          a LIVE multi-host board — many machines, one screen
pulam-tui fleet --json   a flat [{ host, terminalId, ...awareness }] dump
```

```
pulam  ·  3 terminals  ·  20:06:50  ·  Ctrl-C to quit

ID        REPO·BRANCH   PR          AGENT               FG      ACTIVE
a3f10000  kolu·feat/x   #1412 ✓     claude · working    node    4s
b7c20000  kolu·master   —           codex · awaiting    codex   1s
c9d40000  drishti·fold  #1408 ✗     —                   nvim    12m
```

The agent column buckets each AI agent's fine-grained state into `working` /
`awaiting` / `waiting`; the PR column rolls its checks up to ✓ / ✗ / ·. The
agent state and PR carry a semantic colour (awaiting → amber, working → cyan,
pass/fail → green/red); the rest stay calm.

The bare dashboard is a **point-in-time snapshot** read once when it opens; the
clock in the header ticks every second so you can see it's live. For **live rows
across machines**, use `fleet` (below).

## fleet — the live multi-host board

```sh
pulam-tui fleet --host nix@a --host nix@b   # local + a + b, live
pulam-tui fleet --host nix@prod --no-local  # just the remote(s)
pulam-tui fleet --ssh-config                # add every Host alias from ~/.ssh/config
pulam-tui fleet --json                      # [{ host, terminalId, ...awareness }]
# pin which kaval a host's remote pulam reads (a host running several):
pulam-tui fleet --host nix@zest --kaval nix@zest=/tmp/kaval-7692-501/pty-host.sock
```

`fleet` dials each host once (the same Nix-over-ssh provisioning as `--host`; the
local pulam is included unless `--no-local`), then **mirrors** every host's
`awareness` collection into one aggregate keyed by `(host, terminalId)` and
re-renders on any delta — so a `working → awaiting you` transition repaints
without a re-dial. Every agent **awaiting you** floats to the top across the whole
fleet, and a breathing amber strip names which hosts need you. Terminals are
grouped per host; a host that's unreachable or running a version-skew build gets a
distinct header rather than silently vanishing. The board **fills the terminal
width** — `repo·branch` grows to show long branches in full on a wide screen and
truncates only when the terminal is genuinely narrow.

Each row also carries a **live working-tree cell** — a changed-file count and the
branch's ahead/behind vs upstream — refreshed the instant a repo changes (the
daemon's `subscribeRepoChange` pulse re-queries `git status`, keyed by repo so
repo-mates share one watch). **Select** a row with ↑/↓ and press **Enter** to
**drill in**: a panel opens that repo's full `git status` — the
`staged · modified · untracked` summary and the changed-file list — and **Esc**
closes it.

- `--by host` (default) — per-host groups, needs-you first within each.
- `--by needs` — one fleet-wide list, urgency-sorted ("who's waiting, anywhere").
- `--by agent` — grouped by agent state (awaiting / working / idle) across hosts.
- **↑/↓** move the row cursor, **Enter** opens the git-status drill-in, **Esc**
  closes it, **Ctrl-C** quits.
- `--kaval <host>=<socket>` — pin which kaval a remote host's pulam dials, for a
  host running several (a standalone kaval + a kolu-server). Repeatable; the
  `<host>` matches a `--host` value. Omit and each host discovers the one that's
  up — `pulam-tui fleet` reports a host with several as `unreachable` until pinned.

## Short ids

Terminal ids are uuids, so the dashboard prints just the first 8 characters;
`--json` keeps the full id (so `jq -r '.[].id'` round-trips).

## Running it

```sh
nix run github:juspay/kolu#pulam-tui          # the dashboard
nix run github:juspay/kolu#pulam-tui -- --json # scriptable dump
```

By default it dials a pulam on this machine. Two ways to point it elsewhere,
**mutually exclusive**:

- `--socket PATH` — a different local socket.
- `--host <ssh>` — a **remote** pulam over ssh. It provisions the daemon's
  closure with Nix and runs `pulam --stdio`, then dials it — the same awareness
  surface over a different transport (riding the same `@kolu/surface-nix-host`
  provisioning as `kaval-tui --host`). The remote pulam **discovers** the running
  kaval — a standalone one, or a **kolu-server** (each namespaced by listen
  port) — so `--host` lands on your remote kolu's terminals with no extra flag,
  and recomputes awareness from now (it's ephemeral by design). Cross-arch: an
  aarch64-darwin laptop can provision an x86_64-linux box.
- `--kaval PATH` (only with `--host`) — pin **which** kaval the remote pulam
  dials, for a host running several (e.g. two kolu-servers). Omit it and pulam
  discovers the one that's up.

```sh
nix run github:juspay/kolu#pulam-tui -- --host nix@prod
# several kavals on the host? pick one:
nix run github:juspay/kolu#pulam-tui -- --host nix@prod --kaval "$XDG_RUNTIME_DIR"/kaval-7692/pty-host.sock
```

`--host` ships the target-arch pulam **daemon** closure, so run pulam-tui from
its Nix wrapper (the command above) — the bare entrypoint has no baked drv map.

The full design lives in the
[pulam atlas note](https://kolu.dev/atlas/pulam.html).
