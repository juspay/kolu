/**
 * kaval's daemon composition — a ~thin wrapper over `@kolu/surface-daemon`'s
 * `daemonMain` skeleton. This is the "soul" side of the spine/soul line: it
 * supplies kaval's choices (where its gate and socket live, its own rcDir, the
 * daemon wire's `{ group, handlers }`, the `forever` lifetime, and its anchor — the state-root
 * manifest its padi writes beside the socket) and nothing more. The mechanism —
 * gate → serve → teardown, including the anchor-gone self-reap that used to be
 * kaval's private `watchStateRoot` (#1713, generalized in juspay/kolu#2010) —
 * lives in the spine, where `odu serve` reuses it.
 *
 * kaval computes its OWN paths in-package: it does NOT import kolu-server's
 * `koluRoot`. A standalone daemon owns its disk. B0 already removed any env
 * role here — there is no shell/env-application step; the daemon serves the
 * fully-specified spawns it is handed.
 */

import { startHeapDiagnostics } from "@kolu/heap-diag";
import {
  armRuntimeFaultExit,
  type DaemonExit,
  daemonLifetimeFromEnv,
  daemonMain,
  type Logger,
  lifetimeInfo,
  type ProcessIdentity,
  resolveDaemonHome,
} from "@kolu/surface-daemon";
import { processIdentityFromEnv } from "osfacts-client";
import { serveKavalDaemonSurface } from "./daemonSurface.ts";
import { createInProcessPtyHost } from "./inProcessPtyHost.ts";
import { startKavalSelfLiveness } from "./selfLiveness.ts";
import {
  KAVAL_NS_PREFIX,
  PTY_HOST_SOCK_FILE,
  readStateRootManifest,
} from "./socketPath.ts";

function readProcessIdentity(pid: number): ProcessIdentity | undefined {
  return processIdentityFromEnv("KOLU_OSFACTS_BIN", pid);
}

function selfIdentity(): ProcessIdentity {
  const identity = readProcessIdentity(process.pid);
  if (identity === undefined) {
    throw new Error(
      `osfacts could not resolve this kaval process (${process.pid})`,
    );
  }
  return identity;
}

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
  /** State-root (anchor) liveness poll interval, in ms — forwarded to the
   *  spine's `anchorPollMs`. A TEST seam (like `signal`); production omits it
   *  and uses the spine's default cadence. */
  stateRootPollMs?: number;
  /** Self-liveness probe cadence, in ms (#2101 N2) — the same kind of TEST seam
   *  as `stateRootPollMs`; production omits it and uses
   *  `SELF_PROBE_INTERVAL_MS`. */
  selfLivenessPollMs?: number;
}

/** Run the kaval daemon to completion: own a PTY host, serve `ptyHostSurface`
 *  over kaval's socket, and stay up forever (until a signal/abort). Resolves
 *  the spine's `DaemonExit` for the bin to map to an exit code. */
