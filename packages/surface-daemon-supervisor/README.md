# @kolu/surface-daemon-supervisor

The **supervisor half** of the surface-daemon spine: the mechanism a process uses to spawn, watch, and recycle a surface daemon it does *not* run in — the mirror of [`@kolu/surface-daemon`](../surface-daemon/README.md) (the daemon half). A zero-`kolu-*`-dependency package, deliberately **not** a staleKey root (it runs in the client process, never the daemon), so the second tenant (`odu serve`) reuses it without dragging kolu in.

It exists because the same two programs that share the daemon half also share its mirror: [kaval](../../docs/atlas/src/content/atlas/pty-daemon.html) (kolu-server spawns and watches the PTY daemon, B2/B3) and `odu serve` ([odu-runner](../../docs/atlas/src/content/atlas/odu-runner.html), the odu CLI spawns and watches the CI coordinator) both need an endpoint state machine, a reap-wait, a survivable spawn, and a composed restart. The design and the mechanism/soul line live in the Atlas note [`surface-daemon`](../../docs/atlas/src/content/atlas/surface-daemon.html).

## What's in scope — the incantation, not the values

```
       createEndpoint({ driver, connect, gatePath, socketPath, onStatus })
                 │
       ensure()  │  boot policy = ALWAYS RECYCLE
                 ▼
       gatePid + isHolderLive ─ live survivor? ─ kill ─ waitForPidGone   (composed from @kolu/surface-daemon)
                 │
                 ▼
       driver.spawn() ── survivable-spawn: INVOCATION_ID gate → systemd-run --user / detached+unref
                 │
                 ▼
       waitForSocket ── connect() ── handshake (the caller's soul)
                 │                          │ skew/transport → dead
                 ▼                          ▼
       onStatus(connected, identity, startedAt)   onStatus(dead)
                 │
       daemon dies mid-session → onClose → onStatus(degraded)
```

Everything program-specific arrives as a parameter:

- the **driver** — `survivableSpawnDriver({ binPath, args, env, unitPrefix })` ships here as the default, but *which* binary, args, and forwarded env are the caller's soul;
- the **`connect`** — dials the socket and runs the contract-version handshake; what the contract is and what `identity` means are the caller's soul (the endpoint is generic over both);
- the **`gatePath`/`socketPath`** — the scope key (per-user for kaval, per-repo for `odu serve`);
- **`onStatus`** — the per-host transition report the caller's surface projects so the UI never lies.

## Public API

| Export | What it is |
| --- | --- |
| `createEndpoint(spec)` | The endpoint state machine: `connecting → connected \| dead`, then `connected → degraded` if the daemon dies. `ensure()` runs the always-recycle boot; `current()` is the live connection. Generic over the client `C` and identity `I`. |
| `survivableSpawnDriver(cfg, deps?)` | The default `DaemonDriver`: the `INVOCATION_ID` gate (systemd-run `--user` under a service, detached `+unref` otherwise), per-spawn unique unit names, absolute-path discipline. `cfg` is `{ binPath, args, env, unitPrefix }`; `deps` injects the env/spawn/unit-suffix seams for tests. |
| `restart(endpoint, steps)` | The composed `capture → drain → recycle → reattach` sequence. All steps are required by the type even when degenerate — B2's boot recycle passes no-ops; B3 fills them with the real session capture + adoption. |
| `waitForPidGone(pid, opts?)` | Poll `isHolderLive` until a pid is reaped (`ESRCH`) or the load-aware ceiling (default 120s) passes. The reap-wait the recycle blocks on so a respawn never races a still-live gate holder. |

```ts
import {
  createEndpoint,
  survivableSpawnDriver,
  restart,
} from "@kolu/surface-daemon-supervisor";

// kolu-server's composition (the soul fills in the values):
const endpoint = createEndpoint<PtyHostClient, PtyHostIdentity>({
  hostId: "local",
  gatePath,
  socketPath,
  driver: survivableSpawnDriver({
    binPath: kavalBinPath, // resolved from the kolu closure
    args: [], // let kaval pick its own default socket
    env: { XDG_RUNTIME_DIR }, // the --setenv set
    unitPrefix: "kaval",
  }),
  connect: connectKaval, // unixSocketLink + system.version handshake
  log,
  onStatus: (hostId, status) => publishDaemonStatus(hostId, status),
});
await restart(endpoint, NO_SURVIVAL_STEPS); // B2 boot = recycle with degenerate steps

// `odu serve` (S2) substitutes a per-repo gate, its own connect/handshake,
// and `{ binPath: oduBin, unitPrefix: "odu-serve", ... }` — same endpoint.
```

## What deliberately does *not* live here

- **No `localDriver` values.** The kaval binary path, the dev-flag exec-arg filter, the `--setenv` set, the socket/gate paths, and the unit prefix are kolu's soul — they live in `packages/server/src/ptyHost/localDriver.ts` and arrive as `cfg`. The package physically cannot reach them: the dependency-closure test (`deps.closure.test.ts`) fails on any `kolu-*` edge.
- **No contract / handshake.** `connect` is injected; the endpoint never imports a surface contract, so it stays generic over the client and identity types.
- **No survival.** `restart`'s steps are degenerate in B2 — adoption, session capture, and reconciliation (B3's soul) are filled in by the caller, never built in.

## Invariant this package carries

> **It runs in the client, never the daemon — so it is never a staleKey root.** A change here cannot change what a daemon restart would load (that is the daemon half's job), so `default.nix` hashes none of it and `kaval/src/buildId.closure.test.ts` never reaches it. The mirror invariant of `@kolu/surface-daemon`'s "only daemon-running code lives here": only *supervising* code lives here, and only kolu-free supervising code at that.
