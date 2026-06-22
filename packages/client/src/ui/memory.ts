/** Byte-count formatting + the Chromium JS-heap probe — the single source of
 *  truth for memory display across the client. Shared by the Diagnostic Info
 *  dialog (the full `used / total (limit)` breakdown) and the chrome-bar rail
 *  (the compact whole-MB readouts), so the granularity rules live in one place. */

import { BYTES_PER_MB, bytesToWholeMB } from "kolu-common/surface";

/** Bytes → megabytes, rounded to 0.1 MB. A number (not a string) so the
 *  diagnostic JSON snapshot stays machine-parseable. */
export function bytesToMB(bytes: number): number {
  return Math.round((bytes / BYTES_PER_MB) * 10) / 10;
}

/** Bytes → a display string, dropping to KB below 100 KB — a fresh 80×24 buffer
 *  is ~23 KB, and "0.0 MB" obscures more than it communicates. */
export function formatMB(bytes: number): string {
  if (bytes < 100_000) return `${Math.round(bytes / 1024)} KB`;
  return `${bytesToMB(bytes).toFixed(1)} MB`;
}

/** Bytes → a compact whole-MB string for the rail (e.g. `142 MB`). Coarser than
 *  {@link formatMB} on purpose: the rail wants a glanceable figure. Built on the
 *  shared {@link bytesToWholeMB}, the same computation the server-side sampler
 *  dedups on — so the rendered figure and the dedup boundary can't drift. */
export function formatMBCompact(bytes: number): string {
  return `${bytesToWholeMB(bytes)} MB`;
}

/** `performance.memory` is Chromium-only and missing from the DOM type
 *  definitions — isolate the narrow cast here. Returns null on non-Chromium
 *  browsers (Firefox/Safari don't expose it), which is the honest "this browser
 *  can't tell us", not a degraded fallback. */
export function readJsHeap(): {
  usedMB: number;
  totalMB: number;
  limitMB: number;
} | null {
  const mem = (
    performance as {
      memory?: {
        usedJSHeapSize: number;
        totalJSHeapSize: number;
        jsHeapSizeLimit: number;
      };
    }
  ).memory;
  if (!mem) return null;
  return {
    usedMB: bytesToMB(mem.usedJSHeapSize),
    totalMB: bytesToMB(mem.totalJSHeapSize),
    limitMB: bytesToMB(mem.jsHeapSizeLimit),
  };
}

/** This browser's used JS-heap in bytes, or null on non-Chromium browsers. The
 *  rail's client-memory source — raw bytes so the rail formats it the same way
 *  it formats the server/kaval figures (via {@link formatMBCompact}). */
export function readJsHeapUsedBytes(): number | null {
  const mem = (performance as { memory?: { usedJSHeapSize: number } }).memory;
  return mem ? mem.usedJSHeapSize : null;
}
