# @kolu/surface-example-mini-ci

A minimal CI-runner **TUI over oRPC stdio** — a long-lived runner owns a tiny task DAG (`build → test → lint`) and streams it to an ephemeral terminal client. Deliberately *not* the real [justci](https://github.com/juspay/justci): no Haskell, no GitHub statuses, no multi-platform fan-out. Just a DAG of shell commands, runnable locally or on a remote host with the source shipped by `git archive` over ssh.

This is **Phase 0** of [`kolu-tui`](../../../../docs/plans/remote-terminals.pty-daemon.tui.html): the falsifiability test (lesson #3) for the "interactive TUI over oRPC stdio" pattern, the way the [notes app](../README.md) and the [remote-process-monitor](../remote-process-monitor/README.md) (→ [drishti](https://github.com/srid/drishti)) validated the earlier patterns. It is a clean structural twin of kolu-tui — if the surface primitives express it cleanly, the seam is at the right altitude for kolu-tui to inherit; if it were awkward, that's a framework finding to fix *before* kolu-tui adopts it.

## Architecture

```
┌──────────────────────┐  oRPC over stdio (stdioLink / serveOverStdio)  ┌──────────────────────────────┐
│     mini-ci TUI      │ ── nodes.get · nodeLog.get · node.rerun ───────▶│  mini-ci runner (child proc) │
│ (the example client) │ ◀─ node-state cell  +  per-node log stream ──── │  task DAG: build → test → lint│
└──────────────────────┘                                                 └──────────────────────────────┘
```

Local mode spawns the runner as a child; remote mode runs it on another host over ssh — **the same `stdioLink`, only the subprocess differs.**

## Surface shape

The plan writes these as `nodes.list()` / `node.log(id)` / `node.rerun(id)`; the surface-idiomatic spelling the framework derives is the right column.

| Primitive | Path | Purpose |
|---|---|---|
| **Cell** | `surface.nodes.get({})` | The whole pipeline's node-state — id, status (`pending`/`running`/`ok`/`failed`/`skipped`), exit code, duration. First yield is the full snapshot; subsequent yields are deltas. ↔ kolu-tui's `list`. |
| **Stream** | `surface.nodeLog.get({ id })` | One node's output. First frame is the buffered `snapshot`; subsequent frames are `append` deltas (a `rerun` re-emits an empty `snapshot` to reset). ↔ kolu-tui's `attach`. |
| **Procedure** | `surface.node.rerun({ id })` | Reset a node + its transitive dependents to `pending` and re-run them — the only mutation. ↔ kolu-tui's input. |

## Run locally

```sh
cd packages/surface/example/mini-ci
just run                            # built-in build → test → lint pipeline
just run --pipeline ci.json         # build → {test, lint} → report (parallel)
nix run .#mini-ci                   # via Nix (builds the tsx-wrapped binary)
```

`just run` is parametrized — every argument passes straight to the TUI. The dashboard paints a node-status table plus the attached node's log tail. Keys: digits `1`–`9` attach a node, `n`/`p` cycle, `r` rerun the attached node, `q` quit. For scripting / CI:

```sh
just run --json                # run to completion, print final state, exit non-zero on failure
just run --headless            # stream status transitions as plain lines
```

## Run on a remote host

```sh
just run --remote user@somehost
```

This ships a clean snapshot of the flake source with `git archive HEAD | ssh user@somehost 'tar -x -C /tmp/mini-ci-src'` — no `.git`, no prebuilt closure — then runs `nix run path:/tmp/mini-ci-src#mini-ci-runner -- --stdio` on the host, with the TUI attached over **stdio-over-ssh**. **All target hosts are assumed to have Nix**, so the host *builds* the runner from the shipped source — no `node`/`pnpm`/`tsx` assumed on PATH, and Nix supplies the workspace deps (via the `pnpmDeps` fixed-output fetch). Requires only passwordless ssh + Nix on the host.

This is the deliberate **"source, not a closure"** cousin of the [remote-process-monitor](../remote-process-monitor/README.md), which `nix copy`s a *prebuilt* closure over ssh: mini-ci ships source and lets the host build it.

### Reuse of `@kolu/surface-nix-host`

The ssh dead-peer keepalive policy (`SSH_COMMON_OPTS`) and the localhost-vs-ssh check (`isLocalHost`) are reused from [`@kolu/surface-nix-host`](../../../surface-nix-host) — the same source of truth drishti's `HostSession` uses — rather than re-derived here. mini-ci does **not** reuse `HostSession` itself: its provisioning is nix-*closure*-coupled (`provisionAgent` ships a prebuilt `.drv`, and it spawns `${agentPath}/bin/${binary}`), whereas mini-ci ships source and `nix run`s it. _Framework finding (the kind Phase 0 exists to surface): giving `HostSession` a pluggable provisioner — closure-copy vs source-ship — would let mini-ci inherit its ref-count + reconnect + connection-state machinery too._

## Detach (and why there's no `~`-escape)

kolu-tui's Phase-2 ssh-style `~`-escape exists because that client is a **raw VT passthrough** where every byte must reach the inner program, so it needs an unambiguous escape that never collides with the inner tool. mini-ci's dashboard renders **structured state** and owns the keyboard directly, so it binds plain keys — the `~`-escape decision is recorded for kolu-tui, not needed here. Likewise, because the runner is the TUI's child (or dies with the ssh pipe), this is *client-side* come-and-go, not server-restart survival — exactly the honest-scope line the plan draws between kolu-tui (client detach while the server runs) and the daemon plan (server survival).

## Falsifiability checklist — what `mini-ci.test.ts` proves

The test drives the *real* runner surface through the *real* stdio transport (`createLoopbackPair` → `serveOverStdio` → `stdioLink`), so a green run is genuine evidence the pattern holds:

1. **Cell snapshot-then-delta** — the `nodes` cell streams a full snapshot then deltas; a late subscriber's first frame is the current state.
2. **Topo order** — across every captured frame, a node only runs once its dependency is `ok` (race-free invariant).
3. **Per-node log snapshot** — a late subscriber to a finished node's `nodeLog` gets the buffered output as its first `snapshot` frame.
4. **Mutation re-runs the closure** — `node.rerun` resets the node + its dependents to `pending` and they settle `ok` again.
5. **No false greens** — a failed dependency `skip`s its dependents.
6. **Only the link differs** — the local / ship / remote transport commands differ only in the subprocess (argv assertions).
7. **Stdout is the protocol** — the runner logs to fd 2; `serveOverStdio` reserves stdout for framing (inherited from the framework, exercised by every round-trip here).

## What's not in this demo

- **`HostSession`-style reconnect.** The remote link is a single session; it doesn't ref-count or auto-reconnect. Wiring it through a (provisioner-pluggable) `HostSession` — so a dropped ssh pipe re-snaps state, exactly as drishti does — is the graduation step (see the framework finding above).
- **Server-restart survival.** This is client-side detach/reattach while the runner lives; surviving a *runner* restart is kolu-server's job in the [daemon plan](../../../../docs/plans/remote-terminals.pty-daemon.html), not here.
- **A real CI runner.** The DAG runs shell commands with no caching, no artifact passing, no platform fan-out — that's [justci](https://github.com/juspay/justci)'s job. mini-ci could graduate to its own repo the way remote-process-monitor became [drishti](https://github.com/srid/drishti).
