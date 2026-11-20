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

function pinOnceResolved<T>(read: () => T | undefined): () => T | undefined {
  let pinned: T | undefined;
  return () => (pinned ??= read());
}

export interface KavalDaemonOptions {
  socketOverride?: string;
  log: Logger;
  signal?: AbortSignal;
  onReady?: (info: { socketPath: string; pid: number }) => void;
  stateRootPollMs?: number;
  selfLivenessPollMs?: number;
}

export function runKavalDaemon(opts: KavalDaemonOptions): Promise<DaemonExit> {
  const { log } = opts;
  const home = resolveDaemonHome({
    app: KAVAL_NS_PREFIX,
    placement: "runtime",
    socketFile: PTY_HOST_SOCK_FILE,
    socketOverride: opts.socketOverride,
  });
  const rcDir = home.file("rc");

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
  const runtimeFaultSignal = armRuntimeFaultExit({
    done: daemonSurface.done,
    log,
    subject: "kaval pty-host surface runtime",
  });

  const selfLivenessFault = new AbortController();
  const faultSignal = AbortSignal.any([
    runtimeFaultSignal,
    selfLivenessFault.signal,
  ]);
  let stopSelfLiveness: (() => void) | undefined;

  startHeapDiagnostics({
    log,
    snapshotPrefix: "kaval-baseline",
    logPrefix: "kaval_diag",
    extraColumns: () => ({ terminals: terminalCount() }),
  });

  return daemonMain({
    home,
    processIdentity: selfIdentity(),
    readProcessIdentity,
    group: daemonSurface.group,
    handlers: daemonSurface.handlers,
    lifetime,
    anchor: pinOnceResolved(() => readStateRootManifest(home.dir)),
    anchorPollMs: opts.stateRootPollMs,
    log,
    signal: opts.signal,
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
    stopSelfLiveness?.();
    return daemonSurface.close();
  });
}
