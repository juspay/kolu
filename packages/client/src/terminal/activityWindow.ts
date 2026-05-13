/** Activity-window vocabulary used by the canvas minimap's window selector.
 *
 *  Single source of truth: each option carries its display label and its
 *  staleness threshold (or `null` for "no filter"). Adding a new window is
 *  one entry in `WINDOWS` plus one in `WINDOW_VALUES` for display order. */

import { HOUR_MS } from "./staleness";

export type MinimapWindow = "all" | "4h" | "12h" | "24h" | "48h";

export interface WindowOption {
  /** Compact label shown inside the minimap trigger button. */
  short: string;
  /** Long label shown in the popover menu and tooltip. */
  label: string;
  /** `null` disables the filter — every tile renders as a full rect. */
  thresholdMs: number | null;
}

/** Single source of truth — a fresh `Record<MinimapWindow, …>` literal is
 *  already exhaustive at the type level: TS's required-property check
 *  fires if a `MinimapWindow` literal is added to the union without a row
 *  here, and excess-property check fires if a row is added without a
 *  matching union member. No casts, no non-null asserts. */
const WINDOWS: Record<MinimapWindow, WindowOption> = {
  all: { short: "All", label: "All terminals", thresholdMs: null },
  "4h": { short: "4h", label: "Active in last 4h", thresholdMs: 4 * HOUR_MS },
  "12h": {
    short: "12h",
    label: "Active in last 12h",
    thresholdMs: 12 * HOUR_MS,
  },
  "24h": {
    short: "24h",
    label: "Active in last 24h",
    thresholdMs: 24 * HOUR_MS,
  },
  "48h": {
    short: "48h",
    label: "Active in last 48h",
    thresholdMs: 48 * HOUR_MS,
  },
};

/** Display-order list for the popover menu. Object iteration order is the
 *  declaration order above for string keys, but encode it once here so a
 *  reader doesn't have to rely on that invariant at every consumer. */
export const WINDOW_VALUES: readonly MinimapWindow[] = [
  "all",
  "4h",
  "12h",
  "24h",
  "48h",
];

export function isMinimapWindow(value: string): value is MinimapWindow {
  return value in WINDOWS;
}

export function windowOption(w: MinimapWindow): WindowOption {
  return WINDOWS[w];
}
