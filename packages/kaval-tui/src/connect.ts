/**
 * Dial the kolu-server pty-host over its unix socket and hand back a
 * spec-typed client. The transport is `unixSocketLink` — the local-IPC member
 * of `@kolu/surface`'s link family, same ndjson framing the in-server listener
 * speaks (and the same framing the ssh/daemon path speaks, swapping only the
 * socket for a child's stdio). This module just binds it to `ptyHostSurface`.
 *
 * The link is built in two layers now (PLAN D2): `unixSocketLink` returns a
 * transport-neutral, tag-keyed `{ dispatch, dispose }`, and `ptyHostClientOver`
 * — kaval's OWN one-and-only cast — turns that dispatch into the member face.
 * We do not re-derive the face here: a second cast would be a second place for
 * the spec-to-face projection to drift.
 */
import { unixSocketLink } from "@kolu/surface/links/unix-socket";
import { Effect, type Scope } from "effect";
import { type PtyHostClient, ptyHostClientOver, ptyHostSurface } from "kaval";

/** The pty-host client — kaval's spec-derived member face
 *  (`SurfaceClientOf<typeof ptyHostSurface.spec>`). Identical whether the link
 *  is a local unix socket (`unixSocketLink`) or an ssh stdio child
 *  (`dialAgentOnce` → `stdioLink`), so one client type backs both transports. */
export type PtyTuiClient = PtyHostClient;

/** A live pty-host connection. Both the local socket path (`connectPtyHost`) and
 *  the ssh `--host` path (`main.ts`'s `connectHost`) hand back this shape, so
 *  every `cmd*()` is transport-blind — written against it once over either
 *  transport. This is the kaval-tui CLI's shape: a one-shot dialer needs only
 *  the client. A long-lived consumer (kolu-server, P3) that wants the session's
 *  `onState`/`markConnected` seam composes its own `Connection` variant carrying
 *  `session` (as mini-ci's dialer does) — it does NOT reuse this one.
 *
 *  There is no `dispose` field, and its absence carries the rule it used to
 *  document in prose: a wire link's teardown releases the scope holding the
 *  protocol's dial/ping/response fibers, and a link dropped without awaiting
 *  that leaks them. It is a SCOPE finalizer now, so it cannot be forgotten,
 *  cannot be un-awaited, and runs on the interrupted path too. */
export interface Connection {
  client: PtyTuiClient;
}

/** Connect to the pty-host at `socketPath`, for the caller's SCOPE. Fails with
 *  the raw socket error (`ECONNREFUSED` for a dead/absent server, `ENOENT` for a
 *  missing path) so the caller can print an honest, actionable message. */
export function connectPtyHost(
  socketPath: string,
): Effect.Effect<Connection, unknown, Scope.Scope> {
  return Effect.map(
    Effect.acquireRelease(
      Effect.tryPromise({
        try: () => unixSocketLink({ group: ptyHostSurface.group, socketPath }),
        catch: (err) => err,
      }),
      (link) => Effect.promise(() => link.dispose()),
    ),
    (link) => ({ client: ptyHostClientOver(link.dispatch) }),
  );
}
