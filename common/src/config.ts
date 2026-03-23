/**
 * Centralized config defaults for kolu.
 *
 * Collects magic numbers that were scattered across client and server
 * modules into one place so they stay in sync.
 */

/** Default terminal grid dimensions (matches xterm/VT100 standard). */
export const DEFAULT_COLS = 80;
export const DEFAULT_ROWS = 24;

/** Default server port. */
export const DEFAULT_PORT = 7681;

/** Default font size for the terminal (px). */
export const DEFAULT_FONT_SIZE = 14;

/** Seconds of no PTY output before a terminal is considered idle/sleeping. */
export const ACTIVITY_IDLE_THRESHOLD_S = 5;
