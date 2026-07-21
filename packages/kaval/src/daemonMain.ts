/**
 * kaval's daemon composition — a ~thin wrapper over `@kolu/surface-daemon`'s
 * `daemonMain` skeleton. This is the "soul" side of the spine/soul line: it
 * supplies kaval's choices (where its gate and socket live, its own rcDir, the
 * pty-host router, the `forever` lifetime) and nothing more. The mechanism —
 * gate → serve → teardown — lives in the spine, where `odu serve` reuses it.
 *
 * kaval computes its OWN paths in-package: it does NOT import kolu-server's
 * `koluRoot`. A standalone daemon owns its disk. B0 already removed any env
 * role here — there is no shell/env-application step; the daemon serves the
 * fully-specified spawns it is handed.
 */

import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { startHeapDiagnostics } from "@kolu/heap-diag";
import {
  acquirePidGate,
  type DaemonExit,
  daemonLifetimeFromEnv,
  daemonMain,
  lifetimeInfo,
  type Logger,
} from "@kolu/surface-daemon";
import { createInProcessPtyHost } from "./inProcessPtyHost.ts";
import { selfRole, writeEphemeralRole } from "./role.ts";
import {
  getPtyHostSocketPath,
  KAVAL_GATE_FILE,
  KAVAL_NS_PREFIX,
  readStateRootManifest,
} from "./socketPath.ts";

/** How often the daemon checks whether its state-root still exists. Fixed, not a
 *  knob — a vanished state-root is permanent, so a lazy cadence reaps the zombie
 *  without busy-watching. (Tests inject a small value via
 *  {@link KavalDaemonOptions.stateRootPollMs}.) */
const STATE_ROOT_POLL_MS = 5_000;

/** Consecutive missed checks before self-exit. A single miss could be a transient
 *  (a brief unmount); a real deletion stays gone, so a second confirm costs one
 *  interval and rules the transient out. */
const STATE_ROOT_MISSES_TO_EXIT = 2;

export interface KavalDaemonOptions {
  /** Override the default socket path (`--socket`). The gate and rcDir are
   *  derived as siblings of it, so one flag relocates the whole rendezvous. */
  socketOverride?: string;
  log: Logger;
  /** Forwarded to the spine's `daemonMain` — an external stop signal (tests;
   *  a parent tearing the daemon down without a real OS signal). */
  signal?: AbortSignal;
  /** Forwarded readiness hook — fired once the socket is listening. */
  onReady?: (info: { socketPath: string; pid: number }) => void;
  /** State-root liveness poll interval, in ms. A TEST seam (like `signal`) —
   *  production omits it and uses {@link STATE_ROOT_POLL_MS}. */
  stateRootPollMs?: number;
}

/** Run the kaval daemon to completion: own a PTY host, serve `ptyHostSurface`
 *  over kaval's socket, and stay up forever (until a signal/abort). Resolves
 *  the spine's `DaemonExit` for the bin to map to an exit code. */
