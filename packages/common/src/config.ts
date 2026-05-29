/**
 * Centralized config defaults for kolu.
 *
 * Collects magic numbers that were scattered across client and server
 * modules into one place so they stay in sync. `DEFAULT_PREFERENCES`
 * lives in `./surface` (next to `PreferencesSchema`) — config.ts holds
 * only typeless constants that don't depend on the surface domain.
 */

/** Default server port. */
export const DEFAULT_PORT = 7681;

/** Default font size for the terminal (px). */
export const DEFAULT_FONT_SIZE = 14;

/** Scrollback buffer size in lines. Sized for multi-hour Claude sessions
 *  so PDF export (see `exportScrollbackAsPdf.ts`) captures a useful window —
 *  the export reads from this same ring buffer. Per-line memory in xterm
 *  is small, so 50K is low tens of MB per terminal in the worst case.
 *
 *  Single source of truth for both the client's visible scrollback and the
 *  server's headless ring buffer — the local backend reads this and passes
 *  it to `@kolu/pty-host`'s `spawn` so the server-side headless terminal
 *  stays in lock-step with what the client renders. */
export const DEFAULT_SCROLLBACK = 50_000;
