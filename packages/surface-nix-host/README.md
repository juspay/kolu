# `@kolu/surface-nix-host`

**Run a typed [`@kolu/surface`](../surface/) agent on a remote machine over `ssh`. The package handles provisioning (ship a Nix derivation, realise it on the target), the long-lived ssh subprocess (with ref-counting, reconnect, exponential backoff), and the reactive state cell that lets you observe link lifecycle in the same `useCell` shape browsers consume.**

You bring the surface contract (your `defineSurface(…)` schema) and the agent binary's `.drv`. The package gives you a typed RPC client over stdio, plus a state machine that survives transient drops and respawns the agent through a fresh ssh subprocess on the other side.

## When to reach for it

You want a Node parent server to talk to an agent process on another host as if it were local — same `useCell` / `useCollection` / `useStream` shape the browser uses, just with a Node-process boundary in the middle instead of a WebSocket. The headline use case is **kolu's `RemoteTerminalBackend`**: the parent's terminal surface forwards reads to a kolu-agent running on the user's remote dev box. The same shape works for any "read sensors / mutate state / observe events on host X from host Y" problem — process monitor, log tailer, GPU stats, build runner, etc.

The reference consumer is [`packages/surface/example/remote-process-monitor/`](../surface/example/remote-process-monitor/) — a three-tier `htop`-style live process monitor that exercises every primitive in this package end-to-end.

## What it gives you

```ts
import { getHostSession, type HostSession } from "@kolu/surface-nix-host";
import { contract } from "./your-surface";  // your typed @kolu/surface contract

const session: HostSession<typeof contract> = getHostSession<typeof contract>({
  host: "alice@bob.example",                 // any ssh target; "localhost" short-circuits
  resolveDrvPath: () =>                       // resolve the agent's .drv for the *target*
    Promise.resolve(process.env.MY_AGENT_DRV!),//   arch; called inside each spawn (see below)
  binary: "my-agent",                        // exe name inside the realised closure
});

// Subscribe to lifecycle state (snapshot-then-delta).
session.onState((s) => console.log(s.connection));
//   "copying"   → "connecting" → "connected"
//   on drop:    → "disconnected" → "copying" → … (exp backoff, capped at 60s)
//   network drop (unreachable host): retries forever; remote rejection
//     (e.g. trusted-users): gives up into terminal "failed" after N. See
//     `s.failureCause`. `recheck()` force-re-probes after a laptop wake.

// Pin the session for the parent's lifetime; obtain the typed client.
const client = await session.pin();
const sys = client.system.get({});           // typed oRPC — same shape your browser uses
```

## What it's NOT

