/**
 * `padi --stdio` — front padi's durable daemon over a stdio byte bridge.
 *
 * The twin of `kaval/src/stdioBridge.ts`. The *mechanism* is the shared
 * `frontDaemonOverStdio` primitive — the durable counterpart to `serveOverStdio`,
 * homed in `@kolu/surface-daemon`. This module is the **padi-specific
 * composition** of it, supplying the two things the generic relay is parameterized
 * over:
 *
 *   - **the socket path** — padi's own digest-keyed rendezvous, resolved the SAME
 *     way `runPadiDaemon` does (`padiSocketPath(resolvePadiStateRoot(stateRoot),
 *     socketOverride)`), so the front and the daemon it fronts agree on the path;
 *   - **the daemon-spawn** — re-exec THIS `padi` binary minus `--stdio`, so the
 *     detached, gate-held daemon comes up to serve that same socket (the
 *     `reExecAsDetachedDaemon` invariant: the single-process `node --import` form
 *     so SIGTERM reaches the daemon, not a swallowing `tsx` fork). The re-exec'd
 *     daemon runs `runPadiDaemon`, which spawns/adopts its OWN kaval and serves
 *     `padiSurface` + the frozen control core — kaval rides inside padi's closure,
 *     so nothing else needs provisioning.
 *
 * W3.1's remote binding runs `ssh <host> padi --stdio` (via
 * `getHostSession({ host, binary: "padi", extraArgs: ["--stdio"] })`) and speaks
 * the combined `padiDaemonContract` (padiSurface + control core) over the relay;
 * the durable padi it fronts — and its kaval, and the PTYs — outlives the ssh
 * link, so a remote canvas survives detach → reattach exactly as `kaval-tui
 * --host` does for a bare PTY.
 */

import {
  frontDaemonOverStdio,
  reExecAsDetachedDaemon,
} from "@kolu/surface-daemon";
import {
  padiSocketPath,
  padiStderrLogPath,
  resolvePadiStateRoot,
} from "./stateRoot.ts";

export interface RunPadiStdioBridgeOptions {
  /** The value of `--state-root`, threaded straight from `bin.ts`'s argv parse,
   *  so the front and the re-exec'd daemon resolve the SAME digest-keyed socket
   *  from the SAME token. Default (`undefined`): `KOLU_PADI_STATE_DIR` else padi's
   *  binary default (`$HOME/.local/state/padi`) — the remote padi spells its own
   *  default state-root on ITS host. */
  stateRoot?: string;
  /** The value of `--socket` (rare override); the daemon's gate sits beside it. */
  socketOverride?: string;
  /** The value of `--client-id` (the binder's stable per-client UUID) — the
   *  isolation-default. Rides through in `process.argv` to the re-exec'd daemon,
   *  so the front resolves the SAME per-client estate the daemon will serve. */
  clientId?: string;
}

/** Run the `--stdio` bridge: front padi's durable daemon over this process's
 *  stdio for the lifetime of the link. Resolves when the link ends; the daemon
 *  it fronts (and its kaval + PTYs) keeps running.
 *
 *  CLI-only: `reExecAsDetachedDaemon` re-execs `process.argv` (minus `--stdio`),
 *  so the daemon serves the same `--state-root` / `--socket` ONLY because those
 *  tokens are still in argv. Pass `stateRoot`/`socketOverride` here *without* a
 *  matching flag in argv and the daemon would bind the default while the front
 *  waits on the override — so don't call this off the CLI path; for a programmatic
 *  front, use `frontDaemonOverStdio` directly with a path-injecting `spawnDaemon`. */
export function runPadiStdioBridge(
  opts: RunPadiStdioBridgeOptions = {},
): Promise<void> {
  // Resolve ONCE to the (possibly per-client isolated) absolute state-root, so the
  // front's socket + stderr-log and the re-exec'd daemon agree on the estate: the
  // daemon resolves the SAME token set from argv (`--client-id` rides through the
  // `--stdio`-strip). Passing the resolved ABSOLUTE path back into the path helpers
  // is a no-op re-resolve (an absolute path is returned as-is), so the isolation is
  // applied exactly once, here.
  const stateRoot = resolvePadiStateRoot(opts.stateRoot, opts.clientId);
  const socketPath = padiSocketPath(stateRoot, opts.socketOverride);
  return frontDaemonOverStdio({
    socketPath,
    // Start padi's own durable daemon: re-exec this binary minus `--stdio`. Any
    // `--state-root`/`--socket` ride through in `process.argv`, so the daemon
    // resolves the SAME path the front just did — load-bearing, and why this shim
    // is CLI-only (see the docstring). P0: this call site is DETACHING (nobody will hold the
    // child's stderr), so a crash-catcher file is mandatory here — `stderrLog` gives its raw
    // stderr a home (`padi.stderr.log`). The daemon's own entrypoint routes its pino stream to
    // `padi.log`; no flag to set. Without these a remote padi's whole log stream — incl. the
    // WAL-watcher lines — went to /dev/null, undiagnosable.
    spawnDaemon: () =>
      reExecAsDetachedDaemon({
        stripArgs: ["--stdio"],
        stderrLog: padiStderrLogPath(stateRoot),
      }),
    log: (msg) => process.stderr.write(`padi --stdio: ${msg}\n`),
  });
}
