# pulam-tui

**pulam-tui** is the terminal-side client for [`pulam`](../pulam), the standalone
terminal-workspace daemon. It dials pulam's unix socket and reads the
`awareness` collection: what each terminal _is in_ — repo branch, the open PR and
its checks, which AI agent and whether it's working / awaiting you / waiting, and
the foreground process.

Where [`kaval-tui`](../kaval-tui) shows what's _running_ in each PTY, pulam-tui
shows what each terminal _is in_. It is the **raw** client — a thin, scriptable
CLI, kaval-tui's sibling, with **zero kolu-server and no browser**. The rich,
leave-it-on-a-second-monitor **fleet dashboard across many hosts** is
[`pulam-web`](../pulam-web)'s job; pulam-tui is single-daemon.

```
pulam-tui status [--json]            a one-shot snapshot of every terminal
pulam-tui watch [<id>] [--json]      follow live until Ctrl+C — every terminal, or one by id
pulam-tui wait <id> --until <state>  block until that terminal's agent reaches a state, then exit
```

```
$ pulam-tui status

ID        REPO·BRANCH         PR          AGENT             FOREGROUND   IDLE
a3f10000  kolu·feat/dial-ssh  #1412 ✓     claude · working  node           4s
b7c20000  drishti·master      —           codex · waiting   codex          1s
c9d40000  kolu·fix/fold       #1408 ✗     —                 nvim          12m
```

`status` prints the snapshot and exits; `watch` follows the daemon live, printing
one line per awareness change (with a trailing `●` when a terminal is moving bytes
right now), until `Ctrl+C`. Pass an id to `watch` — the short id from `status` or
any unique prefix — to narrow to a single terminal. `--json` makes either
machine-readable: `status --json` is a top-level array; `watch --json` is one JSON
object per line (NDJSON), so `jq -c` streams it.

```sh
# alert when any agent blocks on you
pulam-tui watch --json | jq -rc 'select(.agent.state=="awaiting_user") | "\(.id) needs you"'
```

## Waiting on an agent — `wait`

`wait` blocks until one terminal's agent reaches a target **bucket**, then exits
— the done-signal an agent uses to **drive another agent**. The buckets are the
shared `agentProjection` fold's: `working` (thinking / tool_use / background),
`awaiting` (the agent stopped to ask you), `waiting` (its turn just ended). Pass
a comma list to `--until`; `awaiting,waiting` is "the agent's turn ended" (it
left `working`):

```sh
id=$(kaval-tui create -- claude --json | jq -r .id)   # spawn an agent terminal
kaval-tui send  "$id" "refactor the parser to use a lexer"   # prompt it (submits)
pulam-tui  wait "$id" --until awaiting,waiting               # block until its turn ends
kaval-tui snapshot "$id"                                     # read its reply — then loop
```

`--timeout <ms>` caps the wait and **fails loud** (exit code `2`) rather than
hanging forever; without it `wait` blocks until the state, the link drops, or
`Ctrl+C`. `--json` prints `{ id, agent }` so the driver reads the new state
without a second call.

> **Mind the stale-state race.** Right after `send`, the agent may still report
> the *previous* turn's `waiting`/`awaiting` for a beat before it picks up. For a
> robust loop, wait for the pickup first, then the turn-end: `pulam-tui wait $id
> --until working` then `pulam-tui wait $id --until awaiting,waiting`.

## Short ids

Terminal ids are uuids, so the human views print just the first 8 characters;
`--json` keeps the full id (so `jq -r '.[].id'` round-trips).

## Running it

```sh
nix run github:juspay/kolu#pulam-tui -- status
nix run github:juspay/kolu#pulam-tui -- watch
```

By default it dials a pulam on this machine. Two ways to point it elsewhere,
**mutually exclusive** (flags go _after_ the subcommand):

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
nix run github:juspay/kolu#pulam-tui -- status --host nix@prod
# several kavals on the host? pick one:
nix run github:juspay/kolu#pulam-tui -- status --host nix@prod --kaval "$XDG_RUNTIME_DIR"/kaval-7692/pty-host.sock
```

`--host` ships the target-arch pulam **daemon** closure, so run pulam-tui from
its Nix wrapper (the command above) — the bare entrypoint has no baked drv map.

The full design lives in the
[pulam-tui atlas note](https://kolu.dev/atlas/pulam-tui.html).
