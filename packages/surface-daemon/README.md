# @kolu/surface-daemon

The **daemon half** of the surface-daemon spine: the lifecycle mechanism every long-lived process that owns a unix socket and serves a typed [`@kolu/surface`](../surface/README.md) repeats — pid-gated single-instance entry, a `gate → serve → teardown` skeleton, and a lifetime policy knob. A zero-`kolu-*`-dependency package so it can be hashed whole into a daemon's staleKey and, eventually, graduate.

It exists because two programs arrived at the identical machinery from opposite ends: [kaval](../../docs/atlas/src/content/atlas/pty-daemon.html) (the PTY daemon, B1/B2) and `odu serve` ([odu-runner](../../docs/atlas/src/content/atlas/odu-runner.html), the long-lived CI coordinator) both need a single-instance gate, a daemon entry sequence, and a socket that outlives its clients. Rather than hand-roll a second copy, the mechanism is named here once. The design, the mechanism/policy line, and the extraction sequencing live in the Atlas note [`surface-daemon`](../../docs/atlas/src/content/atlas/surface-daemon.html).

## What's in scope — mechanism, not soul

```
       acquirePidGate(gatePath)          ── atomic single-instance claim
                 │  held? → exit 0 (another live daemon serves this scope)
                 ▼
       serve router over socketPath      ── @kolu/surface unix-socket listener
                 │  won't bind? → serve-failed
                 ▼
       wait for lifetime to end          ── signal · abort · idle (idleTimeout)
                 │
                 ▼
       close socket · release gate · return DaemonExit
```

`daemonMain` is the skeleton; everything program-specific arrives as a parameter — the **scope key** (`gatePath`: per-user for kaval, per-repo for `odu serve`), the **socket path**, the **router** to serve, and the **lifetime** (`forever` for a PTY daemon an idle timeout would wrongly kill; `idleTimeout` for a CI coordinator that may exit when quiet). It never calls `process.exit` — it returns a `DaemonExit` the bin maps to a code — so the whole lifecycle is drivable in-process from a test.

## Public API

| Export | What it is |
| --- | --- |
| `acquirePidGate(gatePath)` | The daemon side of the gate: atomic claim via `link(2)`, returns `{ kind: "acquired", release }` or `{ kind: "held", pid }` (a live instance already serves — exit 0). |
| `gatePid(gatePath)` / `isHolderLive(pid)` | The gate's file format, single-sourced as two daemon-running primitives — the pid parse and the liveness probe. The supervisor (kolu-server, from B2) composes them where it lives (`isHolderLive(gatePid(path))`) for a live-only read, so no supervisor reader crosses into this daemon-hashed package. |
| `daemonMain(spec)` | The `gate → serve → teardown` skeleton. `spec` = `{ gatePath, socketPath, router, lifetime, log, signal?, onReady? }`; resolves a `DaemonExit`. |
| `Logger` | The structural logging contract (so the package carries no `kolu-*` dep). |

```ts
import { daemonMain } from "@kolu/surface-daemon";

// kaval's entire entry is a composition over the skeleton:
const exit = await daemonMain({
  gatePath: join(runtimeDir, "kaval.pid"),
  socketPath: getPtyHostSocketPath(socketOverride, "kaval"),
  router: createInProcessPtyHost({ log, rcDir }).servedRouter,
  lifetime: { kind: "forever" },
  log,
});
// `odu serve` (S2) substitutes a per-repo gate, its own router, and
// `{ kind: "idleTimeout", ms, isIdle }` — same skeleton, opposite policy.
```

## What deliberately does *not* live here

The line between **spine** (extract) and **soul** (keep per-program) is what makes this package safe to hash whole into a staleKey:

- **No supervisor.** The endpoint state machine, the spawn / `waitForPidGone` drivers, and the composed restart run in the *client* process, not the daemon. They are built server-side in kaval B2 (`packages/server/src/ptyHost/`) and extract into a **separate** `@kolu/surface-daemon-supervisor` package at S1 — not a `/supervisor` subpath of this one, so the package boundary is the staleKey boundary (Atlas: surface-daemon, "a separate supervisor package"). A supervisor file *here* would flip kaval's staleKey on every supervisor-only edit — the over-prompting failure A2 killed, reborn.
- **No survival, adoption, or reconciliation.** kaval's B3 soul — resurrecting live PTY fds across a restart — is irreplaceable kernel state with no analogue in `odu serve` (whose runs are replaceable). It never becomes spine.
- **No env or spawn policy.** B0 moved all of that client-side; the daemon serves the router it is handed and asks no questions.

## Invariant this package carries

> **Only code that runs inside the daemon process may live here.** `@kolu/surface-daemon`'s whole `src/` is hashed (alongside kaval and `terminal-protocol`) into kaval's build id (`default.nix`'s `kavalSrc`, pinned by `kaval/src/buildId.closure.test.ts`). That whole-package hash is a correct staleKey contribution *only* while everything in it is daemon-running code — so the supervisor half lives server-side until S1, when it extracts into its **own** `@kolu/surface-daemon-supervisor` package (not a subpath here): the package boundary becomes the hash boundary, with no subdir glob to mis-scope.
