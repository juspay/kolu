import { makeEventListener } from "@solid-primitives/event-listener";

/**
 * Sync `--app-h` on `<html>` to the visible height in LAYOUT pixels so layouts
 * can use `height: var(--app-h, 100dvh)` for keyboard-aware sizing.
 *
 * iOS Safari (current versions) overlays the soft keyboard on top of the
 * layout viewport — `100dvh` does NOT shrink when the keyboard opens, so
 * focused inputs end up under the keyboard. `interactive-widget=resizes-content`
 * in the viewport meta is the standard CSS fix but iOS Safari ignores it
 * (WebKit standards-position open). VisualViewport.height does track the
 * visible area, so we use that as an override.
 *
 * `visualViewport.height` is measured in VISUAL pixels, so under page
 * magnification (`scale > 1` — a trackpad pinch the browser handled itself) it
 * reports the window height divided by the scale while the CSS layout width
 * stays put. Writing that raw number made the shell 1600×625 inside a 1600×813
 * window and refit every terminal (#2354), so the scale is multiplied back out:
 * `height × scale` is the window's height in the layout pixels the CSS box is
 * drawn in. Rounded to hundredths — the product carries float noise that would
 * otherwise jitter layout on every resize event.
 *
 * Scale is 1 in every case the override exists for: an iOS keyboard shrinks
 * `height` and leaves `scale` alone, so that behaviour is unchanged. On a
 * platform with no keyboard overlay the result equals `innerHeight`, making the
 * override a no-op there.
 */
export function useVisualViewportHeight(): void {
  const vv = window.visualViewport;
  if (!vv) return;
  const sync = () => {
    const layoutHeight = Math.round(vv.height * vv.scale * 100) / 100;
    document.documentElement.style.setProperty("--app-h", `${layoutHeight}px`);
  };
  sync();
  makeEventListener(vv, "resize", sync);
}
