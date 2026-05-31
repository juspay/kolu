# @kolu/surface-example-mini-ci

A minimal CI-runner **TUI over oRPC stdio**. A long-lived **runner** owns a task DAG — each node a child process with a per-node log buffer — and serves it as a `@kolu/surface` over stdio. An ephemeral **TUI** attaches, paints a live node-status table plus the attached node's log tail, and exercises three surface primitives. Deliberately _not_ the real [justci](https://github.com/juspay/justci): no Haskell, no GitHub statuses, no multi-platform fan-out — just a DAG of shell commands, runnable locally or on a remote host.

This is **Phase 0** of [`kolu-tui`](../../../../docs/plans/remote-terminals.pty-daemon.tui.html): the falsifiability test (lesson #3) for the "interactive TUI over oRPC stdio" pattern, the way the [notes app](../README.md) and the [remote-process-monitor](../remote-process-monitor/README.md) (→ [drishti](https://github.com/srid/drishti)) validated the earlier patterns. It is a clean structural twin of kolu-tui — if the surface primitives express it cleanly, the seam is at the right altitude for kolu-tui to inherit; if it were awkward, that's a framework finding to fix _before_ kolu-tui adopts it.

## Architecture

The runner is shipped to the host the **drishti way** — as a prebuilt nix closure copied + realised over ssh — and reached through [`@kolu/surface-nix-host`](../../../surface-nix-host)'s `HostSession`, exactly as remote-process-monitor does it:

```
┌──────────────────────┐                                              ┌──────────────────────────────────┐
│      mini-ci TUI     │                                              │   mini-ci-runner (on the host)   │
│   (ephemeral client) │                                              │   serveOverStdio({ router })     │
│                      │  HostSession                                 │                                  │
│  session = getHost-  │  ── nix copy closure (skipped on localhost)─▶│   task DAG: per-node child proc  │
│   Session({ host,    │  ── nix-store --realise ────────────────────▶│   runs `pnpm --filter … type-    │
│    binary,           │  ── ssh $host mini-ci-runner --stdio ───────▶│   check` against the bundled     │
│    resolveDrvPath })│                                              │   workspace (surfaceExampleBase) │
│                      │  ◀─ nodes Cell  +  nodeLog Stream (ssh stdio)│                                  │
└──────────────────────┘                                              └──────────────────────────────────┘
```

`HostSession` owns the ref-count, reconnect, and a connection-state cell (`copying → connecting → connected`). The TUI calls `session.markConnected()` on the first `nodes` frame and `session.destroy()` on quit. `localhost` skips the `nix copy` and runs the realised binary directly — **the same `HostSession`, only the transport differs.**

## Surface shape

The plan writes these as `nodes.list()` / `node.log(id)` / `node.rerun(id)`; the surface-idiomatic spelling the framework derives is the right column.

| Primitive     | Path                          | Purpose                                                                                                                                                                                                                                  |
| ------------- | ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Cell**      | `surface.nodes.get({})`       | The whole pipeline's node-state — id, status (`pending`/`running`/`ok`/`failed`/`skipped`), exit code, duration. First yield is the full snapshot; subsequent yields are deltas. ↔ kolu-tui's `list`.                                       |
| **Stream**    | `surface.nodeLog.get({ id })` | One node's output. First frame is the buffered `snapshot`; subsequent frames are `append` deltas (a `rerun` re-emits an empty `snapshot` to reset). ↔ kolu-tui's `attach`.                                                                 |
| **Procedure** | `surface.node.rerun({ id })`  | Reset a node + its transitive dependents to `pending` and re-run them — the only mutation. ↔ kolu-tui's input.                                                                                                                             |

Keys: digits `1`–`9` attach a node's log, `n`/`p` cycle, `r` rerun the attached node, `q` quit.

## The default pipeline runs real CI

The zero-config pipeline isn't a toy `build → test → lint` — it's **real CI for the [remote-process-monitor](../remote-process-monitor/README.md) example**: `tsc --noEmit` over its dependency closure. `@kolu/surface` and `@kolu/surface-nix-host` typecheck in parallel (`needs: []`), then `@kolu/surface-example-remote-process-monitor` (`needs: [surface, nix-host]`). These are the same typecheck gates the repo's CI runs.

```
   surface ──┐
             ├──▶ monitor
  nix-host ──┘
```

The `mini-ci-runner` closure bundles the workspace + `node_modules` (via the shared `surfaceExampleBase` nix derivation), so the `pnpm --filter … typecheck` tasks run against whatever host the closure lands on — no `pnpm install`, no source checkout on the remote.

**Read-only by construction.** The closure lives in the read-only nix store, so only **read-only** checks (typecheck) are in the default pipeline. Write-heavy tasks would fail: a `vite build` wants `node_modules/.vite-temp`, and `nix build` wants `flake.nix` (which isn't in the closure's source fileset). Running those would need a writable copy of the workspace first — the trade-off of shipping a _closure_ (drishti) rather than source.

## Run

```sh
cd packages/surface/example/mini-ci
just run                         # local (host = localhost)
just run user@host               # remote — needs passwordless ssh + Nix on the host
just run localhost --json        # run to completion, print final state, exit non-zero on failure
just run localhost --headless    # stream status transitions as plain lines
nix run .#mini-ci                # standalone — bakes the current system's runner .drv
```

`just run [host]` probes the host's nix-system, resolves the matching `mini-ci-runner` `.drv`, and passes it as `MINI_CI_RUNNER_DRV` (exactly like drishti's `KOLU_AGENT_DRV`); [`src/probe-arch.ts`](src/probe-arch.ts) is the thin arch-probe wrapper over `@kolu/surface-nix-host`'s `resolveSystem`. The TUI then drives the runner via `getHostSession({ host, binary: "mini-ci-runner", resolveDrvPath })`. Remote hosts only need passwordless ssh + Nix; the runner is built once for the host's arch and `nix copy`d over.

