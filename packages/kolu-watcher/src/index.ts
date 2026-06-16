/**
 * `kolu-watcher` — the P3 (kaval-sessions) host-resident process that lets
 * kolu-server dial a remote host's terminals over ssh.
 *
 * On the remote host, beside the durable kaval, kolu-watcher:
 *   - runs kolu's per-terminal provider DAG (`@kolu/terminal-dag`) FRESH per
 *     build (the always-current-code line — it is re-run, not adopted),
 *   - serves native fs/git (kolu-git) for the host's repos,
 *   - fronts the host-local kaval by being a CLIENT of its unix socket and
 *     forwarding the pty verbs/taps,
 *   - exposes all of it as ONE `watcherSurface` over an ssh `stdioLink`.
 *
 * kolu-server's `RemoteTerminalEndpoint` consumes this surface and mirrors it
 * into the same browser surface local terminals use. The `kolu-` prefix is
 * deliberate: unlike the kolu-agnostic kaval, kolu-watcher runs kolu's own
 * coupled logic, which is exactly why it is a separate process (and a
 * separate nix closure that may depend on kolu app packages).
 */
export {
  WATCHER_CONTRACT_VERSION,
  type WatcherSurface,
  watcherSurface,
} from "./watcherSurface.ts";
