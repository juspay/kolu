/**
 * The well-known unix-socket path where kolu-server serves the in-process
 * pty-host and `kaval-tui` connects to it. Single source of truth so the
 * server and the CLI — two separate packages, two separate processes —
 * compute it identically.
 *
 * The rendezvous mechanics (why a stable path; why the off-systemd fallback
 * is a fixed `/tmp/<app>-$UID/`, NOT `os.tmpdir()` whose `$TMPDIR` form
 * diverged between a launchd server and a `nix run` CLI on macOS — the
 * "no pty-host socket at /tmp/kolu/..." bug) live with
 * `getRuntimeSocketPath` in `@kolu/surface/unix-socket`; this module just
 * pins kolu's names. It assumes one kolu-server per user session — the
 * single-server model R-4 Phase 1 ships. Pass an explicit override (the
 * CLI's and the server's `--pty-host-socket`) to run more than one.
 */
import { getRuntimeSocketPath } from "@kolu/surface/unix-socket";

/** The socket path: `override` if given, else `$XDG_RUNTIME_DIR/<app>/
 *  pty-host.sock` on systemd Linux, else the `$TMPDIR`-independent per-user
 *  fallback `/tmp/<app>-$UID/pty-host.sock`. `app` is parameterized (default
 *  `"kolu"`) so a standalone daemon can own its own rendezvous namespace
 *  without the host name being hardcoded into the path. */
export function getPtyHostSocketPath(override?: string, app = "kolu"): string {
  return getRuntimeSocketPath({
    app,
    file: "pty-host.sock",
    override,
  });
}