## Detach (and why there's no `~`-escape)

kolu-tui's Phase-2 ssh-style `~`-escape exists because that client is a **raw VT passthrough** where every byte must reach the inner program, so it needs an unambiguous escape that never collides with the inner tool. mini-ci's dashboard renders **structured state** and owns the keyboard directly, so it binds plain keys — the `~`-escape decision is recorded for kolu-tui, not needed here. Likewise, because the runner is reached over a single `HostSession` (or dies with the ssh pipe), this is _client-side_ come-and-go, not server-restart survival — exactly the honest-scope line the plan draws between kolu-tui (client detach while the server runs) and the daemon plan (server survival).

## Falsifiability checklist — what `mini-ci.test.ts` proves

The unit test drives the _real_ runner surface through the _real_ stdio transport (`createLoopbackPair` → `serveOverStdio` → `stdioLink`, the same framing the ssh path uses), so a green run is genuine evidence the pattern holds:

1. **Cell snapshot-then-delta** — the `nodes` cell streams a full snapshot then deltas; a late subscriber's first frame is the current state.
2. **Topo order** — across every captured frame, a node only runs once its dependency is `ok` (race-free invariant).
3. **Per-node log snapshot** — a late subscriber to a finished node's `nodeLog` gets the buffered output as its first `snapshot` frame.
4. **Rerun re-runs the closure** — `node.rerun` resets the node + its dependents to `pending` and they settle `ok` again.
5. **No false greens** — a failed dependency `skip`s its dependents.

Plus the live e2e: `just run localhost --json` type-checks remote-process-monitor's dependency closure green over a real `HostSession` + ssh stdio.

## What's not in this demo

- **Write-heavy CI tasks (builds).** The runner closure is read-only, so the default pipeline is typecheck-only. `vite build` / `nix build` would need a writable copy of the workspace first — the read-only-closure trade-off above.
- **Server-restart survival.** This is client-side detach/reattach while the runner lives; surviving a _runner_ restart is kolu-server's job in the [daemon plan](../../../../docs/plans/remote-terminals.pty-daemon.html), not here.
- **A real CI runner.** The DAG runs shell commands with no caching, no artifact passing, no platform fan-out — that's [justci](https://github.com/juspay/justci)'s job. mini-ci could graduate to its own repo the way remote-process-monitor became [drishti](https://github.com/srid/drishti).
- **Known bug:** in some terminals the TUI can leave the terminal in raw mode on quit — filed as [juspay/kolu#1076](https://github.com/juspay/kolu/issues/1076).
