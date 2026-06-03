// Self-destructing service worker.
//
// kolu does NOT use a service worker (see docs/cache-bug.md): it can't work
// offline — no live WebSocket means no app — and content-hashed assets are
// already `immutable`-cached by the HTTP cache, while a precaching worker
// reliably served stale builds on a normal reload across deploys.
//
// Earlier builds registered a Workbox worker. This script exists ONLY to retire
// it: the browser's periodic service-worker update check re-fetches `/sw.js`
// (served `no-cache`), finds THIS instead of the old precaching worker, installs
// it, and on activation it deletes every cache, unregisters itself, and reloads
// any tab it controls — so the page comes back fresh from the network with no
// worker. This works even while the old worker still controls the page (when the
// app's own JS can't run to unregister it). New visitors never register it (the
// client no longer calls registerSW), so it is inert for them.

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(retire());
});

async function retire() {
  const keys = await caches.keys().catch(() => []);
  await Promise.all(keys.map((key) => caches.delete(key)));
  await self.registration.unregister();
  const clients = await self.clients.matchAll({ type: "window" });
  for (const client of clients) client.navigate(client.url);
}
