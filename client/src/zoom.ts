/**
 * Keyboard zoom — owns font-size signal, localStorage persistence, and key capture.
 *
 * Separated from Terminal so the terminal component consumes fontSize
 * reactively without knowing how it's produced or persisted.
 */
import { createSignal } from "solid-js";
import { makeEventListener } from "@solid-primitives/event-listener";
import { makePersisted } from "@solid-primitives/storage";
import { DEFAULT_FONT_SIZE } from "kolu-common/config";
import { isPlatformModifier, ZOOM_KEYS } from "./keyboard";

const FONT_SIZE_KEY = "kolu-font-size";

/**
 * Reactive font-size signal driven by Cmd/Ctrl +/-.
 * Call inside a component — cleanup is automatic via @solid-primitives/event-listener.
 *
 * @param isActive — accessor; zoom keys only apply when true (for multi-terminal, only the visible one zooms)
 */
export function createZoom(isActive: () => boolean) {
  const [fontSize, setFontSize] = makePersisted(
    createSignal(DEFAULT_FONT_SIZE),
    { name: FONT_SIZE_KEY, serialize: String, deserialize: Number },
  );

  // Capture phase: intercept before xterm's own keydown handler in bubble phase
  makeEventListener(
    window,
    "keydown",
    (e: KeyboardEvent) => {
      if (!isActive()) return;
      if (!isPlatformModifier(e)) return;
      const delta = ZOOM_KEYS[e.key];
      if (!delta) return;
      e.preventDefault();
      e.stopPropagation();
      setFontSize((prev) => prev + delta);
    },
    { capture: true },
  );

  return fontSize;
}
