/**
 * `onWake` — wire the browser "the runtime may have just resumed" signals to a
 * `wake` callback (the heartbeat's fast resume re-probe), and return a detacher.
 *
 * Two signals, because no single one covers every resume:
 *   - `window`'s `focus` fires on app-switch return (alt-tab / Cmd-Tab), which
 *     keeps `document.visibilityState === "visible"` and fires NO
 *     `visibilitychange` (the same fact `renderRecovery.ts` is built on);
 *   - `document`'s `visibilitychange` → visible covers a real tab switch.
 * Both only ever PROBE (the heartbeat's `wake()` can only cause an extra probe,
 * never a stale verdict), so firing both — even redundantly on a resume that
 * trips both — is harmless.
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
  const onFocus = () => wake();
  const onVisible = () => {
    if (document.visibilityState === "visible") wake();
  };
  window.addEventListener("focus", onFocus);
  document.addEventListener("visibilitychange", onVisible);
  return () => {
    window.removeEventListener("focus", onFocus);
    document.removeEventListener("visibilitychange", onVisible);
  };
}
