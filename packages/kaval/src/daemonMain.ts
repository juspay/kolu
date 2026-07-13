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
  type DaemonExit,
  daemonLifetimeFromEnv,
  daemonMain,
  lifetimeInfo,
  type Logger,
} from "@kolu/surface-daemon";
import { createInProcessPtyHost } from "./inProcessPtyHost.ts";
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

  // Resolve the lifetime ONCE, before the router is built: `forever` in
  // production; `boundToPid` when a harness/smoke run set `KOLU_DAEMON_BIND_PID`
  // (padi forwards it into kaval's env) so a test-spawned kaval dies with its run.
  // The same value is served on `system.version` (via `lifetimeInfo`) and handed
  // to `daemonMain` below, so the readout and the actual policy can't drift.
  const lifetime = daemonLifetimeFromEnv({ kind: "forever" });

  const ptyHost = createInProcessPtyHost({
    log,
    rcDir,
    lifetime: lifetimeInfo(lifetime),
  });
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
  // Own the surface runtime's shutdown: release its owned sources when the
  // daemon tears down (inert today — no cell connectors — but the daemon owns
  // its runtime's lifetime by construction, not by convention).
  controller.signal.addEventListener("abort", () => void ptyHost.close(), {
    once: true,
  });
  const stopWatch = watchStateRoot({
    dir,
    log,
    pollMs: opts.stateRootPollMs ?? STATE_ROOT_POLL_MS,
    onGone: () => controller.abort(),
  });

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
  }).finally(stopWatch);
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
