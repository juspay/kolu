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

import type { SurfaceHealth } from "@kolu/surface/solid";
import type { SurfaceConnectionStatus } from "@kolu/surface-app/solid";
import type {
  ConnectionInfo,
  ConnectionState,
} from "@kolu/surface-nix-host/connection";
import {
  CONN_STATE,
  type ConnPresentation,
  HEALTH_PALETTE,
} from "./connectionStates.ts";

/** pulam-web's hard-gate readiness over the framework FACT — the ONE predicate
 *  the body `<SurfaceGate ready>` AND the header dot `<HostStatusPip ready>`
 *  share, so the dot's GREEN and the body's "show it" are the SAME decision (it
 *  can't go green over a body the gate is hiding, nor vice versa). The link is up
 *  — the fact's `live` leg, which now carries the mirror's `connected` state BY
 *  CONSTRUCTION (the `connection` cell's `liveWhen`), so this no longer hand-ANDs
 *  `connInfo().state === "connected"` — AND no subscription is erroring (a
 *  dashboard must not paint a stale roster over a broken sub). Deliberately does
 *  NOT gate on `pending`: the body has its OWN internal loading states ("loading
 *  terminal details…"), so a per-key value sub still settling must not blank the
 *  whole host — which is why this is a custom predicate, not `gateStatus === "ready"`. */
export function hostBodyReady(h: SurfaceHealth): boolean {
  return h.live && !h.subs.some((s) => s.error);
}

/** WHICH leg the resolved health came from — so a consumer can tell a real
 *  mirror failure (the host gave up; show the error card + Reconnect) apart from
 *  a transport-shadowed one (the dashboard ws died; show "reload"), even though
 *  both resolve to `state: "failed"`. The body gate keys the FailedCard on
 *  `source === "mirror"` so a transport-down host whose stale mirror cell still
 *  reads `failed` never paints a stale error + a Reconnect that can't run. */
export type HealthSource = "transport" | "mirror";

/** A resolved host health — a presentation row, the effective `state` the gate
 *  reads, and which leg (`source`) produced it. The single name for
 *  `effectiveHealth`'s output, so the fold and every consumer (the header
 *  indicator, the body gate, `ConnectionView`'s prop) move in lock-step. */
export type EffectiveHealth = ConnPresentation & {
  state: ConnectionState;
  source: HealthSource;
};

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
): EffectiveHealth {
  // Dispatch on the transport status, fenced exhaustive (the repo's `satisfies
  // never` fold idiom): a new `SurfaceConnectionStatus` variant forces a compile
  // error here rather than silently falling through to the mirror branch.
  switch (status) {
    case "down":
      return {
        state: "failed",
        source: "transport",
        dot: HEALTH_PALETTE.red,
        text: HEALTH_PALETTE.red,
        label: "disconnected — reload",
        message: "Lost the connection to the dashboard. Reload to reconnect.",
        pending: false,
      };
    case "reconnecting":
      return {
        state: "disconnected",
        source: "transport",
        dot: HEALTH_PALETTE.amber,
        text: HEALTH_PALETTE.amber,
        label: "reconnecting…",
        message: "Reconnecting to the dashboard…",
        pending: true,
      };
    // Transport live/connecting → the MIRROR's health is the real signal. The two
    // siblings share one handler (the mirror passthrough) explicitly.
    case "connecting":
    case "live":
      return { state: info.state, source: "mirror", ...CONN_STATE[info.state] };
    default: {
      const unreachable: never = status;
      throw new Error(
        `effectiveHealth: unhandled SurfaceConnectionStatus ${String(unreachable)}`,
      );
    }
  }
}
