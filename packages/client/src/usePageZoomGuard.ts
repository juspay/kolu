import { makeEventListener } from "@solid-primitives/event-listener";

/**
 * Stop the browser from MAGNIFYING the page (visual-viewport scale ≠ 1).
 *
 * A trackpad pinch is delivered to a page as a `wheel` event with
 * `ctrlKey: true`. The canvas claims that event over `canvas-container`
 * (capture phase, see `canvas/viewport/gestures.ts`) and turns it into canvas
 * zoom — but a pinch that lands on the dock, the right panel or the chrome bar
 * reaches nobody, so Chrome magnifies the whole document instead. kolu's shell
 * is sized to the window, so magnification is never what the user wanted: the
 * layout keeps the window's width while `visualViewport.height` shrinks by
 * 1/scale, the root's `--app-h` follows it, and every terminal refits to a
 * shorter grid (#2354).
 *
 * One window-level, non-passive, bubble-phase listener is the whole fix: by the
 * time an event bubbles to `window` any surface that wanted it (the canvas) has
 * already consumed it, and everything else gets `preventDefault()` — no
 * magnification, anywhere in kolu.
 *
 * Accepted trade: Chrome cannot distinguish a trackpad pinch from
 * Ctrl+mouse-wheel, so Ctrl+wheel no longer zooms the browser either. The
 * keyboard zoom (Ctrl +/−/0) is untouched — it is not a wheel event.
 *
 * Desktop Chrome/Firefox only, deliberately: Safari sends `gesturestart`/
 * `gesturechange` instead, and a touch device pinches via `touch-action`, not
 * wheel. Neither is a surface kolu runs its canvas on today.
 */
export function usePageZoomGuard(): void {
  makeEventListener(
    window,
    "wheel",
    (e) => {
      if (e.ctrlKey) e.preventDefault();
    },
    { passive: false },
  );
}
