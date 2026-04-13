/**
 * Re-fit a terminal when the browser tab regains visibility.
 *
 * WHY THIS EXISTS (see #217):
 *
 * Browsers may pause or coalesce ResizeObserver callbacks while a tab is
 * in the background. If something changes the container size while the tab
 * is hidden — window resize, display scaling change, OS sleep/wake cycle,
 * sidebar layout shift — ResizeObserver might not fire a catch-up callback
 * when the tab returns. xterm.js is then stuck with stale dimensions,
 * typically rendering narrower than its container. A full page refresh was
 * the only workaround.
 *
 * The bug is NOT reliably reproducible because modern browsers *usually*
 * deliver a pending ResizeObserver entry on tab return — but not always,
 * especially after sleep/wake or WebGL context loss. The race depends on
 * browser internals, OS power management, and timing.
 *
 * This listener is defensive: `visibilitychange` is a guaranteed event, so
 * we always re-fit on tab return regardless of whether ResizeObserver caught
 * up. The cost is one debounced fit() call per tab switch — negligible.
 *
 * Must be called inside a SolidJS owner (e.g. onMount) so makeEventListener
 * auto-cleans up on dispose.
 */

import { makeEventListener } from "@solid-primitives/event-listener";

export function refitOnTabVisible(
  debouncedFit: () => void,
  isVisible?: () => boolean,
) {
  makeEventListener(document, "visibilitychange", () => {
    if (!document.hidden && (isVisible?.() ?? true)) debouncedFit();
  });
}
