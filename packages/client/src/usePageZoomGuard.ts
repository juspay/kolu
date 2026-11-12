import { attachPageZoomGuard } from "@kolu/solid-browser/pageZoom";
import { onCleanup } from "solid-js";

/**
 * Refuse the browser's own page magnification for the whole kolu window.
 *
 * A trackpad pinch arrives as a `wheel` event with `ctrlKey: true`. The canvas
 * claims that event over `canvas-container` and turns it into canvas zoom (see
 * `canvas/viewport/gestures.ts`); over the dock, the right panel or the chrome
 * bar nothing claimed it, so Chrome magnified the document instead. kolu's
 * shell is sized to the window, so magnifying it only pushes the right-hand
 * side and the bottom of the workspace off screen (#2354).
 *
 * The listener is unconditional and runs in the CAPTURE phase: it refuses every
 * `ctrlKey` wheel in the window before any descendant sees it, so a deeper
 * listener that calls `stopPropagation()` without a `preventDefault()` cannot
 * reopen the hole. The canvas's own capture-phase claim still runs — it does
 * not read `defaultPrevented` — and keeps its own `preventDefault`, so that
 * module stays correct on its own.
 *
 * Accepted trade: Chrome cannot distinguish a trackpad pinch from
 * Ctrl+mouse-wheel, so Ctrl+wheel no longer zooms the browser either. The
 * keyboard zoom (Ctrl +/−/0) is untouched — it is not a wheel event.
 *
 * Scope is a deliberate limit of this change, not a claim about kolu: only the
 * `wheel`-based gesture of desktop Chrome/Firefox is refused. Desktop Safari
 * (which does run the canvas) reports a pinch as `gesturestart`/`gesturechange`
 * instead, and a touch device pinches through `touch-action`; neither is
 * handled here, so both can still magnify the page.
 *
 * A sandboxed preview iframe never delivers its wheel events to this window, so
 * it carries the same guard inside its own frame — see
 * `artifact-sdk/src/iframe/index.ts`.
 */
export function usePageZoomGuard(): void {
  onCleanup(attachPageZoomGuard(window));
}
