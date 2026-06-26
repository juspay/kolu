/**
 * `createSocketStatus` — a reactive transport-level connection status for a
 * reconnecting surface socket that has NO identity-probe lifecycle (the
 * `connectSurface` shape: pulam-web / drishti per-host sockets).
 *
 * `createServerLifecycle` already derives a richer `connecting → connected →
 * reconnected / restarted` lifecycle, but it needs an `identity.info` probe to
 * tell a restart from a transient drop. An app with no identity surface still
 * wants to SHOW the user "this host is reconnecting" / "this host is down" — the
 * whole point of the half-open watchdog is that the link recovers, and a silent
 * recovery the user can't see is half a fix. This derives that minimal signal
 * from the socket's own `open`/`close` events alone.
 */

import type { SurfaceConnectionStatus } from "@kolu/surface/solid";
import { type Accessor, createSignal } from "solid-js";
import { STALE_PROCESS_CLOSE_CODE } from "../index";

// `SurfaceConnectionStatus` moved to `@kolu/surface` (beside `createLiveSignal`,
// which is now the primary status+watchdog source); re-exported so any direct
// `./socketStatus` importer keeps one path.
export type { SurfaceConnectionStatus };

/** A reconnecting socket reduced to the two events this reads. */
type ObservableSocket = {
  addEventListener(type: "open", listener: () => void): void;
  addEventListener(
    type: "close",
    listener: (event?: { code?: number }) => void,
  ): void;
};

/** Derive a reactive `status` from a reconnecting socket's open/close. `down` is
 *  reached only when the socket was built with `retireOnStaleClose` AND closes
 *  with the stale-restart code — a retired socket won't reconnect, so it is
 *  terminally down (reload to recover); every other close is a transient drop
 *  reported as `reconnecting`. */
export function createSocketStatus(
  ws: ObservableSocket,
  opts: { retireOnStaleClose?: boolean; restartCloseCode?: number } = {},
): Accessor<SurfaceConnectionStatus> {
  const [status, setStatus] =
    createSignal<SurfaceConnectionStatus>("connecting");
  ws.addEventListener("open", () => setStatus("live"));
  ws.addEventListener("close", (event) => {
    const retired =
      opts.retireOnStaleClose === true &&
      event?.code === (opts.restartCloseCode ?? STALE_PROCESS_CLOSE_CODE);
    setStatus(retired ? "down" : "reconnecting");
  });
  return status;
}
