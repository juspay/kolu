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
 * pins kolu's names.
 *
 * kolu-server namespaces its daemon PER INSTANCE by listen port
 * (`kaval-<port>/`), so two servers on one box never collide on a single gate
 * (the prod incident where a second server recycled the first's daemon). The
 * consequence: there is no one fixed path a flag-less `kaval-tui` can assume, so
 * it `discoverPtyHostSockets()` the running daemon instead.
 */
import { existsSync, readdirSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { getRuntimeSocketPath } from "@kolu/surface/unix-socket";

/** The socket filename inside every kaval rendezvous dir. */
export const PTY_HOST_SOCK_FILE = "pty-host.sock";

/** The app-namespace prefix kaval owns. A standalone daemon serves under it
 *  bare (`kaval/`); each kolu-server serves under a per-port decoration of it
 *  (`kavalNamespace(port)` → `kaval-<port>/`). The prefix is the one literal
 *  that ties construction and discovery together. */
export const KAVAL_NS_PREFIX = "kaval";

/** The app namespace for a kolu-server's per-instance daemon, keyed by listen
 *  port so two servers on one box never collide on a single gate. */
export function kavalNamespace(port: number): string {
  return `${KAVAL_NS_PREFIX}-${port}`;
}

/** The socket path: `override` if given, else `$XDG_RUNTIME_DIR/<app>/
 *  pty-host.sock` on systemd Linux, else the `$TMPDIR`-independent per-user
 *  fallback `/tmp/<app>-$UID/pty-host.sock`. `app` is parameterized (default
 *  `"kolu"`) so a standalone daemon can own its own rendezvous namespace
 *  without the host name being hardcoded into the path. */
export function getPtyHostSocketPath(override?: string, app = "kolu"): string {
  return getRuntimeSocketPath({
    app,
    file: PTY_HOST_SOCK_FILE,
    override,
  });
}

/** Discover the rendezvous sockets of running pty-host daemons under the per-user
 *  runtime root — every kolu-server's per-port namespace (`kaval-<port>/`) plus a
 *  bare standalone `kaval/`. Lets a flag-less `kaval-tui` dial the daemon without
 *  knowing the server's port.
 *
 *  The runtime root and the env's namespace decoration are NOT re-derived here:
 *  they are READ BACK from `getRuntimeSocketPath` itself, so discovery can never
 *  spell the path shape differently than construction. Build the bare daemon's
 *  socket path, then walk back up — its grandparent is the root to scan, its
 *  parent's basename is the (possibly `-$UID`-decorated) bare namespace dir. The
 *  per-port pattern is the same decoration with `\d+` substituted for the port,
 *  learnt from a probe build with port `0`. Returns every `<ns>/pty-host.sock`
 *  that exists; never throws (an unreadable root → []). */
export function discoverPtyHostSockets(): string[] {
  // The bare daemon's socket: `<root>/<bareDir>/pty-host.sock`. Whatever shape
  // surface gives it (XDG `kaval/`, or `/tmp` `kaval-$UID/`) the decoration is
  // baked into `bareDir`, never re-decided here.
  const bareDir = dirname(
    getRuntimeSocketPath({ app: KAVAL_NS_PREFIX, file: PTY_HOST_SOCK_FILE }),
  );
  const root = dirname(bareDir);
  const bareName = basename(bareDir);

  // Learn the env's port decoration from the builder too: a probe build with
  // port `0` yields the decorated per-port name; turn its literal `0` back into
  // `\d+` to match any port. (Escape the rest so a `/tmp` path can't inject
  // regex metacharacters.)
  const portedName = basename(
    dirname(
      getRuntimeSocketPath({
        app: kavalNamespace(0),
        file: PTY_HOST_SOCK_FILE,
      }),
    ),
  );
  const portedRe = new RegExp(
    `^${portedName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace("0", "\\d+")}$`,
  );

  let entries: string[];
  try {
    entries = readdirSync(root);
  } catch {
    return [];
  }
  const found: string[] = [];
  for (const name of entries) {
    if (name !== bareName && !portedRe.test(name)) continue;
    const sock = join(root, name, PTY_HOST_SOCK_FILE);
    if (existsSync(sock)) found.push(sock);
  }
  return found;
}
