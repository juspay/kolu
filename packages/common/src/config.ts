/**
 * Centralized config defaults for kolu.
 *
 * Collects magic numbers that were scattered across client and server
 * modules into one place so they stay in sync. `DEFAULT_PREFERENCES`
 * lives in `./surface` (next to `PreferencesSchema`) — config.ts holds
 * only typeless constants that don't depend on the surface domain.
 */

/** Default terminal grid dimensions (matches xterm/VT100 standard). */
export const DEFAULT_COLS = 80;
export const DEFAULT_ROWS = 24;

/** Default server port. */
export const DEFAULT_PORT = 7681;

/** Default font size for the terminal (px). */
export const DEFAULT_FONT_SIZE = 14;

/** Scrollback buffer size in lines. Sized for multi-hour Claude sessions
 *  so PDF export (see `exportScrollbackAsPdf.ts`) captures a useful window —
 *  the export reads from this same ring buffer. Per-line memory in xterm
 *  is small, so 50K is low tens of MB per terminal in the worst case. */
export const DEFAULT_SCROLLBACK = 50_000;
