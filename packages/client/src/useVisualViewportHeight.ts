import { makeEventListener } from "@solid-primitives/event-listener";

/**
 * Sync `--app-h` on `<html>` to `window.visualViewport.height` so layouts can
 * use `height: var(--app-h, 100dvh)` for keyboard-aware sizing.
 *
 * iOS Safari (current versions) overlays the soft keyboard on top of the
 * layout viewport — `100dvh` does NOT shrink when the keyboard opens, so
 * focused inputs end up under the keyboard. `interactive-widget=resizes-content`
 * in the viewport meta is the standard CSS fix but iOS Safari ignores it
 * (WebKit standards-position open). VisualViewport.height does track the
 * visible area, so we use that as an override.
 *
 * Other platforms are safe: visualViewport.height equals innerHeight when
 * no keyboard is open, and shrinks the same as dvh on Chrome Android — the
 * override is a no-op there.
 */
export function useVisualViewportHeight(): void {
  const vv = window.visualViewport;
  if (!vv) return;
  const sync = () => {
    document.documentElement.style.setProperty("--app-h", `${vv.height}px`);
  };
  sync();
  makeEventListener(vv, "resize", sync);
}
