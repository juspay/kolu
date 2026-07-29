/**
 * The daemon BINARY half — the blocks the `@kolu/surface-daemon` reference
 * embeds. `daemonHome` decides the on-disk home; `daemonMain` is the whole
 * gate → serve → teardown skeleton; `frontDaemonOverStdio` is the durable
 * stdio front an ssh session dials.
 *
 * Typechecked, never executed — the runtime-y bits live inside functions so the
 * module compiles without spawning anything.
 */

import {
  controlCoreFragment,
  controlCoreSurface,
  daemonHome,
  daemonMain,
  daemonProcessMain,
  frontDaemonOverStdio,
  reExecAsDetachedDaemon,
  readBakedIdentity,
  stderrLogger,
} from "@kolu/surface-daemon";
import { implementSurfaces } from "@kolu/surface/server";
import { deps } from "./serve";
import { surface } from "./surface";

// #region home
// Durable ⇒ state dir (never /run): a daemon supervised over ssh must outlive
// the session that spawned it; logind deletes $XDG_RUNTIME_DIR with the last
// session. Gate and socket live side by side under the home.
const home = daemonHome({ app: "fleet-top", placement: "state" });
// #endregion home

const readIdentity = readBakedIdentity("FLEET_TOP");

// The example surface's flattened router — the same `router` a browser or a
// unix-socket client reaches; the daemon just serves it durably.
export function runDaemon(controller: AbortController): void {
  // #region control-core
  // Serve these deps beside the versioned application surface. `hello` remains
  // readable even when that application contract is skewed; `drain` waits for
  // the daemon's own persistence/shutdown hook.
  const control = controlCoreFragment({
    stateRoot: home.dir,
    surfaceVersion: "1.0",
    startedAt: Date.now(),
    commit: readIdentity.navigableCommit,
    buildId: readIdentity.staleKey,
    onDrain: () => controller.abort(),
  });
  const router = implementSurfaces(
    { app: surface, control: controlCoreSurface },
    {},
    { app: deps, control },
  ).router as Parameters<typeof daemonMain>[0]["router"];
  // #endregion control-core
  // #region lifecycle
  daemonProcessMain({
    name: "fleet-top", // crash-arm narration prefix
    run: () =>
      daemonMain({
        // gate, socket, anchor — all derived from home inside the spine
        home,
        router, // runtime.router — already the final flattened router
        lifetime: { kind: "forever" }, // or { kind: "idleTimeout", ms, isIdle }
        log: stderrLogger(),
        signal: controller.signal,
        onReady: ({ socketPath, pid }) =>
          process.stderr.write(`listening on ${socketPath} (pid ${pid})\n`),
      }),
  });
  // #endregion lifecycle
}

// The `--stdio` front an ssh session runs: adopt-or-spawn the gate-held daemon,
// then raw-byte-relay this process's stdio onto its socket so the surface
// survives the link.
export function frontOverStdio(): Promise<void> {
  // #region front
  return frontDaemonOverStdio({
    socketPath: home.socketPath,
    spawnDaemon: () => reExecAsDetachedDaemon({ stripArgs: ["--stdio"] }),
    log: (msg) => process.stderr.write(`--stdio: ${msg}\n`),
  });
  // #endregion front
}
