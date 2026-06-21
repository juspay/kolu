# arivu-tui

**arivu-tui** is the terminal-side viewer for [`arivu`](../arivu), the standalone
terminal-awareness daemon. It dials arivu's unix socket and reads the
`awareness` collection: what each terminal _is in_ — repo branch, the open PR and
its checks, which AI agent and whether it's working / awaiting you / waiting, and
the foreground process.

Where [`kaval-tui`](../kaval-tui) shows what's _running_ in each PTY, arivu-tui
shows what each terminal _is in_ — a "what is every agent doing, across every
repo" dashboard, with **zero kolu-server and no browser**.

```
arivu-tui          an OpenTUI dashboard — one row per terminal (Ctrl-C to quit)
arivu-tui --json   a one-shot machine-readable dump (a top-level array)
```

```
arivu  ·  3 terminals  ·  20:06:50  ·  Ctrl-C to quit

ID        REPO·BRANCH   PR          AGENT               FG      ACTIVE
a3f10000  kolu·feat/x   #1412 ✓     claude · working    node    4s
b7c20000  kolu·master   —           codex · awaiting    codex   1s
c9d40000  drishti·fold  #1408 ✗     —                   nvim    12m
```

The agent column buckets each AI agent's fine-grained state into `working` /
`awaiting` / `waiting`; the PR column rolls its checks up to ✓ / ✗ / ·. The
agent state and PR carry a semantic colour (awaiting → amber, working → cyan,
pass/fail → green/red); the rest stay calm.

The dashboard is a **point-in-time snapshot** read once when it opens; the clock
in the header ticks every second so you can see it's live. Live row refresh and
the multi-host fleet board land in the next slice (P3 PR2b).

## Short ids

Terminal ids are uuids, so the dashboard prints just the first 8 characters;
`--json` keeps the full id (so `jq -r '.[].id'` round-trips).

## Running it

```sh
nix run github:juspay/kolu#arivu-tui          # the dashboard
nix run github:juspay/kolu#arivu-tui -- --json # scriptable dump
```

By default it dials an arivu on this machine. Two ways to point it elsewhere,
**mutually exclusive**:

- `--socket PATH` — a different local socket.
- `--host <ssh>` — a **remote** arivu over ssh. It provisions the daemon's
  closure with Nix and runs `arivu --stdio`, then dials it — the same awareness
  surface over a different transport (riding the same `@kolu/surface-nix-host`
  provisioning as `kaval-tui --host`). The remote arivu **discovers** the running
  kaval — a standalone one, or a **kolu-server** (each namespaced by listen
  port) — so `--host` lands on your remote kolu's terminals with no extra flag,
  and recomputes awareness from now (it's ephemeral by design). Cross-arch: an
  aarch64-darwin laptop can provision an x86_64-linux box.
- `--kaval PATH` (only with `--host`) — pin **which** kaval the remote arivu
  dials, for a host running several (e.g. two kolu-servers). Omit it and arivu
  discovers the one that's up.

```sh
nix run github:juspay/kolu#arivu-tui -- --host nix@prod
# several kavals on the host? pick one:
nix run github:juspay/kolu#arivu-tui -- --host nix@prod --kaval "$XDG_RUNTIME_DIR"/kaval-7692/pty-host.sock
```

`--host` ships the target-arch arivu **daemon** closure, so run arivu-tui from
its Nix wrapper (the command above) — the bare entrypoint has no baked drv map.

The full design lives in the
[arivu atlas note](https://kolu.dev/atlas/arivu.html).
