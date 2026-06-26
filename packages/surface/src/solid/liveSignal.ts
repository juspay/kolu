/**
 * `LiveSignal` — a transport-liveness accessor BLESSED by a seam that wires the
 * half-open watchdog.
 *
 * `health().live` over a websocket link is a LIE unless something actively probes
 * the link: a WebSocket can silently HALF-OPEN (the socket stays `open` while no
 * bytes flow either way — laptop sleep, Wi-Fi roam, NAT idle-eviction), firing
 * neither `close` nor `error`, so a `() => true` or an open/close-only
 * `() => socketStatus() === "live"` reads `live` FOREVER over a dead link (#1564,
 * one seam upstream of the dot). `surfaceClient`/`surfaceClients` therefore refuse
 * such a signal over a half-openable link (see `requireTransportLive`): the only
 * `{ live }` they accept there is a `LiveSignal`.
 *
 * The brand is unforgeable on purpose. {@link brandLiveSignal} is the ONLY way to
 * stamp it, and the only thing that calls it is `@kolu/surface-app`'s
 * `createLiveSignal` — the seam that derives the liveness accessor AND wires the
 * heartbeat watchdog in the SAME call (so `connectSurface`/`connectSurfaces` and
 * any hand-built client mint the brand only THROUGH a real watchdog). Minting a
 * `LiveSignal` is the promise "a watchdog forces this socket's `live` to flip
 * false when it half-opens"; there is no path to the brand that skips the
 * watchdog, so the half-open-blind lie can no longer be SPELLED — not merely not
 * rendered.
 */

import type { Accessor } from "solid-js";

/** The unforgeable brand. Module-private — nothing outside this file can name it,
 *  so the only way to stamp a `LiveSignal` is {@link brandLiveSignal}. */
const LIVE_SIGNAL_BRAND = Symbol("kolu.surface.liveSignal");

/** A transport-liveness accessor a connect seam minted AFTER wiring the half-open
 *  watchdog — the only `{ live }` `surfaceClient`/`surfaceClients` accept over a
 *  half-openable websocket link. Structurally an `Accessor<boolean>` plus the
 *  unforgeable {@link LIVE_SIGNAL_BRAND}. */
export type LiveSignal = Accessor<boolean> & {
  readonly [LIVE_SIGNAL_BRAND]: true;
};

/** Stamp a liveness accessor as a {@link LiveSignal}.
 *
 *  INTERNAL — call ONLY from `@kolu/surface-app`'s `createLiveSignal`, and ONLY
 *  after wiring the half-open heartbeat the brand asserts. The stamp is a promise
 *  that a watchdog backs this signal; stamping a raw open/close (or constant-true)
 *  accessor would forge that promise and re-introduce the green-over-a-dead-link
 *  lie under a brand the guard trusts. Mutates `live` in place (a symbol property
 *  on the function — the accessor's call behaviour is unchanged) and returns it. */
export function brandLiveSignal(live: Accessor<boolean>): LiveSignal {
  return Object.assign(live, {
    [LIVE_SIGNAL_BRAND]: true as const,
  }) as LiveSignal;
}

/** True if `live` carries the {@link LiveSignal} brand — i.e. a connect seam minted
 *  it through `createLiveSignal` after wiring the half-open watchdog.
 *  `requireTransportLive` consults this to refuse a bare/open-close-only signal
 *  over a half-openable link (a missing OR unbranded `{ live }` both fail). */
export function isLiveSignal(live: unknown): live is LiveSignal {
  return (
    typeof live === "function" &&
    (live as unknown as Record<symbol, unknown>)[LIVE_SIGNAL_BRAND] === true
  );
}