- **Not a transport.** That's [`@kolu/surface/links/stdio`](../surface/src/links/stdio.ts). This package sits *on top of* the stdio link and adds: process supervision (spawn/respawn ssh), `.drv` provisioning (the Nix bit), and a reactive state cell for the connection's own lifecycle.
- **Not a Nix utility.** `provisionAgent` is purposely minimal — `nix copy --derivation`, then `ssh $host nix-store --realise`, then pin the output behind a per-agent GC root, then return the resulting path (an already-provisioned host short-circuits all three with a single realise-probe — see [Why Nix](#why-nix-locked-in)). If you want richer flake handling (e.g. resolve a flake ref to a `.drv`), do it inside the `resolveDrvPath` callback you pass.
- **Not opinionated about UI.** The package returns a typed RPC client. Mirroring its streams into your parent server's local surface (so the browser can consume them) is the consumer's job. See the [`remote-process-monitor` example](../surface/example/remote-process-monitor/src/server/router.ts) for the canonical bridge pattern.

## Why Nix (locked-in)

Cross-arch deployment is the load-bearing problem this package solves. Parent on darwin, target on linux — or vice versa. A locally-built closure has the parent's CPU architecture baked into its binaries; `nix copy` can't smuggle it across.

The `.drv` ships **build instructions** (platform-neutral) rather than build outputs. The remote realises the derivation on its own architecture, producing target-arch-correct binaries.

```
parent: nix eval --raw .#packages.<remote-system>.<agent>.drvPath
        └── caller's responsibility — `resolveSystem(host)` gives <remote-system>
parent: nix copy --derivation --to ssh-ng://$host $drvPath
remote: nix-store --realise $drvPath  →  /nix/store/...-agent
remote: nix-store --realise $out --add-root <link> --indirect  (GC-pin)
parent: ssh $host $agentPath/bin/<binary> --stdio
```

The pin step is what keeps a `nix-collect-garbage` on the target from
deleting the agent out from under a live session (or forcing a rebuild on
the next reconnect). The root is one fixed symlink per agent — keyed on the
`.drv` name — so each realise moves it to the newest output and the previous
hash becomes GC-eligible, exactly like `nix build`'s `result` link. It's
best-effort: if the root can't be written, the agent still runs unpinned.

**Warm fast-path.** On an already-provisioned host the whole sequence collapses to one ssh. `provisionAgent` first runs `nix-store --realise $drvPath --add-root <link> --indirect`, which on a host that already holds the closure is an instant no-op that both confirms it's present *and* refreshes the GC root — so the redundant `nix copy` (the wasteful "copying 0 paths" step), plus the separate realise/pin a warm host would otherwise re-pay on every dial, is skipped. On a miss it fast-fails and falls through to the full `nix copy → realise → pin` above; the fall-through's pin is best-effort, so even an unwritable root degrades to *works, unpinned* rather than a hard failure. Remote-only — localhost never copies anyway (the `.drv` is already in its store).

**Connection multiplexing.** The surviving ssh round-trips of a warm dial — the arch probe (`resolveSystem`), the realise-probe provision check, and the agent dial — used to each pay their own ~5s ssh handshake because nothing reused the connection. They now share **one** ssh master via `ControlMaster=auto` / `ControlPersist`: the first op opens it, the rest ride it as near-instant channels (and `nix copy`'s own ssh fork rides it too, through `NIX_SSHOPTS`). It needs **no `~/.ssh/config` change** — the control opts ride the same single-source-of-truth render as the dead-peer keepalive — and the control socket is a **kolu-private** path (never `~/.ssh`): `$XDG_RUNTIME_DIR/kolu-ssh/%C` on systemd Linux, else the per-user `/tmp/kolu-ssh-$UID/%C` fallback (same `getRuntimeSocketPath` convention as the pty-host socket). It's addressed by ssh's `%C` token to stay short and per-host. Multiplexing is purely additive: if the control dir can't be made owner-only the opts silently drop and ssh connects un-multiplexed, never a failure. Lifecycle is delegated to ssh's own `auto` — a stale master (unclean death) just costs one un-multiplexed dial, which then re-masters; there is deliberately no `ssh -O exit` teardown, which would defeat the *cross-invocation* warmth `ControlPersist` exists to provide (a second `kaval-tui` within minutes reuses the still-warm master).

**Nix is the contract, not the implementation.** No tarball, Docker, or prebuilt-binary fallback exists or will. The whole point of this package is "use Nix for cross-arch deployment of typed stdio agents"; consumers that don't want Nix should pick a different transport layer.

Remote-side requirement: the parent's user must be in `trusted-users` in the remote's `nix.conf` so the daemon accepts the unsigned closure. Without that, `nix copy` rejects.

## The pieces

| Export | Role |
|---|---|
| `HostSession<C>` | One ssh subprocess per `(host, binary)`. Ref-counted. State machine. Survives drops via `scheduleReconnect`. Snapshot-then-delta `onState`. Generic over the contract type `C`. |
| `getHostSession<C>(opts)` | Pool lookup — repeated calls with the same `(host, binary)` return the same session (first call's `opts` win). |
| `dialAgentOnce<C>(opts)` | **One-shot CLI dial.** The composition every `--host` CLI needs but no single export owned: parse + validate the baked `{ system → drv }` env map (fail-fast, *before* any session), construct an **unpooled** `HostSession`, then `pin → probe → markConnected → return { client, dispose }` with the link already proven live. Caller brings only its volatile values — `binary`, the env-var name + value, a `drvNoun` for errors, and a one-RPC `probe` closure. Unpooled by design: a one-shot dial is independent, so its `dispose()` tears down only its own session (no cross-dial sharing, no destroyed-session reuse). Used by `kaval-tui --host` and `arivu-tui --host`. |
| `destroyAllSessions()` | Tear down every pooled session. Call on parent shutdown. |
| `provisionAgent({ host, drvPath, onProgress })` | Ship the `.drv` to the host (skipped for localhost), `nix-store --realise` it there, pin the output behind a per-agent GC root (`agentGcRootPath`), and return the realised output path. An already-provisioned remote skips the copy via a single realise-probe (the *warm fast-path* in [Why Nix](#why-nix-locked-in)). Progress lines forwarded to `onProgress`. |
| `mirrorRemoteCollection<K,V>(opts)` | Helper: bridge a remote `Collection<K,V>` to a local one — keys stream + per-key value streams, with abort cleanup on key departure. |
| `waitForNextClient(session, previous)` | Helper for the consumer's reconnect-loop: blocks until the session produces a *fresh* `AgentClient<C>` (post-reconnect). |
| `buildAgentCommand({ host, agentPath, binary })` | Compute the spawn argv for an agent binary on a given host. Used internally; exported for consumers that need to invoke the agent directly (e.g. one-shot subprocess tests). The argv ends ssh's option parsing with `--` before the host, so an attacker-influenced `host` (`-oProxyCommand=…`) can never be read by ssh as an *option* — it is always a destination. |
| `resolveSystem(host)` | Ask `host`'s own Nix for `builtins.currentSystem` (`nix-instantiate --eval`, locally for `isLocalHost`, over `ssh` otherwise) and return the nix-system string. No `uname` table to maintain — the host's Nix is the source of truth, and it's already reachable since `provisionAgent` shells `nix-store` on the same PATH. Pairs with a per-system `.drv` map the caller builds at its own build time. **Memoized per host for the process** (a host's nix-system is stable), so repeat dials don't re-probe; a *failed* probe isn't cached, so a transient-unreachable host re-probes on the next dial. |
| `runCapture(cmd, args, onProgress)`, `runProgress(cmd, args, onProgress)` | Spawn-and-await helpers with consistent close-event-flush semantics. Used internally by `provisionAgent` and `resolveSystem`; exported so consumers can avoid re-rolling the same event-wiring dance. |
| `isLocalHost(host)`, `forEachLine(chunk, cb)` | Small utilities shared by `nixCopy` and `HostSession`. |

## Lifecycle invariants

- **Snapshot-then-delta on `onState`**: a listener attached at any point sees the current state synchronously before any subsequent transitions. Matches the contract `@kolu/surface`'s `useCell` consumers expect.
- **`pin()` vs `acquire()`**:
  - `pin()` is the parent-lifetime intent — bumps `refCount` unconditionally so the session keeps trying to reconnect even if the first spawn fails.
  - `acquire()` is scoped — bumps `refCount` only on successful spawn. A failed provisioning leaves `refCount` untouched (no `try/finally` leak in the caller).
- **Reconnect terminates only for *remote* faults**: each failure carries a `failureCause` (`"network"` | `"remote"`). A `"remote"` fault — the host answered but rejected the closure (e.g. the parent's user isn't in `trusted-users`) — is bounded by `MAX_CONSECUTIVE_FAILURES` (currently 5); after that the session surfaces the terminal `"failed"` state with the last error, so a misconfigured target fails loudly instead of spamming forever. A `"network"` fault — the host was unreachable (asleep, roaming between Wi-Fi networks, VPN down) — is **never** terminal: the session keeps retrying at the capped backoff indefinitely, so a laptop that closes its lid at home and reopens at a café reconnects on its own with no manual intervention.
- **`recheck()` vs `reconnect()`**: `reconnect()` is the manual "Reconnect" button — it re-arms a `"failed"`/idle session and deliberately won't disturb a live link. `recheck()` is the wake / network-change companion: it force-cycles *whatever* is there, including a `"connected"` link, because after a sleep that link is often stale (the far end dropped the socket but the local ssh child won't notice until its keepalive fails ~30s later). A long-running parent calls `recheck()` on every session when it observes the machine wake or regain connectivity.
- **Pump-loop pattern**: the stdio link doesn't auto-reconnect mid-stream (the streams die with the agent process). The consumer is expected to loop on `waitForNextClient`, running pumps against each fresh `AgentClient` the session produces:

  ```ts
  let last: AgentClient<C> | null = null;
  while (!session.isDestroyed()) {
    const client = await waitForNextClient(session, last);
    last = client;
    await Promise.allSettled([pumpSystem(client), pumpMetrics(client)]);
  }
  ```

  When the link dies, the pumps' `for await` loops settle, the loop re-enters, `waitForNextClient` blocks until the session's `scheduleReconnect` produces a new client, pumps restart against it.

## Computing `drvPath` for the target

> **One-shot CLI?** Reach for `dialAgentOnce` instead of hand-rolling any of
> this. It centralizes the env-map parse + `resolveSystem` lookup + the
> `pin → probe → markConnected → dispose` lifecycle for the `--host` shape:
>
> ```ts
> const { client, dispose } = await dialAgentOnce<typeof contract>({
>   host,
>   binary: "my-agent",
>   envVar: "MY_AGENT_DRVS_JSON",
>   agentDrvsJson: process.env.MY_AGENT_DRVS_JSON,
>   drvNoun: "my-agent",
>   // one cheap RPC proves the link; the surface client is namespaced under
>   // `surface` (e.g. kaval-tui: `c.surface.system.heartbeat({})`, arivu-tui:
>   // the first frame of `c.surface.version.get({})`).
>   probe: (c) => c.surface.system.heartbeat({}),
> });
> ```
>
> The manual recipe below is for **long-lived** consumers that want the
> session's `onState`/`markConnected` seam directly (e.g. a parent server
> mirroring streams into its own surface).

The package solves the probe half of this — `resolveSystem(host)` asks the host's own Nix for `builtins.currentSystem` (locally or over `ssh`) and returns the nix-system string. The caller owns the policy of mapping that system to a derivation path; the typical shape is a JSON map baked at build time and looked up at runtime:

```ts
import { resolveSystem, getHostSession } from "@kolu/surface-nix-host";

// drvBySystem usually comes from a build-time env var or flake attr:
//   { "x86_64-linux": "/nix/store/…-my-agent.drv",
//     "aarch64-linux": "/nix/store/…-my-agent.drv",
//     "aarch64-darwin": "/nix/store/…-my-agent.drv" }
const drvBySystem: Record<string, string> = JSON.parse(
  process.env.MY_AGENT_DRVS_JSON ?? "{}",
);

async function resolveDrv(host: string): Promise<string> {
  const sys = await resolveSystem(host);
  const drv = drvBySystem[sys];
  if (!drv) {
    throw new Error(`${host}: no .drv baked for ${sys}`);
  }
  return drv;
}

// Pass the probe as `resolveDrvPath` — do NOT `await resolveDrv(host)` at
// the call site. Eager resolution runs the ssh probe *before* the session
// exists, so an unreachable host throws out of construction. Deferred, the
// probe runs inside the spawn cycle: an unreachable host is a `"network"`
// fault that flows through `disconnected → backoff → disconnected → …`,
// retrying indefinitely until it's reachable again (never terminal — see
// the reconnect-terminates note above), instead of crashing the caller.
const session = getHostSession({
  host,
  resolveDrvPath: () => resolveDrv(host),
  binary: "my-agent",
});
```

The bash equivalent for shell-only contexts (`just dev` recipes) is `sys=$(ssh "$host" nix-instantiate --eval --expr builtins.currentSystem)` with the surrounding quotes stripped — but the TypeScript consumer should reach for `resolveSystem`. The package still has no opinion on how the `drvBySystem` map gets populated: bake it via `builtins.toJSON` at flake-eval time, load it from a config file, or compute it at runtime — `resolveSystem` works for any of them.

## Status

Pre-1.0; API may shift. Used by [`packages/surface/example/remote-process-monitor/`](../surface/example/remote-process-monitor/) and (planned) `kolu`'s `RemoteTerminalBackend` (R-2 of [juspay/kolu#951](https://github.com/juspay/kolu/issues/951)).
