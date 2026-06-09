/**
 * Keyboard zoom — owns font-size signal, localStorage persistence, and key capture.
 *
 * Per-terminal: each terminal gets its own persisted font size.
 * Cmd/Ctrl +/- to zoom in/out, Cmd/Ctrl+0 to reset.
 */

import { makeEventListener } from "@solid-primitives/event-listener";
import { DEFAULT_FONT_SIZE } from "kolu-common/config";
import type { TerminalId } from "kolu-common/surface";
import { persistedPref } from "../persistedPref";
import { isPlatformModifier, ZOOM_KEYS } from "./keyboard";

/**
 * Reactive font-size signal driven by Cmd/Ctrl +/- and Cmd/Ctrl+0 (reset).
 * Call inside a component — cleanup is automatic via @solid-primitives/event-listener.
 *
 * @param terminalId — persistence key (each terminal remembers its own zoom level)
 * @param isActive — accessor; zoom keys only apply when true. Callers pass the
 *   *focused* state, not visibility: in canvas mode every tile is visible, so a
 *   visibility gate would zoom all tiles at once (#1238). Exactly one tile is
 *   focused (the active one in canvas; the single visible one in mobile), so
 *   only that terminal handles the zoom keys.
 */
export function createZoom(terminalId: TerminalId, isActive: () => boolean) {
  const [fontSize, setFontSize] = persistedPref<number>({
    name: `kolu-font-size-${terminalId}`,
    fallback: DEFAULT_FONT_SIZE,
    serialize: String,
    // Guard the read: `Number("garbage")` is `NaN`, which would otherwise
    // become the font size. Reject non-finite / non-positive and fall back.
    parse: (raw) => {
      const n = Number(raw);
      if (!Number.isFinite(n) || n <= 0) {
        throw new Error(`invalid persisted font size: ${raw}`);
      }
      return n;
    },
  });

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
