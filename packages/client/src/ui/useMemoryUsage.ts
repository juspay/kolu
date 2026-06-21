/**
 * Live memory readouts for the chrome bar's identity rail (and the Diagnostic
 * Info dialog) — one singleton subscription each consumer shares.
 *
 * Three figures, two sources:
 *   - `serverRssBytes` / `kavalRssBytes` ride the server-pushed `processMemory`
 *     cell (the server samples both; see `server/src/memorySampler.ts`).
 *   - `clientHeapUsedBytes` is a browser-local read off `performance.memory`,
 *     refreshed each second off the SHARED app clock (`getClockNow`) — no
 *     dedicated timer, so it never adds a visibility-blind interval (the clock
 *     already throttles itself in a hidden tab).
 */

import { toast } from "solid-sonner";
import { getClockNow } from "../time/clock";
import { app } from "../wire";
import { readJsHeapUsedBytes } from "./memory";

const sub = app.cells.processMemory.use({
  onError: (err) => toast.error(`Memory readout error: ${err.message}`),
});

/** The kolu-server process's RSS in bytes, or undefined before the first server
 *  yield (it's always a real number once a sample lands — the server measures
 *  itself). */
export function serverRssBytes(): number | undefined {
  return sub.value()?.serverRssBytes;
}

/** The kaval daemon's RSS in bytes; `null` when there's no live daemon to
 *  measure (down / degraded / pre-first-poll), or undefined before the first
 *  server yield. */
export function kavalRssBytes(): number | null | undefined {
  return sub.value()?.kavalRssBytes;
}

/** This browser's used JS heap in bytes, refreshed every second off the shared
 *  app clock, or `null` on non-Chromium browsers (which don't expose
 *  `performance.memory`). */
export function clientHeapUsedBytes(): number | null {
  // Re-read on each clock tick — reading the shared `now` signal in a tracking
  // context (JSX/memo) makes the consumer recompute every second.
  getClockNow()();
  return readJsHeapUsedBytes();
}
