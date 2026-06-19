/**
 * The well-known socket where `arivu` serves its awareness surface and
 * `arivu-tui` dials it — one resolver both import, so the default path can
 * never drift between them (the role kaval's `getPtyHostSocketPath` plays for
 * the pty-host socket). One `arivu` per host (the standalone default), so a
 * single fixed path suffices — no per-instance namespacing.
 *
 * This is node-coupled (it resolves a per-user runtime dir), so it is a
 * SEPARATE entry from the package root: a browser / remote-kolu consumer of
 * `arivuSurface` imports `@kolu/arivu-contract` and never drags in `node:`.
 */

import { getRuntimeSocketPath } from "@kolu/surface/unix-socket";

/** arivu's awareness socket: `override` if given, else
 *  `$XDG_RUNTIME_DIR/arivu/awareness.sock` (or the `/tmp/arivu-$UID/...`
 *  per-user fallback off systemd). */
export function arivuSocketPath(override?: string): string {
  return getRuntimeSocketPath({
    app: "arivu",
    file: "awareness.sock",
    override,
  });
}
