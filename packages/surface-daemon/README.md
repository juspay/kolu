# @kolu/surface-daemon

The **durable-daemon spine**: the lifecycle mechanism every long-lived process that owns a unix socket and serves a typed [`@kolu/surface`](../surface/README.md) repeats — both halves of the daemon *binary*. **Serve it** — pid-gated single-instance entry, a `gate → serve → teardown` skeleton, a lifetime policy knob. And **front it** over ssh-stdio so a remote session outlives the link (`frontDaemonOverStdio`, the durable counterpart to `serveOverStdio`). A zero-`kolu-*`-dependency package so it can be hashed whole into a daemon's staleKey and, eventually, graduate.

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
| `gatePid(gatePath)` / `isHolderLive(pid)` | The gate's file format, single-sourced as two daemon-running primitives — the pid parse and the liveness probe. The supervisor (`@kolu/surface-daemon-supervisor`, from B2) composes them where it lives (`isHolderLive(gatePid(path))`) for a live-only read, so no supervisor reader crosses into this daemon-hashed package. |
| `daemonMain(spec)` | The `gate → serve → teardown` skeleton. `spec` = `{ gatePath, socketPath, router, lifetime, log, signal?, onReady? }`; resolves a `DaemonExit`. |
| `frontDaemonOverStdio(opts)` | The **front half**: adopt-or-spawn the gate-held daemon at `socketPath` and raw-byte-relay this process's stdio onto its socket, so a remote session survives the ssh link. The durable counterpart to `serveOverStdio` (see below). |
| `reExecAsDetachedDaemon(opts)` | The same-binary daemon-spawn kaval supplies as its `spawnDaemon` (the front has no built-in default — `spawnDaemon` is required): re-exec this process minus the front flag (`stripArgs`) as the single-process `node --import` form, detached, so SIGTERM reaches the daemon and it survives the link's SIGHUP. |
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

## Fronting it over stdio — the durable counterpart to `serveOverStdio`

A surface daemon is reached *locally* over its unix socket. To reach it *remotely* and have the session **survive the link**, `frontDaemonOverStdio` runs a per-link proxy on the host (`ssh <host> <binary> --stdio`) that:

1. **adopts-or-spawns** the gate-held daemon — connect to the one already serving `socketPath`; else call `spawnDaemon` and poll until it binds (idempotent under the daemon's own pid-gate, so a racing second link is a clean no-op), then
2. **raw-byte-relays** this process's stdin⇄stdout onto that socket. No decode: a `serveOverUnixSocket` listener and a client's `stdioLink` carry the *same* `@kolu/surface` peer framing, so the proxy is contract-blind — `node:net` only, no surface/oRPC import — which is what keeps a consumer's daemon-closure allow-list intact.

It is the **durable** sibling of `@kolu/surface`'s `serveOverStdio`: where `serveOverStdio` makes the `--stdio` process *be* the server (ephemeral — a fresh one per link, gone when the link drops, right for a re-run-fresh agent like `mini-ci` or drishti), `frontDaemonOverStdio` fronts a *separate, gate-held* daemon whose state outlives the link — `dtach`/`abduco` for any surface daemon. kaval is the first consumer (`kaval --stdio`, R-2's `kaval-tui --host`); a survivable CI run and a remote REPL are the anticipated next ones.

`reExecAsDetachedDaemon` is the same-binary spawn strategy kaval supplies as its `spawnDaemon` (the front takes an opaque `spawnDaemon` — required, no built-in default — so a systemd-supervised consumer can hand in its own): re-exec this process minus the front flag (`["--stdio"]`) as the signal-deliverable single-process `node --import <loader> bin.ts` form — *not* a `tsx bin.ts` CLI fork that swallows `SIGTERM` and leaks the socket + gate — `detached` + `stdio:"ignore"` + `unref` so it survives the SIGHUP that closes the link.

```ts
import { frontDaemonOverStdio, reExecAsDetachedDaemon } from "@kolu/surface-daemon";

// kaval's `--stdio` is a thin composition: kaval resolves its own socket path
// and supplies the daemon-spawn; the relay + adopt-or-spawn is the primitive.
await frontDaemonOverStdio({
  socketPath: getPtyHostSocketPath(socketOverride, "kaval"),
  spawnDaemon: () => reExecAsDetachedDaemon({ stripArgs: ["--stdio"] }),
});
```

## What deliberately does *not* live here

The line between **spine** (extract) and **soul** (keep per-program) is what makes this package safe to hash whole into a staleKey:

- **No supervisor.** The endpoint state machine, the spawn / `waitForPidGone` drivers, and the composed restart run in the *client* process, not the daemon. They are born in kaval B2 as a **separate** `@kolu/surface-daemon-supervisor` package — not a `/supervisor` subpath of this one, so the package boundary is the staleKey boundary (Atlas: surface-daemon, "a separate supervisor package"). A supervisor file *here* would flip kaval's staleKey on every supervisor-only edit — the over-prompting failure A2 killed, reborn.
- **No survival, adoption, or reconciliation.** kaval's B3 soul — resurrecting live PTY fds across a restart — is irreplaceable kernel state with no analogue in `odu serve` (whose runs are replaceable). It never becomes spine.
- **No env or spawn policy.** B0 moved all of that client-side; the daemon serves the router it is handed and asks no questions.

## Invariant this package carries

> **Only code in the daemon *binary* — serve *and* front — may live here.** `@kolu/surface-daemon`'s whole `src/` is hashed (alongside kaval and `terminal-protocol`) into kaval's build id (`default.nix`'s `kavalSrc`, pinned by `kaval/src/buildId.closure.test.ts`). That whole-package hash is a correct staleKey contribution because everything in it is part of the one daemon binary a restart loads: the serve half (`daemonMain`/pid-gate) runs *in* the daemon process, and the front half (`frontDaemonOverStdio`) runs in the per-link proxy reached from that binary's `--stdio` dispatch — both are reached from the consumer's daemon entries (`bin.ts`/`index.ts`). What stays out is the **supervisor** half — it runs in the *client* process, never the daemon, so it lives in its **own** `@kolu/surface-daemon-supervisor` package (born in kaval B2, not a subpath here): the package boundary is the hash boundary, with no subdir glob to mis-scope.
