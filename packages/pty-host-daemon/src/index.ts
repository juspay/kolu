/** `@kolu/pty-host-daemon` — the LOCAL surviving-daemon provider.
 *
 *  Owns the daemon-process side of the pty-host: connecting to the surviving
 *  daemon over its unix socket (and spawning/restarting it), the detached /
 *  `systemd-run` launch, the pid-gone wait barrier, and the server-flag→env
 *  promotion the daemon's env contract depends on. The daemon's *behaviour*
 *  lives in `@kolu/pty-host` (hashed into the staleKey); this package is the
 *  process glue around it.
 */
export {
  type DaemonHandle,
  type DaemonHandleDeps,
  type DaemonState,
  ensureDaemon,
} from "./daemonHandle.ts";
export { DAEMON_ENV_KEYS } from "./env.ts";
export { promotePtyHostDaemonFlags } from "./socketEnv.ts";
export { type SpawnDaemonOpts, spawnDaemonProcess } from "./spawn.ts";
export {
  type IsAlive,
  waitForPidGone,
  type WaitForPidGoneResult,
} from "./waitForPidGone.ts";
