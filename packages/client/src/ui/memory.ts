/** Byte-count readouts + the Chromium JS-heap probe. The units are
 *  `@kolu/byte-units`' (binary: KiB · MiB · GiB) — the one formatter every byte
 *  figure in kolu goes through; this module only picks each readout's
 *  granularity. Shared by
 *  the Diagnostic Info dialog (the full `used / total (limit)` breakdown), the
 *  chrome-bar rail (the compact whole-MiB readouts) and the State Backups dialog
 *  (snapshot sizes), so the granularity rules live in one place rather than one
 *  formatter per surface with its own thresholds. */

import { formatBytes, formatMiB, mibOf } from "@kolu/byte-units";

/** Bytes → a display string, dropping to KiB below ~100 KiB — a fresh 80×24
 *  buffer is ~23 KiB, and "0.0 MiB" obscures more than it communicates. */
export function formatSize(bytes: number): string {
  if (bytes < 100_000) return formatBytes(bytes);
  return formatMiB(bytes, 1);
}

/** A compact whole-MiB figure (`formatMiB(bytes, 0)`, the rail's granularity —
 *  the same `mibOf` rounding the server's `processMemory` dedup compares on)
 *  with a null guard for the "no figure yet" case (`null`: no kaval daemon, or a
 *  non-Chromium browser with no `performance.memory`) — the rail tooltips and
 *  the info dialogs share it so the fallback string can't drift. */
export function mibText(
  bytes: number | null,
  fallback = "unavailable",
): string {
  return bytes === null ? fallback : formatMiB(bytes, 0);
}

/** `performance.memory` is Chromium-only and missing from the DOM type
 *  definitions — isolate the narrow cast here. Returns null on non-Chromium
 *  browsers (Firefox/Safari don't expose it), which is the honest "this browser
 *  can't tell us", not a degraded fallback. */
export function readJsHeap(): {
  usedMiB: number;
  totalMiB: number;
  limitMiB: number;
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
    // Numbers (to a tenth of a MiB), not strings, so the diagnostic JSON
    // snapshot stays machine-parseable.
    usedMiB: mibOf(mem.usedJSHeapSize, 1),
    totalMiB: mibOf(mem.totalJSHeapSize, 1),
    limitMiB: mibOf(mem.jsHeapSizeLimit, 1),
  };
}

/** This browser's used JS-heap in bytes, or null on non-Chromium browsers. The
 *  rail's client-memory source — raw bytes so the rail formats it the same way
 *  it formats the server/kaval figures (via {@link mibText}). */
export function readJsHeapUsedBytes(): number | null {
  const mem = (performance as { memory?: { usedJSHeapSize: number } }).memory;
  return mem ? mem.usedJSHeapSize : null;
}
