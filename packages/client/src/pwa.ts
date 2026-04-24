/**
 * PWA deploy-synchronization helpers. Owns "make sure the user's next
 * navigation lands on the fresh build" — so callers (right now just the
 * `TransportOverlay` restart button) don't have to know about
 * `navigator.serviceWorker` at all.
 *
 * Extracting this boundary also means future additions (version-hash
 * comparison, install-progress UI, analytics on reload) land here instead
 * of growing a `TransportOverlay` whose declared role is transport-state
 * display, not SW lifecycle.
 */

/**
 * Install any pending service-worker update, then reload the page.
 *
 * Without the `update()` await, the reload serves the old Workbox precache
 * while the new SW is still installing — the user sees stale UI until a
 * *second* reload. Awaiting the Update algorithm (§3.2.8 of the SW spec)
 * ensures the new SW has installed and (with `skipWaiting`+`clientsClaim`,
 * which vite-plugin-pwa's autoUpdate mode enables by default) is controlling
 * the page before navigation fires.
 *
 * Safe on HTTP: `navigator.serviceWorker` is `undefined` in insecure
 * contexts per the `[SecureContext]` IDL annotation, so the optional
 * chain short-circuits and the reload proceeds as a plain navigation.
 */
export async function forceUpdateAndReload(): Promise<void> {
  try {
    const reg = await navigator.serviceWorker?.getRegistration();
    await reg?.update();
  } catch (err) {
    // Best-effort: the user clicked Reload, honour that intent even if the
    // SW update couldn't complete (network drop mid-click, script parse
    // error, etc.). Log so a chronically-failing update doesn't hide.
    console.warn("SW update before reload failed:", err);
  }
  location.reload();
}
