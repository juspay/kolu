/**
 * Keyboard zoom — owns font-size signal, localStorage persistence, and key capture.
 *
 * Separated from Terminal so the terminal component consumes fontSize
 * reactively without knowing how it's produced or persisted.
 */
import { createSignal, onCleanup } from "solid-js";

const FONT_SIZE_KEY = "kolu-font-size";
const DEFAULT_FONT_SIZE = 14;
const isMac = /Mac|iPhone|iPad/.test(navigator.userAgent);
const ZOOM_KEYS: Record<string, 1 | -1> = { "=": 1, "+": 1, "-": -1 };

/** Reactive font-size signal driven by Cmd/Ctrl +/-. Call inside a component. */
export function createZoom() {
  const [fontSize, setFontSize] = createSignal(
    Number(localStorage.getItem(FONT_SIZE_KEY)) || DEFAULT_FONT_SIZE,
  );

  function handleZoomKeys(e: KeyboardEvent) {
    if (!(isMac ? e.metaKey : e.ctrlKey)) return;
    const delta = ZOOM_KEYS[e.key];
    if (!delta) return;
    e.preventDefault();
    e.stopPropagation();
    setFontSize((prev) => {
      const next = prev + delta;
      localStorage.setItem(FONT_SIZE_KEY, String(next));
      return next;
    });
  }

  // Capture phase: intercept before ghostty's own keydown handler in bubble phase
  window.addEventListener("keydown", handleZoomKeys, { capture: true });
  onCleanup(() =>
    window.removeEventListener("keydown", handleZoomKeys, { capture: true }),
  );

  return fontSize;
}
