import type { Preferences } from "./index";

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

/** Scrollback buffer size in lines. Sized for multi-hour Claude sessions
 *  so PDF export (see `exportSessionAsPdf.ts`) captures a useful window —
 *  the export reads from this same ring buffer. Per-line memory in xterm
 *  is small, so 50K is low tens of MB per terminal in the worst case. */
export const DEFAULT_SCROLLBACK = 50_000;

/** Seconds of no PTY output before a terminal is considered idle/sleeping. */
export const ACTIVITY_IDLE_THRESHOLD_S = 5;

/** Rolling window for activity history (ms). Both server and client use this. */
export const ACTIVITY_WINDOW_MS = 5 * 60 * 1000; // 5 minutes

/** Default preference values — single source of truth for server and client. */
export const DEFAULT_PREFERENCES: Preferences = {
  seenTips: [],
  startupTips: true,
  shuffleTheme: true,
  scrollLock: true,
  activityAlerts: true,
  colorScheme: "dark",
  sidebarAgentPreviews: "attention",
  canvasMode: false,
  terminalRenderer: "auto",
  rightPanel: {
    collapsed: true,
    size: 0.25,
    tab: { kind: "inspector" },
    pinned: true,
  },
};
