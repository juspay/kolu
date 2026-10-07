/** Byte-count readouts + the Chromium JS-heap probe. The units are
 *  `@kolu/byte-units`' (binary: KiB · MiB · GiB) — the one formatter every byte
 *  figure in kolu goes through; this module only picks each readout's
 *  granularity. Shared by
 *  the Diagnostic Info dialog (the full `used / total (limit)` breakdown), the
 *  chrome-bar rail (the compact whole-MB readouts) and the State Backups dialog
 *  (snapshot sizes), so the granularity rules live in one place rather than one
 *  formatter per surface with its own thresholds. */

import { formatBytes, formatMiB } from "@kolu/byte-units";
import { BYTES_PER_MB } from "kolu-common/surface";

/** Bytes → megabytes, rounded to 0.1 MB. A number (not a string) so the
 *  diagnostic JSON snapshot stays machine-parseable. */
export function bytesToMB(bytes: number): number {
  return Math.round((bytes / BYTES_PER_MB) * 10) / 10;
}

/** Bytes → a display string, dropping to KiB below ~100 KiB — a fresh 80×24
 *  buffer is ~23 KiB, and "0.0 MiB" obscures more than it communicates. */
export function formatMB(bytes: number): string {
  if (bytes < 100_000) return formatBytes(bytes);
  return formatMiB(bytes, 1);
}

/** Bytes → a compact whole-MiB string for the rail (e.g. `142 MiB`). Coarser
 *  than {@link formatMB} on purpose: the rail wants a glanceable figure. Whole
 *  MiB is the same rounding the server-side sampler dedups on
 *  (`bytesToWholeMB`), so the figure and the dedup boundary can't drift. */
export function formatMBCompact(bytes: number): string {
  return formatMiB(bytes, 0);
}

/** {@link formatMBCompact} with a null guard for the "no figure yet" case
 *  (`null`: no kaval daemon, or a non-Chromium browser with no
 *  `performance.memory`) — the rail tooltips and the info dialogs share it so
 *  the fallback string can't drift. */
export function mbText(bytes: number | null, fallback = "unavailable"): string {
  return bytes === null ? fallback : formatMBCompact(bytes);
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
