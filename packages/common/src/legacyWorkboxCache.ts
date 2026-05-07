/**
 * Cache names left behind by Kolu's former Workbox app-shell service worker.
 * Workbox's default names are `workbox-<kind>-<scope>`, while older precache
 * cleanup also keys on the `-precache-` marker.
 */
export const LEGACY_WORKBOX_CACHE_NAME_PREFIXES = ["workbox-"] as const;
export const LEGACY_WORKBOX_CACHE_NAME_MARKERS = ["-precache-"] as const;

export function isLegacyWorkboxCacheName(cacheName: string): boolean {
  return (
    LEGACY_WORKBOX_CACHE_NAME_PREFIXES.some((prefix) =>
      cacheName.startsWith(prefix),
    ) ||
    LEGACY_WORKBOX_CACHE_NAME_MARKERS.some((marker) =>
      cacheName.includes(marker),
    )
  );
}
