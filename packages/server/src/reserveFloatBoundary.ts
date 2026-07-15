/**
 * kolu-server's NARROW, LOUD, REMOVAL-CONDITIONED survival boundary for the
 * padiBinding "reconnects when padi dies" residual (juspay/kolu#1719's survivor).
 *
 * ## What it survives, and why kolu can only survive it (not fix it)
 * When a bound padi dies mid-reconnect while a browser (or the in-process
 * `directLink` the re-serve is dialed through) is attached to a terminal, the
 * re-served `terminalAttach` relay's upstream subscribe can be torn down while its
 * response is in flight. oRPC's `ClientPeer.request` then abandons an INTERMEDIATE
 * promise in its streaming-response handling; when `handleTransportClosed →
 * peer.close({ reason })` rejects the parked response pull with the typed
 * transport-closed `ORPCError` (`SURFACE_STDIO_TRANSPORT_CLOSED` — the one owned,
 * greppable shape #1719 made cross the stdio seam), that abandoned promise floats as
 * an unhandled rejection. Under kolu-server's fatal-by-design `unhandledRejection`
 * policy (`index.ts`) that would CRASH the whole server on a benign dependency
 * teardown float.
 *
 * ## The residual wears TWO shapes (one mechanism)
 * The float carries whatever value reaches that abandoned intermediate promise:
 * - `SURFACE_STDIO_TRANSPORT_CLOSED` — the raw stdio close, when the relay's own
 *   parked pull is what floats ({@link isSurfaceStdioTransportClosed}).
 * - `SURFACE_RELAY_TRANSPORT_LOST` — the SAME stdio close after the re-serve relay
 *   (`failThroughStreamCore`, `@kolu/surface-remote`) CATCHES it mid-stream and
 *   re-throws it WRAPPED as its retryable middle-hop end (`RelayTransportLostError`,
 *   so a LIVE client re-subscribes end-to-end). Post-#1822 the abandoned float
 *   surfaces as this wrapped shape ({@link isSurfaceRelayTransportLost}).
 * Both are the one un-ownable oRPC-internal residual; the boundary survives EITHER,
 * via {@link isSurvivableReserveFloat}, and nothing else. The relay re-throws genuine
 * application errors UNCHANGED, so neither survivable code can ever be an app error.
 *
 * kolu proved it cannot OWN that promise from any of its own layers — seven
 * public-API ownership seams were measured (the reServe handler pull IS owned, via
 * `@kolu/surface`'s `ownReadAheadPull`, which removes ~67% of these floats; the
 * remaining ~3% is this oRPC-internal intermediate promise, reachable by NONE of:
 * owning the request/`.get()`/pull results, threading a clean-abort teardown signal,
 * or wrapping the client). Per architecture-first-principles P5, the "this promise
 * is owned/settled" guarantee belongs to the layer that knows enough to complete it —
 * INSIDE oRPC — and a lower layer (kolu) may optimize but cannot guarantee. So kolu's
 * honest role is: optimize what it reaches (`ownReadAheadPull`) + SURVIVE what it
 * can't (this boundary) + push the real fix to the knowing layer (the upstream oRPC
 * issue). A fork to jam kolu into oRPC's layer for a 3%-rare float is a
 * disproportionate standing maintenance tax on a core dep; srid ruled it out.
 *
 * ## Why this is NOT a fail-fast hole
 * - **NARROW.** {@link isSurvivableReserveFloat} matches nothing but those two owned
 *   typed transport-teardown codes; a rejection of ANY other shape stays fatal (the
 *   caller keeps its `process.exit(1)`). And narrow BY CONSTRUCTION: `unhandledRejection` fires
 *   ONLY for ABANDONED rejections — a LIVE consumer's typed error is handled by that
 *   consumer and never reaches here, so a fail-through relay's re-throw (which a
 *   browser's `consumeReattachingStream` re-attaches on) is untouched. Only the
 *   orphaned float is survived.
 * - **LOUD.** Every survived float logs a marked ERROR ({@link
 *   RESERVE_TRANSPORT_FLOAT_MARKER}) carrying the reason — greppable in CI / the
 *   server log so an operator enumerates every float the boundary kept the server
 *   alive through. Never silent. This is #1792's loud-not-fatal doctrine extended to
 *   the consumer side, now JUSTIFIED because kolu-side ownership is proven insufficient.
 * - **REMOVAL-CONDITIONED.** This boundary is TEMPORARY, tied to the upstream oRPC
 *   fix. When oRPC settles its own abandoned response promise on `close` and we bump
 *   the pinned oRPC version, DELETE this module + its wiring in `index.ts`, and revert
 *   the padiBinding reconnect test to a plain zero-unhandled-rejection assertion.
 *   Tracked in the flaky-test-tracker row for #1719. Not permanent-by-forgetting.
 *
 * (A sibling latent crash almost certainly exists in drishti-server — the other
 * `@kolu/surface` re-serve consumer — on the same oRPC float; called out in the
 * upstream issue and tracked as a drishti follow-up, out of scope here.)
 */