export function runKavalDaemon(opts: KavalDaemonOptions): Promise<DaemonExit> {
  const { log } = opts;
  // kaval's rendezvous is one resolveDaemonHome — overrides (CLI `--socket`)
  // are absorbed into the home construction, not juggled as loose paths past
  // the spine. Gate + socket ride `home` into daemonMain.
  const home = resolveDaemonHome({
    app: KAVAL_NS_PREFIX,
    placement: "runtime",
    socketFile: PTY_HOST_SOCK_FILE,
    socketOverride: opts.socketOverride,
  });
  const rcDir = home.file("rc");

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
  const daemonSurface = serveKavalDaemonSurface({
    ptyHost,
    stateRoot: home.dir,
  });
  const { terminalCount } = ptyHost;
  // Observe the surface runtime's `done` and treat a rejection as FATAL (#2101 G2,
  // the same ruling padi took): after G1 the only failures left on this channel are
  // structural wiring deaths, which do not heal by waiting. kaval's declared policy
  // is RECYCLE — its padi adopt-or-spawns a replacement and the PTYs are re-attached
  // — so dying loudly is strictly better than serving half a runtime. The ptyHost
  // surface declares no cell connectors, so nothing faults today; this is the arm
  // that keeps the FUTURE first fault from being a zombie instead of a restart.
  const runtimeFaultSignal = armRuntimeFaultExit({
    done: daemonSurface.done,
    log,
    subject: "kaval pty-host surface runtime",
    // No last rites: kaval owns no durable session (padi does), and its live PTYs
    // are reaped by `daemonSurface.close()` in the `.finally` below — which the
    // fault path reaches like any other shutdown, because it IS one.
  });

  // #2101 N2 — the SECOND way this daemon can prove itself unfit, and the one the
  // runtime-fault arm structurally cannot see: a serving layer that HANGS without
  // faulting. `done` never rejects for it (nothing failed), so the self-probe
  // gets its own controller and the two are merged into the one `faultSignal`
  // `daemonMain` takes. Merging rather than adding a second spec field is
  // deliberate: the DISPOSITION is identical — end the tenure through the ordinary
  // shutdown machinery with a non-zero exit so the supervisor respawns — and the
  // spine should not learn a new vocabulary for a second reason to take the same
  // action.
  const selfLivenessFault = new AbortController();
  const faultSignal = AbortSignal.any([
    runtimeFaultSignal,
    selfLivenessFault.signal,
  ]);
  // Started at readiness, not here: before the socket is listening a self-dial
  // would be measuring a daemon that has not opened yet. Stopped in the
  // `.finally` below AND by the caller's stop signal, so a deliberate shutdown
  // can never race its own clean exit into a fault exit.
  let stopSelfLiveness: (() => void) | undefined;

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

  // Once the manifest resolves to a real path, it never changes again for this
  // process's lifetime (padi writes it once, around kaval's own boot) — so cache
  // it after the first successful read. Two properties ride on this, not one:
  // it stops the spine's anchor poll `readFileSync`-ing the same answer every
  // tick for a `forever` daemon's whole life, AND it PINS the anchor against
  // later manifest loss — a rendezvous dir deleted after resolution would
  // otherwise reset the thunk to `undefined` ("never anchored") and silently
  // disarm the self-reap for a daemon that unambiguously should still reap.
  // Retry (uncached) only while it's still unresolved, which is exactly the
  // startup race this thunk exists to survive.
  let resolvedStateRoot: string | undefined;

  return daemonMain({
    home,
    processIdentity: selfIdentity(),
    readProcessIdentity,
    // One field became two when the router died (surface-daemon's `DaemonSpec`
    // now takes `{ group, handlers }`) — forwarded verbatim, spelled the same
    // way on both sides, so the spine invents no vocabulary kaval has to learn.
    group: daemonSurface.group,
    handlers: daemonSurface.handlers,
    // The same lifetime resolved above (reused, never re-derived) — so the value
    // served on `system.version` is provably the one governing the daemon.
    lifetime,
    // kaval's ANCHOR is its padi's state-root, learned from the `state-root`
    // manifest padi writes beside kaval's socket (kaval is told only a
    // `--socket`, never the root itself). The spine re-reads the thunk every
    // poll tick, which is exactly the semantics the manifest needs: padi writes
    // it around kaval's boot (a one-shot startup read could race it), and a
    // STANDALONE kaval has no manifest at all — the thunk stays `undefined` and
    // it is simply never reaped, its reason to exist untied to any state-root.
    anchor: () => (resolvedStateRoot ??= readStateRootManifest(home.dir)),
    anchorPollMs: opts.stateRootPollMs,
    log,
    signal: opts.signal,
    // The owned-fault arm — ends the tenure as `reason: "runtime-fault"` (non-zero
    // exit) through the same teardown a signal gets, rather than leaving a kaval
    // that answers RPCs with a dead runtime behind them.
    faultSignal,
    onReady: (info) => {
      stopSelfLiveness = startKavalSelfLiveness({
        socketPath: info.socketPath,
        log,
        onExhausted: () => selfLivenessFault.abort(),
        pollMs: opts.selfLivenessPollMs,
      });
      opts.signal?.addEventListener("abort", () => stopSelfLiveness?.(), {
        once: true,
      });
      opts.onReady?.(info);
    },
  }).finally(() => {
    // Disarm FIRST: from here the surface is closing, so a probe crossing a
    // listener that is going away would be measuring the shutdown, not a wedge.
    stopSelfLiveness?.();
    // Own the surface runtime's shutdown deterministically: once the daemon has
    // stopped serving, release its owned sources. AWAITING close here (the
    // `.finally` waits on the returned promise) — rather than a fire-and-forget
    // `void ptyHost.close()` off an abort listener that an ALREADY-aborted input
    // signal could register too late to ever fire — makes the release ordered
    // and unmissable. `close` disposes every live PTY (so a shutting-down daemon
    // reaps its node-pty children instead of orphaning them to init) and then
    // closes the surface runtime — the daemon owning its runtime's lifetime by
    // construction.
    return daemonSurface.close();
  });
}
