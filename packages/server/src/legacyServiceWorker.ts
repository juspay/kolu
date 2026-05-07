import {
  LEGACY_WORKBOX_CACHE_NAME_MARKERS,
  LEGACY_WORKBOX_CACHE_NAME_PREFIXES,
} from "kolu-common/legacyWorkboxCache";

/**
 * One-release compatibility worker for clients that already installed Kolu's
 * old Workbox app-shell service worker. New builds do not register a service
 * worker, but old registrations still update from `/sw.js`; this script makes
 * that update delete the obsolete cache owner and navigate windows back to the
 * network-served app shell.
 */
const prefixesJson = JSON.stringify(LEGACY_WORKBOX_CACHE_NAME_PREFIXES);
const markersJson = JSON.stringify(LEGACY_WORKBOX_CACHE_NAME_MARKERS);

export const LEGACY_SERVICE_WORKER = `
const LEGACY_WORKBOX_CACHE_NAME_PREFIXES = ${prefixesJson};
const LEGACY_WORKBOX_CACHE_NAME_MARKERS = ${markersJson};

function isLegacyWorkboxCacheName(cacheName) {
  return (
    LEGACY_WORKBOX_CACHE_NAME_PREFIXES.some((prefix) => cacheName.startsWith(prefix)) ||
    LEGACY_WORKBOX_CACHE_NAME_MARKERS.some((marker) => cacheName.includes(marker))
  );
}

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    try {
      await self.registration.unregister();
    } catch (err) {
      console.warn("Legacy service-worker unregister failed:", err);
    }

    try {
      const cacheNames = await self.caches.keys();
      await Promise.all(
        cacheNames
          .filter(isLegacyWorkboxCacheName)
          .map((cacheName) => self.caches.delete(cacheName)),
      );
    } catch (err) {
      console.warn("Legacy Workbox cache cleanup failed:", err);
    }

    const clients = await self.clients.matchAll({
      type: "window",
      includeUncontrolled: true,
    });
    await Promise.all(clients.map((client) => client.navigate(client.url)));
  })());
});
`.trim();
