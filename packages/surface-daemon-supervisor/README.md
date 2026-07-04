# @kolu/surface-daemon-supervisor

The **supervisor half** of the surface-daemon spine: the mechanism a process uses to spawn, watch, and recycle a surface daemon it does *not* run in — the mirror of [`@kolu/surface-daemon`](../surface-daemon/README.md) (the daemon half). A zero-`kolu-*`-dependency package, deliberately **not** a staleKey root (it runs in the client process, never the daemon), so the second tenant (`odu serve`) reuses it without dragging kolu in.

It exists because the same two programs that share the daemon half also share its mirror: [kaval](../../docs/atlas/src/content/atlas/pty-daemon.mdx) (kolu-server spawns and watches the PTY daemon, B2/B3) and `odu serve` ([odu-runner](../../docs/atlas/src/content/atlas/odu-runner.mdx), the odu CLI spawns and watches the CI coordinator) both need an endpoint state machine, a reap-wait, a survivable spawn, and a composed restart. The design and the mechanism/soul line live in the Atlas note [`surface-daemon`](../../docs/atlas/src/content/atlas/surface-daemon.mdx).

Beside the endpoint it carries the **convergence kit** (`convergence/`, #L3): the shared answer to *"the running daemon is not the one I shipped — detect it, decide, converge it"*, with **policy as the parameter**. kaval and padi each hand-rolled this; the kit lifts only the **decision** (the endpoint mechanism is untouched, byte-identical per daemon) into a pure `decide()` table each daemon declares a `ConvergencePolicy` into (kaval: `recycle-on-skew` + `nudge-human`; padi: `drain-newer-else-refuse` + `drain-and-replace`). See [The convergence kit](#the-convergence-kit) below.

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
| `converge(args)` | The convergence-kit orchestrator: probe the running daemon's identity, ask `decide`, enact via the endpoint's **existing** boot methods, return a typed `ConvergenceOutcome`. Bind method is **policy-driven** — a `recycle`-on-skew daemon binds via `adoptOrEnsure` on every path (so a skew recycles wherever the endpoint finds it, incl. the adopt-hint the probe never saw); a `refuse`/`drain` daemon via `adoptOrSpawnOrRefuse`. |
| `decide(baked, running\|null, policy, fenceSpent)` | The **pure** decision fold (zero I/O) — the policy TABLE, unit-tested directly. Absent / off-nix / fence cases are table rows, not special branches. |
| `ConvergencePolicy<Cap>` / `createBuildDrainFence()` / `outcomeAdopted(outcome)` | The declared policy (per trigger: contract-skew / build-mismatch), the once-per-boot build-drain fence, and the uniform "was a survivor adopted?" reader across every outcome kind. |
| `ConvergenceIdentity` · `contractIsNewer` / `contractIsCompatible` / `buildIdMatches` | (Re-exported from `@kolu/surface-daemon`, where they live to keep this package `@kolu/surface`-free.) The two convergence axes: contract versions are **ordered**; build ids are **match-only**, no ordering. |

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
  connect: connectKaval, // direct createConnection + stdioLink + system.version handshake (owns the socket 'close' event)
  log,
  onStatus: (hostId, status) => publishDaemonStatus(hostId, status),
});
await restart(endpoint, NO_SURVIVAL_STEPS); // B2 boot = recycle with degenerate steps

// `odu serve` (S2) substitutes a per-repo gate, its own connect/handshake,
// and `{ binPath: oduBin, unitPrefix: "odu-serve", ... }` — same endpoint.
```

## The convergence kit — policy as the parameter

`converge()` sits *over* the endpoint. The endpoint already parameterizes the **contract** axis by boot-method choice (`adoptOrEnsure` = recycle-on-skew, `adoptOrSpawnOrRefuse` = refuse-on-skew); the kit adds the **build** axis (a same-contract closure change) and a shared, exhaustively-tested **decision table** both daemons declare into — so a new daemon gets convergence by *declaring a policy*, not re-deriving one.

```
       converge({ endpoint, baked, probe, policy, buildFence })
                 │
       probe() ── read running identity over a VERSION-AGNOSTIC channel   ← Pin 3
                 │
       decide(baked, running, policy, fenceSpent) ── PURE, zero I/O       ← the policy TABLE
                 │
       enact via the endpoint's EXISTING boot methods (bind = policy-driven)
                 │
       ConvergenceOutcome  ── the CALLER wires it to its own surfaces/logs (the kit
                              detects + decides; the caller enacts what it owns —
                              padi's #1670 breadcrumb, kaval's currency nudge)
```

Three make-illegal-unrepresentable pins: **(1)** the `drain-and-replace` policy arms exist only for a **drain-capable** handshake — a drainless daemon (kaval) declaring one is a *compile error*; **(2)** contract versions are ordered, build ids are **match-only** with no ordering exported (store hashes don't order); **(3)** identity is read before the versioned handshake, so it stays reachable at a skew. The design lives in the Atlas note `padi-cleanup` (L3).

## What deliberately does *not* live here

- **No `localDriver` values.** The kaval binary path, the dev-flag exec-arg filter, the `--setenv` set, the socket/gate paths, and the unit prefix are kolu's soul — they live in `packages/server/src/ptyHost/localDriver.ts` and arrive as `cfg`. The package physically cannot reach them: the dependency-closure test (`deps.closure.test.ts`) fails on any `kolu-*` edge.
- **No contract / handshake.** `connect` is injected; the endpoint never imports a surface contract, so it stays generic over the client and identity types.
- **No survival.** `restart`'s steps are degenerate in B2 — adoption, session capture, and reconciliation (B3's soul) are filled in by the caller, never built in.

## Invariant this package carries

> **It runs in the client, never the daemon — so it is never a staleKey root.** A change here cannot change what a daemon restart would load (that is the daemon half's job), so `default.nix` hashes none of it and `kaval/src/buildId.closure.test.ts` never reaches it. The mirror invariant of `@kolu/surface-daemon`'s "only daemon-*binary* code lives here" (its serve + front halves): only *supervising* code lives here, and only kolu-free supervising code at that.
