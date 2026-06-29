/**
 * The well-known socket where `pulam` serves its terminalWorkspace surface and
 * `pulam-tui` dials it — one resolver both import, so the default path can
 * never drift between them (the role kaval's `getPtyHostSocketPath` plays for
 * the pty-host socket). One `pulam` per host (the standalone default), so a
 * single fixed path suffices — no per-instance namespacing.
 *
 * This is node-coupled (it resolves a per-user runtime dir), so it is a
 * SEPARATE entry from `./surface`: a browser / remote-kolu consumer of
 * `terminalWorkspaceSurface` imports `@kolu/pulam-library/surface` and
 * never drags in `node:`.
 */

import { getRuntimeSocketPath } from "@kolu/surface/unix-socket";

/** pulam's awareness socket: `override` if given, else
 *  `$XDG_RUNTIME_DIR/pulam/awareness.sock` (or the `/tmp/pulam-$UID/...`
 *  per-user fallback off systemd). The `pulam` app namespace is the daemon's
 *  runtime path identity, unrelated to the package name — a live daemon's
 *  socket must not move when the package is renamed. */
export function pulamSocketPath(override?: string): string {
  return getRuntimeSocketPath({
    app: "pulam",
    file: "awareness.sock",
    override,
  });
}
