/**
 * `effectiveHealth` — the transport ∘ mirror fold, the ONE place pulam-web's two
 * independently-failing links resolve to a single health.
 *
 * pulam-web is browser ⇄ backend ⇄ remote pulam (over ssh). TWO links can be
 * down independently: the browser↔backend ws (the transport `status`) and the
 * backend↔remote mirror (the `connection` cell, off `session.onState`). The
 * header dot AND the body gate both read THIS fold, so they can't disagree about
 * whether a host is up. Pure (no JSX, no solid) so it lives in a `.ts` module the
 * unit tests can import directly — `ConnectionView.tsx` renders OFF it; the
 * precedence is the kind of decision logic that must be testable apart from the
 * pixels it drives.
 */

import type {
  ConnectionInfo,
  ConnectionState,
} from "@kolu/surface-nix-host/connection";
import type { SurfaceConnectionStatus } from "@kolu/surface-app/solid";
import { CONN_STATE, type ConnPresentation } from "./connectionStates.ts";

/** WHICH leg the resolved health came from — so a consumer can tell a real
 *  mirror failure (the host gave up; show the error card + Reconnect) apart from
 *  a transport-shadowed one (the dashboard ws died; show "reload"), even though
 *  both resolve to `state: "failed"`. The body gate keys the FailedCard on
 *  `source === "mirror"` so a transport-down host whose stale mirror cell still
 *  reads `failed` never paints a stale error + a Reconnect that can't run. */
export type HealthSource = "transport" | "mirror";

/** The single fold over BOTH volatility axes — the browser↔backend transport
 *  (`status`) and the backend↔remote mirror (`info.state`) — into one resolved
 *  health. The precedence is "transport trouble shadows the mirror": a `down` or
 *  `reconnecting` ws makes the mirror cell stale, so report the pipe first; on a
 *  live/connecting pipe the mirror IS the real signal. Resolves to a `state` so
 *  one consumer ("is this host effectively connected?") and the header dot read
 *  the SAME answer — `down`/`reconnecting` resolve to a non-`connected` state so
 *  a transport-down host can never read as connected. It also carries `source`
 *  (transport vs mirror) so the body can render the FailedCard only for a REAL
 *  mirror failure, not a transport-shadowed one. Both `HostHealthIndicator` and
 *  `HostGroup`'s body gate consume this; the precedence lives here, once. */
export function effectiveHealth(
  status: SurfaceConnectionStatus,
  info: ConnectionInfo,
): ConnPresentation & { state: ConnectionState; source: HealthSource } {
  if (status === "down")
    return {
      state: "failed",
      source: "transport",
      dot: "#ff8d8d",
      text: "#ff8d8d",
      label: "disconnected — reload",
      message: "Lost the connection to the dashboard. Reload to reconnect.",
      pending: false,
    };
  if (status === "reconnecting")
    return {
      state: "disconnected",
      source: "transport",
      dot: "#e6a23c",
      text: "#e6a23c",
      label: "reconnecting…",
      message: "Reconnecting to the dashboard…",
      pending: true,
    };
  // Transport live/connecting → the MIRROR's health is the real signal.
  return { state: info.state, source: "mirror", ...CONN_STATE[info.state] };
}
