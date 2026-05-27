# @kolu/surface-example-remote-process-monitor

A three-tier `top`-shaped live process monitor — browser SolidJS UI ↔ Node parent server ↔ remote agent over ssh stdio. Same typed `@kolu/surface` reactive primitives the notes app uses, but the source of truth lives on another machine.

This is **R-1.5's falsifiability test** for the framework's stdio transport: every primitive added in R-1.5 (`StdioRPCLink`, `serveOverStdio`, `createLoopbackPair`, `inMemoryChannel`) is exercised in the same shape Kolu R-2's `RemoteTerminalBackend` will use — different data (processes instead of terminals), same lifecycle and transport stack.

## Three tiers

```
Browser (SolidJS UI)
   │  WebSocket (oRPC — the framework's existing browser transport)
   ▼
Parent server (Node)
   │  ssh stdio (the R-1.5 stdio link)
   ▼
Remote host: process-monitor-agent (Node, --stdio mode)
   │  /proc/* on linux, sysctl on darwin
   ▼
Kernel
```

The browser's `app.cells.system.use(...)` and `app.collections.processes.use(...)` look identical to the notes app — only the parent server's implementation differs (it forwards to a remote agent instead of an in-process store).

## Surface shape

| Primitive | Path | Purpose |
|---|---|---|
| **Cell** | `system` | Load averages, memory used/total, uptime, OS, hostname, connection state (the parent overrides during connect/copy/disconnect). |
| **Collection** | `processes` | Keyed by PID. Each value: `{ user, cpuPct, memPct, command }`. The first yield is the full current snapshot; subsequent yields are per-PID upserts/removes (snapshot-then-delta). |
| **Procedure** | `process.kill` | `kill(pid, signal)` — the only mutation. Signals: `TERM`, `KILL`, `HUP`, `INT`. |

## Run locally

```sh
cd packages/surface/example/remote-process-monitor
just dev                   # host defaults to localhost
just dev user@somehost     # any ssh target
```

Open <http://localhost:5175>. Requires passwordless ssh into the target (set up `~/.ssh/authorized_keys` for your own user if you haven't), and the remote's nix-daemon must trust the parent's user (`trusted-users` in `nix.conf`) so it accepts the unsigned closure the parent ships.

`just dev` boots the parent server (`:7720`) + Vite client (`:5175`). It probes the host's architecture via `ssh $host uname -ms`, then evaluates `nix eval --raw .#packages.<remote-system>.process-monitor-agent.drvPath` to get the *target-arch* derivation, and exports it as `KOLU_AGENT_DRV`. The parent's `HostSession` then:

1. `nix copy --derivation --to ssh-ng://$host $KOLU_AGENT_DRV` — ships the `.drv` (plus any inputs the remote doesn't have) to the host.
2. `ssh $host nix-store --realise $KOLU_AGENT_DRV` — builds it on the remote, returning a path on the remote's store.
3. `ssh $host $realisedPath/bin/process-monitor-agent --stdio` — runs it.

`KOLU_AGENT_DRV` is **required, no fallback** — the operator is the only one who knows which derivation/architecture is correct. The UI shows copy + realise progress while waiting; subsequent connects skip both if the closure is already realised on the remote.

The whole demo also ships as a single binary that bakes its own agent `.drv` for the current system:

```sh
nix run .#process-monitor-monitor -- user@somehost
```

To smoke-test the agent in isolation:

```sh
nix run .#process-monitor-agent -- --stdio                     # normal mode
nix run .#process-monitor-agent -- --stdio --broken-stdout-log # lesson #4
```

## Falsifiability checklist — what to watch

The plan's 12-row table maps to observable behavior in this app:

1. **Stdio link over ssh** — `ssh $host $agent --stdio` connects; the typed RPC client `surface.system.get(...)` round-trips.
2. **Peer-server pumps typed router** — the agent's `serveOverStdio({ router })` serves a non-trivial surface (system cell + processes collection + kill procedure).
3. **Snapshot-then-delta on collections** — open devtools, watch the WebSocket frames: first frame for the processes collection is the full PID map, subsequent frames are per-PID upserts/removes.
4. **Snapshot-then-delta on state listeners** — the "Connecting…" overlay attaches before `connect()` returns and still sees the initial `state === "connecting"`. The parent's `HostSession.onState(cb)` fires `cb(current)` synchronously.
5. **Deferred heartbeat** — no heartbeat in this PR; the link survives a cold `nix copy` of arbitrary length because there's no premature "disconnected" transition. The parent transitions to `connected` only after the first system snapshot arrives.
6. **Single host session per host** — opening multiple browser tabs against the same parent shares ONE ssh subprocess. `getHostSession({host, agentPath})` ref-counts.
7. **Instant pane + async fill** — the monitor pane renders the moment the browser connects (with a "Copying…" / "Connecting…" overlay); transport readiness is signalled by the first snapshot arriving.
8. **Wire-shape drift impossible by construction** — the parent ships a target-arch `.drv` (computed once via `nix eval --raw .#packages.<remote-system>.process-monitor-agent.drvPath`) and realises it on the remote, so parent and agent are always the same nix derivation. (R-2 uses a required `KOLU_AGENT_FLAKE_REF` env var; this demo's `KOLU_AGENT_DRV` is the file-shape twin.)
9. **Remote command builder** — `HostSession.spawn` builds `ssh -o BatchMode=yes $host $agentPath/bin/process-monitor-agent --stdio`. File-shape twin of R-2's `install.ts` `remoteAgentCommand`.
10. **Auto `.drv` provisioning** — first connect runs `nix copy --derivation --to ssh-ng://$host $KOLU_AGENT_DRV` then `ssh $host nix-store --realise $KOLU_AGENT_DRV` (the copy is skipped on localhost; realise is a local build there). Progress lines are forwarded to the UI's progress tail.
11. **Stdout is the protocol; logs go to fd 2** — agent logs route to `process.stderr` via the local `log()` helper. Run `pnpm run dev:agent -- --broken-stdout-log` to reproduce lesson #4 — the parent's link surfaces `SyntaxError: Unexpected token '«'` rather than hanging.
12. **Reconnect → state reconciles, no ghosts** — kill the agent (`pkill -f process-monitor-agent` on the remote, or `Ctrl-C` on the localhost dev agent). The session's reconnect timer fires after 2s; the processes collection re-snaps on the new link; processes that ended during the gap drop out of the UI cleanly.

## What's not in this demo

- **A real CLI for `kill` signal selection.** The UI hardcodes `TERM`. The procedure schema accepts `KILL`/`HUP`/`INT` — a button group is left as an exercise.
- **Per-PID streaming value refresh.** The collection's `byKey` snapshot is filled on first key arrival; subsequent value changes ride the system poll cadence rather than per-key channels. R-2 would generate per-key channels for richer per-tile updates.
- **Standalone `nix run` for the whole demo.** The agent ships as a flake derivation (`.#process-monitor-agent`), but the parent server + Vite client still run from source via `just dev`. Bundling the parent + a pre-built client into a single `nix run .#process-monitor-monitor` is straightforward and a reasonable follow-up.