export function runKavalDaemon(opts: KavalDaemonOptions): Promise<DaemonExit> {
  const { log } = opts;
  // kaval's rendezvous lives under its own app namespace, so kaval-tui's
  // default (`getPtyHostSocketPath(undefined, "kaval")`) reaches it with no
  // flags. The gate and the per-PTY init-file dir sit beside the socket in the
  // same private (0700) directory.
  const socketPath = getPtyHostSocketPath(opts.socketOverride, KAVAL_NS_PREFIX);
  const dir = dirname(socketPath);
  const gatePath = join(dir, KAVAL_GATE_FILE);
  const rcDir = join(dir, "rc");

  // ── Claim the single-instance gate FIRST, before ANY boot side effect (F2,
  // juspay/kolu#1334) ── mirrors padi's gate-first `daemonMain`. The ephemeral role
  // stamp used to run BEFORE the gate was acquired (inside `daemonMain`), so a dev
  // kaval aimed at a live PRODUCTION digest would overwrite `role → dev`, THEN lose
  // the gate and exit — leaving the prod holder's dir reading `dev`, and the adopt/
  // kill guard wrongly permitting a dev process to SIGTERM it. Acquiring the gate up
  // top and stamping ONLY as the winning holder makes that unconstructible. The gate's
  // own `acquirePidGate` mkdir's the private (0700) rendezvous dir, so the role write
  // below never ENOENT-crashes and no separate mkdir is needed.
  const gate = acquirePidGate(gatePath);
  if (gate.kind === "held") {
    log.info(
      { gatePath, pid: gate.pid },
      "kaval already running for this rendezvous; yielding to the live instance",
    );
    return Promise.resolve({ kind: "already-running", pid: gate.pid });
  }
  if (gate.kind === "dir-not-private") {
    log.error(
      { gatePath, dir: gate.dir },
      "kaval gate directory is not private (owner-only); refusing to start",
    );
    return Promise.resolve({ kind: "serve-failed", detail: "dir-not-private" });
  }

  // ── Hold the gate + role stamp + any partial runtime under try/catch until the
  // spine's `daemonMain` takes cleanup ownership (F17, juspay/kolu#1334) ── Moving the
  // gate acquire up top (F2) opened an ownership GAP: a throw AFTER acquire but BEFORE
  // `daemonMain` is handed the gate (an EACCES/EIO/ENOSPC role write, a malformed
  // `KOLU_DAEMON_BIND_PID` in `daemonLifetimeFromEnv`, a ptyHost create fault, a watcher
  // fault) would leak the gate — still naming THIS live pid — plus a half-built ptyHost,
  // so an IN-PROCESS caller that catches the error could never retry (the next launch
  // reads the gate as "already running"). Release the IDEMPOTENT gate and AWAIT the
  // partial runtime's teardown on any pre-transfer throw, then re-raise. Once
  // `daemonMain` is handed the gate it owns release + teardown (its `.finally` below
  // disposes the watcher + ptyHost), so the transfer is the try's final `return`. Mirrors
  // padi's `runPadiDaemon`, whose `finally` disposes the served runtime on a
  // pre-transfer boot-step throw.
  let ptyHostForCleanup: ReturnType<typeof createInProcessPtyHost> | undefined;
  let stopWatchForCleanup: (() => void) | undefined;
  try {
    // Lock 2 role stamp (juspay/kolu#1334): the ephemeral role beside kaval's gate,
    // written by the WINNING holder BEFORE its socket serves, so the adopt/kill guard
    // reads this live kaval's true role. `KOLU_ROLE` is threaded server → padi → kaval,
    // so a production kaval stamps `production` and a dev one `dev`. Only the holder
    // writes it (a lost racer returned above), so a losing opposite-role launch can
    // never change the live holder's marker. It runs INSIDE the ownership try (F17): a
    // role-write throw (EACCES/EIO/ENOSPC) must release the gate, not leak it still
    // naming this live pid with the adopt/kill guard unable to read its role.
    writeEphemeralRole(dir, selfRole());

    // Resolve the lifetime ONCE, before the router is built: `forever` in
    // production; `boundToPid` when a harness/smoke run set `KOLU_DAEMON_BIND_PID`
    // (padi forwards it into kaval's env) so a test-spawned kaval dies with its run.
    // The same value is served on `system.version` (via `lifetimeInfo`) and handed
    // to `daemonMain` below, so the readout and the actual policy can't drift. A
    // MALFORMED value throws here — inside the gate-owning try, so the gate is freed.
    const lifetime = daemonLifetimeFromEnv({ kind: "forever" });

    const ptyHost = createInProcessPtyHost({
      log,
      rcDir,
      lifetime: lifetimeInfo(lifetime),
    });
    ptyHostForCleanup = ptyHost;
    const { servedRouter, terminalCount } = ptyHost;
    // Observe the surface runtime's `done`: the ptyHost surface declares no cell
    // connectors, so this is inert today (nothing faults) — wired so any future
    // owned fault reaches kaval's log instead of floating, without changing today's
    // behavior (fail-fast disposition unchanged; a fault does not kill the daemon).
    ptyHost.done.catch((err) =>
      log.error(
        { err: err instanceof Error ? err.message : String(err) },
        "pty-host surface runtime faulted",
      ),
    );

    // Interim heap instrumentation (no-op unless KOLU_DIAG_DIR is set) — logs the
    // heap curve with the live-terminal count (the leak's independent variable)
    // so the leak is visible in prod. See kaval-heap-oom.mdx.
    startHeapDiagnostics({
      log,
      snapshotPrefix: "kaval-baseline",
      // kaval owns its own log-event namespace ("kaval_diag*"), distinct from the
      // server's "diag*" so the two timelines don't collide when both are enabled.
      logPrefix: "kaval_diag",
      extraColumns: () => ({ terminals: terminalCount() }),
    });

    // Self-exit when our state-root is deleted out from under us. A padi-spawned
    // kaval's reason to exist is its padi's state-root (recorded in the manifest
    // padi writes beside our socket); when an e2e/nix-shell run's ephemeral
    // state-root is removed, the daemon it left behind has nothing to serve and
    // should reap itself rather than linger as a zombie. Fold the watcher's stop
    // signal together with the caller's own `signal` so whichever fires first tears
    // the daemon down through the spine's normal abort path (gate released, socket
    // unlinked) — consistent with the fail-fast doctrine: a vanished invariant is a
    // loud clean exit, not a silent degrade. A standalone kaval has no manifest and
    // is simply never watched.
    const controller = new AbortController();
    forwardAbort(opts.signal, controller);
    const stopWatch = watchStateRoot({
      dir,
      log,
      pollMs: opts.stateRootPollMs ?? STATE_ROOT_POLL_MS,
      onGone: () => controller.abort(),
    });
    stopWatchForCleanup = stopWatch;

    // Ownership TRANSFERS to the spine here: it serves under the gate and releases it
    // on teardown; the `.finally` disposes the watcher + ptyHost. Past this `return`
    // a failure is the spine's to clean up, not ours — so the catch below never runs.
    return daemonMain({
      gatePath,
      socketPath,
      router: servedRouter,
      // The same lifetime resolved above (reused, never re-derived) — so the value
      // served on `system.version` is provably the one governing the daemon.
      lifetime,
      log,
      signal: controller.signal,
      onReady: opts.onReady,
      // The gate claimed at the top (F2) — the spine serves under it and releases it on
      // teardown, rather than acquiring it here (too late — the role write would have
      // already run before the race was decided).
      gate,
    }).finally(() => {
      stopWatch();
      // Own the surface runtime's shutdown deterministically: once the daemon has
      // stopped serving, release its owned sources. AWAITING close here (the
      // `.finally` waits on the returned promise) — rather than a fire-and-forget
      // `void ptyHost.close()` off an abort listener that an ALREADY-aborted input
      // signal could register too late to ever fire — makes the release ordered
      // and unmissable. `close` disposes every live PTY (so a shutting-down daemon
      // reaps its node-pty children instead of orphaning them to init) and then
      // closes the surface runtime — the daemon owning its runtime's lifetime by
      // construction.
      return ptyHost.close();
    });
  } catch (err) {
    // A PRE-TRANSFER boot failure: dispose whatever partial runtime we built, then
    // release the idempotent gate so a retry in THIS process finds it available. Return
    // a rejected promise (not a sync throw) so an `await runKavalDaemon(...)` caller
    // observes it as a normal rejection.
    stopWatchForCleanup?.();
    return (async () => {
      // AWAIT the partial ptyHost's close BEFORE releasing the gate (F17): a
      // fire-and-forget `void ptyHost.close()` let an in-process retry re-acquire the
      // gate and start a new runtime while the OLD partial ptyHost + its node-pty
      // children were still closing. Awaiting orders the teardown ahead of the release.
      // A cleanup-path rejection is PRESERVED (aggregated with the boot error), never
      // swallowed — a caught error must surface, not collapse to an empty state. The
      // outcome is a DISCRIMINATED result, not a nullable `cleanupErr`: a Promise can
      // legally `reject(undefined)`, so overloading `undefined` as "no cleanup error"
      // would silently DROP that rejection (F17). `caught` decides; `reason` is
      // aggregated even when it is `undefined`.
      let cleanup: { caught: false } | { caught: true; reason: unknown } = {
        caught: false,
      };
      try {
        await ptyHostForCleanup?.close();
      } catch (e) {
        cleanup = { caught: true, reason: e };
      }
      gate.release();
      if (cleanup.caught) {
        throw new AggregateError(
          [err, cleanup.reason],
          "kaval boot failed and its partial-runtime cleanup also failed",
        );
      }
      throw err;
    })();
  }
}

