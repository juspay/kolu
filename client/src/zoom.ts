/**
 * Keyboard zoom — owns font-size signal, localStorage persistence, and key capture.
 *
 * Per-terminal: each terminal gets its own persisted font size.
 * Cmd/Ctrl +/- to zoom in/out, Cmd/Ctrl+0 to reset.
 */
import { createSignal } from "solid-js";
import { makeEventListener } from "@solid-primitives/event-listener";
import { makePersisted } from "@solid-primitives/storage";
import { DEFAULT_FONT_SIZE } from "kolu-common/config";
import { isPlatformModifier, ZOOM_KEYS } from "./keyboard";
import type { TerminalId } from "kolu-common";

/**
 * Reactive font-size signal driven by Cmd/Ctrl +/- and Cmd/Ctrl+0 (reset).
 * Call inside a component — cleanup is automatic via @solid-primitives/event-listener.
 *
 * @param terminalId — persistence key (each terminal remembers its own zoom level)
 * @param isActive — accessor; zoom keys only apply when true (only the visible terminal zooms)
 */
export function createZoom(terminalId: TerminalId, isActive: () => boolean) {
  const [fontSize, setFontSize] = makePersisted(
    createSignal(DEFAULT_FONT_SIZE),
    {
      name: `kolu-font-size-${terminalId}`,
      serialize: String,
      deserialize: Number,
    },
  );

  // Capture phase: intercept before xterm's own keydown handler in bubble phase
  makeEventListener(
    window,
    "keydown",
    (e: KeyboardEvent) => {
      if (!isActive()) return;
      if (!isPlatformModifier(e)) return;

      // Reset to default
      if (e.key === "0") {
        e.preventDefault();
        e.stopPropagation();
        setFontSize(DEFAULT_FONT_SIZE);
        return;
      }

      // Zoom in/out
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
