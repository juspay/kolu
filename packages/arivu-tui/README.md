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
arivu-tui list [--json]   one row per terminal — id · branch · pr · agent · foreground
arivu-tui watch <id>      follow one terminal's awareness live (Ctrl-C to stop)
```

```
ID        BRANCH         PR        AGENT             FOREGROUND
a3f10000  feat/dial-ssh  #1412 ✓   claude · working  node
b7c20000  master         —         codex · waiting   codex
c9d40000  fix/fold       #1408 ✗   —                 nvim
```

The agent column buckets each AI agent's fine-grained state into `working` /
`awaiting` / `waiting`; the PR column rolls its checks up to ✓ / ✗ / ·.

## Short ids

Terminal ids are uuids, so `list` prints just the first 8 characters; `watch`
takes that short form **or any unique prefix**, resolved against the live set.
`--json` keeps the full id (so `jq -r '.[].id'` round-trips).

## Running it

```sh
nix run github:juspay/kolu#arivu-tui -- list
nix run github:juspay/kolu#arivu-tui -- watch a3f1
```

By default it dials an arivu on this machine. Two ways to point it elsewhere,
**mutually exclusive**:

- `--socket PATH` — a different local socket.
- `--host <ssh>` — a **remote** arivu over ssh. It provisions the daemon's
  closure with Nix and runs `arivu --stdio`, then dials it — the same awareness
  surface over a different transport (riding the same `@kolu/surface-nix-host`
  provisioning as `kaval-tui --host`). The remote arivu dials the remote kaval
  and recomputes awareness from now (it's ephemeral by design). Cross-arch: an
  aarch64-darwin laptop can provision an x86_64-linux box.

```sh
nix run github:juspay/kolu#arivu-tui -- list --host nix@prod
```

`--host` ships the target-arch arivu **daemon** closure, so run arivu-tui from
its Nix wrapper (the command above) — the bare entrypoint has no baked drv map.

The full design lives in the
[arivu atlas note](https://kolu.dev/atlas/arivu.html).