import {
  isSurfaceRelayTransportLost,
  isSurfaceStdioTransportClosed,
} from "@kolu/surface/client";

/** The two shapes the ONE residual float wears — both benign abandoned re-serve
 *  transport-teardown signals, never an application error:
 *  - {@link isSurfaceStdioTransportClosed}: the raw stdio close (the padi link dying).
 *  - {@link isSurfaceRelayTransportLost}: SR5's re-serve relay CATCHING that stdio
 *    close mid-stream and re-throwing it WRAPPED as the retryable relay end
 *    (`RelayTransportLostError`). Post-#1822 the residual floats carrying THIS shape.
 *  Both are the SAME un-ownable oRPC-internal residual (P5); the boundary survives
 *  either and NOTHING else. Both codes are removed together when the upstream oRPC
 *  fix lands. */
function isSurvivableReserveFloat(reason: unknown): boolean {
  return (
    isSurfaceStdioTransportClosed(reason) || isSurfaceRelayTransportLost(reason)
  );
}

/** The greppable marker every survived float carries. Grep CI logs / the server log
 *  for it to enumerate every oRPC-upstream float this boundary kept kolu-server alive
 *  through — each one is a reminder the upstream fix is still pending, not an accepted
 *  cost. */
export const RESERVE_TRANSPORT_FLOAT_MARKER =
  "reserve-transport-closed-float-boundary";

/** The minimal logger shape this boundary needs (a pino-style `error`). */
export interface FloatBoundaryLog {
  error: (obj: Record<string, unknown>, msg: string) => void;
}

/**
 * The NARROW-LOUD boundary decision for one `unhandledRejection`. Returns `true` iff
 * the rejection is the ONE survivable typed transport-closed float — the caller then
 * LOGS it loud (already done here) and does NOT crash. Returns `false` for every
 * other rejection — the caller then applies its OWN fatal policy (kolu-server:
 * `process.exit(1)`), so a genuinely-corrupting float still fails loud.
 *
 * `onCaught` is an optional observer (a test records the survived float to assert the
 * daemon survived it); it must not throw (a throwing observer would itself float).
 */
export function surviveReserveTransportFloat(
  reason: unknown,
  log: FloatBoundaryLog,
  onCaught?: (reason: unknown) => void,
): boolean {
  if (!isSurvivableReserveFloat(reason)) return false;
  log.error(
    {
      marker: RESERVE_TRANSPORT_FLOAT_MARKER,
      err: reason instanceof Error ? reason : undefined,
      reason: reason instanceof Error ? undefined : reason,
    },
    `${RESERVE_TRANSPORT_FLOAT_MARKER}: a re-served terminal stream floated its typed ` +
      "transport-closed rejection (an oRPC-upstream intermediate-promise abandon on a " +
      "padi reconnect — kolu cannot own it, tracked upstream). kolu-server SURVIVES " +
      "(loud boundary, temporary — remove when the oRPC fix lands). Reconnect proceeds.",
  );
  try {
    onCaught?.(reason);
  } catch {
    // An observer that throws must not itself float; swallow (the boundary's whole
    // job is to keep this rejection from crashing the process).
  }
  return true;
}
