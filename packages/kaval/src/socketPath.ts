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
import { join } from "node:path";
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

/** Discover the rendezvous sockets of running pty-host daemons under the per-user
 *  runtime root — every kolu-server's per-port namespace (`kaval-<port>/`) plus a
 *  bare standalone `kaval/`. Lets a flag-less `kaval-tui` dial the daemon without
 *  knowing the server's port. Mirrors `getRuntimeSocketPath`'s two shapes:
 *  `<app>/` under `$XDG_RUNTIME_DIR`, else `<app>-<uid>/` under `/tmp`. Returns
 *  every `<ns>/pty-host.sock` that exists; never throws (an unreadable root → []). */
export function discoverPtyHostSockets(): string[] {
  const xdg = process.env.XDG_RUNTIME_DIR;
  const onXdg = xdg !== undefined && xdg !== "";
  const base = onXdg ? xdg : "/tmp";
  const uid = process.getuid?.() ?? "shared";
  // Namespace dir: `kaval` or `kaval-<port>` under XDG; the same with a `-<uid>`
  // suffix under /tmp (where the path is shared across launch contexts).
  const re = onXdg ? /^kaval(-\d+)?$/ : new RegExp(`^kaval(-\\d+)?-${uid}$`);
  let entries: string[];
  try {
    entries = readdirSync(base);
  } catch {
    return [];
  }
  const found: string[] = [];
  for (const name of entries) {
    if (!re.test(name)) continue;
    const sock = join(base, name, "pty-host.sock");
    if (existsSync(sock)) found.push(sock);
  }
  return found;
}
