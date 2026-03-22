/**
 * Keyboard shortcut helpers — platform-aware Cmd/Ctrl detection.
 *
 * Consolidates the duplicated platform modifier logic that was spread
 * across Terminal.tsx and CommandPalette.tsx.
 */

import { isMac } from "./platform";

/** Check if the platform modifier key (Cmd on macOS, Ctrl elsewhere) is pressed. */
export function isPlatformModifier(e: KeyboardEvent): boolean {
  return isMac ? e.metaKey : e.ctrlKey;
}

/** Zoom key deltas: maps key to font-size change direction. */
export const ZOOM_KEYS: Record<string, 1 | -1> = { "=": 1, "+": 1, "-": -1 };
