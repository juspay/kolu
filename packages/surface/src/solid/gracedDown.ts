/**
 * `gracedDown` — a grace-windowed view of a boolean predicate: it tracks a
 * `source` accessor but DELAYS its rising edge, so a `false → true → false`
 * blink that resolves inside `ms` never shows as `true`, while a sustained
 * `true` does once the window elapses. The falling edge is INSTANT (no second
 * window on the way down).
 *
 * The motivating use is a full-screen "Disconnected" overlay over a transport's
 * instantaneous `down` status: a forced reconnect (a half-open watchdog
 * recovering, partysocket riding out a Wi-Fi roam) closes and reopens the socket
 * in well under a second, and flashing the alarm for that blink is noise — but
 * the status itself must stay instantaneous for the header dot and the heartbeat
 * gate, so the grace lives in a SEPARATE derived signal, not folded onto the
 * status. It is deliberately typed over a bare `boolean` predicate — NOT a
 * transport's `ConnectionStatus` (which lives downstream in `@kolu/surface-app`;
 * importing it here would invert the workspace dependency arrow) — so any source
 * that can express "is the thing I'd debounce currently true?" reuses it.
 *
 * Hand-rolled rather than `@solid-primitives/scheduled`'s `debounce`: that
 * debounces BOTH edges (we need an instant falling edge) and SSR-no-ops, so it is
 * not a drop-in. The timer is the asymmetry, owned here in one place.
 */

import {
  type Accessor,
  createEffect,
  createSignal,
  onCleanup,
  untrack,
} from "solid-js";

/** A grace-windowed view of `source`: `true` only once `source()` has stayed
 *  `true` continuously for `ms`; back to `false` the instant `source()` drops.
 *  Built from a `createEffect` over `source` + a single `setTimeout`, so it works
 *  identically for any boolean accessor and disposes its pending timer with its
 *  owner. Call under a reactive owner (a component / `createRoot`). */
export function gracedDown(
  source: Accessor<boolean>,
  ms: number,
): Accessor<boolean> {
  const [shown, setShown] = createSignal(false);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const clearTimer = (): void => {
    if (timer !== undefined) {
      clearTimeout(timer);
      timer = undefined;
    }
  };
  createEffect(() => {
    if (source()) {
      // Rising edge: arm the grace window ONCE. A repeat `true` (the predicate
      // re-firing while still up) must not reset a pending window, and once shown
      // there is nothing left to arm. `untrack` keeps the effect reacting to
      // `source` alone — `shown` is this signal's OWN output, not a dependency.
      if (timer === undefined && !untrack(shown)) {
        timer = setTimeout(() => {
          timer = undefined;
          // Re-read truth at fire: only show if `source` is STILL true.
          if (source()) setShown(true);
        }, ms);
      }
    } else {
      // Falling edge: cancel a pending show and hide INSTANTLY — the asymmetry
      // (the grace delays only the rise) is the whole point.
      clearTimer();
      if (untrack(shown)) setShown(false);
    }
  });
  onCleanup(clearTimer);
  return shown;
}
