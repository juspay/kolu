/** Activity-window vocabulary used by the canvas minimap's window selector.
 *
 *  Single source of truth: each option carries its display label and its
 *  staleness threshold (or `null` for "no filter"). Adding a new window is
 *  one entry in `WINDOW_OPTIONS` and zero edits elsewhere. */

import { HOUR_MS } from "./staleness";

export type MinimapWindow = "all" | "4h" | "12h" | "24h" | "48h";

export interface WindowOption {
  value: MinimapWindow;
  label: string;
  /** `null` disables the filter — every tile renders as a full rect. */
  thresholdMs: number | null;
}

export const WINDOW_OPTIONS: readonly WindowOption[] = [
  { value: "all", label: "All terminals", thresholdMs: null },
  { value: "4h", label: "Active in last 4h", thresholdMs: 4 * HOUR_MS },
  { value: "12h", label: "Active in last 12h", thresholdMs: 12 * HOUR_MS },
  { value: "24h", label: "Active in last 24h", thresholdMs: 24 * HOUR_MS },
  { value: "48h", label: "Active in last 48h", thresholdMs: 48 * HOUR_MS },
];

/** Lookup table keyed by `MinimapWindow` for O(1) reads. Derived from
 *  `WINDOW_OPTIONS` so the array stays the source of truth. */
const BY_VALUE: Record<MinimapWindow, WindowOption> = Object.fromEntries(
  WINDOW_OPTIONS.map((o) => [o.value, o]),
) as Record<MinimapWindow, WindowOption>;

export function isMinimapWindow(value: string): value is MinimapWindow {
  return value in BY_VALUE;
}

export function windowOption(w: MinimapWindow): WindowOption {
  return BY_VALUE[w];
}
