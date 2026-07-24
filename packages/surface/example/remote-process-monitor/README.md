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
| **Cell** | `system` | Load averages, memory used/total, uptime, OS, hostname. (SR9: this re-serve carries no per-host `connection` cell — connection presentation is a host-map concept; see `common/surface.ts`.) |
| **Collection** | `processes` | Keyed by PID. Each value: `{ user, cpuPct, memPct, command }`. The first yield is the full current snapshot; subsequent yields are per-PID upserts/removes (snapshot-then-delta). |
| **Procedure** | `process.kill` | `kill(pid, signal)` — the only mutation. Signals: `TERM`, `KILL`, `HUP`, `INT`. |

## Run locally

```sh
cd packages/surface/example/remote-process-monitor
just dev                   # host defaults to localhost
just dev user@somehost     # any ssh target
```

Open <http://localhost:5175>. Requires passwordless ssh into the target (set up `~/.ssh/authorized_keys` for your own user if you haven't), and the remote's nix-daemon must trust the parent's user (`trusted-users` in `nix.conf`) so it accepts the unsigned closure the parent ships.

`just dev` boots the parent server (`:7720`) + Vite client (`:5175`) and supplies the independent example flake as the exact agent source. Surface Remote probes the host's architecture and selects `process-monitor-agent` from that source. The parent session then:

1. `nix build --eval-store auto --store ssh-ng://$host "$source#packages.$system.process-monitor-agent"` — evaluates the exact source, then transfers and realises its target-system agent through one Nix-owned lifetime.
2. `ssh $host nix-store --realise $output --add-root … --indirect` — commits the realised output behind its stable target-store GC root.
3. `ssh $host $output/bin/process-monitor-agent --stdio` — runs it.

The source is **required, no fallback** and is baked into `nix run` wrappers; `just dev` supplies the working example flake explicitly. The UI shows provisioning progress while waiting; a cached, rooted closure takes the warm path.

The whole demo also ships as a single binary whose wrapper bakes the same exact source flake:

```sh
nix run ..#process-monitor-monitor -- user@somehost
```

To smoke-test the agent in isolation:

```sh
nix run ..#process-monitor-agent -- --stdio                     # normal mode
nix run ..#process-monitor-agent -- --stdio --broken-stdout-log # lesson #4
```

## Falsifiability checklist — what to watch

The plan's 12-row table maps to observable behavior in this app:

1. **Stdio link over ssh** — `ssh $host $agent --stdio` connects; the typed RPC client `surface.system.get(...)` round-trips.
2. **Peer-server pumps typed router** — the agent's `serveOverStdio({ router })` serves a non-trivial surface (system cell + processes collection + kill procedure).
3. **Snapshot-then-delta on collections** — open devtools, watch the WebSocket frames: first frame for the processes collection is the full PID map, subsequent frames are per-PID upserts/removes.
4. **Snapshot-then-delta on state listeners** — the "Connecting…" overlay attaches before `connect()` returns and still sees the initial connection state. The parent session's `onState(cb)` fires `cb(current)` synchronously.
5. **Deferred heartbeat** — no heartbeat in this PR; the link survives a long cold provision because there's no premature "disconnected" transition. The parent transitions to `connected` only after the first system snapshot arrives.
6. **Single host session per host** — opening multiple browser tabs against the same parent shares one server-owned session and ssh subprocess.
7. **Instant pane + async fill** — the monitor pane renders the moment the browser connects (with a "Copying…" / "Connecting…" overlay); transport readiness is signalled by the first snapshot arriving.
8. **Wire-shape drift impossible by construction** — the wrapper and development recipe name one exact source flake; the connector selects and realises that source's target-architecture agent, so parent and agent come from the same build.
9. **Remote command builder** — `sshConnector` builds `ssh -o BatchMode=yes $host $agentPath/bin/process-monitor-agent --stdio`.
10. **Auto `.drv` provisioning** — first connect runs one remote-store `nix build` for evaluation, transfer, and realisation, then requires the target-store GC-root commit before the agent path can escape. Progress lines are forwarded to the UI's progress tail.
11. **Stdout is the protocol; logs go to fd 2** — agent logs route to `process.stderr` via the local `log()` helper. Run `pnpm run dev:agent -- --broken-stdout-log` to reproduce lesson #4 — the parent's link surfaces `SyntaxError: Unexpected token '«'` rather than hanging.
12. **Reconnect → state reconciles, no ghosts** — kill the agent (`pkill -f process-monitor-agent` on the remote, or `Ctrl-C` on the localhost dev agent). The session's reconnect timer fires after 2s; the processes collection re-snaps on the new link; processes that ended during the gap drop out of the UI cleanly.

## What's not in this demo

- **A real CLI for `kill` signal selection.** The UI hardcodes `TERM`. The procedure schema accepts `KILL`/`HUP`/`INT` — a button group is left as an exercise.
- **Per-PID streaming value refresh.** The collection's `byKey` snapshot is filled on first key arrival; subsequent value changes ride the system poll cadence rather than per-key channels. R-2 would generate per-key channels for richer per-tile updates.
