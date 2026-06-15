/**
 * `kaval --stdio` — front kaval's durable daemon over a stdio byte bridge.
 *
 * The *mechanism* is the shared `frontDaemonOverStdio` primitive — the durable
 * counterpart to `serveOverStdio`, homed in `@kolu/surface-daemon` (P2.5). This
 * module is the **kaval-specific composition** of it, supplying the two things
 * the generic relay is parameterized over:
 *
 *   - **the socket path** — kaval's own rendezvous (`socketPath.ts`: the per-user
 *     default, or the `--socket` override / per-port kolu-server namespace);
 *   - **the daemon-spawn** — re-exec THIS `kaval` binary minus `--stdio`, so the
 *     detached, gate-held daemon comes up to serve that same socket (the
 *     `reExecAsDetachedDaemon` invariant: the single-process `node --import` form
 *     so SIGTERM reaches the daemon, not a swallowing `tsx` fork).
 *
 * R-2's `kaval-tui --host` runs `ssh <host> kaval --stdio` and speaks
 * `ptyHostSurface` over the relay; the daemon it fronts outlives the link, so a
 * remote PTY survives detach → reattach.
 */

import {
  frontDaemonOverStdio,
  reExecAsDetachedDaemon,
} from "@kolu/surface-daemon";
import { getPtyHostSocketPath, KAVAL_NS_PREFIX } from "./socketPath.ts";

export interface RunStdioBridgeOptions {
  /** Override the daemon socket to front (`--socket`); the spawned daemon, if
   *  any, is launched to serve the same path. Default: kaval's own namespace. */
  socketOverride?: string;
}

/** Run the `--stdio` bridge: front kaval's durable daemon over this process's
 *  stdio for the lifetime of the link. Resolves when the link ends; the daemon
 *  it fronts keeps running. */
export function runStdioBridge(
  opts: RunStdioBridgeOptions = {},
): Promise<void> {
  const socketPath = getPtyHostSocketPath(opts.socketOverride, KAVAL_NS_PREFIX);
  return frontDaemonOverStdio({
    socketPath,
    // Start kaval's own durable daemon: re-exec this binary minus `--stdio`.
    // Any `--socket` rides through in `process.argv`, so the daemon serves the
    // same path the front just resolved.
    spawnDaemon: () => reExecAsDetachedDaemon({ stripArgs: ["--stdio"] }),
    log: (msg) => process.stderr.write(`kaval --stdio: ${msg}\n`),
  });
}