/** Poll the state-root recorded in the manifest beside kaval's socket; once it
 *  has been gone for {@link STATE_ROOT_MISSES_TO_EXIT} consecutive checks, log a
 *  clear line and fire `onGone`. Returns a stop function (cleared on daemon exit).
 *
 *  The manifest is re-read every tick, not captured once: padi writes it around
 *  kaval's boot, so a single startup read could race it, and a standalone kaval
 *  never has one — re-reading makes both cases self-correcting. The manifest file
 *  lives in the rendezvous dir (NOT inside the state-root), so it survives the
 *  state-root's deletion and still names what vanished. */
function watchStateRoot(opts: {
  dir: string;
  log: Logger;
  pollMs: number;
  onGone: () => void;
}): () => void {
  let misses = 0;
  const timer = setInterval(() => {
    const stateRoot = readStateRootManifest(opts.dir);
    if (stateRoot === undefined || existsSync(stateRoot)) {
      misses = 0;
      return;
    }
    misses += 1;
    if (misses < STATE_ROOT_MISSES_TO_EXIT) return;
    opts.log.info(
      { stateRoot },
      "kaval state-root has been deleted; shutting down (its reason to exist is gone)",
    );
    clearInterval(timer);
    opts.onGone();
  }, opts.pollMs);
  // Don't let the poll timer alone keep the event loop alive.
  timer.unref?.();
  return () => clearInterval(timer);
}

/** Forward an external abort into `controller`, so kaval's own stop triggers (the
 *  state-root watcher) and the caller's `signal` share one teardown path. Fires
 *  immediately if `external` is already aborted. */
function forwardAbort(
  external: AbortSignal | undefined,
  controller: AbortController,
): void {
  if (external === undefined) return;
  if (external.aborted) {
    controller.abort();
    return;
  }
  external.addEventListener("abort", () => controller.abort(), { once: true });
}
