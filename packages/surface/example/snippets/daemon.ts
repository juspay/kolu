/**
 * The daemon BINARY half — the blocks the `@kolu/surface-daemon` reference
 * embeds. `daemonMain` is the whole gate → serve → teardown skeleton;
 * `frontDaemonOverStdio` is the durable stdio front an ssh session dials.
 *
 * Typechecked, never executed — the runtime-y bits live inside functions so the
 * module compiles without spawning anything.
 */

import {
  daemonExitCode,
  daemonMain,
  frontDaemonOverStdio,
  reExecAsDetachedDaemon,
  stderrLogger,
} from "@kolu/surface-daemon";
import { router as serveRouter } from "./serve";

const GATE_PATH = "/run/fleet-top/daemon.pid";
const SOCKET_PATH = "/run/fleet-top/daemon.sock";

// oRPC's `Lazy<Router>` spread isn't accepted by the strict `Router<any, any>`
// input type; the runtime shape is valid (the same cast the fleet-top daemon uses).
const router = serveRouter as Parameters<typeof daemonMain>[0]["router"];

// The example surface's flattened router — the same `router` a browser or a
// unix-socket client reaches; the daemon just serves it durably.
export async function runDaemon(controller: AbortController): Promise<never> {
  // #region lifecycle
  const exit = await daemonMain({
    gatePath: GATE_PATH, // the single-instance scope key
    socketPath: SOCKET_PATH, // where the surface is served
    router, // fragment.router — already the final flattened router
    lifetime: { kind: "forever" }, // or { kind: "idleTimeout", ms, isIdle }
    log: stderrLogger(),
    signal: controller.signal,
    onReady: ({ socketPath, pid }) =>
      process.stderr.write(`listening on ${socketPath} (pid ${pid})\n`),
  });
  process.exit(daemonExitCode(exit));
  // #endregion lifecycle
}

// The `--stdio` front an ssh session runs: adopt-or-spawn the gate-held daemon,
// then raw-byte-relay this process's stdio onto its socket so the surface
// survives the link.
export function frontOverStdio(): Promise<void> {
  // #region front
  return frontDaemonOverStdio({
    socketPath: SOCKET_PATH,
    spawnDaemon: () => reExecAsDetachedDaemon({ stripArgs: ["--stdio"] }),
    log: (msg) => process.stderr.write(`--stdio: ${msg}\n`),
  });
  // #endregion front
}
