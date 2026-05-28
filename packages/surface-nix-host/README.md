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
  drvPath: process.env.MY_AGENT_DRV!,        // operator-supplied; the derivation of
                                              // the agent binary for the *target* arch
  binary: "my-agent",                        // exe name inside the realised closure
});

// Subscribe to lifecycle state (snapshot-then-delta).
session.onState((s) => console.log(s.connection));
//   "copying"   → "connecting" → "connected"
//   on drop:    → "disconnected" → "copying" → … (exp backoff, capped attempts)

// Pin the session for the parent's lifetime; obtain the typed client.
const client = await session.pin();
const sys = client.system.get({});           // typed oRPC — same shape your browser uses
```

## What it's NOT

- **Not a transport.** That's [`@kolu/surface/links/stdio`](../surface/src/links/stdio.ts). This package sits *on top of* the stdio link and adds: process supervision (spawn/respawn ssh), `.drv` provisioning (the Nix bit), and a reactive state cell for the connection's own lifecycle.
- **Not a Nix utility.** `provisionAgent` is purposely minimal — `nix copy --derivation`, then `ssh $host nix-store --realise`, then return the resulting path. If you want richer flake handling (e.g. resolve a flake ref to a `.drv` at startup), compute the `.drv` outside and pass `{ drvPath }`.
- **Not opinionated about UI.** The package returns a typed RPC client. Mirroring its streams into your parent server's local surface (so the browser can consume them) is the consumer's job. See the [`remote-process-monitor` example](../surface/example/remote-process-monitor/src/server/router.ts) for the canonical bridge pattern.

## Why Nix (locked-in)

Cross-arch deployment is the load-bearing problem this package solves. Parent on darwin, target on linux — or vice versa. A locally-built closure has the parent's CPU architecture baked into its binaries; `nix copy` can't smuggle it across.

The `.drv` ships **build instructions** (platform-neutral) rather than build outputs. The remote realises the derivation on its own architecture, producing target-arch-correct binaries.

```
parent: nix eval --raw .#packages.<remote-system>.<agent>.drvPath
        └── caller's responsibility — typically depends on `ssh $host uname -ms`
parent: nix copy --derivation --to ssh-ng://$host $drvPath
remote: nix-store --realise $drvPath  →  /nix/store/...-agent
parent: ssh $host $agentPath/bin/<binary> --stdio
```

**Nix is the contract, not the implementation.** No tarball, Docker, or prebuilt-binary fallback exists or will. The whole point of this package is "use Nix for cross-arch deployment of typed stdio agents"; consumers that don't want Nix should pick a different transport layer.

Remote-side requirement: the parent's user must be in `trusted-users` in the remote's `nix.conf` so the daemon accepts the unsigned closure. Without that, `nix copy` rejects.

## The pieces

| Export | Role |
|---|---|
| `HostSession<C>` | One ssh subprocess per `(host, drvPath, binary)`. Ref-counted. State machine. Survives drops via `scheduleReconnect`. Snapshot-then-delta `onState`. Generic over the contract type `C`. |
| `getHostSession<C>(opts)` | Pool lookup — repeated calls with the same `(host, drvPath, binary)` return the same session. |
| `destroyAllSessions()` | Tear down every pooled session. Call on parent shutdown. |
| `provisionAgent({ host, drvPath, onProgress })` | Ship the `.drv` to the host (skipped for localhost), `nix-store --realise` it there, return the realised output path. Progress lines forwarded to `onProgress`. |
| `mirrorRemoteCollection<K,V>(opts)` | Helper: bridge a remote `Collection<K,V>` to a local one — keys stream + per-key value streams, with abort cleanup on key departure. |
| `waitForNextClient(session, previous)` | Helper for the consumer's reconnect-loop: blocks until the session produces a *fresh* `AgentClient<C>` (post-reconnect). |
| `buildAgentCommand({ host, agentPath, binary })` | Compute the spawn argv for an agent binary on a given host. Used internally; exported for consumers that need to invoke the agent directly (e.g. one-shot subprocess tests). |
| `resolveSystem(host)` | Run `uname -ms` against `host` (locally for `isLocalHost`, over `ssh` otherwise) and map the output to a nix-system string. Throws on unsupported uname output. Pairs with a per-system `.drv` map the caller builds at its own build time. |
| `UNAME_TO_NIX_SYSTEM`, `unameToNixSystem(out)` | The mapping table + pure helper underneath `resolveSystem`. Exported so a consumer can pre-validate its `.drv` map keys against the table at startup. |
| `runCapture(cmd, args, onProgress)`, `runProgress(cmd, args, onProgress)` | Spawn-and-await helpers with consistent close-event-flush semantics. Used internally by `provisionAgent` and `resolveSystem`; exported so consumers can avoid re-rolling the same event-wiring dance. |
| `isLocalHost(host)`, `forEachLine(chunk, cb)` | Small utilities shared by `nixCopy` and `HostSession`. |

## Lifecycle invariants

- **Snapshot-then-delta on `onState`**: a listener attached at any point sees the current state synchronously before any subsequent transitions. Matches the contract `@kolu/surface`'s `useCell` consumers expect.
- **`pin()` vs `acquire()`**:
  - `pin()` is the parent-lifetime intent — bumps `refCount` unconditionally so the session keeps trying to reconnect even if the first spawn fails.
  - `acquire()` is scoped — bumps `refCount` only on successful spawn. A failed provisioning leaves `refCount` untouched (no `try/finally` leak in the caller).
- **Reconnect terminates**: bounded by `MAX_CONSECUTIVE_FAILURES` (currently 5). After that many failed spawns in a row, the session surfaces a permanent `"disconnected"` state with the last error — so a misconfigured target fails loudly instead of spamming forever.
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

The package solves the probe half of this — `resolveSystem(host)` runs `uname -ms` (locally or over `ssh`) and returns a nix-system string. The caller owns the policy of mapping that system to a derivation path; the typical shape is a JSON map baked at build time and looked up at runtime:

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

const session = getHostSession({
  host,
  drvPath: await resolveDrv(host),
  binary: "my-agent",
});
```

The bash equivalent (single-host shell scripts, `just dev` recipes) is now a one-liner — `sys=$(ssh "$host" uname -ms)` plus a `case` — but the TypeScript consumer should reach for `resolveSystem` over reimplementing the table. The package still has no opinion on how the `drvBySystem` map gets populated: bake it via `builtins.toJSON` at flake-eval time, load it from a config file, or compute it at runtime — `resolveSystem` works for any of them.

## Status

Pre-1.0; API may shift. Used by [`packages/surface/example/remote-process-monitor/`](../surface/example/remote-process-monitor/) and (planned) `kolu`'s `RemoteTerminalBackend` (R-2 of [juspay/kolu#951](https://github.com/juspay/kolu/issues/951)).
