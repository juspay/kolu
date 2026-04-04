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

/** Scrollback buffer size in lines. Matches Ghostty's ~10K default. */
export const DEFAULT_SCROLLBACK = 10_000;

/** Seconds of no PTY output before a terminal is considered idle/sleeping. */
export const ACTIVITY_IDLE_THRESHOLD_S = 5;

/** Rolling window for activity history (ms). Both server and client use this. */
export const ACTIVITY_WINDOW_MS = 5 * 60 * 1000; // 5 minutes

/** Default user preferences — shared by server (conf defaults) and client (loading fallback). */
import type { Preferences } from "./index";
export const DEFAULT_PREFERENCES: Preferences = {
  seenTips: [],
  startupTips: true,
  randomTheme: true,
  scrollLock: true,
  activityAlerts: true,
  colorScheme: "dark",
};
