import { formatBytes, formatMiB, mibOf } from "@kolu/byte-units";

/** Bytes → a display string, dropping to KiB below ~100 KiB. */
export function formatSize(bytes: number): string {
  if (bytes < 100_000) return formatBytes(bytes);
  return formatMiB(bytes, 1);
}

/** A compact whole-MiB figure with a null guard for the "no figure yet" case. */
export function mibText(
  bytes: number | null,
  fallback = "unavailable",
): string {
  return bytes === null ? fallback : formatMiB(bytes, 0);
}

/** `performance.memory` is Chromium-only and missing from the DOM type
 *  definitions — isolate the narrow cast here. Null on other browsers. */
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
    usedMiB: mibOf(mem.usedJSHeapSize, 1),
    totalMiB: mibOf(mem.totalJSHeapSize, 1),
    limitMiB: mibOf(mem.jsHeapSizeLimit, 1),
  };
}

/** This browser's used JS-heap in bytes, or null on non-Chromium browsers. */
export function readJsHeapUsedBytes(): number | null {
  const mem = (performance as { memory?: { usedJSHeapSize: number } }).memory;
  return mem ? mem.usedJSHeapSize : null;
}
