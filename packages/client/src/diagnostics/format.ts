import type { ServerDiagnostics } from "kolu-common";

/** Single source of truth for byte-count display across the dialog.
 *  `bytesToMB` returns a number (used by the `jsHeap` snapshot shape, which
 *  callers may parse programmatically). `formatMB` returns a display string
 *  and drops to KB below 100 KB — a fresh 80×24 buffer is ~23 KB, and
 *  "0.0 MB" obscures more than it communicates. */
export function bytesToMB(bytes: number): number {
  return Math.round((bytes / 1_048_576) * 10) / 10;
}

export function formatMB(bytes: number): string {
  if (bytes < 100_000) return `${Math.round(bytes / 1024)} KB`;
  return `${bytesToMB(bytes).toFixed(1)} MB`;
}

export function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m`;
}

export function formatDetails(
  details: ServerDiagnostics["trackedResources"][number]["details"],
): string | null {
  const entries = Object.entries(details);
  if (entries.length === 0) return null;
  return entries.map(([key, value]) => `${key}=${String(value)}`).join(" · ");
}

export function formatResourceAge(
  server: ServerDiagnostics,
  resource: ServerDiagnostics["trackedResources"][number],
): string {
  return formatDuration(Math.max(0, server.sampledAt - resource.createdAt));
}
