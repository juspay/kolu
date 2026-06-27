/**
 * `onWake` — wire the browser "the runtime may have just resumed" signals to a
 * `wake` callback (the heartbeat's fast resume re-probe), and return a detacher.
 *
 * Three signals, because no single one covers every resume:
 *   - `window`'s `focus` fires on app-switch return (alt-tab / Cmd-Tab), which
 *     keeps `document.visibilityState === "visible"` and fires NO
 *     `visibilitychange` (the same fact `renderRecovery.ts` is built on);
 *   - `document`'s `visibilitychange` → visible covers a real tab switch;
 *   - `document`'s Page-Lifecycle `resume` fires when a FROZEN tab unfreezes
 *     (background discard, `chrome://discards` "Freeze") — and fires BEFORE the
 *     page's frozen timer tasks resume, so it re-probes ahead of the overdue
 *     probe-timeout the freeze left armed (the freeze is OS-awake, so the
 *     wall/monotonic gap the void watches is ~0 — `resume` is what catches it).
 * All three only ever ask the heartbeat to re-PROBE, so firing several — even
 * redundantly on a resume that trips more than one — is harmless: a wake over a
 * healthy link just re-probes it. (The one case a wake settles `onStale` is the
 * watchdog's own backstop — a never-settling probe that a storm of wakes has kept
 * re-arming past the void budget; see `createHeartbeat`'s `wake`. That is the
 * watchdog firing as designed, not this seam forcing a verdict.)
 *
 * Crucially, visibility is wired only to PROBE, never to VOID. A merely-hidden
 * tab is still RUNNING, so its probe timeout is REAL — voiding on `hidden` would
 * blind the watchdog to a genuine half-open during a long background (and is a
 * coverage regression for a consumer with a hidden-but-live streaming tab). Only
 * a MEASURED clock discontinuity (the framework-free core's own arithmetic) ever
 * voids; this seam just lets a real wake re-probe sooner than the next interval.
 *
 * DOM-guarded: a no-op (an empty detacher) where there is no `window` / `document`
 * — the node-env unit suite, SSR — so the off-DOM legs (the ssh HostSession, a
 * server-side mirror) consume the heartbeat without this ever reaching for a DOM.
 */
export function onWake(wake: () => void): () => void {
  if (typeof window === "undefined" || typeof document === "undefined") {
    return () => {};
  }
  // `focus` and `resume` are unconditional re-probes, so `wake` is the listener
  // directly (it ignores the event arg); only `visibilitychange` needs a guard to
  // fire on the visible edge alone.
  const onVisible = () => {
    if (document.visibilityState === "visible") wake();
  };
  window.addEventListener("focus", wake);
  document.addEventListener("visibilitychange", onVisible);
  // `resume` is a Page-Lifecycle event not yet in `DocumentEventMap`, so it lands
  // on `addEventListener`'s string overload — typed but not in the named union.
  document.addEventListener("resume", wake);
  return () => {
    window.removeEventListener("focus", wake);
    document.removeEventListener("visibilitychange", onVisible);
    document.removeEventListener("resume", wake);
  };
}
