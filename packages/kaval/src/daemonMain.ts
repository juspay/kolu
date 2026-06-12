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

import { dirname, join } from "node:path";
import { type DaemonExit, daemonMain, type Logger } from "@kolu/surface-daemon";
import { createInProcessPtyHost } from "./inProcessPtyHost.ts";
import { getPtyHostSocketPath } from "./socketPath.ts";

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
  const socketPath = getPtyHostSocketPath(opts.socketOverride, "kaval");
  const dir = dirname(socketPath);
  const gatePath = join(dir, "kaval.pid");
  const rcDir = join(dir, "rc");

  const { servedRouter } = createInProcessPtyHost({ log, rcDir });

  return daemonMain({
    gatePath,
    socketPath,
    router: servedRouter,
    lifetime: { kind: "forever" },
    log,
    signal: opts.signal,
    onReady: opts.onReady,
  });
}
